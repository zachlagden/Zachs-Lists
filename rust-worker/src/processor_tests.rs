use super::*;
use bson::{doc, Bson, Document};
use std::time::Duration;

use crate::db::job::Claim;
use crate::db::progress::{JobStage, SourceStatus};
use crate::source_cache_test_server::{Reply, TestServer};
use crate::test_support::{insert_job, queued_job, stored_job, test_config, test_database};

const WORKER_ID: &str = "worker-a";
const BLOCKED_STAGE_WAIT: Duration = Duration::from_secs(30);

pub(super) struct Harness {
    pub(super) db: Database,
    pub(super) _data_dir: tempfile::TempDir,
    pub(super) jobs: JobRepository,
    pub(super) cancellation: Cancellation,
    pub(super) processor: JobProcessor,
}

pub(super) async fn harness(server: &TestServer) -> Harness {
    let db = test_database("processor_test").await;
    let data_dir = tempfile::tempdir().unwrap();
    let mut config = test_config(&db, data_dir.path(), WORKER_ID);
    config.max_concurrent_downloads = 1;
    let cancellation = Cancellation::default();
    let mut processor = JobProcessor::new(
        config,
        JobRepository::new(&db, WORKER_ID.into()),
        &db,
        cancellation.clone(),
    )
    .unwrap();
    Arc::get_mut(&mut processor.downloader)
        .expect("the downloader is not shared yet")
        .route_to_test_server(server.address);
    Harness {
        jobs: JobRepository::new(&db, WORKER_ID.into()),
        db,
        _data_dir: data_dir,
        cancellation,
        processor,
    }
}

impl Harness {
    pub(super) async fn claim(&self, job: Document) -> Job {
        insert_job(&self.db, &job).await;
        match self.jobs.claim_next().await.unwrap() {
            Claim::Claimed(job) => *job,
            other => panic!("expected a claimed job, got {other:?}"),
        }
    }

    pub(super) async fn add_user(&self, username: &str) {
        self.store_live_config(username, "", "").await;
    }

    pub(super) async fn stored_target(&self, username: &str) -> Document {
        let (collection, filter) = if username == crate::config::DEFAULT_TARGET {
            ("system_config", doc! { "_id": "default_build" })
        } else {
            ("users", doc! { "username": username })
        };
        self.db
            .collection::<Document>(collection)
            .find_one(filter)
            .await
            .unwrap()
            .unwrap()
    }

    pub(super) async fn store_live_config(
        &self,
        username: &str,
        blocklists: &str,
        whitelist: &str,
    ) {
        self.db
            .collection::<Document>("users")
            .insert_one(doc! {
                "username": username,
                "is_enabled": true,
                "config": { "blocklists": blocklists, "whitelist": whitelist },
            })
            .await
            .unwrap();
    }
}

pub(super) fn source_line(server: &TestServer, path: &str, name: &str) -> String {
    format!("{}|{}|tracking", server.url(path), name)
}

pub(super) fn snapshot(blocklists: &str, whitelist: &str) -> Option<Document> {
    Some(doc! {
        "blocklists": blocklists,
        "whitelist": whitelist,
        "revision": Bson::Null,
        "limits": Bson::Null,
    })
}

fn rejection_code(outcome: Result<(), BuildFailure>) -> &'static str {
    match outcome {
        Err(BuildFailure {
            error: BuildError::Rejected { code, .. },
            ..
        }) => code,
        other => panic!("expected a rejected build, got {other:?}"),
    }
}

fn revision(job: &Document) -> i64 {
    match job.get("rev") {
        Some(Bson::Int32(value)) => i64::from(*value),
        Some(Bson::Int64(value)) => *value,
        other => panic!("rev is not an integer: {other:?}"),
    }
}

fn stored_source(job: &Document, index: usize) -> Document {
    job.get_document("progress")
        .unwrap()
        .get_array("sources")
        .unwrap()[index]
        .as_document()
        .unwrap()
        .clone()
}

pub(super) fn hosts_body(domains: usize) -> Vec<u8> {
    (0..domains)
        .map(|n| format!("0.0.0.0 d{n:07}.blocked.example\n"))
        .collect::<String>()
        .into_bytes()
}

struct Observed {
    revisions: Vec<i64>,
    jobs: Vec<Document>,
}

fn observe(
    db: &Database,
    job_id: bson::oid::ObjectId,
) -> (
    tokio::task::JoinHandle<Observed>,
    tokio::sync::oneshot::Sender<()>,
) {
    let db = db.clone();
    let (stop, mut stopped) = tokio::sync::oneshot::channel();
    let observer = tokio::spawn(async move {
        let mut observed = Observed {
            revisions: Vec::new(),
            jobs: Vec::new(),
        };
        loop {
            let job = stored_job(&db, &job_id).await;
            let seen = revision(&job);
            if observed.revisions.last() != Some(&seen) {
                observed.revisions.push(seen);
                observed.jobs.push(job);
            }
            if stopped.try_recv().is_ok() {
                return observed;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    });
    (observer, stop)
}

#[test]
fn stop_reasons_survive_conversion_through_anyhow() {
    let lease_lost: anyhow::Error = JobWriteError::LeaseLost.into();
    assert!(matches!(
        BuildError::from(lease_lost),
        BuildError::LeaseLost
    ));
    let cancelled: anyhow::Error = Cancelled.into();
    assert!(matches!(BuildError::from(cancelled), BuildError::Cancelled));
    assert!(matches!(
        BuildError::from(anyhow::anyhow!("disk full")),
        BuildError::Internal(_)
    ));
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_uses_the_snapshot_when_the_live_config_differs() {
    let server = TestServer::start(vec![Reply::new(200, b"blocked.example\nkept.example\n")]).await;
    let harness = harness(&server).await;
    let snapshot_blocklists = source_line(&server, "/snapshot", "snapshot_list");
    harness
        .store_live_config("sam", &source_line(&server, "/live", "live_list"), "")
        .await;
    let job = harness
        .claim(queued_job(
            "sam",
            snapshot(&snapshot_blocklists, "blocked.example"),
        ))
        .await;

    harness.processor.process_job(&job).await.unwrap();

    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /snapshot "), "{}", requests[0]);
    let stored = stored_job(&harness.db, &job.id).await;
    assert_eq!(stored.get_str("status").unwrap(), "completed");
    let result = stored.get_document("result").unwrap();
    assert_eq!(result.get_i64("whitelisted_removed").unwrap(), 1);
    assert_eq!(result.get_i64("unique_domains").unwrap(), 1);
    assert_eq!(result.get("error_code"), Some(&Bson::Null));
    let sam = harness.stored_target("sam").await;
    assert_eq!(
        sam.get_str("published_generation").unwrap(),
        result.get_str("generation_id").unwrap()
    );
    assert!(!sam
        .get_document("stats")
        .unwrap()
        .contains_key("config_hash"));
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn job_without_a_snapshot_falls_back_to_the_live_config() {
    let server = TestServer::start(vec![Reply::new(200, b"blocked.example\nkept.example\n")]).await;
    let harness = harness(&server).await;
    harness
        .store_live_config(
            "sam",
            &source_line(&server, "/live", "live_list"),
            "kept.example",
        )
        .await;
    let job = harness.claim(queued_job("sam", None)).await;

    harness.processor.process_job(&job).await.unwrap();

    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("GET /live "), "{}", requests[0]);
    let stored = stored_job(&harness.db, &job.id).await;
    assert_eq!(stored.get_str("status").unwrap(), "completed");
    let result = stored.get_document("result").unwrap();
    assert_eq!(result.get_i64("whitelisted_removed").unwrap(), 1);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn expected_failures_carry_their_code_and_write_nothing_themselves() {
    let server = TestServer::start(vec![Reply::new(500, b"")]).await;
    let harness = harness(&server).await;

    let unparsable = harness
        .claim(queued_job("sam", snapshot("ftp://source.example/list", "")))
        .await;
    assert_eq!(
        rejection_code(harness.processor.process_job(&unparsable).await),
        error_code::INVALID_CONFIG
    );

    let empty = harness
        .claim(queued_job("alex", snapshot("# nothing enabled\n", "")))
        .await;
    assert_eq!(
        rejection_code(harness.processor.process_job(&empty).await),
        error_code::NO_SOURCES
    );

    let unreachable = harness
        .claim(queued_job(
            "robin",
            snapshot(&source_line(&server, "/down", "down_list"), ""),
        ))
        .await;
    let all_failed = harness
        .processor
        .process_job(&unreachable)
        .await
        .unwrap_err();
    assert!(matches!(
        all_failed.error,
        BuildError::Rejected {
            code: error_code::ALL_SOURCES_FAILED,
            ..
        }
    ));
    let final_progress = all_failed.progress.unwrap();
    assert_eq!(final_progress.stage, JobStage::Downloading);
    assert_eq!(final_progress.processed_sources, 1);
    assert_eq!(
        final_progress.sources[0].status,
        crate::db::progress::SourceStatus::Failed
    );
    assert!(final_progress.sources[0].completed_at.is_some());

    let missing_user = harness.claim(queued_job("jo", None)).await;
    let missing = harness
        .processor
        .process_job(&missing_user)
        .await
        .unwrap_err();
    assert!(matches!(missing.error, BuildError::Internal(_)));
    assert!(missing.progress.is_none());

    for job in [&unparsable, &empty, &unreachable, &missing_user] {
        let stored = stored_job(&harness.db, &job.id).await;
        assert_eq!(stored.get_str("status").unwrap(), "processing");
        assert_eq!(stored.get("result"), Some(&Bson::Null));
    }
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn cancellation_stops_between_sources_and_writes_nothing_more() {
    let server = TestServer::start(vec![
        Reply::new(200, b"first.example\n").stalled_after(0),
        Reply::new(200, b"second.example\n"),
    ])
    .await;
    let harness = harness(&server).await;
    let blocklists = format!(
        "{}\n{}",
        source_line(&server, "/first", "first_list"),
        source_line(&server, "/second", "second_list")
    );
    let job = harness
        .claim(queued_job("sam", snapshot(&blocklists, "")))
        .await;
    let job_id = job.id;
    let Harness {
        db,
        _data_dir,
        cancellation,
        processor,
        ..
    } = harness;

    let build = tokio::spawn(async move { processor.process_job(&job).await });
    while server.recorded_requests().is_empty() {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let during_first_download = stored_job(&db, &job_id).await;
    assert_eq!(
        during_first_download
            .get_document("progress")
            .unwrap()
            .get_str("stage")
            .unwrap(),
        "downloading"
    );
    cancellation.cancel();

    let stopped = build.await.unwrap().unwrap_err();
    assert!(matches!(stopped.error, BuildError::Cancelled));
    let stopped_progress = stopped.progress.expect("the build was downloading");
    assert_eq!(
        stopped_progress.sources[0].status,
        SourceStatus::Downloading
    );
    assert!(stopped_progress.sources[0].completed_at.is_none());
    let after_stop = stored_job(&db, &job_id).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(server.recorded_requests().len(), 1);
    assert_eq!(stored_job(&db, &job_id).await, after_stop);
    assert_eq!(after_stop.get_str("status").unwrap(), "processing");
    assert_eq!(after_stop.get("result"), Some(&Bson::Null));
    assert_eq!(
        stored_source(&after_stop, 1).get_str("status").unwrap(),
        "pending"
    );
    db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn dripped_source_moves_through_downloading_and_processing_with_growing_bytes() {
    let dripped = hosts_body(150_000);
    let unsized_body = hosts_body(40);
    let server = TestServer::start(vec![
        Reply::new(200, &dripped).dripped(8, Duration::from_millis(60)),
        Reply::new(200, &unsized_body).without_length(),
    ])
    .await;
    let mut harness = harness(&server).await;
    harness.add_user("sam").await;
    harness.processor.config.progress_update_interval_ms = 10;
    let blocklists = format!(
        "{}\n{}",
        source_line(&server, "/dripped", "dripped_list"),
        source_line(&server, "/unsized", "unsized_list")
    );
    let job = harness
        .claim(queued_job("sam", snapshot(&blocklists, "")))
        .await;
    let (observer, stop) = observe(&harness.db, job.id);

    harness.processor.process_job(&job).await.unwrap();
    stop.send(()).unwrap();
    let observed = observer.await.unwrap();

    let dripped_states: Vec<Document> = observed
        .jobs
        .iter()
        .filter(|job| {
            job.get_document("progress")
                .unwrap()
                .get_array("sources")
                .unwrap()
                .len()
                == 2
        })
        .map(|job| stored_source(job, 0))
        .collect();
    let statuses: Vec<&str> = dripped_states
        .iter()
        .map(|source| source.get_str("status").unwrap())
        .collect();
    let mut order = statuses.clone();
    order.dedup();
    let expected_order = ["pending", "downloading", "processing", "completed"];
    let mut position = 0;
    for status in &order {
        position += expected_order[position..]
            .iter()
            .position(|expected| expected == status)
            .unwrap_or_else(|| panic!("statuses went backwards: {order:?}"));
    }
    assert!(order.contains(&"downloading"), "{order:?}");
    assert!(order.contains(&"processing"), "{order:?}");
    assert_eq!(order.last(), Some(&"completed"));

    let total = dripped.len() as i64;
    let while_downloading: Vec<i64> = dripped_states
        .iter()
        .filter(|source| source.get_str("status").unwrap() == "downloading")
        .map(|source| source.get_i64("bytes_downloaded").unwrap())
        .collect();
    assert!(while_downloading.windows(2).all(|pair| pair[0] <= pair[1]));
    let mut partial: Vec<i64> = while_downloading
        .iter()
        .copied()
        .filter(|bytes| *bytes > 0 && *bytes < total)
        .collect();
    partial.dedup();
    assert!(partial.len() >= 2, "{while_downloading:?}");
    assert!(dripped_states
        .iter()
        .filter(|source| source.get_str("status").unwrap() != "pending")
        .filter(|source| source.get("bytes_total") != Some(&Bson::Null))
        .all(|source| source.get_i64("bytes_total").unwrap() == total));

    let stored = stored_job(&harness.db, &job.id).await;
    let finished = stored_source(&stored, 0);
    assert_eq!(finished.get_i64("bytes_downloaded").unwrap(), total);
    assert_eq!(finished.get_i64("bytes_total").unwrap(), total);
    assert_eq!(finished.get_i64("domain_count").unwrap(), 150_000);
    assert_eq!(finished.get("domain_change"), Some(&Bson::Null));
    assert!(!finished.get_bool("cache_hit").unwrap());
    assert!(!finished.get_bool("stale").unwrap());
    assert!(finished.get_str("started_at").unwrap() <= finished.get_str("completed_at").unwrap());
    let unsized_source = stored_source(&stored, 1);
    assert_eq!(unsized_source.get_str("status").unwrap(), "completed");
    assert_eq!(unsized_source.get("bytes_total"), Some(&Bson::Null));
    assert_eq!(
        unsized_source.get_i64("bytes_downloaded").unwrap(),
        unsized_body.len() as i64
    );
    assert_eq!(unsized_source.get("download_percent"), Some(&Bson::Null));

    assert!(observed.revisions.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(observed.revisions.len() > 8, "{:?}", observed.revisions);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn completed_build_writes_the_whole_schema_and_nothing_after_the_terminal_write() {
    let server = TestServer::start(vec![
        Reply::new(200, b"first.example\nshared.example\nallowed.example\n"),
        Reply::new(200, b"||shared.example^\n||second.example^\n"),
        Reply::new(503, b""),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = format!(
        "{}|first_list|tracking\n{}|second_list|advertising\n{}|down_list|malicious",
        server.url("/first"),
        server.url("/second"),
        server.url("/down")
    );
    let job = harness
        .claim(queued_job(
            "sam",
            snapshot(&blocklists, "allowed.example\nnot a pattern\n"),
        ))
        .await;
    let (observer, stop) = observe(&harness.db, job.id);

    harness.processor.process_job(&job).await.unwrap();
    let completed = stored_job(&harness.db, &job.id).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    stop.send(()).unwrap();
    let observed = observer.await.unwrap();

    assert_eq!(stored_job(&harness.db, &job.id).await, completed);
    assert_eq!(completed.get_str("status").unwrap(), "completed");
    assert_eq!(observed.revisions.last(), Some(&revision(&completed)));
    assert!(observed.revisions.windows(2).all(|pair| pair[0] < pair[1]));
    let terminal_writes = observed
        .jobs
        .iter()
        .filter(|job| job.get_str("status").unwrap() == "completed")
        .count();
    assert_eq!(terminal_writes, 1);

    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/job-progress.json")).unwrap();
    let keys = |value: &serde_json::Value| -> std::collections::BTreeSet<String> {
        value.as_object().unwrap().keys().cloned().collect()
    };
    let progress =
        Bson::Document(completed.get_document("progress").unwrap().clone()).into_relaxed_extjson();
    let result =
        Bson::Document(completed.get_document("result").unwrap().clone()).into_relaxed_extjson();
    let expected = &fixture["completed"];
    assert_eq!(keys(&progress), keys(&expected["progress"]));
    assert_eq!(keys(&result), keys(&expected["result"]));
    for source in progress["sources"].as_array().unwrap() {
        assert_eq!(keys(source), keys(&expected["progress"]["sources"][0]));
    }
    assert_eq!(
        keys(&progress["whitelist"]),
        keys(&expected["progress"]["whitelist"])
    );
    assert_eq!(
        keys(&progress["generation"]),
        keys(&expected["progress"]["generation"])
    );
    assert_eq!(progress["stage"], "completed");
    assert_eq!(progress["processed_sources"], 3);
    let categories: Vec<&serde_json::Value> = progress["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|source| &source["category"])
        .collect();
    assert_eq!(categories, ["tracking", "advertising", "malicious"]);
    assert_eq!(progress["whitelist"]["domains_before"], 4);
    assert_eq!(progress["whitelist"]["domains_after"], 3);
    assert_eq!(progress["whitelist"]["domains_checked"], 4);
    assert_eq!(progress["whitelist"]["patterns_total"], 1);
    assert_eq!(progress["whitelist"]["processing"], false);
    assert_eq!(progress["generation"]["files_total"], 9);
    assert_eq!(progress["generation"]["files_completed"], 9);
    for format in progress["generation"]["formats"].as_array().unwrap() {
        assert_eq!(format["status"], "completed");
        assert_eq!(format["total_domains"], 7);
        assert_eq!(format["domains_written"], 7);
        assert!(format["gz_size"].as_u64().unwrap() > 0);
    }
    for stage in ["downloading", "whitelist", "generation"] {
        let timing = &progress["stages"][stage];
        assert!(timing["started_at"].as_str().unwrap().ends_with('Z'));
        assert!(timing["completed_at"].as_str().unwrap() >= timing["started_at"].as_str().unwrap());
        assert!(progress["stage_snapshots"][stage].is_object());
    }

    assert_eq!(result["sources_processed"], 2);
    assert_eq!(result["sources_failed"], 1);
    assert_eq!(result["sources_stale"], 0);
    assert_eq!(result["total_domains"], 5);
    assert_eq!(result["unique_domains"], 3);
    assert_eq!(result["whitelisted_removed"], 1);
    assert_eq!(
        result["categories"],
        serde_json::json!({ "tracking": 2, "advertising": 2 })
    );
    assert_eq!(result["output_files"].as_array().unwrap().len(), 9);
    assert_eq!(result["generation_id"].as_str().unwrap().len(), 36);
    let warnings: Vec<&str> = result["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|warning| warning.as_str().unwrap())
        .collect();
    assert_eq!(warnings.len(), 2);
    assert!(warnings[0].starts_with("Source down_list could not be used"));
    assert!(warnings[1].starts_with("1 whitelist lines were ignored"));
    assert_eq!(result["error_code"], serde_json::Value::Null);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn domain_change_compares_with_the_count_stored_by_the_previous_build() {
    let server = TestServer::start(vec![
        Reply::new(200, b"one.example\ntwo.example\n"),
        Reply::new(200, b"one.example\ntwo.example\nthree.example\n"),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "counted_list");

    let first = harness
        .claim(queued_job("sam", snapshot(&blocklists, "")))
        .await;
    harness.processor.process_job(&first).await.unwrap();
    let first_source = stored_source(&stored_job(&harness.db, &first.id).await, 0);
    assert_eq!(first_source.get_i64("domain_count").unwrap(), 2);
    assert_eq!(first_source.get("domain_change"), Some(&Bson::Null));

    let cache = harness.db.collection::<Document>("cache");
    let cached = cache.find_one(doc! {}).await.unwrap().unwrap();
    assert_eq!(
        cached
            .get_document("stats")
            .unwrap()
            .get_i64("domain_count")
            .unwrap(),
        2
    );
    cache
        .update_one(doc! {}, doc! { "$set": { "stats.domain_count": 7_i64 } })
        .await
        .unwrap();

    let second = harness
        .claim(queued_job("sam", snapshot(&blocklists, "")))
        .await;
    harness.processor.process_job(&second).await.unwrap();
    let second_source = stored_source(&stored_job(&harness.db, &second.id).await, 0);
    assert_eq!(second_source.get_i64("domain_count").unwrap(), 3);
    assert_eq!(second_source.get_i64("domain_change").unwrap(), -4);
    let recounted = cache.find_one(doc! {}).await.unwrap().unwrap();
    assert_eq!(
        recounted
            .get_document("stats")
            .unwrap()
            .get_i64("domain_count")
            .unwrap(),
        3
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn lost_lease_stops_the_build_during_a_download_without_writing() {
    let server = TestServer::start(vec![
        Reply::new(200, &hosts_body(20_000)).dripped(600, Duration::from_millis(50))
    ])
    .await;
    let mut harness = harness(&server).await;
    harness.processor.config.progress_update_interval_ms = 20;
    let job = harness
        .claim(queued_job(
            "sam",
            snapshot(&source_line(&server, "/slow", "slow_list"), ""),
        ))
        .await;
    let job_id = job.id;
    let Harness {
        db,
        _data_dir,
        cancellation,
        processor,
        ..
    } = harness;

    let build = tokio::spawn(async move { processor.process_job(&job).await });
    loop {
        let stored = stored_job(&db, &job_id).await;
        let progress = stored.get_document("progress").unwrap();
        if !progress.get_array("sources").unwrap().is_empty()
            && stored_source(&stored, 0)
                .get_i64("bytes_downloaded")
                .unwrap()
                > 0
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    db.collection::<Document>("jobs")
        .update_one(
            doc! { "_id": job_id },
            doc! { "$set": { "worker_id": "worker-b" } },
        )
        .await
        .unwrap();
    let held_by_other = stored_job(&db, &job_id).await;

    let stopped = build.await.unwrap().unwrap_err();
    assert!(matches!(
        stopped.error,
        BuildError::Cancelled | BuildError::LeaseLost
    ));
    let stopped_progress = stopped.progress.expect("the build was downloading");
    assert_eq!(
        stopped_progress.sources[0].status,
        SourceStatus::Downloading
    );
    assert!(cancellation.is_cancelled());
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(stored_job(&db, &job_id).await, held_by_other);
    db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn heartbeat_keeps_writing_during_blocking_work_and_leaves_the_revision_alone() {
    let server = TestServer::start(Vec::new()).await;
    let harness = harness(&server).await;
    let job = harness.claim(queued_job("sam", None)).await;
    let before = stored_job(&harness.db, &job.id).await;
    let jobs = harness.jobs.clone();
    let job_id = job.id;
    let (stage_blocked, blocked) = tokio::sync::oneshot::channel();
    let (fifth_heartbeat, heartbeats) = std::sync::mpsc::channel();
    let heartbeat = tokio::spawn(async move {
        blocked.await.unwrap();
        let mut written = 0;
        let mut ticker = tokio::time::interval(Duration::from_millis(20));
        loop {
            ticker.tick().await;
            if jobs.heartbeat(&job_id).await.unwrap() {
                written += 1;
            }
            if written == 5 {
                return fifth_heartbeat.send(()).is_ok();
            }
        }
    });

    let fifth_heartbeat_came_while_blocked = harness
        .processor
        .stage_thread
        .run(move || {
            stage_blocked
                .send(())
                .expect("the heartbeat task is waiting");
            let extractor = DomainExtractor::new();
            let mut domains = CategoryDomains::default();
            extract_source(
                &extractor,
                SourceBody {
                    source_index: 0,
                    category: None,
                    abp: false,
                    content: hosts_body(100_000),
                },
                &mut domains,
                &Cancellation::default(),
                &|_| {},
            )?;
            Ok(heartbeats.recv_timeout(BLOCKED_STAGE_WAIT).is_ok())
        })
        .await
        .unwrap();

    assert!(fifth_heartbeat_came_while_blocked);
    assert!(heartbeat.await.unwrap());
    let after = stored_job(&harness.db, &job.id).await;
    assert!(
        after.get_datetime("heartbeat_at").unwrap() > before.get_datetime("heartbeat_at").unwrap()
    );
    assert_eq!(revision(&after), revision(&before));
    assert_eq!(after.get("updated_at"), before.get("updated_at"));
    harness.db.drop().await.unwrap();
}
