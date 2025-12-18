use anyhow::{anyhow, Result};
use bson::doc;
use mongodb::{Collection, Database};
use serde::Deserialize;

/// User config embedded in user document
#[derive(Debug, Clone, Deserialize)]
pub struct UserConfig {
    pub blocklists: Option<String>,
    pub whitelist: Option<String>,
}

/// User document projection for config retrieval
#[derive(Debug, Deserialize)]
struct UserDoc {
    pub config: Option<UserConfig>,
}

/// System config document for default lists
#[derive(Debug, Deserialize)]
struct SystemConfigDoc {
    pub blocklists: Option<String>,
    pub whitelist: Option<String>,
}

/// Repository for fetching user and system configurations from MongoDB
pub struct UserConfigRepository {
    users_collection: Collection<UserDoc>,
    system_config_collection: Collection<SystemConfigDoc>,
}

impl UserConfigRepository {
    /// Create a new user config repository
    pub fn new(db: &Database) -> Self {
        Self {
            users_collection: db.collection("users"),
            system_config_collection: db.collection("system_config"),
        }
    }

    /// Get config for a user or default lists
    ///
    /// For username "__default__", fetches from system_config collection.
    /// For regular users, fetches from their user document.
    pub async fn get_config(&self, username: &str) -> Result<UserConfig> {
        if username == "__default__" {
            self.get_default_config().await
        } else {
            self.get_user_config(username).await
        }
    }

    /// Get user config from users collection
    async fn get_user_config(&self, username: &str) -> Result<UserConfig> {
        let filter = doc! { "username": username };

        let user = self
            .users_collection
            .find_one(filter)
            .await?
            .ok_or_else(|| anyhow!("User not found: {}", username))?;

        user.config
            .ok_or_else(|| anyhow!("No config found for user: {}", username))
    }

    /// Get default config from system_config collection
    async fn get_default_config(&self) -> Result<UserConfig> {
        let filter = doc! { "_id": "default_config" };

        let config = self
            .system_config_collection
            .find_one(filter)
            .await?
            .ok_or_else(|| anyhow!("Default config not found in system_config collection"))?;

        Ok(UserConfig {
            blocklists: config.blocklists,
            whitelist: config.whitelist,
        })
    }

    /// Get blocklist config content for a user
    pub async fn get_blocklists(&self, username: &str) -> Result<String> {
        let config = self.get_config(username).await?;
        config
            .blocklists
            .ok_or_else(|| anyhow!("No blocklist config found for: {}", username))
    }

    /// Get whitelist content for a user (returns empty string if none)
    pub async fn get_whitelist(&self, username: &str) -> Result<String> {
        let config = self.get_config(username).await?;
        Ok(config.whitelist.unwrap_or_default())
    }
}
