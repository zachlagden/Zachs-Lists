use anyhow::Result;
use bson::DateTime as BsonDateTime;
use chrono::Utc;
use mongodb::Database;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::db::job::{Job, JobRepository};
use crate::db::progress::{
    JobProgress, JobResult, OutputFile, SourceProgress,
    SourceStatus,
};
use crate::db::user::{ListMetadata, UserRepository};
use crate::db::user_config::UserConfigRepository;
use crate::downloader::{DownloadResult, Downloader, Source};
use crate::extractor::DomainExtractor;
use crate::generator::OutputGenerator;
use crate::whitelist::WhitelistManager;

/// Domains organized by category for per-category output generation
pub struct CategoryDomains {
    /// Map from category name to domains in that category
    /// None key = uncategorized sources
    pub by_category: HashMap<Option<String>, HashSet<String>>,
}

impl CategoryDomains {
    pub fn new() -> Self {
        Self { by_category: HashMap::new() }
    }

    /// Get all unique domains across all categories
    pub fn all_unique(&self) -> HashSet<String> {
        self.by_category.values().flatten().cloned().collect()
    }

    /// Total domain count across all categories (deduplicated)
    pub fn total_count(&self) -> usize {
        self.all_unique().len()
    }

    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.by_category.values().all(|d| d.is_empty())
    }

    /// Number of categories
    pub fn category_count(&self) -> usize {
        self.by_category.len()
    }
}

/// Main job processor that orchestrates the entire pipeline
pub struct JobProcessor {
    config: Config,
    job_repo: JobRepository,
    user_config_repo: UserConfigRepository,
    user_repo: UserRepository,
    downloader: Downloader,
    extractor: DomainExtractor,
}

impl JobProcessor {
    /// Create a new job processor
    pub fn new(config: Config, job_repo: JobRepository, db: &Database) -> Result<Self> {
        let downloader = Downloader::new(config.clone(), db)?;
        let extractor = DomainExtractor::new();
        let user_config_repo = UserConfigRepository::new(db);
        let user_repo = UserRepository::new(db);

        Ok(Self {
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

    /// Process a single job
    pub async fn process_job(&self, job: &Job) -> Result<()> {
        let start_time = Instant::now();
        info!(
            "Processing job {} for user {}",
            job.job_id, job.username
        );

        // Load config from MongoDB
        let config_content = match self.user_config_repo.get_blocklists(&job.username).await {
            Ok(content) => content,
            Err(e) => {
                self.job_repo
                    .fail(&job.id, vec![format!("Failed to load config: {}", e)])
                    .await?;
                return Ok(());
            }
        };

        // Load whitelist content early for config hash calculation
        let whitelist_content = self.user_config_repo.get_whitelist(&job.username).await
            .unwrap_or_default();

        // Compute current config hash
        let current_config_hash = Self::compute_config_hash(&config_content, &whitelist_content);

        // Parse sources
        let sources = Downloader::parse_config(&config_content);
        if sources.is_empty() {
            self.job_repo
                .fail(&job.id, vec!["No valid sources in config".to_string()])
                .await?;
            return Ok(());
        }

        info!("Found {} sources to process", sources.len());

        // Check for "no changes" optimization
        // Skip if: config hash unchanged AND all sources would be cache hits
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
                            "No changes detected since last build. All sources are cached and configuration unchanged.".to_string(),
                        )
                        .await?;
                    return Ok(());
                }
            }
        }

        // Initialize progress tracking
        let progress = Arc::new(Mutex::new(JobProgress::downloading(sources.len() as u64)));

        // Initialize source progress
        {
            let mut p = progress.lock().await;
            p.sources = sources
                .iter()
                .map(|s| SourceProgress {
                    id: Downloader::hash_url(&s.url),
                    name: s.name.clone(),
                    url: s.url.clone(),
                    status: SourceStatus::Pending,
                    cache_hit: None,
                    bytes_downloaded: 0,
                    bytes_total: None,
                    download_percent: None,
                    download_time_ms: None,
                    domain_count: None,
                    domain_change: None,
                    error: None,
                    warnings: Vec::new(),
                    started_at: None,
                    completed_at: None,
                })
                .collect();
        }

        // Update progress in DB
        self.update_progress(&job.id, &progress).await?;

        // Stage 1: Download sources
        let download_results = self
            .download_stage(&job.id, sources, Arc::clone(&progress))
            .await?;

        // Check for complete failure
        let successful_downloads: Vec<&DownloadResult> = download_results
            .iter()
            .filter(|r| r.error.is_none())
            .collect();

        if successful_downloads.is_empty() {
            self.job_repo
                .fail(
                    &job.id,
                    vec!["All source downloads failed".to_string()],
                )
                .await?;
            return Ok(());
        }

        // Stage 2: Extract domains (organized by category)
        let category_domains = self
            .extraction_stage(&job.id, &download_results, Arc::clone(&progress))
            .await?;

        info!(
            "Extracted {} unique domains across {} categories",
            category_domains.total_count(),
            category_domains.category_count()
        );

        if category_domains.is_empty() {
            self.job_repo
                .fail(&job.id, vec!["No domains extracted".to_string()])
                .await?;
            return Ok(());
        }

        // Stage 3: Whitelist filtering
        let (filtered_domains, whitelist_removed, _whitelist_progress) = self
            .whitelist_stage(&job.id, &job.username, category_domains, Arc::clone(&progress))
            .await?;

        info!(
            "{} domains after whitelist filtering ({} removed)",
            filtered_domains.total_count(),
            whitelist_removed
        );

        // Stage 4: Generate output files (per-category + combined)
        let output_files = self
            .generation_stage(&job.id, &job.username, filtered_domains, Arc::clone(&progress))
            .await?;

        // Calculate final stats
        let sources_processed = download_results.iter().filter(|r| r.error.is_none()).count() as u64;
        let sources_failed = download_results.iter().filter(|r| r.error.is_some()).count() as u64;
        let total_domains: u64 = {
            let p = progress.lock().await;
            p.sources.iter().filter_map(|s| s.domain_count).sum()
        };
        // Get unique domains from the combined "all_domains" file
        let unique_domains = output_files
            .iter()
            .find(|f| f.name.starts_with("all_domains"))
            .map(|f| f.domain_count)
            .unwrap_or(0);

        // Calculate total output size
        let total_output_size: u64 = output_files.iter().map(|f| f.size_bytes).sum();

        // Build result
        let result = JobResult::success(
            sources_processed,
            sources_failed,
            total_domains,
            unique_domains,
            whitelist_removed,
            output_files.clone(),
        );

        // Mark job as completed
        self.job_repo.complete(&job.id, result).await?;

        // Update user document with lists and stats
        // Get existing lists to preserve is_public settings
        let existing_lists = self.user_repo.get_existing_lists(&job.username).await
            .unwrap_or_default();

        // Build list metadata for "all_domains" (combined list)
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let all_domains_list = ListMetadata {
            name: "all_domains".to_string(),
            // Preserve is_public from existing list, default to false
            is_public: existing_lists.iter()
                .find(|l| l.name == "all_domains")
                .map(|l| l.is_public)
                .unwrap_or(false),
            formats: vec!["hosts".to_string(), "plain".to_string(), "adblock".to_string()],
            domain_count: unique_domains,
            last_updated: now,
        };

        // Update user document
        if let Err(e) = self.user_repo.update_after_build(
            &job.username,
            vec![all_domains_list],
            unique_domains,
            total_output_size,
            current_config_hash,
        ).await {
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

    /// Download stage: fetch all sources in parallel
    async fn download_stage(
        &self,
        job_id: &bson::oid::ObjectId,
        sources: Vec<Source>,
        progress: Arc<Mutex<JobProgress>>,
    ) -> Result<Vec<DownloadResult>> {
        // Download sources - the callback just logs progress, we'll update DB after
        let results = self
            .downloader
            .download_sources(sources, |_idx, _source_progress| {
                // Progress updates are handled after all downloads complete
                // to avoid frequent DB writes during parallel downloads
            })
            .await;

        // Final progress update
        {
            let mut p = progress.lock().await;
            for (idx, result) in results.iter().enumerate() {
                if idx < p.sources.len() {
                    p.sources[idx].status = if result.error.is_some() {
                        SourceStatus::Failed
                    } else {
                        SourceStatus::Completed
                    };
                    p.sources[idx].cache_hit = Some(result.cache_hit);
                    p.sources[idx].bytes_downloaded = result.bytes_downloaded;
                    p.sources[idx].download_time_ms = Some(result.download_time_ms);
                    p.sources[idx].error = result.error.clone();
                    p.sources[idx].warnings = result.warnings.clone();
                }
            }
            p.processed_sources = p.sources.len() as u64;
        }

        self.update_progress(&job_id, &progress).await?;

        Ok(results)
    }

    /// Extraction stage: extract domains and organize by category
    async fn extraction_stage(
        &self,
        _job_id: &bson::oid::ObjectId,
        download_results: &[DownloadResult],
        progress: Arc<Mutex<JobProgress>>,
    ) -> Result<CategoryDomains> {
        let mut category_domains = CategoryDomains::new();

        for result in download_results {
            if result.error.is_some() {
                continue;
            }

            let content = match &result.content {
                Some(bytes) => bytes,
                None => {
                    warn!("No content for {}", result.source.name);
                    continue;
                }
            };

            // Convert bytes to string for extraction
            let content_str = match String::from_utf8_lossy(content) {
                std::borrow::Cow::Borrowed(s) => s.to_string(),
                std::borrow::Cow::Owned(s) => s,
            };

            // Extract domains from content
            let domains = self.extractor.extract_from_content(&content_str);

            // domain_count = total domains from this source
            let source_domain_count = domains.len() as u64;

            // Calculate domain_change = current - previous
            let domain_change = result.previous_domain_count
                .map(|prev| source_domain_count as i64 - prev as i64);

            // Get category from source
            let category = result.source.category.clone();

            // Add domains to category bucket
            let category_set = category_domains.by_category
                .entry(category.clone())
                .or_insert_with(HashSet::new);
            let count_before = category_set.len();
            category_set.extend(domains);
            let new_in_category = category_set.len() - count_before;

            debug!(
                "Extracted {} domains from {} [category: {:?}] ({} new in category, change: {:?})",
                source_domain_count,
                result.source.name,
                category,
                new_in_category,
                domain_change
            );

            // Update source progress with correct domain_count and domain_change
            {
                let mut p = progress.lock().await;
                if let Some(source) = p.sources.iter_mut().find(|s| s.id == result.url_hash) {
                    source.domain_count = Some(source_domain_count);
                    source.domain_change = domain_change;
                }
            }

            // Save domain_count to cache for next run
            if let Err(e) = self.downloader.update_domain_count(&result.url_hash, source_domain_count).await {
                warn!("Failed to update domain count in cache for {}: {}", result.source.name, e);
            }
        }

        Ok(category_domains)
    }

    /// Whitelist stage: filter out whitelisted domains from all categories
    async fn whitelist_stage(
        &self,
        job_id: &bson::oid::ObjectId,
        username: &str,
        category_domains: CategoryDomains,
        progress: Arc<Mutex<JobProgress>>,
    ) -> Result<(CategoryDomains, u64, crate::db::progress::WhitelistProgress)> {
        // Get all unique domains for global stats
        let all_domains = category_domains.all_unique();
        let domains_before = all_domains.len() as u64;

        // Update progress to whitelist stage
        {
            let mut p = progress.lock().await;
            p.to_whitelist(domains_before);
        }
        self.update_progress(job_id, &progress).await?;

        // Load whitelist from MongoDB
        let whitelist_content = self.user_config_repo.get_whitelist(username).await?;
        let whitelist = WhitelistManager::from_content(&whitelist_content);

        // Filter ALL domains to get whitelist stats (pattern matches, etc.)
        let (_, total_removed, pattern_matches) = whitelist.filter_domains(all_domains);

        // Filter each category separately
        let mut filtered = CategoryDomains::new();
        for (category, domains) in category_domains.by_category {
            let (remaining, _, _) = whitelist.filter_domains(domains);
            if !remaining.is_empty() {
                filtered.by_category.insert(category, remaining);
            }
        }

        let domains_after = filtered.total_count() as u64;

        // Create whitelist progress
        let whitelist_progress = whitelist.create_progress(domains_before, domains_after, pattern_matches);

        // Update progress
        {
            let mut p = progress.lock().await;
            p.whitelist = Some(whitelist_progress.clone());
        }
        self.update_progress(job_id, &progress).await?;

        Ok((filtered, total_removed, whitelist_progress))
    }

    /// Generation stage: create output files for each category and combined
    async fn generation_stage(
        &self,
        job_id: &bson::oid::ObjectId,
        username: &str,
        category_domains: CategoryDomains,
        progress: Arc<Mutex<JobProgress>>,
    ) -> Result<Vec<OutputFile>> {
        let total_domains = category_domains.total_count() as u64;

        // Update progress to generation stage
        {
            let mut p = progress.lock().await;
            p.to_generation(total_domains);
        }
        self.update_progress(job_id, &progress).await?;

        // Create output generator
        let output_dir = self.config.output_dir(username);
        let generator = OutputGenerator::new(output_dir);

        // Clean up old files
        generator.cleanup_old_files()?;

        // Convert HashSets to sorted Vecs per category
        let sorted_by_category: HashMap<Option<String>, Vec<String>> = category_domains
            .by_category
            .into_iter()
            .map(|(cat, domains)| (cat, DomainExtractor::sort_domains(domains)))
            .collect();

        // Generate all category files in parallel
        let mut output_files = generator.generate_all_categories(&sorted_by_category)?;

        // Create combined "all domains" list (deduplicated across categories)
        // Note: nsfw category is excluded from the combined list
        let all_domains: HashSet<String> = sorted_by_category
            .iter()
            .filter(|(cat, _)| {
                // Exclude nsfw category from all_domains
                !matches!(cat, Some(c) if c == "nsfw")
            })
            .flat_map(|(_, domains)| domains.iter().cloned())
            .collect();
        let all_sorted = DomainExtractor::sort_domains(all_domains);

        // Generate combined files (all_domains_*.txt.gz) for backward compatibility
        let progress_clone = Arc::clone(&progress);
        let combined_files = generator.generate_all(&all_sorted, |gen_progress| {
            let progress = Arc::clone(&progress_clone);
            let gen_progress = gen_progress.clone();
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current().block_on(async {
                    let mut p = progress.lock().await;
                    p.generation = Some(gen_progress);
                });
            });
        })?;
        output_files.extend(combined_files);

        // Final progress update
        {
            let mut p = progress.lock().await;
            p.to_completed();
        }
        self.update_progress(job_id, &progress).await?;

        Ok(output_files)
    }

    /// Update progress in database
    async fn update_progress(
        &self,
        job_id: &bson::oid::ObjectId,
        progress: &Arc<Mutex<JobProgress>>,
    ) -> Result<()> {
        let p = progress.lock().await;
        self.job_repo.update_progress(job_id, &*p).await?;
        Ok(())
    }
}
