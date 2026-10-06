use anyhow::{anyhow, bail, Context, Result};
use bson::DateTime as BsonDateTime;
use futures::stream::{self, StreamExt};
use mongodb::Database;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, LazyLock, Mutex, Weak,
};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;

use crate::config::Config;
use crate::db::cache::{content_hash, CacheEntry, CacheRepository, MAX_SOURCE_SIZE_BYTES};
use crate::db::progress::{SourceProgress, SourceStatus};
use crate::safe_http::{get_source_conditional, parse_source_url, SourceValidators};

#[derive(Debug, Clone)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub category: Option<String>,
}

#[derive(Debug)]
pub struct DownloadResult {
    pub source: Source,
    pub url_hash: String,
    pub content: Option<Vec<u8>>,
    pub content_hash: Option<String>,
    pub last_checked_at: Option<BsonDateTime>,
    pub stale_fallback: bool,
    pub cache_hit: bool,
    pub bytes_downloaded: u64,
    pub download_time_ms: u64,
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub previous_domain_count: Option<u64>,
}

#[derive(Default)]
struct SourceCheckGate {
    lock: AsyncMutex<()>,
    successful_checks: AtomicU64,
}

static SOURCE_CHECKS: LazyLock<Mutex<HashMap<String, Weak<SourceCheckGate>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn source_check_gate(key: String) -> Arc<SourceCheckGate> {
    let mut gates = SOURCE_CHECKS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
        return gate;
    }
    let gate = Arc::new(SourceCheckGate::default());
    gates.insert(key, Arc::downgrade(&gate));
    gate
}

pub struct Downloader {
    config: Config,
    cache_repo: CacheRepository,
    #[cfg(test)]
    test_address: Option<std::net::SocketAddr>,
}

impl Downloader {
    pub fn new(config: Config, db: &Database) -> Result<Self> {
        Ok(Self {
            config,
            cache_repo: CacheRepository::new(db),
            #[cfg(test)]
            test_address: None,
        })
    }

    pub fn hash_url(url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub async fn download_source(&self, source: &Source, _force: bool) -> DownloadResult {
        let url_hash = Self::hash_url(&source.url);
        let start = Instant::now();
        let mut result = DownloadResult {
            source: source.clone(),
            url_hash: url_hash.clone(),
            content: None,
            content_hash: None,
            last_checked_at: None,
            stale_fallback: false,
            cache_hit: false,
            bytes_downloaded: 0,
            download_time_ms: 0,
            error: None,
            warnings: Vec::new(),
            previous_domain_count: None,
        };
        let gate = source_check_gate(format!(
            "{}:{}:{}",
            Self::hash_url(&self.config.mongo_uri),
            self.cache_repo.namespace(),
            url_hash,
        ));
        let observed_checks = gate.successful_checks.load(Ordering::SeqCst);
        let _guard = gate.lock.lock().await;
        let coalesced = gate.successful_checks.load(Ordering::SeqCst) != observed_checks;
        match self
            .check_source(source, &url_hash, coalesced, &mut result)
            .await
        {
            Ok(true) => {
                gate.successful_checks.fetch_add(1, Ordering::SeqCst);
            }
            Ok(false) => {}
            Err(error) => result.error = Some(error.to_string()),
        }
        result.download_time_ms = start.elapsed().as_millis() as u64;
        result
    }

    async fn check_source(
        &self,
        source: &Source,
        url_hash: &str,
        coalesced: bool,
        result: &mut DownloadResult,
    ) -> Result<bool> {
        parse_source_url(&source.url)?;
        let entry = match self.cache_repo.get_entry(url_hash).await {
            Ok(entry) => entry,
            Err(_) => {
                result.warnings.push(
                    "Source cache metadata could not be read; checking upstream without validators"
                        .into(),
                );
                None
            }
        };
        let mut cached_content = None;
        if let Some(entry) = &entry {
            result.previous_domain_count = u64::try_from(entry.stats.domain_count).ok();
            if entry.url.as_deref() == Some(source.url.as_str()) {
                match self.cache_repo.get_verified_content(entry).await {
                    Ok(content) => cached_content = Some(content),
                    Err(error) => result
                        .warnings
                        .push(format!("Source cache unusable: {}", error)),
                }
            } else {
                result
                    .warnings
                    .push("Source cache URL does not match the requested source".into());
            }
        }
        if coalesced {
            if let (Some(entry), Some(content)) = (&entry, cached_content.as_ref()) {
                if entry.allows_fallback_at(BsonDateTime::now()) {
                    result.content_hash = Some(content_hash(content));
                    result.content = cached_content;
                    result.cache_hit = true;
                    result.last_checked_at = entry.last_checked_at;
                    return Ok(false);
                }
            }
        }
        let validators = entry
            .as_ref()
            .filter(|_| cached_content.is_some())
            .and_then(|entry| {
                let final_url = entry.final_url.clone()?;
                if entry.etag.is_none() && entry.last_modified.is_none() {
                    return None;
                }
                let validators = SourceValidators {
                    final_url,
                    etag: entry.etag.clone(),
                    last_modified: entry.last_modified.clone(),
                };
                if validators.validate().is_err() {
                    result.warnings.push(
                        "Invalid cached source validators; checking upstream without validators"
                            .into(),
                    );
                    return None;
                }
                Some(validators)
            });
        let timeout = Duration::from_secs(self.config.http_timeout_secs);
        let fetch = async {
            #[cfg(test)]
            if let Some(address) = self.test_address {
                return crate::safe_http::get_source_for_test(
                    &source.url,
                    timeout,
                    validators.as_ref(),
                    address,
                )
                .await;
            }
            get_source_conditional(&source.url, timeout, validators.as_ref()).await
        }
        .await;
        let response = match fetch {
            Ok(response) => response,
            Err(error) => return Self::fallback(entry.as_ref(), cached_content, error, result),
        };
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
        if response.status() == reqwest::StatusCode::NOT_MODIFIED {
            let validators = validators.as_ref().ok_or_else(|| {
                anyhow!("Source returned 304 without a verified conditional cache body")
            })?;
            if parse_source_url(&validators.final_url)? != *response.url() {
                bail!("Source returned 304 for a different cached destination");
            }
            let content = cached_content
                .ok_or_else(|| anyhow!("Source returned 304 but its cached body is missing"))?;
            let entry = entry
                .as_ref()
                .ok_or_else(|| anyhow!("Source returned 304 but its cache metadata is missing"))?;
            let checked_at = self
                .cache_repo
                .confirm_not_modified(entry, etag.as_deref(), last_modified.as_deref())
                .await
                .context("Could not persist the upstream source check")?;
            result.content_hash = Some(content_hash(&content));
            result.content = Some(content);
            result.cache_hit = true;
            result.last_checked_at = Some(checked_at);
            return Ok(true);
        }
        if response.status() != reqwest::StatusCode::OK {
            return Self::fallback(
                entry.as_ref(),
                cached_content,
                anyhow!("Source returned HTTP {}", response.status()),
                result,
            );
        }
        let final_url = response.url().to_string();
        drop(cached_content);
        let content = match Self::read_response(response).await {
            Ok(content) => content,
            Err(error) => {
                let fallback_content = if let Some(entry) = entry
                    .as_ref()
                    .filter(|entry| entry.url.as_deref() == Some(source.url.as_str()))
                {
                    match self.cache_repo.get_verified_content(entry).await {
                        Ok(content) => Some(content),
                        Err(error) => {
                            result
                                .warnings
                                .push(format!("Source cache unusable: {}", error));
                            None
                        }
                    }
                } else {
                    None
                };
                return Self::fallback(entry.as_ref(), fallback_content, error, result);
            }
        };
        if content.is_empty() {
            result.warnings.push("Downloaded empty file".into());
        }
        let domain_count = content.iter().filter(|&&b| b == b'\n').count() as i64;
        let checked_at = self
            .cache_repo
            .store_checked(
                url_hash,
                &source.url,
                &final_url,
                &content,
                etag.as_deref(),
                last_modified.as_deref(),
                domain_count,
            )
            .await
            .context("Could not persist the downloaded source body")?;
        result.bytes_downloaded = content.len() as u64;
        result.content_hash = Some(content_hash(&content));
        result.content = Some(content);
        result.last_checked_at = Some(checked_at);
        Ok(true)
    }

    async fn read_response(response: reqwest::Response) -> Result<Vec<u8>> {
        if response
            .content_length()
            .is_some_and(|length| length > MAX_SOURCE_SIZE_BYTES)
        {
            bail!("Source body exceeds the size limit");
        }
        let mut content = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("Error reading source response body")?;
            if chunk.len() as u64 > MAX_SOURCE_SIZE_BYTES - content.len() as u64 {
                bail!("Source body exceeds the size limit");
            }
            content.extend_from_slice(&chunk);
        }
        Ok(content)
    }

    fn fallback(
        entry: Option<&CacheEntry>,
        content: Option<Vec<u8>>,
        error: anyhow::Error,
        result: &mut DownloadResult,
    ) -> Result<bool> {
        if let (Some(entry), Some(content)) = (entry, content) {
            if entry.verify_body(&content).is_ok() && entry.allows_fallback_at(BsonDateTime::now())
            {
                result.warnings.push(format!("Stale source: upstream check failed ({}); using a verified cache body checked within seven days", error));
                result.content_hash = Some(content_hash(&content));
                result.content = Some(content);
                result.last_checked_at = entry.last_checked_at;
                result.cache_hit = true;
                result.stale_fallback = true;
                return Ok(false);
            }
        }
        Err(anyhow!("Source check failed ({}); no verified cache body checked within seven days is available", error))
    }

    /// Download multiple sources in parallel
    pub async fn download_sources(
        &self,
        sources: Vec<Source>,
        force: bool,
        progress_callback: impl Fn(usize, &SourceProgress) + Send + Sync,
    ) -> Vec<DownloadResult> {
        let max_concurrent = self.config.max_concurrent_downloads.max(1);

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
                        started_at: Some(
                            chrono::Utc::now()
                                .format("%Y-%m-%dT%H:%M:%S%.6f")
                                .to_string(),
                        ),
                        completed_at: None,
                    };

                    // Download
                    let result = downloader.download_source(&source, force).await;

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
                    progress.completed_at = Some(
                        chrono::Utc::now()
                            .format("%Y-%m-%dT%H:%M:%S%.6f")
                            .to_string(),
                    );

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
    pub fn parse_config(content: &str) -> Result<Vec<Source>> {
        let mut sources = Vec::new();
        let mut seen_urls = std::collections::HashSet::new();
        let mut seen_names = std::collections::HashSet::new();
        if content
            .lines()
            .filter(|line| !line.trim().is_empty() && !line.trim().starts_with('#'))
            .count()
            > 1000
        {
            anyhow::bail!("Source configuration exceeds the safety limit");
        }

        for line in content.lines() {
            let line = line.trim();

            // Skip empty lines, comments, and disabled entries
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            // Parse line: url|name|category or url|name or just url
            let parts: Vec<&str> = line.split('|').collect();

            let url = parts[0].trim();

            let parsed = parse_source_url(url)?;
            if parts.len() > 3 || parts.iter().any(|part| part.trim().is_empty()) {
                anyhow::bail!("Invalid source configuration fields");
            }

            let name = if parts.len() > 1 {
                parts[1].trim().to_string()
            } else {
                // Use URL domain as name
                parsed
                    .host_str()
                    .unwrap_or("source")
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                            c
                        } else {
                            '_'
                        }
                    })
                    .collect()
            };

            let category = if parts.len() > 2 {
                Some(parts[2].trim().to_string())
            } else {
                None
            };

            if name.len() > 100
                || !name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                anyhow::bail!("Invalid source name");
            }
            if parts.len() > 1 && !seen_names.insert(name.to_lowercase()) {
                anyhow::bail!("Duplicate source name");
            }
            if let Some(value) = &category {
                if !matches!(
                    value.as_str(),
                    "comprehensive"
                        | "malicious"
                        | "advertising"
                        | "tracking"
                        | "suspicious"
                        | "nsfw"
                ) {
                    anyhow::bail!("Invalid source category");
                }
            }
            if seen_urls.insert(url.to_string()) {
                sources.push(Source {
                    name,
                    url: url.to_string(),
                    category,
                });
            }
        }

        Ok(sources)
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

    pub async fn check_all_cached(&self, _sources: &[Source]) -> bool {
        false
    }
}

#[cfg(test)]
#[path = "source_cache_tests.rs"]
mod tests;
