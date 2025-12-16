use serde::{Deserialize, Serialize};

/// Job stage enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStage {
    Queue,
    Downloading,
    Whitelist,
    Generation,
    Completed,
}

impl Default for JobStage {
    fn default() -> Self {
        Self::Queue
    }
}

/// Source download status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceStatus {
    Pending,
    Downloading,
    Processing,
    Completed,
    Failed,
}

impl Default for SourceStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// Format generation status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FormatStatus {
    Pending,
    Generating,
    Compressing,
    Completed,
}

impl Default for FormatStatus {
    fn default() -> Self {
        Self::Pending
    }
}

/// Progress for a single source
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SourceProgress {
    pub id: String,
    pub name: String,
    pub url: String,
    pub status: SourceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_hit: Option<bool>,
    pub bytes_downloaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_time_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain_change: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Whitelist pattern match info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhitelistPatternMatch {
    pub pattern: String,
    pub pattern_type: String,
    pub match_count: u64,
    #[serde(default)]
    pub samples: Vec<String>,
}

/// Whitelist processing progress
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WhitelistProgress {
    pub domains_before: u64,
    pub domains_after: u64,
    pub total_removed: u64,
    pub processing: bool,
    #[serde(default)]
    pub patterns: Vec<WhitelistPatternMatch>,
}

/// Single format generation progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatProgress {
    pub format: String,
    pub status: FormatStatus,
    pub domains_written: u64,
    pub total_domains: u64,
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gz_size: Option<u64>,
}

/// Generation stage progress
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GenerationProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_format: Option<String>,
    #[serde(default)]
    pub formats: Vec<FormatProgress>,
}

/// Full job progress structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    /// Legacy field for backwards compatibility
    pub current_step: String,
    /// Current processing stage
    pub stage: JobStage,
    /// Total number of sources
    pub total_sources: u64,
    /// Number of processed sources
    pub processed_sources: u64,
    /// Currently processing source (legacy)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_source: Option<String>,
    /// Queue position (for queued jobs)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_position: Option<u64>,
    /// Time remaining in queue delay (ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_delay_remaining_ms: Option<u64>,
    /// Per-source progress
    #[serde(default)]
    pub sources: Vec<SourceProgress>,
    /// Whitelist stage progress
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whitelist: Option<WhitelistProgress>,
    /// Generation stage progress
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<GenerationProgress>,
    /// When current stage started
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_started_at: Option<String>,
}

impl Default for JobProgress {
    fn default() -> Self {
        Self {
            current_step: "queued".to_string(),
            stage: JobStage::Queue,
            total_sources: 0,
            processed_sources: 0,
            current_source: None,
            queue_position: None,
            queue_delay_remaining_ms: None,
            sources: Vec::new(),
            whitelist: None,
            generation: None,
            stage_started_at: None,
        }
    }
}

impl JobProgress {
    /// Create progress for downloading stage
    pub fn downloading(total_sources: u64) -> Self {
        Self {
            current_step: "downloading".to_string(),
            stage: JobStage::Downloading,
            total_sources,
            processed_sources: 0,
            current_source: None,
            queue_position: None,
            queue_delay_remaining_ms: None,
            sources: Vec::new(),
            whitelist: None,
            generation: None,
            stage_started_at: Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string()),
        }
    }

    /// Update to whitelist stage
    pub fn to_whitelist(&mut self, domains_before: u64) {
        self.current_step = "whitelist".to_string();
        self.stage = JobStage::Whitelist;
        self.whitelist = Some(WhitelistProgress {
            domains_before,
            domains_after: domains_before,
            total_removed: 0,
            processing: true,
            patterns: Vec::new(),
        });
        self.stage_started_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string());
    }

    /// Update to generation stage
    pub fn to_generation(&mut self, total_domains: u64) {
        self.current_step = "generation".to_string();
        self.stage = JobStage::Generation;
        self.generation = Some(GenerationProgress {
            current_format: None,
            formats: vec![
                FormatProgress {
                    format: "hosts".to_string(),
                    status: FormatStatus::Pending,
                    domains_written: 0,
                    total_domains,
                    percent: 0.0,
                    file_size: None,
                    gz_size: None,
                },
                FormatProgress {
                    format: "plain".to_string(),
                    status: FormatStatus::Pending,
                    domains_written: 0,
                    total_domains,
                    percent: 0.0,
                    file_size: None,
                    gz_size: None,
                },
                FormatProgress {
                    format: "adblock".to_string(),
                    status: FormatStatus::Pending,
                    domains_written: 0,
                    total_domains,
                    percent: 0.0,
                    file_size: None,
                    gz_size: None,
                },
            ],
        });
        self.stage_started_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string());
    }

    /// Mark as completed
    pub fn to_completed(&mut self) {
        self.current_step = "completed".to_string();
        self.stage = JobStage::Completed;
        self.stage_started_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6f").to_string());
    }
}

/// Job result on completion
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub sources_processed: u64,
    pub sources_failed: u64,
    pub total_domains: u64,
    pub unique_domains: u64,
    pub whitelisted_removed: u64,
    #[serde(default)]
    pub output_files: Vec<OutputFile>,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub categories: std::collections::HashMap<String, u64>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
}

/// Output file info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputFile {
    pub name: String,
    pub format: String,
    pub size_bytes: u64,
    pub domain_count: u64,
}

impl JobResult {
    /// Create a success result
    pub fn success(
        sources_processed: u64,
        sources_failed: u64,
        total_domains: u64,
        unique_domains: u64,
        whitelisted_removed: u64,
        output_files: Vec<OutputFile>,
    ) -> Self {
        Self {
            sources_processed,
            sources_failed,
            total_domains,
            unique_domains,
            whitelisted_removed,
            output_files,
            categories: std::collections::HashMap::new(),
            errors: Vec::new(),
            skip_reason: None,
        }
    }

    /// Create a failure result
    pub fn failure(errors: Vec<String>) -> Self {
        Self {
            sources_processed: 0,
            sources_failed: 0,
            total_domains: 0,
            unique_domains: 0,
            whitelisted_removed: 0,
            output_files: Vec::new(),
            categories: std::collections::HashMap::new(),
            errors,
            skip_reason: None,
        }
    }

    /// Create a skip result
    pub fn skipped(reason: String) -> Self {
        Self {
            sources_processed: 0,
            sources_failed: 0,
            total_domains: 0,
            unique_domains: 0,
            whitelisted_removed: 0,
            output_files: Vec::new(),
            categories: std::collections::HashMap::new(),
            errors: Vec::new(),
            skip_reason: Some(reason),
        }
    }
}
