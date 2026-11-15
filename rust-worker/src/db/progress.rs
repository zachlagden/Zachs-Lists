use crate::extractor::FormatBreakdown;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Job stage enum
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStage {
    #[default]
    Queue,
    Downloading,
    Whitelist,
    Generation,
    Completed,
}

/// Source download status
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SourceStatus {
    #[default]
    Pending,
    Downloading,
    Processing,
    Completed,
    Failed,
}

/// Format generation status
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FormatStatus {
    #[default]
    Pending,
    Generating,
    Completed,
}

pub const OUTPUT_FORMAT_NAMES: [&str; 3] = ["hosts", "plain", "adblock"];

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Progress for a single source
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct SourceProgress {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub category: Option<String>,
    pub status: SourceStatus,
    #[serde(default)]
    pub cache_hit: Option<bool>,
    #[serde(default)]
    pub stale: bool,
    pub bytes_downloaded: u64,
    #[serde(default)]
    pub bytes_total: Option<u64>,
    #[serde(default)]
    pub download_percent: Option<f64>,
    #[serde(default)]
    pub download_time_ms: Option<u64>,
    #[serde(default)]
    pub domain_count: Option<u64>,
    #[serde(default)]
    pub domain_change: Option<i64>,
    /// Format breakdown - counts per format type (hosts/plain/adblock)
    #[serde(default)]
    pub format_breakdown: Option<FormatBreakdown>,
    /// Detected format names (e.g., ["hosts", "adblock"])
    #[serde(default)]
    pub detected_formats: Vec<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
}

impl SourceProgress {
    pub fn pending(id: String, name: String, url: String, category: Option<String>) -> Self {
        Self {
            id,
            name,
            url,
            category,
            ..Self::default()
        }
    }
}

/// Whitelist pattern match info
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WhitelistPatternMatch {
    pub pattern: String,
    pub pattern_type: String,
    pub match_count: u64,
    #[serde(default)]
    pub samples: Vec<String>,
}

/// Whitelist processing progress
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct WhitelistProgress {
    pub domains_before: u64,
    pub domains_after: u64,
    #[serde(default)]
    pub domains_checked: u64,
    pub total_removed: u64,
    pub processing: bool,
    #[serde(default)]
    pub patterns_total: u64,
    #[serde(default)]
    pub patterns: Vec<WhitelistPatternMatch>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Single format generation progress
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FormatProgress {
    pub format: String,
    pub status: FormatStatus,
    pub domains_written: u64,
    pub total_domains: u64,
    pub percent: f64,
    #[serde(default)]
    pub file_size: Option<u64>,
    #[serde(default)]
    pub gz_size: Option<u64>,
}

/// Generation stage progress
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct GenerationProgress {
    #[serde(default)]
    pub files_total: u64,
    #[serde(default)]
    pub files_completed: u64,
    #[serde(default)]
    pub current_format: Option<String>,
    #[serde(default)]
    pub formats: Vec<FormatProgress>,
}

impl GenerationProgress {
    pub fn pending(files_total: u64, domains_per_format: u64) -> Self {
        Self {
            files_total,
            files_completed: 0,
            current_format: None,
            formats: OUTPUT_FORMAT_NAMES
                .into_iter()
                .map(|format| FormatProgress {
                    format: format.to_string(),
                    status: FormatStatus::Pending,
                    domains_written: 0,
                    total_domains: domains_per_format,
                    percent: 0.0,
                    file_size: None,
                    gz_size: None,
                })
                .collect(),
        }
    }
}

/// Snapshot of a stage's final state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageSnapshot {
    /// When this stage completed
    pub completed_at: String,
    /// Stage-specific data snapshot
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageTiming {
    pub started_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
}

impl StageTiming {
    fn started_at(started_at: &str) -> Self {
        Self {
            started_at: started_at.to_string(),
            completed_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct StageTimings {
    #[serde(default)]
    pub downloading: Option<StageTiming>,
    #[serde(default)]
    pub whitelist: Option<StageTiming>,
    #[serde(default)]
    pub generation: Option<StageTiming>,
}

/// Full job progress structure
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    #[serde(default)]
    pub current_source: Option<String>,
    /// Queue position (for queued jobs)
    #[serde(default)]
    pub queue_position: Option<u64>,
    /// Time remaining in queue delay (ms)
    #[serde(default)]
    pub queue_delay_remaining_ms: Option<u64>,
    /// Per-source progress
    #[serde(default)]
    pub sources: Vec<SourceProgress>,
    /// Whitelist stage progress
    #[serde(default)]
    pub whitelist: Option<WhitelistProgress>,
    /// Generation stage progress
    #[serde(default)]
    pub generation: Option<GenerationProgress>,
    /// When current stage started
    #[serde(default)]
    pub stage_started_at: Option<String>,
    #[serde(default)]
    pub stages: StageTimings,
    /// Snapshots of completed stages (for viewing historical state)
    #[serde(default)]
    pub stage_snapshots: BTreeMap<String, StageSnapshot>,
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
            stages: StageTimings::default(),
            stage_snapshots: BTreeMap::new(),
        }
    }
}

impl JobProgress {
    pub fn downloading(sources: Vec<SourceProgress>) -> Self {
        let now = now_rfc3339();
        Self {
            current_step: "downloading".to_string(),
            stage: JobStage::Downloading,
            total_sources: sources.len() as u64,
            sources,
            stages: StageTimings {
                downloading: Some(StageTiming::started_at(&now)),
                ..StageTimings::default()
            },
            stage_started_at: Some(now),
            ..Self::default()
        }
    }

    fn snapshot(&mut self, stage: &str, completed_at: &str, data: serde_json::Value) {
        self.stage_snapshots.insert(
            stage.to_string(),
            StageSnapshot {
                completed_at: completed_at.to_string(),
                data,
            },
        );
    }

    pub fn enter_whitelist(
        &mut self,
        domains_before: u64,
        patterns_total: u64,
    ) -> Result<(), serde_json::Error> {
        let now = now_rfc3339();
        let data = serde_json::json!({
            "sources": serde_json::to_value(&self.sources)?,
            "total_sources": self.total_sources,
            "processed_sources": self.processed_sources,
        });
        self.snapshot("downloading", &now, data);
        if let Some(downloading) = self.stages.downloading.as_mut() {
            downloading.completed_at = Some(now.clone());
        }
        self.current_step = "whitelist".to_string();
        self.stage = JobStage::Whitelist;
        self.current_source = None;
        self.whitelist = Some(WhitelistProgress {
            domains_before,
            domains_after: domains_before,
            domains_checked: 0,
            total_removed: 0,
            processing: true,
            patterns_total,
            patterns: Vec::new(),
            warnings: Vec::new(),
        });
        self.stages.whitelist = Some(StageTiming::started_at(&now));
        self.stage_started_at = Some(now);
        Ok(())
    }

    pub fn enter_generation(
        &mut self,
        generation: GenerationProgress,
    ) -> Result<(), serde_json::Error> {
        let now = now_rfc3339();
        let data = serde_json::to_value(&self.whitelist)?;
        self.snapshot("whitelist", &now, data);
        if let Some(whitelist) = self.stages.whitelist.as_mut() {
            whitelist.completed_at = Some(now.clone());
        }
        self.current_step = "generation".to_string();
        self.stage = JobStage::Generation;
        self.generation = Some(generation);
        self.stages.generation = Some(StageTiming::started_at(&now));
        self.stage_started_at = Some(now);
        Ok(())
    }

    pub fn mark_completed(&mut self) -> Result<(), serde_json::Error> {
        let now = now_rfc3339();
        let data = serde_json::to_value(&self.generation)?;
        self.snapshot("generation", &now, data);
        if let Some(generation) = self.stages.generation.as_mut() {
            generation.completed_at = Some(now.clone());
        }
        self.current_step = "completed".to_string();
        self.stage = JobStage::Completed;
        self.stage_started_at = Some(now);
        Ok(())
    }
}

pub mod error_code {
    pub const INVALID_CONFIG: &str = "invalid_config";
    pub const NO_SOURCES: &str = "no_sources";
    pub const ALL_SOURCES_FAILED: &str = "all_sources_failed";
    pub const NO_DOMAINS: &str = "no_domains";
    pub const TARGET_MISSING: &str = "target_missing";
    pub const DOMAIN_LIMIT_EXCEEDED: &str = "domain_limit_exceeded";
    pub const INTERNAL: &str = "internal";

    #[cfg(test)]
    pub const ALL: [&str; 7] = [
        INVALID_CONFIG,
        NO_SOURCES,
        ALL_SOURCES_FAILED,
        NO_DOMAINS,
        TARGET_MISSING,
        DOMAIN_LIMIT_EXCEEDED,
        INTERNAL,
    ];
}

pub const INTERNAL_ERROR_MESSAGE: &str =
    "The build failed because of an internal error. Please try again.";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct LimitMeasurement {
    pub max_domains: Option<u64>,
    pub actual_domains: u64,
}

impl LimitMeasurement {
    pub fn is_over(&self) -> bool {
        self.max_domains
            .is_some_and(|max_domains| self.actual_domains > max_domains)
    }
}

/// Job result on completion
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct JobResult {
    pub sources_processed: u64,
    pub sources_failed: u64,
    #[serde(default)]
    pub sources_stale: u64,
    pub total_domains: u64,
    pub unique_domains: u64,
    pub whitelisted_removed: u64,
    #[serde(default)]
    pub output_files: Vec<OutputFile>,
    #[serde(default)]
    pub categories: BTreeMap<String, u64>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default)]
    pub skip_reason: Option<String>,
    #[serde(default)]
    pub generation_id: Option<String>,
    #[serde(default)]
    pub limit: Option<LimitMeasurement>,
}

/// Output file info
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputFile {
    pub name: String,
    pub format: String,
    pub size_bytes: u64,
    pub domain_count: u64,
}

impl JobResult {
    pub fn skipped(reason: &str) -> Self {
        Self {
            skip_reason: Some(reason.to_string()),
            ..Self::default()
        }
    }

    /// Create a failure result
    pub fn failure(code: &str, errors: Vec<String>) -> Self {
        Self {
            errors,
            error_code: Some(code.to_string()),
            ..Self::default()
        }
    }

    pub fn over_domain_limit(error: String, limit: LimitMeasurement) -> Self {
        Self {
            limit: Some(limit),
            ..Self::failure(error_code::DOMAIN_LIMIT_EXCEEDED, vec![error])
        }
    }
}

#[cfg(test)]
#[path = "progress_tests.rs"]
mod tests;
