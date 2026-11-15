use anyhow::{anyhow, Result};
use bson::DateTime as BsonDateTime;
use mongodb::Database;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use crate::cancellation::{Cancellation, Cancelled};
use crate::config::Config;
use crate::db::cache::content_hash;
use crate::db::job::{Job, JobRepository, JobWriteError};
use crate::db::progress::{error_code, GenerationProgress, JobProgress, JobResult};
use crate::db::user::{ListMetadata, Publication, PublishOutcome, Target, UserRepository};
use crate::db::user_config::UserConfigRepository;
use crate::downloader::{DownloadResult, Downloader, Source};
use crate::extractor::DomainExtractor;
use crate::generation::{
    discard_generation, manifest_exists, prune_generations, remove_empty_directories,
    remove_legacy_flat_files, BuildIdentity, Manifest,
};
use crate::generator::COMBINED_LIST_NAME;
use crate::inputs_digest::{inputs_digest, PROCESSOR_VERSION};
use crate::progress_tracker::{LiveProgress, ProgressTracker};
use crate::stages::{
    apply_whitelist, extract_source, generate_outputs, plan_whitelist, CategoryDomains,
    GeneratedOutput, SourceBody, StageThread,
};

pub const UNCHANGED_SKIP_REASON: &str = "Nothing changed since the last build";
pub const SUPERSEDED_SKIP_REASON: &str =
    "A newer build has already published these lists, so this build was not published";
const TARGET_MISSING_MESSAGE: &str = "The account was deleted before the build could be published";
const EMPTY_DIRECTORY_LEVELS_ABOVE_GENERATIONS: usize = 3;

const CANCELLATION_CHECK_INTERVAL: Duration = Duration::from_millis(100);
const DOWNLOAD_HANDOFF_CAPACITY: usize = 1;

struct Downloaded {
    index: usize,
    result: DownloadResult,
    held_slot: OwnedSemaphorePermit,
}

#[derive(Debug)]
pub struct BuildFailure {
    pub error: BuildError,
    pub progress: Option<Box<JobProgress>>,
}

#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    #[error("the build was cancelled")]
    Cancelled,
    #[error("the job lease was lost")]
    LeaseLost,
    #[error("{message}")]
    Rejected { code: &'static str, message: String },
    #[error("{0:#}")]
    Internal(anyhow::Error),
}

impl BuildError {
    fn rejected(code: &'static str, message: &str) -> Self {
        Self::Rejected {
            code,
            message: message.to_string(),
        }
    }
}

impl From<anyhow::Error> for BuildError {
    fn from(error: anyhow::Error) -> Self {
        if error.downcast_ref::<Cancelled>().is_some() {
            return Self::Cancelled;
        }
        if matches!(
            error.downcast_ref::<JobWriteError>(),
            Some(JobWriteError::LeaseLost)
        ) {
            return Self::LeaseLost;
        }
        Self::Internal(error)
    }
}

impl From<JobWriteError> for BuildError {
    fn from(error: JobWriteError) -> Self {
        match error {
            JobWriteError::LeaseLost => Self::LeaseLost,
            other => Self::Internal(other.into()),
        }
    }
}

impl From<Cancelled> for BuildError {
    fn from(_: Cancelled) -> Self {
        Self::Cancelled
    }
}

struct BuildConfig {
    blocklists: String,
    whitelist: String,
}

/// Main job processor that orchestrates the entire pipeline
pub struct JobProcessor {
    cancellation: Cancellation,
    config: Config,
    job_repo: JobRepository,
    user_config_repo: UserConfigRepository,
    user_repo: UserRepository,
    downloader: Arc<Downloader>,
    extractor: Arc<DomainExtractor>,
    stage_thread: StageThread,
}

impl JobProcessor {
    /// Create a new job processor
    pub fn new(
        config: Config,
        job_repo: JobRepository,
        db: &Database,
        cancellation: Cancellation,
    ) -> Result<Self> {
        let downloader = Arc::new(Downloader::new(config.clone(), db)?);
        let extractor = Arc::new(DomainExtractor::new());
        let user_config_repo = UserConfigRepository::new(db);
        let user_repo = UserRepository::new(db);

        Ok(Self {
            cancellation,
            config,
            job_repo,
            user_config_repo,
            user_repo,
            downloader,
            extractor,
            stage_thread: StageThread::start()?,
        })
    }

    async fn build_config(&self, job: &Job) -> Result<BuildConfig> {
        if let Some(snapshot) = &job.config_snapshot {
            return Ok(BuildConfig {
                blocklists: snapshot.blocklists.clone(),
                whitelist: snapshot.whitelist.clone().unwrap_or_default(),
            });
        }
        let stored = self.user_config_repo.get_config(&job.username).await?;
        Ok(BuildConfig {
            blocklists: stored.blocklists.unwrap_or_default(),
            whitelist: stored.whitelist.unwrap_or_default(),
        })
    }

    /// Process a single job
    pub async fn process_job(&self, job: &Job) -> Result<(), BuildFailure> {
        let mut live = None;
        let Err(error) = self.build(job, &mut live).await else {
            return Ok(());
        };
        let progress = match live.take() {
            Some(live) => match live.stop().await {
                Ok(progress) => Some(Box::new(progress)),
                Err(stopped) => {
                    warn!(
                        "Progress writer for job {} did not stop cleanly: {:#}",
                        job.job_id, stopped
                    );
                    None
                }
            },
            None => None,
        };
        Err(BuildFailure { error, progress })
    }

    async fn build(&self, job: &Job, live: &mut Option<LiveProgress>) -> Result<(), BuildError> {
        let start_time = Instant::now();
        info!(
            "Processing {:?} job {} for user {}",
            job.job_type, job.job_id, job.username
        );

        if job.force_rebuild {
            info!("Force rebuild requested: the build publishes even when nothing changed");
        }

        self.cancellation.check()?;

        let BuildConfig {
            blocklists: config_content,
            whitelist: whitelist_content,
        } = self.build_config(job).await?;

        let sources =
            Downloader::parse_config(&config_content).map_err(|invalid| BuildError::Rejected {
                code: error_code::INVALID_CONFIG,
                message: format!("Blocklist configuration is invalid: {invalid}"),
            })?;
        if sources.is_empty() {
            return Err(BuildError::rejected(
                error_code::NO_SOURCES,
                "No valid sources in config",
            ));
        }

        info!("Found {} sources to process", sources.len());
        self.cancellation.check()?;

        let tracker = Arc::new(ProgressTracker::downloading(&sources));
        let flusher = live.insert(LiveProgress::start(
            self.job_repo.clone(),
            job.id,
            Arc::clone(&tracker),
            self.cancellation.clone(),
            Duration::from_millis(self.config.progress_update_interval_ms),
        ));
        flusher.flush_now().await?;

        let (extracted, content_hashes) = self
            .download_and_extract_stage(&sources, job.force_rebuild, &tracker)
            .await?;
        let downloaded = tracker.source_summary();

        if downloaded.completed == 0 {
            return Err(BuildError::rejected(
                error_code::ALL_SOURCES_FAILED,
                "All source downloads failed",
            ));
        }

        info!(
            "Extracted domains from {} sources across {} categories",
            downloaded.completed,
            extracted.category_count()
        );

        if extracted.is_empty() {
            return Err(BuildError::rejected(
                error_code::NO_DOMAINS,
                "No domains extracted",
            ));
        }

        self.cancellation.check()?;

        let cancellation = self.cancellation.clone();
        let (plan, digest) = self
            .stage_thread
            .run(move || {
                let plan = plan_whitelist(&whitelist_content, extracted, &cancellation)?;
                let digest = inputs_digest(
                    PROCESSOR_VERSION,
                    &sources,
                    &plan.parsed.whitelist.patterns_as_strings(),
                    &content_hashes,
                );
                Ok((plan, digest))
            })
            .await?;

        let target = Target {
            username: &job.username,
            user_id: job.user_id,
        };
        let output_dir = self.config.output_dir(&job.username);
        if !job.force_rebuild
            && self
                .is_already_published(&target, &output_dir, &digest)
                .await?
        {
            info!(
                "Skipping job {}: its inputs match the published generation",
                job.job_id
            );
            if let Some(flusher) = live.take() {
                flusher.stop().await?;
            }
            self.job_repo.skip(&job.id, UNCHANGED_SKIP_REASON).await?;
            return Ok(());
        }

        tracker.begin_whitelist(
            plan.domains_before,
            plan.parsed.whitelist.pattern_count() as u64,
        )?;
        flusher.flush_now().await?;

        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(&tracker);
        let filtered = self
            .stage_thread
            .run(move || {
                Ok(apply_whitelist(plan, &cancellation, &|tick| {
                    reporting.whitelist_checked(tick.checked, tick.newly_removed)
                })?)
            })
            .await?;
        let whitelist_removed = filtered.progress.total_removed;
        if filtered.ignored_lines > 0 {
            warn!(
                "Ignored {} unusable whitelist lines for {}",
                filtered.ignored_lines, job.username
            );
        }
        info!(
            "{} domains after whitelist filtering ({} removed)",
            filtered.progress.domains_after, whitelist_removed
        );
        tracker.whitelist_finished(filtered.progress);

        self.cancellation.check()?;

        tracker.begin_generation(GenerationProgress::pending(
            filtered.generation.files_total,
            filtered.generation.domains_per_format,
        ))?;
        flusher.flush_now().await?;

        let identity = BuildIdentity {
            job_id: job.job_id.clone(),
            job_created_at: job.created_at.to_chrono(),
            attempt: job.attempt,
            inputs_digest: digest,
        };
        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(&tracker);
        let generation_output_dir = output_dir.clone();
        let domains: CategoryDomains = filtered.domains;
        let generated = self
            .stage_thread
            .run(move || {
                generate_outputs(
                    generation_output_dir,
                    identity,
                    domains,
                    &cancellation,
                    &|event| reporting.generation_event(event),
                )
            })
            .await?;
        let GeneratedOutput {
            generation,
            categories,
        } = generated;
        let manifest = generation.manifest;

        let unique_domains = manifest
            .files
            .iter()
            .find(|file| file.list == COMBINED_LIST_NAME)
            .map(|file| file.domain_count)
            .unwrap_or(0);
        let mut warnings = downloaded.warnings;
        if filtered.ignored_lines > 0 {
            warnings.push(format!(
                "{} whitelist lines were ignored because they are not valid patterns",
                filtered.ignored_lines
            ));
        }
        let result = JobResult {
            sources_processed: downloaded.completed,
            sources_failed: downloaded.failed,
            sources_stale: downloaded.stale,
            total_domains: downloaded.total_domains,
            unique_domains,
            whitelisted_removed: whitelist_removed,
            output_files: manifest
                .files
                .iter()
                .map(|file| file.output_file())
                .collect(),
            categories,
            warnings,
            generation_id: Some(manifest.generation_id.clone()),
            ..JobResult::default()
        };

        let mut pointer_may_have_moved = false;
        let outcome = self
            .publish_and_complete(
                job,
                &target,
                &manifest,
                &result,
                &tracker,
                live,
                &mut pointer_may_have_moved,
            )
            .await;
        if !pointer_may_have_moved {
            self.discard_unpublished(&output_dir, &manifest.generation_id)
                .await;
        }
        if matches!(
            outcome,
            Err(BuildError::Rejected {
                code: error_code::TARGET_MISSING,
                ..
            })
        ) {
            self.remove_directories_of_missing_target(&output_dir).await;
        }
        outcome?;

        info!(
            "Job {} finished in {:.2}s with {} domains",
            job.job_id,
            start_time.elapsed().as_secs_f64(),
            unique_domains
        );

        Ok(())
    }

    async fn is_already_published(
        &self,
        target: &Target<'_>,
        output_dir: &Path,
        digest: &str,
    ) -> Result<bool, BuildError> {
        let Some(published) = self.user_repo.published_state(target).await? else {
            return Ok(false);
        };
        if published.inputs_digest.as_deref() != Some(digest) {
            return Ok(false);
        }
        let output_dir = output_dir.to_path_buf();
        Ok(self
            .stage_thread
            .run(move || Ok(manifest_exists(&output_dir, &published.generation_id)))
            .await?)
    }

    #[allow(clippy::too_many_arguments)]
    async fn publish_and_complete(
        &self,
        job: &Job,
        target: &Target<'_>,
        manifest: &Manifest,
        result: &JobResult,
        tracker: &ProgressTracker,
        live: &mut Option<LiveProgress>,
        pointer_may_have_moved: &mut bool,
    ) -> Result<(), BuildError> {
        self.cancellation.check()?;
        tracker.complete()?;
        let final_progress = match live.take() {
            Some(flusher) => flusher.stop().await?,
            None => return Err(BuildError::Internal(anyhow!("progress writer is missing"))),
        };
        self.cancellation.check()?;

        let lists = list_metadata(manifest);
        info!(
            "Publishing generation {} with {} lists for {}",
            manifest.generation_id,
            lists.len(),
            job.username
        );
        *pointer_may_have_moved = true;
        let published = self
            .user_repo
            .publish(
                target,
                &Publication {
                    generation_id: &manifest.generation_id,
                    job_id: &job.job_id,
                    job_created_at: job.created_at,
                    attempt: job.attempt,
                    inputs_digest: &manifest.inputs_digest,
                    lists: &lists,
                    total_domains: result.unique_domains,
                    total_output_size_bytes: manifest.total_size_bytes(),
                },
            )
            .await?;
        let replaced = match published {
            PublishOutcome::Published { replaced } => replaced,
            PublishOutcome::Superseded => {
                info!(
                    "Job {} was not published because a newer build already was",
                    job.job_id
                );
                *pointer_may_have_moved = false;
                self.job_repo.skip(&job.id, SUPERSEDED_SKIP_REASON).await?;
                return Ok(());
            }
            PublishOutcome::TargetMissing => {
                *pointer_may_have_moved = false;
                return Err(BuildError::rejected(
                    error_code::TARGET_MISSING,
                    TARGET_MISSING_MESSAGE,
                ));
            }
        };

        let completed = self
            .job_repo
            .complete(&job.id, result, &final_progress)
            .await;
        self.tidy_after_publish(job, manifest, replaced).await;
        Ok(completed?)
    }

    async fn tidy_after_publish(&self, job: &Job, manifest: &Manifest, replaced: Option<String>) {
        let output_dir = self.config.output_dir(&job.username);
        let published = manifest.order();
        let generation_id = manifest.generation_id.clone();
        let tidied = self
            .stage_thread
            .run(move || {
                let mut keep = vec![generation_id.as_str()];
                keep.extend(replaced.as_deref());
                let pruned = prune_generations(&output_dir, published, &keep, SystemTime::now())?;
                Ok((pruned, remove_legacy_flat_files(&output_dir)?))
            })
            .await;
        match tidied {
            Ok((pruned, legacy_removed)) => {
                if legacy_removed > 0 {
                    info!(
                        "Removed {} files of the old flat layout for {}",
                        legacy_removed, job.username
                    );
                }
                debug!("Kept generations {:?} for {}", pruned.kept, job.username);
            }
            Err(error) => warn!(
                "Could not tidy old output for {} after publishing: {:#}",
                job.username, error
            ),
        }
    }

    async fn discard_unpublished(&self, output_dir: &Path, generation_id: &str) {
        let output_dir = output_dir.to_path_buf();
        let generation_id = generation_id.to_string();
        let discarded = self
            .stage_thread
            .run(move || discard_generation(&output_dir, &generation_id))
            .await;
        if let Err(error) = discarded {
            warn!("Could not remove an unpublished generation: {:#}", error);
        }
    }

    async fn remove_directories_of_missing_target(&self, output_dir: &Path) {
        let generations = crate::generation::generations_dir(output_dir);
        let removed = self
            .stage_thread
            .run(move || {
                remove_empty_directories(&generations, EMPTY_DIRECTORY_LEVELS_ABOVE_GENERATIONS)
            })
            .await;
        if let Err(error) = removed {
            warn!(
                "Could not remove the directories of a deleted account: {:#}",
                error
            );
        }
    }

    fn start_downloads_in_config_order(
        &self,
        sources: Vec<Source>,
        force: bool,
        tracker: &Arc<ProgressTracker>,
        handoff: mpsc::Sender<Downloaded>,
    ) -> JoinSet<Result<(), tokio::task::JoinError>> {
        let slots = Arc::new(Semaphore::new(self.config.max_concurrent_downloads.max(1)));
        let downloader = Arc::clone(&self.downloader);
        let tracker = Arc::clone(tracker);
        let cancellation = self.cancellation.clone();
        let mut dispatcher = JoinSet::new();
        dispatcher.spawn(async move {
            let mut downloads = JoinSet::new();
            for (index, source) in sources.into_iter().enumerate() {
                let Ok(held_slot) = Arc::clone(&slots).acquire_owned().await else {
                    break;
                };
                if cancellation.is_cancelled() {
                    break;
                }
                let handoff = handoff.clone();
                let downloader = Arc::clone(&downloader);
                let tracker = Arc::clone(&tracker);
                downloads.spawn(async move {
                    tracker.source_started(index);
                    let report_bytes =
                        |downloaded, total| tracker.source_bytes(index, downloaded, total);
                    let result = downloader
                        .download_source_reporting(&source, force, &report_bytes)
                        .await;
                    tracker.source_downloaded(index, &result);
                    let handed_over = handoff
                        .send(Downloaded {
                            index,
                            result,
                            held_slot,
                        })
                        .await;
                    if handed_over.is_err() {
                        debug!("Build stopped before {} could be extracted", source.name);
                    }
                });
            }
            drop(handoff);
            while let Some(joined) = downloads.join_next().await {
                joined?;
            }
            Ok(())
        });
        dispatcher
    }

    async fn download_and_extract_stage(
        &self,
        sources: &[Source],
        force: bool,
        tracker: &Arc<ProgressTracker>,
    ) -> Result<(CategoryDomains, Vec<Option<String>>), BuildError> {
        let (handoff, mut downloads) = mpsc::channel::<Downloaded>(DOWNLOAD_HANDOFF_CAPACITY);
        let categories: Vec<Option<String>> = sources
            .iter()
            .map(|source| source.category.clone())
            .collect();
        let mut dispatcher =
            self.start_downloads_in_config_order(sources.to_vec(), force, tracker, handoff);

        let mut extracted = CategoryDomains::default();
        let mut content_hashes: Vec<Option<String>> = vec![None; sources.len()];
        loop {
            self.cancellation.check()?;
            let downloaded =
                match tokio::time::timeout(CANCELLATION_CHECK_INTERVAL, downloads.recv()).await {
                    Err(_) => continue,
                    Ok(None) => break,
                    Ok(Some(downloaded)) => downloaded,
                };
            extracted = self
                .extract_downloaded(
                    downloaded,
                    &categories,
                    extracted,
                    &mut content_hashes,
                    tracker,
                )
                .await?;
        }

        while let Some(dispatched) = dispatcher.join_next().await {
            dispatched
                .and_then(|downloads| downloads)
                .map_err(|stopped| anyhow!("A source download task failed: {stopped}"))?;
        }
        self.cancellation.check()?;

        Ok((extracted, content_hashes))
    }

    async fn extract_downloaded(
        &self,
        downloaded: Downloaded,
        categories: &[Option<String>],
        extracted: CategoryDomains,
        content_hashes: &mut [Option<String>],
        tracker: &Arc<ProgressTracker>,
    ) -> Result<CategoryDomains, BuildError> {
        let Downloaded {
            index,
            mut result,
            held_slot,
        } = downloaded;
        if result.error.is_some() {
            return Ok(extracted);
        }
        let content = result
            .content
            .take()
            .ok_or_else(|| anyhow!("Source {} has no body to extract", result.source.name))?;
        if let Some(used) = content_hashes.get_mut(index) {
            *used = Some(
                result
                    .content_hash
                    .take()
                    .unwrap_or_else(|| content_hash(&content)),
            );
        }
        let body = SourceBody {
            source_index: index,
            category: categories.get(index).cloned().flatten(),
            content,
        };

        tracker.source_extracting(index);
        let extractor = Arc::clone(&self.extractor);
        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(tracker);
        let (extracted, extraction) = self
            .stage_thread
            .run(move || {
                let mut extracted = extracted;
                let extraction =
                    extract_source(&extractor, body, &mut extracted, &cancellation, &|count| {
                        reporting.source_domains_extracted(index, count)
                    })?;
                Ok((extracted, extraction))
            })
            .await?;
        drop(held_slot);

        debug!(
            "Extracted {} domains from {} (formats: {:?})",
            extraction.domain_count,
            result.source.name,
            extraction.format_breakdown.detected_formats()
        );
        tracker.source_completed(
            index,
            extraction.domain_count,
            result.previous_domain_count,
            extraction.format_breakdown,
        );

        if let Err(e) = self
            .downloader
            .update_domain_count(&result.url_hash, extraction.domain_count)
            .await
        {
            warn!(
                "Failed to update domain count in cache for {}: {}",
                result.source.name, e
            );
        }

        Ok(extracted)
    }
}

fn list_metadata(manifest: &Manifest) -> Vec<ListMetadata> {
    let published_at = BsonDateTime::from_chrono(manifest.created_at);
    let mut lists: BTreeMap<&str, ListMetadata> = BTreeMap::new();
    for file in &manifest.files {
        let list = lists
            .entry(file.list.as_str())
            .or_insert_with(|| ListMetadata {
                name: file.list.clone(),
                is_public: true,
                formats: Vec::new(),
                domain_count: file.domain_count,
                last_updated: published_at,
            });
        list.formats.push(file.format.clone());
    }
    let format_order = |format: &String| {
        crate::db::progress::OUTPUT_FORMAT_NAMES
            .iter()
            .position(|known| known == format)
    };
    lists
        .into_values()
        .map(|mut list| {
            list.formats.sort_by_key(format_order);
            list
        })
        .collect()
}

#[cfg(test)]
#[path = "processor_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "publishing_tests.rs"]
mod publishing_tests;
