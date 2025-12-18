use anyhow::Result;
use bson::{doc, Binary, DateTime as BsonDateTime};
use chrono::Utc;
use mongodb::{Collection, Database};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Cache entry stats
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

/// Cache document in MongoDB
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub url_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Binary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    #[serde(default)]
    pub stats: CacheStats,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<BsonDateTime>,
}

/// Repository for cache operations in MongoDB
pub struct CacheRepository {
    collection: Collection<CacheEntry>,
}

impl CacheRepository {
    /// Create a new cache repository
    pub fn new(db: &Database) -> Self {
        Self {
            collection: db.collection("cache"),
        }
    }

    /// Get cached content
    pub async fn get_content(&self, url_hash: &str) -> Result<Option<Vec<u8>>> {
        let filter = doc! { "url_hash": url_hash };

        let entry = self.collection.find_one(filter).await?;

        if let Some(entry) = entry {
            if let Some(binary) = entry.content {
                // Update access stats
                self.touch(url_hash).await?;
                return Ok(Some(binary.bytes));
            }
        }

        Ok(None)
    }

    /// Store content in cache
    pub async fn store(
        &self,
        url_hash: &str,
        url: &str,
        content: &[u8],
        etag: Option<&str>,
        last_modified: Option<&str>,
        domain_count: i64,
    ) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());

        // Calculate content hash
        let mut hasher = Sha256::new();
        hasher.update(content);
        let content_hash = format!("{:x}", hasher.finalize());

        let filter = doc! { "url_hash": url_hash };
        let update = doc! {
            "$set": {
                "url": url,
                "content": Binary { subtype: bson::spec::BinarySubtype::Generic, bytes: content.to_vec() },
                "etag": etag,
                "last_modified": last_modified,
                "content_hash": content_hash,
                "stats.size_bytes": content.len() as i64,
                "stats.domain_count": domain_count,
                "stats.last_download_at": now,
                "updated_at": now,
            },
            "$inc": {
                "stats.download_count": 1_i64,
            },
            "$setOnInsert": {
                "created_at": now,
            }
        };

        self.collection
            .update_one(filter, update)
            .upsert(true)
            .await?;

        Ok(())
    }

    /// Update access time (touch)
    async fn touch(&self, url_hash: &str) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let filter = doc! { "url_hash": url_hash };
        let update = doc! {
            "$set": { "stats.last_accessed_at": now },
            "$inc": { "stats.access_count": 1_i64 },
        };

        self.collection.update_one(filter, update).await?;
        Ok(())
    }

    /// Update domain count after extraction
    pub async fn update_domain_count(&self, url_hash: &str, domain_count: i64) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let filter = doc! { "url_hash": url_hash };
        let update = doc! {
            "$set": {
                "stats.domain_count": domain_count,
                "updated_at": now,
            }
        };

        self.collection.update_one(filter, update).await?;
        Ok(())
    }

    /// Cleanup stale cache entries
    pub async fn cleanup_stale(&self, days: i64) -> Result<u64> {
        use chrono::Duration;

        let cutoff = Utc::now() - Duration::days(days);
        let cutoff_bson = BsonDateTime::from_millis(cutoff.timestamp_millis());

        let filter = doc! { "updated_at": { "$lt": cutoff_bson } };
        let result = self.collection.delete_many(filter).await?;

        Ok(result.deleted_count)
    }

    /// Check if a valid cache entry exists (for "no changes" detection)
    /// Returns true if cache exists and is not older than 7 days
    pub async fn has_valid_cache(&self, url_hash: &str) -> Result<bool> {
        use chrono::Duration;

        let cutoff = Utc::now() - Duration::days(7);
        let cutoff_bson = BsonDateTime::from_millis(cutoff.timestamp_millis());

        // Check if cache entry exists with content and is recent
        let filter = doc! {
            "url_hash": url_hash,
            "content": { "$exists": true, "$ne": null },
            "updated_at": { "$gte": cutoff_bson }
        };

        let count = self.collection.count_documents(filter).await?;
        Ok(count > 0)
    }
}
