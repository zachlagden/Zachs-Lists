use std::env;
use std::path::PathBuf;

/// Worker configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct Config {
    /// MongoDB connection URI
    pub mongo_uri: String,
    /// Database name
    pub database_name: String,
    /// Base data directory
    pub data_dir: PathBuf,
    /// Worker UUID (generated on startup)
    pub worker_id: String,
    /// Progress update interval in milliseconds
    pub progress_update_interval_ms: u64,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,
    /// Maximum concurrent downloads
    pub max_concurrent_downloads: usize,
    /// HTTP request timeout in seconds
    pub http_timeout_secs: u64,
    /// Cache TTL in days
    pub cache_ttl_days: u64,
    /// Maximum cache size in bytes
    pub max_cache_size_bytes: u64,
}

impl Config {
    /// Load configuration from environment variables
    pub fn from_env() -> Self {
        let worker_id = uuid::Uuid::new_v4().to_string();

        Self {
            mongo_uri: env::var("MONGO_URI")
                .unwrap_or_else(|_| "mongodb://localhost:27017".to_string()),
            database_name: env::var("DATABASE_NAME")
                .unwrap_or_else(|_| "blocklist".to_string()),
            data_dir: PathBuf::from(
                env::var("DATA_DIR")
                    .unwrap_or_else(|_| "./data".to_string())
            ),
            worker_id,
            progress_update_interval_ms: env::var("PROGRESS_UPDATE_INTERVAL_MS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500),
            heartbeat_interval_secs: env::var("HEARTBEAT_INTERVAL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            max_concurrent_downloads: env::var("MAX_CONCURRENT_DOWNLOADS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            http_timeout_secs: env::var("HTTP_TIMEOUT_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60),
            cache_ttl_days: env::var("CACHE_TTL_DAYS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(7),
            max_cache_size_bytes: env::var("MAX_CACHE_SIZE_BYTES")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10 * 1024 * 1024 * 1024), // 10 GB
        }
    }

    /// Get path for default lists
    pub fn default_dir(&self) -> PathBuf {
        self.data_dir.join("default")
    }

    /// Get path for user data
    pub fn user_dir(&self, username: &str) -> PathBuf {
        self.data_dir.join("users").join(username)
    }

    /// Get cache directory
    pub fn cache_dir(&self) -> PathBuf {
        self.data_dir.join("cache")
    }

    /// Get config file path for a user
    pub fn config_path(&self, username: &str) -> PathBuf {
        if username == "__default__" {
            self.default_dir().join("config").join("blocklists.conf")
        } else {
            self.user_dir(username).join("config").join("blocklists.conf")
        }
    }

    /// Get whitelist file path for a user
    pub fn whitelist_path(&self, username: &str) -> PathBuf {
        if username == "__default__" {
            self.default_dir().join("config").join("whitelist.txt")
        } else {
            self.user_dir(username).join("config").join("whitelist.txt")
        }
    }

    /// Get output directory for a user
    pub fn output_dir(&self, username: &str) -> PathBuf {
        if username == "__default__" {
            self.default_dir().join("output")
        } else {
            self.user_dir(username).join("output")
        }
    }

    /// Get output file path for a specific format
    pub fn output_path(&self, username: &str, format: &str) -> PathBuf {
        self.output_dir(username).join(format!("all_domains_{}.txt.gz", format))
    }

    /// Get cache path for a URL (using SHA256 hash)
    pub fn cache_path(&self, url_hash: &str) -> PathBuf {
        self.cache_dir().join(url_hash)
    }
}
