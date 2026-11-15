use super::publishing_tests::generation_names;
use super::tests::{harness, Harness};
use super::*;
use bson::{doc, Bson, Document};
use std::collections::BTreeMap;

use crate::db::progress::JobStage;
use crate::generation::generations_dir;
use crate::source_cache_test_server::{Reply, TestServer};
use crate::test_support::{queued_job, stored_job};

const TRACKING_BODY: &[u8] = b"first.example\nshared.example\n";
const NSFW_BODY: &[u8] = b"shared.example\nadult.example\n";
const DOMAINS_IN_ALL_CATEGORIES: u64 = 3;
const DOMAINS_IN_THE_COMBINED_LIST: i64 = 2;

async fn server_for_builds(builds: usize) -> TestServer {
    let replies = (0..builds)
        .flat_map(|_| [Reply::new(200, TRACKING_BODY), Reply::new(200, NSFW_BODY)])
        .collect();
    TestServer::start(replies).await
}

fn two_categories(server: &TestServer) -> String {
    format!(
        "{}|tracking_list|tracking\n{}|nsfw_list|nsfw",
        server.url("/tracking"),
        server.url("/nsfw")
    )
}

fn job_with_limits(username: &str, blocklists: &str, limits: Bson) -> Document {
    queued_job(
        username,
        Some(doc! {
            "blocklists": blocklists,
            "whitelist": "",
            "revision": 1,
            "limits": limits,
        }),
    )
}

fn limited_to(max_domains: i64) -> Bson {
    Bson::Document(doc! { "max_domains": max_domains, "max_source_lists": 50 })
}

fn as_json(document: &Document) -> serde_json::Value {
    Bson::Document(document.clone()).into_relaxed_extjson()
}

fn result_of(job: &Document) -> serde_json::Value {
    as_json(job.get_document("result").unwrap())
}

fn files_under(directory: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    for entry in std::fs::read_dir(directory).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files.extend(files_under(&path));
        } else {
            files.insert(
                path.to_string_lossy().into_owned(),
                std::fs::read(&path).unwrap(),
            );
        }
    }
    files
}

impl Harness {
    async fn run(&self, job: Document) -> Document {
        let job = self.claim(job).await;
        self.processor.process_job(&job).await.unwrap();
        stored_job(&self.db, &job.id).await
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_within_the_limit_publishes_and_records_the_measurement() {
    let server = server_for_builds(1).await;
    let mut harness = harness(&server).await;
    harness.processor.config.enforce_domain_limit = true;
    harness.add_user("sam").await;

    let job = harness
        .run(job_with_limits(
            "sam",
            &two_categories(&server),
            limited_to(DOMAINS_IN_ALL_CATEGORIES as i64),
        ))
        .await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    let result = result_of(&job);
    assert_eq!(
        result["limit"],
        serde_json::json!({ "max_domains": 3, "actual_domains": 3 })
    );
    assert_eq!(result["unique_domains"], DOMAINS_IN_THE_COMBINED_LIST);
    assert_eq!(
        result["categories"],
        serde_json::json!({ "nsfw": 2, "tracking": 2 })
    );
    assert_eq!(result["warnings"], serde_json::json!([]));
    assert_eq!(
        harness.published_generation("sam").await,
        result["generation_id"].as_str().unwrap()
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn forced_build_over_an_enforced_limit_fails_and_leaves_the_published_lists_untouched() {
    let server = server_for_builds(2).await;
    let mut harness = harness(&server).await;
    harness.processor.config.enforce_domain_limit = true;
    harness.add_user("sam").await;
    let blocklists = two_categories(&server);
    let output_dir = harness.output_dir("sam");
    let first = harness
        .run(job_with_limits("sam", &blocklists, Bson::Null))
        .await;
    assert_eq!(first.get_str("status").unwrap(), "completed");
    let published_before = harness.stored_target("sam").await;
    let generation_before = harness.published_generation("sam").await;
    let files_before = files_under(&output_dir);
    assert!(!files_before.is_empty());

    let mut over = job_with_limits("sam", &blocklists, limited_to(2));
    over.insert("force_rebuild", true);
    let over = harness.claim(over).await;
    let failure = harness.processor.process_job(&over).await.unwrap_err();

    let BuildError::OverDomainLimit { limit, message } = failure.error else {
        panic!("expected a build over its limit, got {:?}", failure.error);
    };
    assert_eq!(
        limit,
        LimitMeasurement {
            max_domains: Some(2),
            actual_domains: DOMAINS_IN_ALL_CATEGORIES,
        }
    );
    assert_eq!(
        message,
        "These lists have 3 domains across all categories, which is over the limit of 2, \
         so nothing was published and the previously published lists remain in place."
    );
    let progress = failure.progress.unwrap();
    assert_eq!(progress.stage, JobStage::Whitelist);
    assert!(progress.generation.is_none());
    let untouched = stored_job(&harness.db, &over.id).await;
    assert_eq!(untouched.get("result"), Some(&Bson::Null));

    harness
        .jobs
        .fail_over_domain_limit(&over.id, message.clone(), limit, Some(&progress))
        .await
        .unwrap();

    let failed = stored_job(&harness.db, &over.id).await;
    assert_eq!(failed.get_str("status").unwrap(), "failed");
    let result = result_of(&failed);
    assert_eq!(result["error_code"], error_code::DOMAIN_LIMIT_EXCEEDED);
    assert_eq!(result["errors"], serde_json::json!([message]));
    assert_eq!(
        result["limit"],
        serde_json::json!({ "max_domains": 2, "actual_domains": 3 })
    );
    assert_eq!(result["generation_id"], serde_json::Value::Null);
    assert_eq!(result["output_files"], serde_json::json!([]));
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../tests/fixtures/job-progress.json")).unwrap();
    let keys = |value: &serde_json::Value| -> std::collections::BTreeSet<String> {
        value.as_object().unwrap().keys().cloned().collect()
    };
    assert_eq!(keys(&result), keys(&fixture["completed"]["result"]));
    assert_eq!(
        failed
            .get_document("progress")
            .unwrap()
            .get_str("stage")
            .unwrap(),
        "whitelist"
    );

    assert_eq!(harness.stored_target("sam").await, published_before);
    assert_eq!(generation_names(&output_dir), [generation_before.as_str()]);
    assert_eq!(files_under(&output_dir), files_before);
    assert_eq!(
        std::fs::read_dir(generations_dir(&output_dir))
            .unwrap()
            .count(),
        1
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_over_an_observed_limit_publishes_with_a_warning() {
    let server = server_for_builds(1).await;
    let harness = harness(&server).await;
    assert!(!harness.processor.config.enforce_domain_limit);
    harness.add_user("sam").await;

    let job = harness
        .run(job_with_limits(
            "sam",
            &two_categories(&server),
            limited_to(2),
        ))
        .await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    let result = result_of(&job);
    assert_eq!(
        result["warnings"],
        serde_json::json!([
            "These lists have 3 domains across all categories, which is over the limit of 2, \
             and builds over the limit will fail once the limit is enforced."
        ])
    );
    assert_eq!(result["error_code"], serde_json::Value::Null);
    assert_eq!(
        result["limit"],
        serde_json::json!({ "max_domains": 2, "actual_domains": 3 })
    );
    assert_eq!(
        harness.published_generation("sam").await,
        result["generation_id"].as_str().unwrap()
    );
    assert_eq!(generation_names(&harness.output_dir("sam")).len(), 1);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_without_a_snapshot_limit_is_measured_and_never_fails() {
    let server = server_for_builds(3).await;
    let mut harness = harness(&server).await;
    harness.processor.config.enforce_domain_limit = true;
    let blocklists = two_categories(&server);
    harness.add_user("sam").await;
    harness.add_user("alex").await;
    harness.store_live_config("robin", &blocklists, "").await;

    let no_limits = harness
        .run(job_with_limits("sam", &blocklists, Bson::Null))
        .await;
    let no_domain_limit = harness
        .run(job_with_limits(
            "alex",
            &blocklists,
            Bson::Document(doc! { "max_domains": Bson::Null, "max_source_lists": 50 }),
        ))
        .await;
    let no_snapshot = harness.run(queued_job("robin", None)).await;

    for job in [&no_limits, &no_domain_limit, &no_snapshot] {
        assert_eq!(job.get_str("status").unwrap(), "completed");
        let result = result_of(job);
        assert_eq!(
            result["limit"],
            serde_json::json!({ "max_domains": null, "actual_domains": 3 })
        );
        assert_eq!(result["warnings"], serde_json::json!([]));
    }
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn config_with_more_sources_than_the_snapshot_allows_fails_before_downloading() {
    let server = server_for_builds(1).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let job = harness
        .claim(job_with_limits(
            "sam",
            &two_categories(&server),
            Bson::Document(doc! { "max_domains": 100, "max_source_lists": 1 }),
        ))
        .await;

    let failure = harness.processor.process_job(&job).await.unwrap_err();

    let BuildError::Rejected { code, message } = failure.error else {
        panic!("expected a rejected build, got {:?}", failure.error);
    };
    assert_eq!(code, error_code::INVALID_CONFIG);
    assert_eq!(
        message,
        "The configuration has 2 sources, which is more than the limit of 1."
    );
    assert!(failure.progress.is_none());
    assert!(server.recorded_requests().is_empty());
    assert!(generation_names(&harness.output_dir("sam")).is_empty());
    harness.db.drop().await.unwrap();
}
