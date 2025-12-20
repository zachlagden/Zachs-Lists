use anyhow::Result;
use bson::{doc, DateTime as BsonDateTime};
use chrono::Utc;
use mongodb::options::FindOneOptions;
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
    /// Normalized config fingerprint for cross-user matching
    pub config_fingerprint: Option<String>,
}

/// Result of finding a user with matching config fingerprint
#[derive(Debug, Clone)]
pub struct MatchedUser {
    pub username: String,
    pub lists: Vec<ListMetadata>,
    pub total_domains: u64,
    pub total_output_size: u64,
}

/// Repository for updating user documents after job completion
pub struct UserRepository {
    collection: Collection<UserDoc>,
    db: Database,
}

impl UserRepository {
    /// Create a new user repository
    pub fn new(db: &Database) -> Self {
        Self {
            collection: db.collection("users"),
            db: db.clone(),
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
    /// - stats.config_fingerprint (for cross-user matching)
    ///
    /// For username "__default__", updates system_config instead.
    pub async fn update_after_build(
        &self,
        username: &str,
        lists: Vec<ListMetadata>,
        total_domains: u64,
        total_output_size: u64,
        config_hash: String,
        config_fingerprint: String,
    ) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());

        // For __default__, update system_config collection
        if username == "__default__" {
            let system_config: Collection<bson::Document> =
                self.db.collection("system_config");
            system_config
                .update_one(
                    doc! { "_id": "default_build" },
                    doc! {
                        "$set": {
                            "config_fingerprint": &config_fingerprint,
                            "total_domains": total_domains as i64,
                            "total_output_size_bytes": total_output_size as i64,
                            "last_build_at": now,
                        }
                    },
                )
                .upsert(true)
                .await?;
            return Ok(());
        }

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
                        "stats.config_fingerprint": config_fingerprint,
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

    /// Find a user with matching config fingerprint who has output files
    ///
    /// Returns the most recently built user with a matching fingerprint.
    /// Excludes the requesting user and users without output files.
    /// Also checks __default__ build in system_config.
    pub async fn find_user_by_fingerprint(
        &self,
        fingerprint: &str,
        exclude_username: &str,
    ) -> Result<Option<MatchedUser>> {
        // First check if __default__ matches (and we're not building for default)
        if exclude_username != "__default__" {
            let system_config: Collection<bson::Document> =
                self.db.collection("system_config");
            if let Some(default_build) = system_config
                .find_one(doc! { "_id": "default_build" })
                .await?
            {
                if let Ok(fp) = default_build.get_str("config_fingerprint") {
                    if fp == fingerprint {
                        // Default matches - return it as the source
                        return Ok(Some(MatchedUser {
                            username: "__default__".to_string(),
                            lists: Vec::new(), // Lists will be computed from files
                            total_domains: default_build
                                .get_i64("total_domains")
                                .unwrap_or(0) as u64,
                            total_output_size: default_build
                                .get_i64("total_output_size_bytes")
                                .unwrap_or(0) as u64,
                        }));
                    }
                }
            }
        }

        // Query for users with matching fingerprint, excluding the requesting user
        let filter = doc! {
            "stats.config_fingerprint": fingerprint,
            "username": { "$ne": exclude_username },
            "lists": { "$exists": true, "$not": { "$size": 0 } },
            "stats.last_build_at": { "$exists": true },
            "is_enabled": true,
        };

        // Sort by last_build_at descending to get most recent
        let options = FindOneOptions::builder()
            .sort(doc! { "stats.last_build_at": -1 })
            .build();

        let user = self.collection.find_one(filter).with_options(options).await?;

        if let Some(u) = user {
            let stats = u.stats.unwrap_or(UserStats {
                total_domains: None,
                total_output_size_bytes: None,
                last_build_at: None,
                config_hash: None,
                config_fingerprint: None,
            });
            return Ok(Some(MatchedUser {
                username: u.username,
                lists: u.lists.unwrap_or_default(),
                total_domains: stats.total_domains.unwrap_or(0),
                total_output_size: stats.total_output_size_bytes.unwrap_or(0),
            }));
        }

        Ok(None)
    }
}
