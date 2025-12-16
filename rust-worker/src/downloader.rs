use anyhow::{Context, Result};
use futures::stream::{self, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{debug, info, warn};

use crate::config::Config;
use crate::db::progress::{SourceProgress, SourceStatus};

/// Source definition from config file
#[derive(Debug, Clone)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub category: Option<String>,
}

/// Cache metadata stored alongside cached content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheMetadata {
    pub url: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<u64>,
    pub cached_at: String,
    pub last_accessed_at: String,
    pub access_count: u64,
    /// Domain count from last extraction (for calculating domain_change)
    #[serde(default)]
    pub domain_count: Option<u64>,
}

/// Result of downloading a source
#[derive(Debug)]
pub struct DownloadResult {
    pub source: Source,
    pub url_hash: String,
    pub content_path: PathBuf,
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
}

impl Downloader {
    /// Create a new downloader
    pub fn new(config: Config) -> Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(config.http_timeout_secs))
            .gzip(true)
            .user_agent("BlocklistWorker/1.0 (lists.zachlagden.uk)")
            .build()?;

        Ok(Self { client, config })
    }

    /// Hash a URL to get cache key
    pub fn hash_url(url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Get cache directory for a URL
    fn cache_dir(&self, url_hash: &str) -> PathBuf {
        self.config.cache_dir().join(url_hash)
    }

    /// Get content file path for a URL
    fn content_path(&self, url_hash: &str) -> PathBuf {
        self.cache_dir(url_hash).join("content.txt")
    }

    /// Get metadata file path for a URL
    fn metadata_path(&self, url_hash: &str) -> PathBuf {
        self.cache_dir(url_hash).join("metadata.json")
    }

    /// Load cache metadata if it exists
    async fn load_metadata(&self, url_hash: &str) -> Option<CacheMetadata> {
        let path = self.metadata_path(url_hash);
        match fs::read_to_string(&path).await {
            Ok(content) => serde_json::from_str(&content).ok(),
            Err(_) => None,
        }
    }

    /// Save cache metadata
    async fn save_metadata(&self, url_hash: &str, metadata: &CacheMetadata) -> Result<()> {
        let path = self.metadata_path(url_hash);
        let content = serde_json::to_string_pretty(metadata)?;
        fs::write(&path, content).await?;
        Ok(())
    }

    /// Update last accessed time in metadata
    async fn touch_cache(&self, url_hash: &str) -> Result<()> {
        if let Some(mut metadata) = self.load_metadata(url_hash).await {
            metadata.last_accessed_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
            metadata.access_count += 1;
            self.save_metadata(url_hash, &metadata).await?;
        }
        Ok(())
    }

    /// Update domain count in cache metadata (called after extraction)
    pub async fn update_domain_count(&self, url_hash: &str, domain_count: u64) -> Result<()> {
        if let Some(mut metadata) = self.load_metadata(url_hash).await {
            metadata.domain_count = Some(domain_count);
            self.save_metadata(url_hash, &metadata).await?;
        }
        Ok(())
    }

    /// Check if cache is valid (not expired)
    fn is_cache_valid(&self, metadata: &CacheMetadata) -> bool {
        if let Ok(cached_at) = chrono::DateTime::parse_from_str(
            &metadata.cached_at,
            "%Y-%m-%dT%H:%M:%S%.6f",
        ) {
            let age = chrono::Utc::now().signed_duration_since(cached_at.with_timezone(&chrono::Utc));
            let max_age = chrono::Duration::days(self.config.cache_ttl_days as i64);
            return age < max_age;
        }
        false
    }

    /// Download a single source
    pub async fn download_source(&self, source: &Source) -> DownloadResult {
        let url_hash = Self::hash_url(&source.url);
        let content_path = self.content_path(&url_hash);
        let start = Instant::now();
        let mut warnings = Vec::new();

        // Load existing metadata to get previous domain count
        let existing_metadata = self.load_metadata(&url_hash).await;
        let previous_domain_count = existing_metadata.as_ref().and_then(|m| m.domain_count);

        // Check cache first
        if let Some(ref metadata) = existing_metadata {
            if self.is_cache_valid(metadata) && content_path.exists() {
                // Update access time
                let _ = self.touch_cache(&url_hash).await;
                debug!("Cache hit for {}", source.name);
                return DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content_path,
                    cache_hit: true,
                    bytes_downloaded: 0,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                    warnings,
                    previous_domain_count,
                };
            }
        }

        // Download fresh
        debug!("Downloading {} from {}", source.name, source.url);

        let result = self.fetch_and_cache(source, &url_hash).await;

        match result {
            Ok((bytes_downloaded, new_warnings)) => {
                warnings.extend(new_warnings);
                DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content_path,
                    cache_hit: false,
                    bytes_downloaded,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: None,
                    warnings,
                    previous_domain_count,
                }
            }
            Err(e) => {
                warn!("Failed to download {}: {}", source.name, e);
                DownloadResult {
                    source: source.clone(),
                    url_hash,
                    content_path,
                    cache_hit: false,
                    bytes_downloaded: 0,
                    download_time_ms: start.elapsed().as_millis() as u64,
                    error: Some(e.to_string()),
                    warnings,
                    previous_domain_count,
                }
            }
        }
    }

    /// Fetch URL and cache the result
    async fn fetch_and_cache(&self, source: &Source, url_hash: &str) -> Result<(u64, Vec<String>)> {
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
        let content_length = response.content_length();

        // Create cache directory
        let cache_dir = self.cache_dir(url_hash);
        fs::create_dir_all(&cache_dir).await?;

        // Stream content to file
        let content_path = self.content_path(url_hash);
        let mut file = fs::File::create(&content_path).await?;
        let mut bytes_downloaded: u64 = 0;

        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.with_context(|| "Error reading response body")?;
            bytes_downloaded += chunk.len() as u64;
            file.write_all(&chunk).await?;
        }
        file.flush().await?;

        // Validate content
        if bytes_downloaded == 0 {
            warnings.push("Downloaded empty file".to_string());
        }

        // Save metadata
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string();
        let metadata = CacheMetadata {
            url: source.url.clone(),
            etag,
            last_modified,
            content_length,
            cached_at: now.clone(),
            last_accessed_at: now,
            access_count: 1,
            domain_count: None, // Set later during extraction
        };
        self.save_metadata(url_hash, &metadata).await?;

        info!(
            "Downloaded {} ({} bytes) in cache",
            source.name, bytes_downloaded
        );

        Ok((bytes_downloaded, warnings))
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

    /// Clean up old cache entries
    pub async fn cleanup_cache(&self) -> Result<u64> {
        let cache_dir = self.config.cache_dir();
        if !cache_dir.exists() {
            return Ok(0);
        }

        let mut entries = fs::read_dir(&cache_dir).await?;
        let mut cleaned = 0u64;
        let now = chrono::Utc::now();
        let max_age = chrono::Duration::days(self.config.cache_ttl_days as i64);

        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let url_hash = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");

            if let Some(metadata) = self.load_metadata(url_hash).await {
                if let Ok(accessed) = chrono::DateTime::parse_from_str(
                    &metadata.last_accessed_at,
                    "%Y-%m-%dT%H:%M:%S%.6f",
                ) {
                    let age = now.signed_duration_since(accessed.with_timezone(&chrono::Utc));
                    if age > max_age {
                        info!("Removing stale cache entry: {}", url_hash);
                        fs::remove_dir_all(&path).await?;
                        cleaned += 1;
                    }
                }
            }
        }

        Ok(cleaned)
    }
}
