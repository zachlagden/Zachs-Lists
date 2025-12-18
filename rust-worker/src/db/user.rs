use anyhow::Result;
use bson::{doc, DateTime as BsonDateTime};
use chrono::Utc;
use mongodb::{Collection, Database};
use serde::{Deserialize, Serialize};

/// List metadata stored in user document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListMetadata {
    pub name: String,
    pub is_public: bool,
    pub formats: Vec<String>,
    pub domain_count: u64,
    pub last_updated: BsonDateTime,
}

/// User document projection for updates
#[derive(Debug, Deserialize)]
struct UserDoc {
    #[allow(dead_code)]
    pub username: String,
    pub lists: Option<Vec<ListMetadata>>,
    pub stats: Option<UserStats>,
}

/// User stats embedded in user document
#[derive(Debug, Clone, Deserialize)]
pub struct UserStats {
    pub total_domains: Option<u64>,
    pub total_output_size_bytes: Option<u64>,
    pub last_build_at: Option<BsonDateTime>,
    pub config_hash: Option<String>,
}

/// Repository for updating user documents after job completion
pub struct UserRepository {
    collection: Collection<UserDoc>,
}

impl UserRepository {
    /// Create a new user repository
    pub fn new(db: &Database) -> Self {
        Self {
            collection: db.collection("users"),
        }
    }

    /// Update user document after successful build
    ///
    /// Updates:
    /// - lists array with generated list metadata
    /// - stats.total_domains
    /// - stats.total_output_size_bytes
    /// - stats.last_build_at
    /// - stats.config_hash (for change detection)
    ///
    /// For username "__default__", this is a no-op (no user to update).
    pub async fn update_after_build(
        &self,
        username: &str,
        lists: Vec<ListMetadata>,
        total_domains: u64,
        total_output_size: u64,
        config_hash: String,
    ) -> Result<()> {
        // Skip for default lists - no user document to update
        if username == "__default__" {
            return Ok(());
        }

        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());

        // Convert lists to BSON
        let lists_bson: Vec<bson::Document> = lists
            .iter()
            .map(|l| {
                doc! {
                    "name": &l.name,
                    "is_public": l.is_public,
                    "formats": &l.formats,
                    "domain_count": l.domain_count as i64,
                    "last_updated": l.last_updated,
                }
            })
            .collect();

        self.collection
            .update_one(
                doc! { "username": username },
                doc! {
                    "$set": {
                        "lists": lists_bson,
                        "stats.total_domains": total_domains as i64,
                        "stats.total_output_size_bytes": total_output_size as i64,
                        "stats.last_build_at": now,
                        "stats.config_hash": config_hash,
                        "updated_at": now,
                    }
                },
            )
            .await?;

        Ok(())
    }

    /// Get existing lists for a user (to preserve is_public settings)
    pub async fn get_existing_lists(&self, username: &str) -> Result<Vec<ListMetadata>> {
        if username == "__default__" {
            return Ok(Vec::new());
        }

        let filter = doc! { "username": username };
        let user = self.collection.find_one(filter).await?;

        Ok(user.and_then(|u| u.lists).unwrap_or_default())
    }

    /// Get stored config hash for change detection
    pub async fn get_config_hash(&self, username: &str) -> Result<Option<String>> {
        if username == "__default__" {
            // For default lists, check system_config collection
            return Ok(None); // Always rebuild default lists
        }

        let filter = doc! { "username": username };
        let user = self.collection.find_one(filter).await?;

        Ok(user.and_then(|u| u.stats).and_then(|s| s.config_hash))
    }
}
