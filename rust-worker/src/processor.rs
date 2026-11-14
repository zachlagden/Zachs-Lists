use anyhow::{anyhow, Result};
use bson::DateTime as BsonDateTime;
use chrono::Utc;
use mongodb::Database;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use crate::cancellation::{Cancellation, Cancelled};
use crate::config::Config;
use crate::db::job::{Job, JobRepository, JobType, JobWriteError};
use crate::db::progress::{
    error_code, GenerationProgress, JobProgress, JobResult, JobStage, OutputFile,
};
use crate::db::user::{ListMetadata, MatchedUser, UserRepository};
use crate::db::user_config::UserConfigRepository;
use crate::downloader::{DownloadResult, Downloader, Source};
use crate::extractor::DomainExtractor;
use crate::progress_tracker::{LiveProgress, ProgressTracker};
use crate::stages::{
    apply_whitelist, extract_source, generate_outputs, plan_whitelist, run_blocking,
    CategoryDomains, ExtractedDomains, SourceBody,
};
use crate::whitelist::WhitelistManager;

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
        })
    }

    /// Compute config hash (SHA256 of blocklists + whitelist)
    fn compute_config_hash(blocklists: &str, whitelist: &str) -> String {
        let combined = format!("{}\n---SEPARATOR---\n{}", blocklists, whitelist);
        let mut hasher = Sha256::new();
        hasher.update(combined.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Compute normalized config fingerprint for cross-user matching
    ///
    /// Creates a fingerprint from sorted, normalized sources and whitelist patterns.
    /// Two configs with same sources and whitelist (regardless of comments/order) → same fingerprint.
    fn compute_config_fingerprint(blocklists: &str, whitelist: &str) -> Result<String> {
        // Parse and sort sources by URL
        let mut sources = Downloader::parse_config(blocklists)?;
        sources.sort_by(|a, b| a.url.cmp(&b.url));

        // Create normalized string representation of sources
        let sources_str: Vec<String> = sources
            .iter()
            .map(|s| {
                format!(
                    "{}|{}|{}",
                    s.url.to_lowercase().trim_end_matches('/'),
                    s.name.to_lowercase(),
                    s.category.as_deref().unwrap_or("").to_lowercase()
                )
            })
            .collect();

        // Parse and sort whitelist patterns
        let patterns = WhitelistManager::parse(whitelist)
            .whitelist
            .patterns_as_strings();

        // Hash combined normalized content
        let combined = format!("{}\n---\n{}", sources_str.join("\n"), patterns.join("\n"));
        let mut hasher = Sha256::new();
        hasher.update(combined.as_bytes());
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Copy output files from a matching user to the target user
    async fn copy_output_files(
        &self,
        source: &MatchedUser,
        target_username: &str,
    ) -> Result<Vec<OutputFile>> {
        let source_dir = self.config.output_dir(&source.username);
        let target_dir = self.config.output_dir(target_username);

        info!(
            "Copying output files from {} to {}",
            source_dir.display(),
            target_dir.display()
        );

        // Ensure target directory exists
        std::fs::create_dir_all(&target_dir)?;

        // Clean up any existing files in target
        if let Ok(entries) = std::fs::read_dir(&target_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "gz") {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }

        // Copy all .gz files from source to target
        let mut output_files = Vec::new();
        let entries = std::fs::read_dir(&source_dir)?;

        for entry in entries.flatten() {
            let filename = entry.file_name();
            let filename_str = filename.to_string_lossy();

            if filename_str.ends_with(".txt.gz") {
                let source_path = entry.path();
                let target_path = target_dir.join(&filename);

                std::fs::copy(&source_path, &target_path)?;

                // Extract format and domain count from filename
                // Format: {name}_{format}.txt.gz (e.g., all_domains_hosts.txt.gz)
                let base_name = filename_str.trim_end_matches(".txt.gz");
                let parts: Vec<&str> = base_name.rsplitn(2, '_').collect();
                let format = if parts.len() == 2 {
                    parts[0].to_string()
                } else {
                    "unknown".to_string()
                };

                // Get domain count from source's list metadata if available
                let domain_count = source
                    .lists
                    .iter()
                    .find(|l| base_name.starts_with(&l.name))
                    .map(|l| l.domain_count)
                    .unwrap_or(0);

                let size_bytes = std::fs::metadata(&target_path)?.len();

                output_files.push(OutputFile {
                    name: filename_str.to_string(),
                    format,
                    size_bytes,
                    domain_count,
                });

                debug!("Copied {} ({} bytes)", filename_str, size_bytes);
            }
        }

        info!(
            "Copied {} output files ({} bytes total)",
            output_files.len(),
            output_files.iter().map(|f| f.size_bytes).sum::<u64>()
        );

        Ok(output_files)
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
        info!("Processing job {} for user {}", job.job_id, job.username);

        if job.force_rebuild {
            info!("Force rebuild requested - bypassing all caching optimizations");
        }

        self.cancellation.check()?;

        let BuildConfig {
            blocklists: config_content,
            whitelist: whitelist_content,
        } = self.build_config(job).await?;

        // Parse sources
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

        // Compute current config hash
        let current_config_hash = Self::compute_config_hash(&config_content, &whitelist_content);

        // Compute normalized fingerprint for cross-user matching
        let config_fingerprint =
            Self::compute_config_fingerprint(&config_content, &whitelist_content)?;

        info!("Found {} sources to process", sources.len());

        // Check for "no changes" optimization
        // Skip if: config hash unchanged AND all sources would be cache hits
        if job.job_type != JobType::Scheduled && !job.force_rebuild {
            if let Ok(Some(stored_hash)) = self.user_repo.get_config_hash(&job.username).await {
                if stored_hash == current_config_hash {
                    // Config unchanged, check if all sources are cached
                    let all_cached = self.downloader.check_all_cached(&sources).await;
                    if all_cached {
                        info!(
                            "Skipping job {} - no changes detected (config hash matches, all sources cached)",
                            job.job_id
                        );
                        self.job_repo
                            .skip(
                                &job.id,
                                "No changes detected since last build. All sources are cached and configuration unchanged.",
                            )
                            .await?;
                        return Ok(());
                    }
                }
            }
        }

        self.cancellation.check()?;

        // Check for matching config fingerprint in other users (copy-on-match optimization)
        if job.job_type != JobType::Scheduled && !job.force_rebuild {
            if let Ok(Some(matched)) = self
                .user_repo
                .find_user_by_fingerprint(&config_fingerprint, &job.username)
                .await
            {
                info!(
                    "Config matches user '{}' - copying output files instead of rebuilding",
                    matched.username
                );

                // Get source user's last job stats first (needed for domain counts and stats)
                let source_stats = self
                    .job_repo
                    .get_last_completed_result(&matched.username)
                    .await
                    .ok()
                    .flatten();

                // Copy output files from matched user
                match self.copy_output_files(&matched, &job.username).await {
                    Ok(mut output_files) => {
                        // Populate domain counts from source_stats.output_files if available
                        // This handles the case where matched.lists is empty (e.g., __default__)
                        if let Some(ref src) = source_stats {
                            for file in &mut output_files {
                                if let Some(src_file) =
                                    src.output_files.iter().find(|f| f.name == file.name)
                                {
                                    file.domain_count = src_file.domain_count;
                                }
                            }
                        }

                        let total_output_size: u64 =
                            output_files.iter().map(|f| f.size_bytes).sum();
                        let unique_domains = output_files
                            .iter()
                            .find(|f| f.name.starts_with("all_domains"))
                            .map(|f| f.domain_count)
                            .unwrap_or_else(|| {
                                // Fallback to source stats or matched.total_domains
                                source_stats
                                    .as_ref()
                                    .map(|s| s.unique_domains)
                                    .unwrap_or(matched.total_domains)
                            });

                        // Build result indicating this was a copy, with stats from source
                        let result = JobResult::copied_from_user(
                            matched.username.clone(),
                            source_stats.as_ref(),
                            matched.total_domains,
                            unique_domains,
                            output_files.clone(),
                        );

                        // Copy full progress from source job (includes whitelist breakdown, stage snapshots)
                        let progress = if let Ok(Some(mut source_progress)) = self
                            .job_repo
                            .get_last_completed_progress(&matched.username)
                            .await
                        {
                            // Ensure it shows as completed
                            source_progress.current_step = "completed".to_string();
                            source_progress.stage = JobStage::Completed;
                            source_progress
                        } else {
                            // Fallback to minimal progress if source not found
                            let sources_count = source_stats
                                .as_ref()
                                .map(|s| s.sources_processed + s.sources_failed)
                                .unwrap_or(0);
                            JobProgress::completed_copy(sources_count)
                        };

                        // Mark job as completed
                        self.job_repo.complete(&job.id, &result, &progress).await?;

                        // Build list metadata from output files
                        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
                        let mut all_lists: Vec<ListMetadata> = Vec::new();

                        // If we have lists from matched user, use those
                        if !matched.lists.is_empty() {
                            for list in &matched.lists {
                                all_lists.push(ListMetadata {
                                    name: list.name.clone(),
                                    is_public: true,
                                    formats: list.formats.clone(),
                                    domain_count: list.domain_count,
                                    last_updated: now,
                                });
                            }
                        } else {
                            // Build list metadata from output files
                            let mut seen_names: HashSet<String> = HashSet::new();
                            for file in &output_files {
                                let base_name = file.name.trim_end_matches(".txt.gz");
                                let name = base_name.rsplitn(2, '_').last().unwrap_or(base_name);
                                if !seen_names.contains(name) {
                                    seen_names.insert(name.to_string());
                                    all_lists.push(ListMetadata {
                                        name: name.to_string(),
                                        is_public: true,
                                        formats: vec![
                                            "hosts".to_string(),
                                            "plain".to_string(),
                                            "adblock".to_string(),
                                        ],
                                        domain_count: file.domain_count,
                                        last_updated: now,
                                    });
                                }
                            }
                        }

                        // Update user document
                        if let Err(e) = self
                            .user_repo
                            .update_after_build(
                                &job.username,
                                all_lists,
                                unique_domains,
                                total_output_size,
                                current_config_hash.clone(),
                                config_fingerprint.clone(),
                            )
                            .await
                        {
                            warn!("Failed to update user document for {}: {}", job.username, e);
                        }

                        let duration = start_time.elapsed();
                        info!(
                            "Job {} completed in {:.2}s (copied from {}) - {} domains",
                            job.job_id,
                            duration.as_secs_f64(),
                            matched.username,
                            unique_domains
                        );

                        return Ok(());
                    }
                    Err(e) => {
                        // Copy failed, fall through to normal build
                        warn!(
                            "Failed to copy files from {}: {} - proceeding with normal build",
                            matched.username, e
                        );
                    }
                }
            }
        }

        let tracker = Arc::new(ProgressTracker::downloading(&sources));
        let flusher = live.insert(LiveProgress::start(
            self.job_repo.clone(),
            job.id,
            Arc::clone(&tracker),
            self.cancellation.clone(),
            Duration::from_millis(self.config.progress_update_interval_ms),
        ));
        flusher.flush_now().await?;

        let extracted = self
            .download_and_extract_stage(sources, job.force_rebuild, &tracker)
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
        let plan = run_blocking(move || {
            Ok(plan_whitelist(
                &whitelist_content,
                extracted,
                &cancellation,
            )?)
        })
        .await?;
        tracker.begin_whitelist(
            plan.domains_before,
            plan.parsed.whitelist.pattern_count() as u64,
        )?;
        flusher.flush_now().await?;

        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(&tracker);
        let filtered = run_blocking(move || {
            Ok(apply_whitelist(plan, &cancellation, &|newly_removed| {
                reporting.whitelist_removed(newly_removed)
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

        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(&tracker);
        let output_dir = self.config.output_dir(&job.username);
        let domains: CategoryDomains = filtered.domains;
        let generated = run_blocking(move || {
            generate_outputs(output_dir, domains, &cancellation, &|event| {
                reporting.generation_event(event)
            })
        })
        .await?;
        let output_files = generated.files;
        tracker.complete()?;

        // Get unique domains from the combined "all_domains" file
        let unique_domains = output_files
            .iter()
            .find(|f| f.name.starts_with("all_domains"))
            .map(|f| f.domain_count)
            .unwrap_or(0);

        // Calculate total output size
        let total_output_size: u64 = output_files.iter().map(|f| f.size_bytes).sum();

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
            output_files: output_files.clone(),
            categories: generated.categories,
            warnings,
            ..JobResult::default()
        };

        self.cancellation.check()?;

        let final_progress = match live.take() {
            Some(flusher) => flusher.stop().await?,
            None => return Err(BuildError::Internal(anyhow!("progress writer is missing"))),
        };
        self.job_repo
            .complete(&job.id, &result, &final_progress)
            .await?;

        // Update user document with lists and stats
        // Build list metadata for all categories + all_domains
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let mut all_lists: Vec<ListMetadata> = Vec::new();

        // Group output files by category to build ListMetadata for each
        // Files are named: {category}_{format}.txt.gz (e.g., advertising_hosts.txt.gz)
        // or all_domains_{format}.txt.gz for the combined list
        let mut category_domain_counts: HashMap<String, u64> = HashMap::new();
        for file in &output_files {
            // Skip all_domains files - handled separately below
            if file.name.starts_with("all_domains") {
                continue;
            }

            // Extract category name: e.g., "advertising_hosts.txt.gz" -> "advertising"
            // or "uncategorized_hosts.txt.gz" -> "uncategorized"
            if let Some(category) = file.name.split('_').next() {
                // Only count hosts format files to get domain count (avoid triple-counting)
                if file.format == "hosts" {
                    category_domain_counts.insert(category.to_string(), file.domain_count);
                }
            }
        }

        // Build ListMetadata for each category
        for (category, domain_count) in &category_domain_counts {
            let list = ListMetadata {
                name: category.clone(),
                is_public: true, // All lists are always public
                formats: vec![
                    "hosts".to_string(),
                    "plain".to_string(),
                    "adblock".to_string(),
                ],
                domain_count: *domain_count,
                last_updated: now,
            };
            all_lists.push(list);
        }

        // Add all_domains (combined list)
        let all_domains_list = ListMetadata {
            name: "all_domains".to_string(),
            is_public: true, // All lists are always public
            formats: vec![
                "hosts".to_string(),
                "plain".to_string(),
                "adblock".to_string(),
            ],
            domain_count: unique_domains,
            last_updated: now,
        };
        all_lists.push(all_domains_list);

        info!(
            "Saving {} lists for user {}: {:?}",
            all_lists.len(),
            job.username,
            all_lists.iter().map(|l| &l.name).collect::<Vec<_>>()
        );

        // Update user document
        if let Err(e) = self
            .user_repo
            .update_after_build(
                &job.username,
                all_lists,
                unique_domains,
                total_output_size,
                current_config_hash,
                config_fingerprint,
            )
            .await
        {
            warn!("Failed to update user document for {}: {}", job.username, e);
            // Don't fail the job for this - it's not critical
        }

        let duration = start_time.elapsed();
        info!(
            "Job {} completed in {:.2}s - {} domains",
            job.job_id,
            duration.as_secs_f64(),
            unique_domains
        );

        Ok(())
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
        sources: Vec<Source>,
        force: bool,
        tracker: &Arc<ProgressTracker>,
    ) -> Result<ExtractedDomains, BuildError> {
        let (handoff, mut downloads) = mpsc::channel::<Downloaded>(DOWNLOAD_HANDOFF_CAPACITY);
        let categories: Vec<Option<String>> = sources
            .iter()
            .map(|source| source.category.clone())
            .collect();
        let mut dispatcher = self.start_downloads_in_config_order(sources, force, tracker, handoff);

        let mut extracted = ExtractedDomains::default();
        loop {
            self.cancellation.check()?;
            let downloaded =
                match tokio::time::timeout(CANCELLATION_CHECK_INTERVAL, downloads.recv()).await {
                    Err(_) => continue,
                    Ok(None) => break,
                    Ok(Some(downloaded)) => downloaded,
                };
            extracted = self
                .extract_downloaded(downloaded, &categories, extracted, tracker)
                .await?;
        }

        while let Some(dispatched) = dispatcher.join_next().await {
            dispatched
                .and_then(|downloads| downloads)
                .map_err(|stopped| anyhow!("A source download task failed: {stopped}"))?;
        }
        self.cancellation.check()?;

        Ok(extracted)
    }

    async fn extract_downloaded(
        &self,
        downloaded: Downloaded,
        categories: &[Option<String>],
        extracted: ExtractedDomains,
        tracker: &Arc<ProgressTracker>,
    ) -> Result<ExtractedDomains, BuildError> {
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
        let body = SourceBody {
            source_index: index,
            category: categories.get(index).cloned().flatten(),
            content,
        };

        tracker.source_extracting(index);
        let extractor = Arc::clone(&self.extractor);
        let cancellation = self.cancellation.clone();
        let reporting = Arc::clone(tracker);
        let (extracted, extraction) = run_blocking(move || {
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

#[cfg(test)]
#[path = "processor_tests.rs"]
mod tests;
