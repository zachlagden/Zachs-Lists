use super::*;
use bson::{doc, Bson, Document};
use std::time::Duration;

use crate::db::job::Claim;
use crate::source_cache_test_server::{Reply, TestServer};
use crate::test_support::{insert_job, queued_job, stored_job, test_config, test_database};

const WORKER_ID: &str = "worker-a";

struct Harness {
    db: Database,
    _data_dir: tempfile::TempDir,
    jobs: JobRepository,
    cancellation: Cancellation,
    processor: JobProcessor,
}

async fn harness(server: &TestServer) -> Harness {
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
    processor.downloader.route_to_test_server(server.address);
    Harness {
        jobs: JobRepository::new(&db, WORKER_ID.into()),
        db,
        _data_dir: data_dir,
        cancellation,
        processor,
    }
}

impl Harness {
    async fn claim(&self, job: Document) -> Job {
        insert_job(&self.db, &job).await;
        match self.jobs.claim_next().await.unwrap() {
            Claim::Claimed(job) => *job,
            other => panic!("expected a claimed job, got {other:?}"),
        }
    }

    async fn store_live_config(&self, username: &str, blocklists: &str, whitelist: &str) {
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

    async fn stored_config_hash(&self, username: &str) -> String {
        self.db
            .collection::<Document>("users")
            .find_one(doc! { "username": username })
            .await
            .unwrap()
            .unwrap()
            .get_document("stats")
            .unwrap()
            .get_str("config_hash")
            .unwrap()
            .to_string()
    }
}

fn source_line(server: &TestServer, path: &str, name: &str) -> String {
    format!("{}|{}|tracking", server.url(path), name)
}

fn snapshot(blocklists: &str, whitelist: &str) -> Option<Document> {
    Some(doc! {
        "blocklists": blocklists,
        "whitelist": whitelist,
        "revision": Bson::Null,
        "limits": Bson::Null,
    })
}

fn rejection_code(outcome: Result<(), BuildError>) -> &'static str {
    match outcome {
        Err(BuildError::Rejected { code, .. }) => code,
        other => panic!("expected a rejected build, got {other:?}"),
    }
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
    assert_eq!(
        harness.stored_config_hash("sam").await,
        JobProcessor::compute_config_hash(&snapshot_blocklists, "blocked.example")
    );
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
    assert_eq!(
        rejection_code(harness.processor.process_job(&unreachable).await),
        error_code::ALL_SOURCES_FAILED
    );

    let missing_user = harness.claim(queued_job("jo", None)).await;
    assert!(matches!(
        harness.processor.process_job(&missing_user).await,
        Err(BuildError::Internal(_))
    ));

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
        Reply::new(200, b"first.example\n").delayed(Duration::from_millis(400)),
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

    assert!(matches!(build.await.unwrap(), Err(BuildError::Cancelled)));
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(server.recorded_requests().len(), 1);
    assert_eq!(stored_job(&db, &job_id).await, during_first_download);
    db.drop().await.unwrap();
}
