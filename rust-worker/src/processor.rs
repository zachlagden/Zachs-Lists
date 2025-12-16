use anyhow::{Context, Result};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::fs;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

use crate::config::Config;
use crate::db::job::{Job, JobRepository};
use crate::db::progress::{
    JobProgress, JobResult, OutputFile, SourceProgress,
    SourceStatus,
};
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
    downloader: Downloader,
    extractor: DomainExtractor,
}

impl JobProcessor {
    /// Create a new job processor
    pub fn new(config: Config, job_repo: JobRepository) -> Result<Self> {
        let downloader = Downloader::new(config.clone())?;
        let extractor = DomainExtractor::new();

        Ok(Self {
            config,
            job_repo,
            downloader,
            extractor,
        })
    }

    /// Process a single job
    pub async fn process_job(&self, job: &Job) -> Result<()> {
        let start_time = Instant::now();
        info!(
            "Processing job {} for user {}",
            job.job_id, job.username
        );

        // Load config file
        let config_path = self.config.config_path(&job.username);
        if !config_path.exists() {
            self.job_repo
                .fail(&job.id, vec!["Config file not found".to_string()])
                .await?;
            return Ok(());
        }

        let config_content = fs::read_to_string(&config_path)
            .await
            .context("Failed to read config file")?;

        // Parse sources
        let sources = Downloader::parse_config(&config_content);
        if sources.is_empty() {
            self.job_repo
                .fail(&job.id, vec!["No valid sources in config".to_string()])
                .await?;
            return Ok(());
        }

        info!("Found {} sources to process", sources.len());

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

        // Build result
        let result = JobResult::success(
            sources_processed,
            sources_failed,
            total_domains,
            unique_domains,
            whitelist_removed,
            output_files,
        );

        // Mark job as completed
        self.job_repo.complete(&job.id, result).await?;

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

            let content_path = &result.content_path;
            if !content_path.exists() {
                warn!("Content file missing for {}", result.source.name);
                continue;
            }

            match self.extractor.extract_from_file(content_path).await {
                Ok(domains) => {
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
                Err(e) => {
                    error!(
                        "Failed to extract domains from {}: {}",
                        result.source.name, e
                    );
                }
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

        // Load whitelist
        let whitelist_path = self.config.whitelist_path(username);
        let whitelist = WhitelistManager::from_file(&whitelist_path).await?;

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
        let all_domains: HashSet<String> = sorted_by_category
            .values()
            .flat_map(|d| d.iter().cloned())
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
