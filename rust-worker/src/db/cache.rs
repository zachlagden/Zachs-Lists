use anyhow::Result;
use bson::{doc, oid::ObjectId, Bson, DateTime as BsonDateTime};
use chrono::Utc;
use futures::io::AsyncReadExt;
use mongodb::{gridfs::GridFsBucket, options::GridFsBucketOptions, Collection, Database};
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

/// Cache document in MongoDB (metadata only, content stored in GridFS)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub url_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gridfs_id: Option<ObjectId>,
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

/// Repository for cache operations in MongoDB using GridFS for content storage
pub struct CacheRepository {
    db: Database,
    collection: Collection<CacheEntry>,
}

impl CacheRepository {
    /// Create a new cache repository
    pub fn new(db: &Database) -> Self {
        Self {
            db: db.clone(),
            collection: db.collection("cache"),
        }
    }

    /// Get GridFS bucket for cache files
    fn get_bucket(&self) -> GridFsBucket {
        self.db.gridfs_bucket(
            GridFsBucketOptions::builder()
                .bucket_name("cache_files".to_string())
                .build(),
        )
    }

    /// Get cached content from GridFS
    pub async fn get_content(&self, url_hash: &str) -> Result<Option<Vec<u8>>> {
        let filter = doc! { "url_hash": url_hash };

        let entry = self.collection.find_one(filter).await?;

        if let Some(entry) = entry {
            if let Some(gridfs_id) = entry.gridfs_id {
                let bucket = self.get_bucket();
                match bucket.open_download_stream(Bson::ObjectId(gridfs_id)).await {
                    Ok(mut stream) => {
                        let mut content = Vec::new();
                        stream.read_to_end(&mut content).await?;
                        // Update access stats
                        self.touch(url_hash).await?;
                        return Ok(Some(content));
                    }
                    Err(e) => {
                        tracing::warn!("Failed to download from GridFS: {}", e);
                        return Ok(None);
                    }
                }
            }
        }

        Ok(None)
    }

    /// Store content in GridFS cache
    pub async fn store(
        &self,
        url_hash: &str,
        url: &str,
        content: &[u8],
        etag: Option<&str>,
        last_modified: Option<&str>,
        domain_count: i64,
    ) -> Result<()> {
        use futures::io::AsyncWriteExt;

        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let bucket = self.get_bucket();

        // Calculate content hash
        let mut hasher = Sha256::new();
        hasher.update(content);
        let content_hash = format!("{:x}", hasher.finalize());

        // Delete old GridFS file if exists
        let filter = doc! { "url_hash": url_hash };
        if let Ok(Some(existing)) = self.collection.find_one(filter.clone()).await {
            if let Some(old_gridfs_id) = existing.gridfs_id {
                let _ = bucket.delete(Bson::ObjectId(old_gridfs_id)).await;
            }
        }

        // Upload content to GridFS
        let mut upload_stream = bucket.open_upload_stream(url_hash).await?;
        upload_stream.write_all(content).await?;
        upload_stream.close().await?;
        let gridfs_id = upload_stream.id();

        // Update metadata document
        let update = doc! {
            "$set": {
                "url": url,
                "gridfs_id": gridfs_id,
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

    /// Cleanup stale cache entries and their GridFS files
    pub async fn cleanup_stale(&self, days: i64) -> Result<u64> {
        use chrono::Duration;
        use futures::TryStreamExt;

        let cutoff = Utc::now() - Duration::days(days);
        let cutoff_bson = BsonDateTime::from_millis(cutoff.timestamp_millis());

        let filter = doc! { "updated_at": { "$lt": cutoff_bson } };
        let bucket = self.get_bucket();

        // First, collect all gridfs_ids to delete
        let mut cursor = self.collection.find(filter.clone()).await?;
        let mut gridfs_ids_to_delete = Vec::new();

        while let Some(entry) = cursor.try_next().await? {
            if let Some(gridfs_id) = entry.gridfs_id {
                gridfs_ids_to_delete.push(gridfs_id);
            }
        }

        // Delete GridFS files
        for gridfs_id in &gridfs_ids_to_delete {
            let _ = bucket.delete(Bson::ObjectId(*gridfs_id)).await;
        }

        // Delete metadata documents
        let result = self.collection.delete_many(filter).await?;

        Ok(result.deleted_count)
    }

    /// Check if a valid cache entry exists (for "no changes" detection)
    /// Returns true if cache exists and is not older than 7 days
    pub async fn has_valid_cache(&self, url_hash: &str) -> Result<bool> {
        use chrono::Duration;

        let cutoff = Utc::now() - Duration::days(7);
        let cutoff_bson = BsonDateTime::from_millis(cutoff.timestamp_millis());

        // Check if cache entry exists with gridfs_id and is recent
        let filter = doc! {
            "url_hash": url_hash,
            "gridfs_id": { "$exists": true, "$ne": null },
            "updated_at": { "$gte": cutoff_bson }
        };

        let count = self.collection.count_documents(filter).await?;
        Ok(count > 0)
    }
}
