use anyhow::{anyhow, bail, Context, Result};
use bson::{doc, oid::ObjectId, Bson, DateTime as BsonDateTime};
use chrono::Utc;
use futures::io::AsyncReadExt;
use mongodb::{gridfs::GridFsBucket, options::GridFsBucketOptions, Collection, Database};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_SOURCE_SIZE_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_FALLBACK_AGE_DAYS: i64 = 8;
pub const MAX_FALLBACK_AGE_MILLIS: i64 = MAX_FALLBACK_AGE_DAYS * MILLIS_PER_DAY;
const MILLIS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CacheStats {
    #[serde(default)]
    pub size_bytes: i64,
    #[serde(default)]
    pub domain_count: i64,
    #[serde(default)]
    pub download_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_download_at: Option<BsonDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<BsonDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub url_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gridfs_id: Option<ObjectId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_checked_at: Option<BsonDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_downloaded_at: Option<BsonDateTime>,
    #[serde(default)]
    pub stats: CacheStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<BsonDateTime>,
}

impl CacheEntry {
    fn millis_since_check(&self, now: BsonDateTime) -> Option<i64> {
        self.last_checked_at.and_then(|checked| {
            now.timestamp_millis()
                .checked_sub(checked.timestamp_millis())
        })
    }

    pub fn allows_fallback_at(&self, now: BsonDateTime) -> bool {
        self.millis_since_check(now)
            .is_some_and(|age| (0..=MAX_FALLBACK_AGE_MILLIS).contains(&age))
    }

    pub fn is_fresh_at(&self, now: BsonDateTime, fresh_secs: u64) -> bool {
        let window = i64::try_from(fresh_secs)
            .unwrap_or(i64::MAX)
            .saturating_mul(1000)
            .min(MAX_FALLBACK_AGE_MILLIS);
        self.millis_since_check(now)
            .is_some_and(|age| (0..window).contains(&age))
    }

    pub fn verify_body(&self, content: &[u8]) -> Result<()> {
        if content.len() as u64 > MAX_SOURCE_SIZE_BYTES
            || self.stats.size_bytes < 0
            || self.stats.size_bytes as usize != content.len()
        {
            bail!("Cached source body has an invalid size");
        }
        if self.content_hash.as_deref() != Some(content_hash(content).as_str()) {
            bail!("Cached source body failed its content hash check");
        }
        Ok(())
    }
}

pub fn content_hash(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

pub fn retention_days(configured_days: i64) -> i64 {
    configured_days.max(MAX_FALLBACK_AGE_DAYS)
}

pub struct CheckedDownload<'a> {
    pub url: &'a str,
    pub final_url: &'a str,
    pub content: &'a [u8],
    pub etag: Option<&'a str>,
    pub last_modified: Option<&'a str>,
    pub domain_count: i64,
}

pub struct CacheRepository {
    db: Database,
    collection: Collection<CacheEntry>,
}

impl CacheRepository {
    pub fn new(db: &Database) -> Self {
        Self {
            db: db.clone(),
            collection: db.collection("cache"),
        }
    }

    fn get_bucket(&self) -> GridFsBucket {
        self.db.gridfs_bucket(
            GridFsBucketOptions::builder()
                .bucket_name("cache_files".to_string())
                .build(),
        )
    }

    pub async fn get_entry(&self, url_hash: &str) -> Result<Option<CacheEntry>> {
        self.collection
            .find_one(doc! { "url_hash": url_hash })
            .await
            .map_err(Into::into)
    }

    pub async fn get_verified_content(&self, entry: &CacheEntry) -> Result<Vec<u8>> {
        if !(0..=MAX_SOURCE_SIZE_BYTES as i64).contains(&entry.stats.size_bytes) {
            bail!("Cached source body has an invalid size");
        }
        let gridfs_id = entry
            .gridfs_id
            .ok_or_else(|| anyhow!("Cached source body is missing"))?;
        let stream = self
            .get_bucket()
            .open_download_stream(Bson::ObjectId(gridfs_id))
            .await
            .context("Cached source body is missing or unreadable")?;
        let mut content = Vec::new();
        stream
            .take(MAX_SOURCE_SIZE_BYTES + 1)
            .read_to_end(&mut content)
            .await
            .context("Could not read cached source body")?;
        entry.verify_body(&content)?;
        Ok(content)
    }

    pub async fn store_checked(
        &self,
        url_hash: &str,
        download: CheckedDownload<'_>,
    ) -> Result<BsonDateTime> {
        use futures::io::AsyncWriteExt;

        let CheckedDownload {
            url,
            final_url,
            content,
            etag,
            last_modified,
            domain_count,
        } = download;

        let checked_at = BsonDateTime::now();
        if content.len() as u64 > MAX_SOURCE_SIZE_BYTES {
            bail!("Source body exceeds the cache size limit");
        }
        let bucket = self.get_bucket();
        let existing = self.get_entry(url_hash).await?;
        let mut upload_stream = bucket.open_upload_stream(url_hash).await?;
        if let Err(error) = upload_stream.write_all(content).await {
            let _ = upload_stream.abort().await;
            return Err(error.into());
        }
        upload_stream.close().await?;
        let gridfs_id = upload_stream.id().clone();
        let now = BsonDateTime::from_chrono(Utc::now());
        let update = doc! {
            "$set": {
                "url": url,
                "final_url": final_url,
                "gridfs_id": &gridfs_id,
                "etag": etag,
                "last_modified": last_modified,
                "content_hash": content_hash(content),
                "stats.size_bytes": content.len() as i64,
                "stats.domain_count": domain_count,
                "stats.last_download_at": checked_at,
                "last_downloaded_at": checked_at,
                "last_checked_at": checked_at,
                "updated_at": now,
            },
            "$inc": { "stats.download_count": 1_i64 },
            "$setOnInsert": { "created_at": now }
        };
        if let Err(error) = self
            .collection
            .update_one(doc! { "url_hash": url_hash }, update)
            .upsert(true)
            .await
        {
            if matches!(
                error.kind.as_ref(),
                mongodb::error::ErrorKind::Write(mongodb::error::WriteFailure::WriteError(_))
            ) {
                if let Err(cleanup_error) = bucket.delete(gridfs_id).await {
                    tracing::warn!(
                        "Could not remove rejected cached source body: {}",
                        cleanup_error
                    );
                }
            } else {
                tracing::warn!(
                    "Source cache write outcome is uncertain; retaining the uploaded body"
                );
            }
            return Err(error.into());
        }
        if let Some(old_id) = existing.and_then(|entry| entry.gridfs_id) {
            if let Err(error) = bucket.delete(Bson::ObjectId(old_id)).await {
                tracing::warn!("Could not remove replaced cached source body: {}", error);
            }
        }
        Ok(checked_at)
    }

    pub async fn confirm_not_modified(
        &self,
        entry: &CacheEntry,
        etag: Option<&str>,
        last_modified: Option<&str>,
    ) -> Result<BsonDateTime> {
        let now = BsonDateTime::from_chrono(Utc::now());
        let mut fields = doc! { "last_checked_at": now, "updated_at": now };
        if let Some(etag) = etag {
            fields.insert("etag", etag);
        }
        if let Some(last_modified) = last_modified {
            fields.insert("last_modified", last_modified);
        }
        let result = self
            .collection
            .update_one(
                doc! {
                    "url_hash": &entry.url_hash,
                    "gridfs_id": entry.gridfs_id,
                    "content_hash": &entry.content_hash,
                    "final_url": &entry.final_url,
                },
                doc! { "$set": fields },
            )
            .await?;
        if result.matched_count != 1 {
            bail!("Cached source changed during upstream validation");
        }
        Ok(now)
    }

    pub async fn update_domain_count(&self, url_hash: &str, domain_count: i64) -> Result<()> {
        let now = BsonDateTime::from_chrono(Utc::now());
        self.collection
            .update_one(
                doc! { "url_hash": url_hash },
                doc! { "$set": { "stats.domain_count": domain_count, "updated_at": now } },
            )
            .await?;
        Ok(())
    }

    pub async fn cleanup_stale(&self, days: i64) -> Result<u64> {
        use futures::TryStreamExt;

        let retention_millis = retention_days(days).saturating_mul(MILLIS_PER_DAY);
        let cutoff = BsonDateTime::from_millis(
            Utc::now()
                .timestamp_millis()
                .saturating_sub(retention_millis),
        );
        let filter = doc! { "$or": [
            { "last_checked_at": { "$lt": cutoff } },
            { "last_checked_at": null },
        ] };
        let bucket = self.get_bucket();
        let mut cursor = self.collection.find(filter).await?;
        let mut deleted = 0;
        while let Some(entry) = cursor.try_next().await? {
            let result = self
                .collection
                .delete_one(doc! {
                    "url_hash": &entry.url_hash,
                    "gridfs_id": entry.gridfs_id,
                    "last_checked_at": entry.last_checked_at,
                })
                .await?;
            if result.deleted_count == 1 {
                deleted += 1;
                if let Some(id) = entry.gridfs_id {
                    if let Err(error) = bucket.delete(Bson::ObjectId(id)).await {
                        tracing::warn!("Could not remove expired cached source body: {}", error);
                    }
                }
            }
        }
        Ok(deleted)
    }
}

#[cfg(test)]
#[path = "cache_freshness_tests.rs"]
mod tests;
