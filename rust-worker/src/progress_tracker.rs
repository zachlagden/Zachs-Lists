use anyhow::{anyhow, Result};
use bson::{oid::ObjectId, Document};
use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{interval_at, Instant, MissedTickBehavior};
use tracing::warn;

use crate::cancellation::Cancellation;
use crate::db::job::{JobRepository, JobWriteError};
use crate::db::progress::{
    now_rfc3339, FormatStatus, GenerationProgress, JobProgress, SourceProgress, SourceStatus,
    WhitelistProgress, OUTPUT_FORMAT_NAMES,
};
use crate::downloader::{DownloadResult, Downloader, Source};
use crate::extractor::FormatBreakdown;
use crate::generator::GenerationEvent;

const MAX_RESULT_WARNINGS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Scalar {
    ProcessedSources,
    CurrentSource,
}

#[derive(Default)]
struct Pending {
    everything: bool,
    scalars: BTreeSet<Scalar>,
    sources: BTreeSet<usize>,
    whitelist: bool,
    generation: bool,
}

impl Pending {
    fn everything() -> Self {
        Self {
            everything: true,
            ..Self::default()
        }
    }

    fn is_empty(&self) -> bool {
        !self.everything
            && self.scalars.is_empty()
            && self.sources.is_empty()
            && !self.whitelist
            && !self.generation
    }
}

struct TrackedProgress {
    progress: JobProgress,
    pending: Pending,
    files_completed_by_format: [u64; 3],
}

#[derive(Debug, Default, PartialEq)]
pub struct SourceSummary {
    pub completed: u64,
    pub failed: u64,
    pub stale: u64,
    pub total_domains: u64,
    pub warnings: Vec<String>,
}

pub struct ProgressTracker {
    tracked: Mutex<TrackedProgress>,
}

impl ProgressTracker {
    pub fn downloading(sources: &[Source]) -> Self {
        let sources = sources
            .iter()
            .map(|source| {
                SourceProgress::pending(
                    Downloader::hash_url(&source.url),
                    source.name.clone(),
                    source.url.clone(),
                    source.category.clone(),
                )
            })
            .collect();
        Self {
            tracked: Mutex::new(TrackedProgress {
                progress: JobProgress::downloading(sources),
                pending: Pending::everything(),
                files_completed_by_format: [0; 3],
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, TrackedProgress> {
        self.tracked.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn update_source(&self, index: usize, change: impl FnOnce(&mut SourceProgress)) {
        let mut tracked = self.lock();
        if let Some(source) = tracked.progress.sources.get_mut(index) {
            change(source);
            tracked.pending.sources.insert(index);
        }
    }

    fn count_processed_source(tracked: &mut TrackedProgress) {
        tracked.progress.processed_sources += 1;
        tracked.pending.scalars.insert(Scalar::ProcessedSources);
    }

    pub fn snapshot(&self) -> JobProgress {
        self.lock().progress.clone()
    }

    pub fn source_started(&self, index: usize) {
        self.update_source(index, |source| {
            source.status = SourceStatus::Downloading;
            source.started_at = Some(now_rfc3339());
        });
    }

    pub fn source_bytes(&self, index: usize, downloaded: u64, total: Option<u64>) {
        self.update_source(index, |source| {
            source.bytes_downloaded = downloaded;
            source.bytes_total = total;
            source.download_percent = total
                .filter(|total| *total > 0)
                .map(|total| (downloaded as f64 / total as f64 * 100.0).min(100.0));
        });
    }

    pub fn source_downloaded(&self, index: usize, result: &DownloadResult) {
        let mut tracked = self.lock();
        let Some(source) = tracked.progress.sources.get_mut(index) else {
            return;
        };
        source.cache_hit = Some(result.cache_hit);
        source.stale = result.stale_fallback;
        source.download_time_ms = Some(result.download_time_ms);
        source.warnings = result.warnings.clone();
        match &result.error {
            Some(error) => {
                source.status = SourceStatus::Failed;
                source.error = Some(error.clone());
                source.completed_at = Some(now_rfc3339());
            }
            None => {
                source.status = SourceStatus::Processing;
                source.bytes_downloaded = result.bytes_downloaded;
            }
        }
        tracked.pending.sources.insert(index);
        if result.error.is_some() {
            Self::count_processed_source(&mut tracked);
        }
    }

    pub fn source_extracting(&self, index: usize) {
        let mut tracked = self.lock();
        let name = tracked
            .progress
            .sources
            .get(index)
            .map(|source| source.name.clone());
        tracked.progress.current_source = name;
        tracked.pending.scalars.insert(Scalar::CurrentSource);
    }

    pub fn source_domains_extracted(&self, index: usize, extracted: u64) {
        if extracted == 0 {
            return;
        }
        self.update_source(index, |source| {
            source.domain_count = Some(source.domain_count.unwrap_or(0) + extracted);
        });
    }

    pub fn source_completed(
        &self,
        index: usize,
        domain_count: u64,
        previous_domain_count: Option<u64>,
        format_breakdown: FormatBreakdown,
    ) {
        let mut tracked = self.lock();
        let Some(source) = tracked.progress.sources.get_mut(index) else {
            return;
        };
        source.status = SourceStatus::Completed;
        source.domain_count = Some(domain_count);
        source.domain_change =
            previous_domain_count.map(|previous| domain_count as i64 - previous as i64);
        source.detected_formats = format_breakdown.detected_formats();
        source.format_breakdown = Some(format_breakdown);
        source.completed_at = Some(now_rfc3339());
        tracked.pending.sources.insert(index);
        Self::count_processed_source(&mut tracked);
    }

    pub fn source_summary(&self) -> SourceSummary {
        let tracked = self.lock();
        let mut summary = SourceSummary::default();
        let mut warnings = Vec::new();
        for source in &tracked.progress.sources {
            match source.status {
                SourceStatus::Completed => summary.completed += 1,
                SourceStatus::Failed => {
                    summary.failed += 1;
                    warnings.push(format!(
                        "Source {} could not be used: {}",
                        source.name,
                        source.error.as_deref().unwrap_or("unknown error")
                    ));
                }
                _ => {}
            }
            if source.stale {
                summary.stale += 1;
                warnings.push(format!(
                    "Source {} is stale: its upstream check failed, so the last verified copy was used",
                    source.name
                ));
            }
            summary.total_domains += source.domain_count.unwrap_or(0);
        }
        let hidden = warnings.len().saturating_sub(MAX_RESULT_WARNINGS);
        warnings.truncate(MAX_RESULT_WARNINGS);
        if hidden > 0 {
            warnings.push(format!("{hidden} more source warnings are not listed"));
        }
        summary.warnings = warnings;
        summary
    }

    pub fn begin_whitelist(&self, domains_before: u64, patterns_total: u64) -> Result<()> {
        let mut tracked = self.lock();
        tracked
            .progress
            .enter_whitelist(domains_before, patterns_total)?;
        tracked.pending = Pending::everything();
        Ok(())
    }

    pub fn whitelist_checked(&self, checked: u64, newly_removed: u64) {
        let mut tracked = self.lock();
        if let Some(whitelist) = tracked.progress.whitelist.as_mut() {
            whitelist.domains_checked =
                (whitelist.domains_checked + checked).min(whitelist.domains_before);
            whitelist.total_removed += newly_removed;
            whitelist.domains_after = whitelist
                .domains_before
                .saturating_sub(whitelist.total_removed);
            tracked.pending.whitelist = true;
        }
    }

    pub fn whitelist_finished(&self, whitelist: WhitelistProgress) {
        let mut tracked = self.lock();
        tracked.progress.whitelist = Some(whitelist);
        tracked.pending.whitelist = true;
    }

    pub fn begin_generation(&self, generation: GenerationProgress) -> Result<()> {
        let mut tracked = self.lock();
        tracked.progress.enter_generation(generation)?;
        tracked.files_completed_by_format = [0; 3];
        tracked.pending = Pending::everything();
        Ok(())
    }

    pub fn generation_event(&self, event: GenerationEvent) {
        let mut tracked = self.lock();
        let TrackedProgress {
            progress,
            pending,
            files_completed_by_format,
        } = &mut *tracked;
        let Some(generation) = progress.generation.as_mut() else {
            return;
        };
        let files_per_format = generation.files_total / OUTPUT_FORMAT_NAMES.len() as u64;
        match event {
            GenerationEvent::FileStarted(format) => {
                if let Some(entry) = generation.formats.get_mut(format.index()) {
                    if entry.status == FormatStatus::Pending {
                        entry.status = FormatStatus::Generating;
                    }
                }
                generation.current_format = Some(format.as_str().to_string());
            }
            GenerationEvent::DomainsWritten(format, written) => {
                if let Some(entry) = generation.formats.get_mut(format.index()) {
                    entry.domains_written += written;
                    if entry.total_domains > 0 {
                        entry.percent = (entry.domains_written as f64 / entry.total_domains as f64
                            * 100.0)
                            .min(100.0);
                    }
                }
            }
            GenerationEvent::FileCompleted { format, gz_size } => {
                generation.files_completed += 1;
                files_completed_by_format[format.index()] += 1;
                let format_done = files_completed_by_format[format.index()] >= files_per_format;
                if let Some(entry) = generation.formats.get_mut(format.index()) {
                    entry.gz_size = Some(entry.gz_size.unwrap_or(0) + gz_size);
                    if format_done {
                        entry.status = FormatStatus::Completed;
                        entry.percent = 100.0;
                    }
                }
                if generation.files_completed >= generation.files_total {
                    generation.current_format = None;
                }
            }
        }
        pending.generation = true;
    }

    pub fn complete(&self) -> Result<()> {
        let mut tracked = self.lock();
        tracked.progress.mark_completed()?;
        tracked.pending = Pending::everything();
        Ok(())
    }

    pub fn mark_everything_pending(&self) {
        self.lock().pending = Pending::everything();
    }

    pub fn take_pending_fields(&self) -> Result<Option<Document>, bson::ser::Error> {
        let mut tracked = self.lock();
        if tracked.pending.is_empty() {
            return Ok(None);
        }
        let progress = &tracked.progress;
        let pending = &tracked.pending;
        let mut fields = Document::new();
        if pending.everything {
            fields.insert("progress", bson::to_bson(progress)?);
        } else {
            for scalar in &pending.scalars {
                match scalar {
                    Scalar::ProcessedSources => fields.insert(
                        "progress.processed_sources",
                        bson::to_bson(&progress.processed_sources)?,
                    ),
                    Scalar::CurrentSource => fields.insert(
                        "progress.current_source",
                        bson::to_bson(&progress.current_source)?,
                    ),
                };
            }
            for index in &pending.sources {
                fields.insert(
                    format!("progress.sources.{index}"),
                    bson::to_bson(&progress.sources[*index])?,
                );
            }
            if pending.whitelist {
                fields.insert("progress.whitelist", bson::to_bson(&progress.whitelist)?);
            }
            if pending.generation {
                fields.insert("progress.generation", bson::to_bson(&progress.generation)?);
            }
        }
        tracked.pending = Pending::default();
        Ok(Some(fields))
    }
}

enum WriterRequest {
    Flush(oneshot::Sender<Result<(), JobWriteError>>),
    Stop,
}

struct ProgressWriter {
    jobs: JobRepository,
    job_id: ObjectId,
    tracker: Arc<ProgressTracker>,
    cancellation: Cancellation,
    lease_lost: bool,
}

impl ProgressWriter {
    async fn flush(&mut self) -> Result<(), JobWriteError> {
        if self.lease_lost {
            return Err(JobWriteError::LeaseLost);
        }
        let Some(fields) = self.tracker.take_pending_fields()? else {
            return Ok(());
        };
        match self.jobs.write_progress_fields(&self.job_id, fields).await {
            Ok(()) => Ok(()),
            Err(JobWriteError::LeaseLost) => {
                self.lease_lost = true;
                self.cancellation.cancel();
                Err(JobWriteError::LeaseLost)
            }
            Err(failed) => {
                self.tracker.mark_everything_pending();
                Err(failed)
            }
        }
    }

    async fn flush_on_tick(&mut self) {
        match self.flush().await {
            Ok(()) | Err(JobWriteError::LeaseLost) => {}
            Err(failed) => warn!(
                "Progress write failed and will be retried on the next tick: {}",
                failed
            ),
        }
    }

    async fn run(mut self, every: Duration, mut requests: mpsc::Receiver<WriterRequest>) {
        let mut ticker = interval_at(Instant::now() + every, every);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = ticker.tick() => self.flush_on_tick().await,
                request = requests.recv() => {
                    let Some(WriterRequest::Flush(reply)) = request else {
                        break;
                    };
                    let outcome = self.flush().await;
                    if reply.send(outcome).is_err() {
                        break;
                    }
                }
            }
        }
    }
}

pub struct LiveProgress {
    tracker: Arc<ProgressTracker>,
    requests: mpsc::Sender<WriterRequest>,
    writer: Option<JoinHandle<()>>,
}

impl LiveProgress {
    pub fn start(
        jobs: JobRepository,
        job_id: ObjectId,
        tracker: Arc<ProgressTracker>,
        cancellation: Cancellation,
        every: Duration,
    ) -> Self {
        let (requests, received) = mpsc::channel(1);
        let writer = ProgressWriter {
            jobs,
            job_id,
            tracker: Arc::clone(&tracker),
            cancellation,
            lease_lost: false,
        };
        Self {
            tracker,
            requests,
            writer: Some(tokio::spawn(writer.run(every, received))),
        }
    }

    pub async fn flush_now(&self) -> Result<()> {
        let (reply, outcome) = oneshot::channel();
        self.requests
            .send(WriterRequest::Flush(reply))
            .await
            .map_err(|_| anyhow!("the progress writer has stopped"))?;
        outcome
            .await
            .map_err(|_| anyhow!("the progress writer has stopped"))??;
        Ok(())
    }

    pub async fn stop(mut self) -> Result<JobProgress> {
        if let Some(writer) = self.writer.take() {
            if self.requests.send(WriterRequest::Stop).await.is_ok() {
                writer.await?;
            }
        }
        Ok(self.tracker.snapshot())
    }
}

impl Drop for LiveProgress {
    fn drop(&mut self) {
        if let Some(writer) = self.writer.take() {
            writer.abort();
        }
    }
}

#[cfg(test)]
#[path = "progress_tracker_tests.rs"]
mod tests;
