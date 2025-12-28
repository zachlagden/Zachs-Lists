use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use mongodb::Database;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::db::cache::CacheRepository;
use crate::db::progress::{SourceProgress, SourceStatus};

/// Maximum allowed size for a single source file (100MB)
const MAX_SOURCE_SIZE_BYTES: u64 = 100 * 1024 * 1024;

/// Source definition from config file
#[derive(Debug, Clone)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub category: Option<String>,
}

/// Result of downloading a source
#[derive(Debug)]
pub struct DownloadResult {
    pub source: Source,
    pub url_hash: String,
    /// Content bytes (loaded in memory)
    pub content: Option<Vec<u8>>,
    pub cache_hit: bool,
    pub bytes_downloaded: u64,
    pub download_time_ms: u64,
    pub error: Option<String>,
    pub warnings: Vec<String>,
    /// Previous domain count from cache (for calculating domain_change)
    pub previous_domain_count: Option<u64>,
}

/// Downloader for fetching blocklist sources
pub struct Downloader {
    client: Client,
    config: Config,
    cache_repo: CacheRepository,
}

impl Downloader {
    /// Create a new downloader
    pub fn new(config: Config, db: &Database) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.http_timeout_secs))
            .gzip(true)
            .user_agent("BlocklistWorker/1.0 (lists.zachlagden.uk)")
            .build()?;

        let cache_repo = CacheRepository::new(db);

        Ok(Self { client, config, cache_repo })
    }

    /// Hash a URL to get cache key
    pub fn hash_url(url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Download a single source
    pub async fn download_source(&self, source: &Source) -> DownloadResult {
        let url_hash = Self::hash_url(&source.url);
        let start = Instant::now();
        let mut warnings = Vec::new();

        // Check cache first
        match self.cache_repo.get_content(&url_hash).await {
            Ok(Some(content)) => {
                debug!("Cache hit for {} ({} bytes)", source.name, content.len());
                return DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content: Some(content),
                    cache_hit: true,
                    bytes_downloaded: 0,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                    warnings,
                    previous_domain_count: None, // TODO: Get from cache stats
                };
            }
            Ok(None) => {
                debug!("Cache miss for {}", source.name);
            }
            Err(e) => {
                warn!("Cache read error for {}: {}", source.name, e);
            }
        }

        // Download fresh
        debug!("Downloading {} from {}", source.name, source.url);

        let result = self.fetch_and_cache(source, &url_hash).await;

        match result {
            Ok((content, new_warnings)) => {
                warnings.extend(new_warnings);
                let bytes_downloaded = content.len() as u64;
                DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content: Some(content),
                    cache_hit: false,
                    bytes_downloaded,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                    warnings,
                    previous_domain_count: None,
                }
            }
            Err(e) => {
                warn!("Failed to download {}: {}", source.name, e);
                DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content: None,
                    cache_hit: false,
                    bytes_downloaded: 0,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: Some(e.to_string()),
                    warnings,
                    previous_domain_count: None,
                }
            }
        }
    }

    /// Fetch URL and cache the result in MongoDB
    async fn fetch_and_cache(&self, source: &Source, url_hash: &str) -> Result<(Vec<u8>, Vec<String>)> {
        let mut warnings = Vec::new();

        // Make request
        let response = self
            .client
            .get(&source.url)
            .send()
            .await
            .with_context(|| format!("Failed to fetch {}", source.url))?;

        // Check status
        let status = response.status();
        if !status.is_success() {
            anyhow::bail!("HTTP {} for {}", status, source.url);
        }

        // Get headers for metadata
        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(String::from);
        let last_modified = response
            .headers()
            .get("last-modified")
            .and_then(|v| v.to_str().ok())
            .map(String::from);

        // Check Content-Length if available
        let content_length = response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        if let Some(len) = content_length {
            if len > MAX_SOURCE_SIZE_BYTES {
                anyhow::bail!(
                    "Source file too large: {} bytes (max {} bytes)",
                    len,
                    MAX_SOURCE_SIZE_BYTES
                );
            }
        }

        // Download content to memory with size limit enforcement
        let mut content = Vec::new();
        let mut stream = response.bytes_stream();

        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.with_context(|| "Error reading response chunk")?;
            content.extend_from_slice(&chunk);

            // Check size limit during streaming
            if content.len() as u64 > MAX_SOURCE_SIZE_BYTES {
                anyhow::bail!(
                    "Source file exceeds size limit during download (max {} bytes)",
                    MAX_SOURCE_SIZE_BYTES
                );
            }
        }

        // Validate content
        if content.is_empty() {
            warnings.push("Downloaded empty file".to_string());
        }

        // Estimate domain count from newlines
        let domain_count = content.iter().filter(|&&b| b == b'\n').count() as i64;

        // Store in MongoDB cache
        self.cache_repo
            .store(
                url_hash,
                &source.url,
                &content,
                etag.as_deref(),
                last_modified.as_deref(),
                domain_count,
            )
            .await?;

        info!(
            "Downloaded {} ({} bytes) and cached in MongoDB",
            source.name, content.len()
        );

        Ok((content, warnings))
    }

    /// Download multiple sources in parallel
    pub async fn download_sources(
        &self,
        sources: Vec<Source>,
        progress_callback: impl Fn(usize, &SourceProgress) + Send + Sync,
    ) -> Vec<DownloadResult> {
        let max_concurrent = self.config.max_concurrent_downloads;

        let results: Vec<DownloadResult> = stream::iter(sources.into_iter().enumerate())
            .map(|(idx, source)| {
                let downloader = self;
                async move {
                    // Notify starting
                    let mut progress = SourceProgress {
                        id: Self::hash_url(&source.url),
                        name: source.name.clone(),
                        url: source.url.clone(),
                        status: SourceStatus::Downloading,
                        cache_hit: None,
                        bytes_downloaded: 0,
                        bytes_total: None,
                        download_percent: None,
                        download_time_ms: None,
                        domain_count: None,
                        domain_change: None,
                        format_breakdown: None,
                        detected_formats: Vec::new(),
                        error: None,
                        warnings: Vec::new(),
                        started_at: Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string()),
                        completed_at: None,
                    };

                    // Download
                    let result = downloader.download_source(&source).await;

                    // Update progress with result
                    progress.status = if result.error.is_some() {
                        SourceStatus::Failed
                    } else {
                        SourceStatus::Completed
                    };
                    progress.cache_hit = Some(result.cache_hit);
                    progress.bytes_downloaded = result.bytes_downloaded;
                    progress.download_time_ms = Some(result.download_time_ms);
                    progress.error = result.error.clone();
                    progress.warnings = result.warnings.clone();
                    progress.completed_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string());

                    (idx, result, progress)
                }
            })
            .buffered(max_concurrent)
            .map(|(idx, result, progress)| {
                progress_callback(idx, &progress);
                result
            })
            .collect()
            .await;

        results
    }

    /// Parse sources from config file content
    /// Format: url|name|category or url|name or just url
    /// Deduplicates by URL (first occurrence wins)
    pub fn parse_config(content: &str) -> Vec<Source> {
        let mut sources = Vec::new();
        let mut seen_urls = std::collections::HashSet::new();

        for line in content.lines() {
            let line = line.trim();

            // Skip empty lines, comments, and disabled entries
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // Parse line: url|name|category or url|name or just url
            let parts: Vec<&str> = line.split('|').collect();

            let url = parts[0].trim();

            // Validate URL first
            if url::Url::parse(url).is_err() {
                continue;
            }

            // Skip duplicate URLs
            if seen_urls.contains(url) {
                continue;
            }
            seen_urls.insert(url.to_string());

            let name = if parts.len() > 1 {
                parts[1].trim().to_string()
            } else {
                // Use URL domain as name
                url::Url::parse(url)
                    .ok()
                    .and_then(|u| u.host_str().map(String::from))
                    .unwrap_or_else(|| "Unknown".to_string())
            };

            let category = if parts.len() > 2 {
                Some(parts[2].trim().to_string())
            } else {
                None
            };

            sources.push(Source {
                name,
                url: url.to_string(),
                category,
            });
        }

        sources
    }

    /// Update domain count in cache after extraction
    pub async fn update_domain_count(&self, url_hash: &str, domain_count: u64) -> Result<()> {
        self.cache_repo
            .update_domain_count(url_hash, domain_count as i64)
            .await
    }

    /// Clean up old cache entries
    pub async fn cleanup_cache(&self) -> Result<u64> {
        self.cache_repo
            .cleanup_stale(self.config.cache_ttl_days as i64)
            .await
    }

    /// Check if all sources would be cache hits (for "no changes" detection)
    pub async fn check_all_cached(&self, sources: &[Source]) -> bool {
        for source in sources {
            let url_hash = Self::hash_url(&source.url);
            match self.cache_repo.has_valid_cache(&url_hash).await {
                Ok(true) => continue,
                Ok(false) => {
                    debug!("Source {} not cached or cache expired", source.name);
                    return false;
                }
                Err(e) => {
                    warn!("Cache check error for {}: {}", source.name, e);
                    return false;
                }
            }
        }
        true
    }
}
