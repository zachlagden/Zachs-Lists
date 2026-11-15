use super::*;
use bson::{doc, Bson};
use mongodb::Database;

use crate::db::job::Claim;
use crate::db::progress::JobResult;
use crate::generator::OutputFormat;
use crate::test_support::{insert_job, queued_job, stored_job, test_database};

const WRITE_INTERVAL: Duration = Duration::from_millis(300);
const TICK_WAIT: Duration = Duration::from_secs(30);
const POLL_INTERVAL: Duration = Duration::from_millis(5);

fn sources(count: usize) -> Vec<Source> {
    (0..count)
        .map(|n| Source {
            name: format!("list_{n}"),
            url: format!("https://lists.example.com/{n}.txt"),
            category: None,
            abp: false,
        })
        .collect()
}

fn downloaded(source: &Source, error: Option<&str>, stale: bool) -> DownloadResult {
    DownloadResult {
        source: source.clone(),
        url_hash: Downloader::hash_url(&source.url),
        content: None,
        content_hash: None,
        last_checked_at: None,
        stale_fallback: stale,
        cache_hit: stale,
        bytes_downloaded: if stale { 0 } else { 2048 },
        download_time_ms: 12,
        error: error.map(str::to_string),
        warnings: Vec::new(),
        previous_domain_count: None,
    }
}

#[test]
fn each_source_starts_with_the_category_from_its_config_line() {
    let parsed = Downloader::parse_config(
        "https://lists.example.com/ads.txt|ads_list|advertising\n\
         https://lists.example.com/plain.txt|plain_list\n\
         https://lists.example.org/bare.txt\n",
    )
    .unwrap();

    let progress = ProgressTracker::downloading(&parsed).snapshot();

    let categories: Vec<Option<&str>> = progress
        .sources
        .iter()
        .map(|source| source.category.as_deref())
        .collect();
    assert_eq!(categories, [Some("advertising"), None, None]);
    let written = bson::to_document(&progress.sources[1]).unwrap();
    assert_eq!(written.get("category"), Some(&Bson::Null));
}

fn field_names(fields: &Document) -> Vec<&str> {
    fields.keys().map(String::as_str).collect()
}

fn revision(job: &Document) -> i64 {
    match job.get("rev") {
        Some(Bson::Int32(value)) => i64::from(*value),
        Some(Bson::Int64(value)) => *value,
        other => panic!("rev is not an integer: {other:?}"),
    }
}

struct Claimed {
    db: Database,
    jobs: JobRepository,
    job_id: ObjectId,
    tracker: Arc<ProgressTracker>,
    cancellation: Cancellation,
    live: LiveProgress,
}

async fn claimed_job(source_count: usize) -> Claimed {
    let db = test_database("progress_tracker_test").await;
    let job_id = insert_job(&db, &queued_job("sam", None)).await;
    let jobs = JobRepository::new(&db, "worker-a".into());
    assert!(matches!(
        jobs.claim_next().await.unwrap(),
        Claim::Claimed(_)
    ));
    let tracker = Arc::new(ProgressTracker::downloading(&sources(source_count)));
    let cancellation = Cancellation::default();
    let live = LiveProgress::start(
        jobs.clone(),
        job_id,
        Arc::clone(&tracker),
        cancellation.clone(),
        WRITE_INTERVAL,
    );
    Claimed {
        db,
        jobs,
        job_id,
        tracker,
        cancellation,
        live,
    }
}

async fn job_once_written_after(claimed: &Claimed, revision_before: i64) -> Document {
    tokio::time::timeout(TICK_WAIT, async {
        loop {
            let job = stored_job(&claimed.db, &claimed.job_id).await;
            if revision(&job) > revision_before {
                return job;
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("the progress writer writes on its tick")
}

#[test]
fn a_new_tracker_writes_the_whole_progress_once() {
    let tracker = ProgressTracker::downloading(&sources(2));

    let first = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&first), ["progress"]);
    let progress = first.get_document("progress").unwrap();
    assert_eq!(progress.get_str("stage").unwrap(), "downloading");
    assert_eq!(progress.get_array("sources").unwrap().len(), 2);
    assert!(tracker.take_pending_fields().unwrap().is_none());
}

#[test]
fn source_updates_write_only_the_changed_sources_and_scalars() {
    let all = sources(4);
    let tracker = ProgressTracker::downloading(&all);
    tracker.take_pending_fields().unwrap();

    tracker.source_started(2);
    tracker.source_bytes(2, 512, Some(2048));
    tracker.source_bytes(2, 1024, Some(2048));
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress.sources.2"]);
    let source = fields.get_document("progress.sources.2").unwrap();
    assert_eq!(source.get_str("status").unwrap(), "downloading");
    assert_eq!(source.get_i64("bytes_downloaded").unwrap(), 1024);
    assert_eq!(source.get_i64("bytes_total").unwrap(), 2048);
    assert_eq!(source.get_f64("download_percent").unwrap(), 50.0);
    assert_eq!(source.len(), 19);

    tracker.source_downloaded(2, &downloaded(&all[2], None, false));
    tracker.source_downloaded(0, &downloaded(&all[0], Some("HTTP 503"), false));
    tracker.source_extracting(2);
    tracker.source_domains_extracted(2, 8192);
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(
        field_names(&fields),
        [
            "progress.processed_sources",
            "progress.current_source",
            "progress.sources.0",
            "progress.sources.2"
        ]
    );
    assert_eq!(fields.get_i64("progress.processed_sources").unwrap(), 1);
    assert_eq!(fields.get_str("progress.current_source").unwrap(), "list_2");
    let processing = fields.get_document("progress.sources.2").unwrap();
    assert_eq!(processing.get_str("status").unwrap(), "processing");
    assert_eq!(processing.get_i64("domain_count").unwrap(), 8192);
    assert_eq!(processing.get("completed_at"), Some(&Bson::Null));
    let failed = fields.get_document("progress.sources.0").unwrap();
    assert_eq!(failed.get_str("status").unwrap(), "failed");
    assert_eq!(failed.get_str("error").unwrap(), "HTTP 503");

    tracker.source_completed(2, 9000, Some(9100), FormatBreakdown::default());
    let completed = tracker.snapshot().sources[2].clone();
    assert_eq!(completed.status, SourceStatus::Completed);
    assert_eq!(completed.domain_count, Some(9000));
    assert_eq!(completed.domain_change, Some(-100));
    assert!(completed.started_at.unwrap() <= completed.completed_at.unwrap());
    assert_eq!(tracker.snapshot().processed_sources, 2);
}

#[test]
fn bytes_total_stays_null_when_the_length_is_unknown() {
    let tracker = ProgressTracker::downloading(&sources(1));
    tracker.source_started(0);
    tracker.source_bytes(0, 4096, None);

    let source = tracker.snapshot().sources[0].clone();
    assert_eq!(source.bytes_downloaded, 4096);
    assert_eq!(source.bytes_total, None);
    assert_eq!(source.download_percent, None);
}

#[test]
fn summary_counts_stale_and_failed_sources_and_explains_them() {
    let all = sources(3);
    let tracker = ProgressTracker::downloading(&all);
    tracker.source_downloaded(0, &downloaded(&all[0], None, false));
    tracker.source_completed(0, 10, None, FormatBreakdown::default());
    tracker.source_downloaded(1, &downloaded(&all[1], None, true));
    tracker.source_completed(1, 5, Some(5), FormatBreakdown::default());
    tracker.source_downloaded(2, &downloaded(&all[2], Some("HTTP 503"), false));

    let summary = tracker.source_summary();
    assert_eq!(summary.completed, 2);
    assert_eq!(summary.failed, 1);
    assert_eq!(summary.stale, 1);
    assert_eq!(summary.total_domains, 15);
    assert_eq!(summary.warnings.len(), 2);
    assert!(summary.warnings[0].starts_with("Source list_1 is stale"));
    assert!(summary.warnings[1].contains("list_2") && summary.warnings[1].contains("HTTP 503"));
    let stale = tracker.snapshot().sources[1].clone();
    assert!(stale.stale);
    assert_eq!(stale.cache_hit, Some(true));
    assert_eq!(stale.domain_change, Some(0));
}

#[test]
fn stage_changes_write_everything_and_stage_updates_write_their_own_key() {
    let tracker = ProgressTracker::downloading(&sources(1));
    tracker.take_pending_fields().unwrap();

    tracker.begin_whitelist(100, 3).unwrap();
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress"]);
    tracker.whitelist_checked(40, 4);
    tracker.whitelist_checked(70, 6);
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress.whitelist"]);
    let whitelist = fields.get_document("progress.whitelist").unwrap();
    assert!(whitelist.get_bool("processing").unwrap());
    assert_eq!(whitelist.get_i64("domains_before").unwrap(), 100);
    assert_eq!(whitelist.get_i64("domains_after").unwrap(), 90);
    assert_eq!(whitelist.get_i64("domains_checked").unwrap(), 100);
    assert_eq!(whitelist.get_i64("total_removed").unwrap(), 10);
    assert_eq!(whitelist.get_i64("patterns_total").unwrap(), 3);

    tracker
        .begin_generation(GenerationProgress::pending(6, 180))
        .unwrap();
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress"]);
    tracker.generation_event(GenerationEvent::FileStarted(OutputFormat::Plain));
    tracker.generation_event(GenerationEvent::DomainsWritten(OutputFormat::Plain, 45));
    tracker.generation_event(GenerationEvent::FileCompleted {
        format: OutputFormat::Plain,
        gz_size: 700,
    });
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress.generation"]);
    let generation = tracker.snapshot().generation.unwrap();
    assert_eq!(generation.files_completed, 1);
    assert_eq!(generation.formats[0].status, FormatStatus::Pending);
    assert_eq!(generation.formats[0].gz_size, None);
    assert_eq!(generation.formats[1].status, FormatStatus::Generating);
    assert_eq!(generation.formats[1].domains_written, 45);
    assert_eq!(generation.formats[1].percent, 25.0);
    assert_eq!(generation.formats[1].gz_size, Some(700));

    tracker.generation_event(GenerationEvent::FileStarted(OutputFormat::Plain));
    tracker.generation_event(GenerationEvent::DomainsWritten(OutputFormat::Plain, 135));
    tracker.generation_event(GenerationEvent::FileCompleted {
        format: OutputFormat::Plain,
        gz_size: 900,
    });
    let generation = tracker.snapshot().generation.unwrap();
    assert_eq!(generation.formats[1].status, FormatStatus::Completed);
    assert_eq!(generation.formats[1].gz_size, Some(1600));
    assert_eq!(generation.formats[1].percent, 100.0);

    tracker.take_pending_fields().unwrap();
    tracker.complete().unwrap();
    let fields = tracker.take_pending_fields().unwrap().unwrap();
    assert_eq!(field_names(&fields), ["progress"]);
    let stages = tracker.snapshot().stages;
    for timing in [stages.downloading, stages.whitelist, stages.generation] {
        assert!(timing.unwrap().completed_at.is_some());
    }
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn many_updates_inside_one_interval_produce_at_most_one_write() {
    let claimed = claimed_job(3).await;
    claimed.live.flush_now().await.unwrap();
    let after_start = revision(&stored_job(&claimed.db, &claimed.job_id).await);

    claimed.tracker.source_started(1);
    for downloaded in 1..=500 {
        claimed.tracker.source_bytes(1, downloaded * 100, None);
    }
    let after_updates = job_once_written_after(&claimed, after_start).await;
    assert_eq!(revision(&after_updates), after_start + 1);
    let written = after_updates
        .get_document("progress")
        .unwrap()
        .get_array("sources")
        .unwrap()[1]
        .as_document()
        .unwrap()
        .get_i64("bytes_downloaded")
        .unwrap();
    assert_eq!(written, 50_000);

    tokio::time::sleep(WRITE_INTERVAL * 2).await;
    assert_eq!(
        stored_job(&claimed.db, &claimed.job_id).await,
        after_updates
    );
    claimed.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn partial_flush_changes_only_the_dirty_source() {
    let claimed = claimed_job(3).await;
    claimed.live.flush_now().await.unwrap();
    let before = stored_job(&claimed.db, &claimed.job_id).await;

    claimed.tracker.source_started(1);
    claimed.tracker.source_bytes(1, 512, Some(1024));
    claimed.live.flush_now().await.unwrap();
    let after = stored_job(&claimed.db, &claimed.job_id).await;

    assert_eq!(revision(&after), revision(&before) + 1);
    let progress_before = before.get_document("progress").unwrap();
    let progress_after = after.get_document("progress").unwrap();
    let sources_before = progress_before.get_array("sources").unwrap();
    let sources_after = progress_after.get_array("sources").unwrap();
    for untouched in [0, 2] {
        assert_eq!(
            bson::to_vec(sources_before[untouched].as_document().unwrap()).unwrap(),
            bson::to_vec(sources_after[untouched].as_document().unwrap()).unwrap()
        );
    }
    let changed = sources_after[1].as_document().unwrap();
    assert_eq!(changed.get_str("status").unwrap(), "downloading");
    assert_eq!(changed.get_i64("bytes_downloaded").unwrap(), 512);
    for (key, value) in progress_before {
        if key != "sources" {
            assert_eq!(progress_after.get(key), Some(value), "{key}");
        }
    }
    assert_eq!(progress_before.len(), progress_after.len());
    claimed.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn flush_after_lease_loss_sets_cancellation_and_writes_nothing() {
    let claimed = claimed_job(2).await;
    claimed.live.flush_now().await.unwrap();
    claimed
        .db
        .collection::<Document>("jobs")
        .update_one(
            doc! { "_id": claimed.job_id },
            doc! { "$set": { "status": "queued", "worker_id": Bson::Null } },
        )
        .await
        .unwrap();
    let other_worker = JobRepository::new(&claimed.db, "worker-b".into());
    assert!(matches!(
        other_worker.claim_next().await.unwrap(),
        Claim::Claimed(_)
    ));
    let held_by_other = stored_job(&claimed.db, &claimed.job_id).await;
    assert!(!claimed.cancellation.is_cancelled());

    claimed.tracker.source_started(0);
    let lost = claimed.live.flush_now().await.unwrap_err();
    assert!(matches!(
        lost.downcast_ref::<JobWriteError>(),
        Some(JobWriteError::LeaseLost)
    ));
    assert!(claimed.cancellation.is_cancelled());

    claimed.tracker.source_started(1);
    assert!(claimed.live.flush_now().await.is_err());
    tokio::time::sleep(WRITE_INTERVAL * 2).await;
    assert_eq!(
        stored_job(&claimed.db, &claimed.job_id).await,
        held_by_other
    );
    claimed.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn tick_flush_after_lease_loss_cancels_the_build() {
    let claimed = claimed_job(1).await;
    claimed.live.flush_now().await.unwrap();
    claimed
        .db
        .collection::<Document>("jobs")
        .update_one(
            doc! { "_id": claimed.job_id },
            doc! { "$set": { "worker_id": "worker-b" } },
        )
        .await
        .unwrap();
    let held_by_other = stored_job(&claimed.db, &claimed.job_id).await;

    claimed.tracker.source_started(0);
    tokio::time::timeout(TICK_WAIT, async {
        while !claimed.cancellation.is_cancelled() {
            tokio::time::sleep(POLL_INTERVAL).await;
        }
    })
    .await
    .expect("the tick after the lease was lost cancels the build");

    assert_eq!(
        stored_job(&claimed.db, &claimed.job_id).await,
        held_by_other
    );
    claimed.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn no_progress_write_lands_after_the_terminal_write() {
    let claimed = claimed_job(2).await;
    claimed.live.flush_now().await.unwrap();
    claimed.tracker.source_started(0);
    claimed.live.flush_now().await.unwrap();
    let before_terminal = revision(&stored_job(&claimed.db, &claimed.job_id).await);

    let Claimed {
        db,
        jobs,
        job_id,
        tracker,
        live,
        ..
    } = claimed;
    tracker.source_started(1);
    let late_writer = LiveProgress::start(
        jobs.clone(),
        job_id,
        Arc::clone(&tracker),
        Cancellation::default(),
        WRITE_INTERVAL,
    );
    let final_progress = live.stop().await.unwrap();
    assert_eq!(final_progress.sources[1].status, SourceStatus::Downloading);
    jobs.complete(&job_id, &JobResult::default(), &final_progress)
        .await
        .unwrap();
    let completed = stored_job(&db, &job_id).await;
    assert_eq!(revision(&completed), before_terminal + 1);
    assert_eq!(completed.get_str("status").unwrap(), "completed");
    let stored_sources = completed
        .get_document("progress")
        .unwrap()
        .get_array("sources")
        .unwrap();
    assert_eq!(
        stored_sources[1]
            .as_document()
            .unwrap()
            .get_str("status")
            .unwrap(),
        "downloading"
    );

    tracker.source_bytes(1, 999, None);
    assert!(late_writer.flush_now().await.is_err());
    tracker.source_bytes(0, 999, None);
    tokio::time::sleep(WRITE_INTERVAL * 2).await;
    assert_eq!(stored_job(&db, &job_id).await, completed);
    db.drop().await.unwrap();
}
