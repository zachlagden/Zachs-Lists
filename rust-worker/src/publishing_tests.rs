use super::tests::{harness, hosts_body, snapshot, source_line, Harness};
use super::*;
use bson::{doc, Bson, Document};
use std::path::PathBuf;

use crate::config::DEFAULT_TARGET;
use crate::generation::{generations_dir, read_manifest, MANIFEST_NAME};
use crate::source_cache_test_server::{Reply, TestServer};
use crate::test_support::{queued_job, stored_job};

const FIRST_BODY: &[u8] = b"first.example\nshared.example\n";
const SECOND_BODY: &[u8] = b"first.example\nshared.example\nadded.example\n";

fn generation_names(output_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = match std::fs::read_dir(generations_dir(output_dir)) {
        Ok(entries) => entries
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect(),
        Err(_) => Vec::new(),
    };
    names.sort();
    names
}

fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names
}

fn list_names(target: &Document) -> Vec<&str> {
    target
        .get_array("lists")
        .unwrap()
        .iter()
        .map(|list| list.as_document().unwrap().get_str("name").unwrap())
        .collect()
}

fn job_at(username: &str, blocklists: &str, whitelist: &str, created_at_ms: i64) -> Document {
    let mut job = queued_job(username, snapshot(blocklists, whitelist));
    job.insert("created_at", bson::DateTime::from_millis(created_at_ms));
    job
}

impl Harness {
    fn output_dir(&self, username: &str) -> PathBuf {
        self.processor.config.output_dir(username)
    }

    async fn build(&self, username: &str, blocklists: &str, whitelist: &str) -> Document {
        let job = self
            .claim(queued_job(username, snapshot(blocklists, whitelist)))
            .await;
        self.processor.process_job(&job).await.unwrap();
        stored_job(&self.db, &job.id).await
    }

    async fn published_generation(&self, username: &str) -> String {
        self.stored_target(username)
            .await
            .get_str("published_generation")
            .unwrap()
            .to_string()
    }

    fn publication<'a>(
        &self,
        generation_id: &'a str,
        created_at_ms: i64,
        attempt: i64,
    ) -> Publication<'a> {
        Publication {
            generation_id,
            job_id: "job",
            job_created_at: bson::DateTime::from_millis(created_at_ms),
            attempt,
            inputs_digest: "digest",
            lists: &[],
            total_domains: 0,
            total_output_size_bytes: 0,
        }
    }
}

const SAM: Target<'static> = Target {
    username: "sam",
    user_id: None,
};

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_publishes_a_complete_generation_and_removes_the_legacy_flat_files() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, b"||ads.example^\n"),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    harness
        .db
        .collection::<Document>("users")
        .update_one(
            doc! { "username": "sam" },
            doc! { "$set": { "stats.config_hash": "old", "stats.config_fingerprint": "old" } },
        )
        .await
        .unwrap();
    let output_dir = harness.output_dir("sam");
    std::fs::create_dir_all(&output_dir).unwrap();
    for legacy in ["all_domains_hosts.txt.gz", "malicious_plain.txt.gz"] {
        std::fs::write(output_dir.join(legacy), b"legacy").unwrap();
    }
    let blocklists = format!(
        "{}|first_list|tracking\n{}|second_list|advertising",
        server.url("/first"),
        server.url("/second")
    );

    let job = harness.build("sam", &blocklists, "").await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    let result = job.get_document("result").unwrap();
    let generation_id = result.get_str("generation_id").unwrap();
    let sam = harness.stored_target("sam").await;
    assert_eq!(sam.get_str("published_generation").unwrap(), generation_id);
    let published = sam.get_document("published").unwrap();
    assert_eq!(
        published.get_str("job_id").unwrap(),
        job.get_str("job_id").unwrap()
    );
    assert_eq!(
        published.get_datetime("job_created_at").unwrap(),
        job.get_datetime("created_at").unwrap()
    );
    assert_eq!(published.get_i64("attempt").unwrap(), 1);
    assert_eq!(published.get_str("inputs_digest").unwrap().len(), 64);
    assert!(published.get_datetime("published_at").is_ok());
    assert_eq!(list_names(&sam), ["advertising", "all_domains", "tracking"]);
    let combined = sam.get_array("lists").unwrap()[1].as_document().unwrap();
    assert_eq!(combined.get_i64("domain_count").unwrap(), 3);
    assert!(combined.get_bool("is_public").unwrap());
    assert_eq!(
        combined.get_array("formats").unwrap(),
        &vec![
            Bson::from("hosts"),
            Bson::from("plain"),
            Bson::from("adblock")
        ]
    );
    let stats = sam.get_document("stats").unwrap();
    assert_eq!(stats.get_i64("total_domains").unwrap(), 3);
    assert!(stats.get_datetime("last_build_at").is_ok());
    assert!(!stats.contains_key("config_hash"));
    assert!(!stats.contains_key("config_fingerprint"));

    let manifest = read_manifest(&generations_dir(&output_dir).join(generation_id))
        .unwrap()
        .unwrap();
    assert_eq!(manifest.generation_id, generation_id);
    assert_eq!(manifest.files.len(), 9);
    assert_eq!(
        manifest.inputs_digest,
        published.get_str("inputs_digest").unwrap()
    );
    assert_eq!(
        stats.get_i64("total_output_size_bytes").unwrap() as u64,
        manifest.total_size_bytes()
    );
    assert_eq!(generation_names(&output_dir), [generation_id]);
    let flat_files: Vec<String> = std::fs::read_dir(&output_dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(flat_files, ["generations"]);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn cancelled_build_mid_generation_leaves_no_generation_and_the_pointer_untouched() {
    let large = hosts_body(400_000);
    let server =
        TestServer::start(vec![Reply::new(200, FIRST_BODY), Reply::new(200, &large)]).await;
    let mut harness = harness(&server).await;
    harness.processor.config.progress_update_interval_ms = 10;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    harness.build("sam", &blocklists, "").await;
    let before = harness.stored_target("sam").await;
    let first_generation = harness.published_generation("sam").await;
    let output_dir = harness.output_dir("sam");

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
    loop {
        let stage = stored_job(&db, &job_id)
            .await
            .get_document("progress")
            .unwrap()
            .get_str("stage")
            .unwrap()
            .to_string();
        if stage == "generation" {
            break;
        }
        assert_ne!(stage, "completed");
        tokio::time::sleep(Duration::from_millis(1)).await;
    }
    cancellation.cancel();

    let stopped = build.await.unwrap().unwrap_err();
    assert!(matches!(stopped.error, BuildError::Cancelled));
    assert_eq!(generation_names(&output_dir), [first_generation.as_str()]);
    let users = db.collection::<Document>("users");
    let after = users
        .find_one(doc! { "username": "sam" })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after, before);
    assert_eq!(
        stored_job(&db, &job_id).await.get_str("status").unwrap(),
        "processing"
    );
    db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn worker_killed_between_generation_and_publish_leaves_the_old_lists_published() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, SECOND_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    harness.build("sam", &blocklists, "").await;
    let before = harness.stored_target("sam").await;
    let first_generation = harness.published_generation("sam").await;
    let output_dir = harness.output_dir("sam");
    let first_manifest_bytes = std::fs::read(
        generations_dir(&output_dir)
            .join(&first_generation)
            .join(MANIFEST_NAME),
    )
    .unwrap();

    let mut domains = CategoryDomains::default();
    domains
        .by_category
        .entry(Some("tracking".to_string()))
        .or_default()
        .insert("never-published.example".to_string());
    let abandoned = generate_outputs(
        output_dir.clone(),
        BuildIdentity {
            job_id: "killed-before-publish".into(),
            job_created_at: chrono::Utc::now(),
            attempt: 1,
            inputs_digest: "e".repeat(64),
        },
        domains,
        &Cancellation::default(),
        &|_| {},
    )
    .unwrap()
    .generation
    .manifest
    .generation_id;

    assert_eq!(harness.stored_target("sam").await, before);
    assert_eq!(
        std::fs::read(
            generations_dir(&output_dir)
                .join(&first_generation)
                .join(MANIFEST_NAME)
        )
        .unwrap(),
        first_manifest_bytes
    );
    assert_eq!(
        generation_names(&output_dir),
        sorted(vec![first_generation.clone(), abandoned])
    );

    harness.build("sam", &blocklists, "").await;
    let third_generation = harness.published_generation("sam").await;
    assert_eq!(
        generation_names(&output_dir),
        sorted(vec![first_generation, third_generation])
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn worker_dying_after_the_pointer_update_is_requeued_and_rebuilt_which_is_acceptable() {
    let server = TestServer::start(vec![Reply::new(200, FIRST_BODY)]).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    let first_attempt = harness
        .claim(queued_job("sam", snapshot(&blocklists, "")))
        .await;
    assert_eq!(first_attempt.attempt, 1);
    let mut died_before_complete = harness.publication(
        "11111111-1111-4111-8111-111111111111",
        first_attempt.created_at.timestamp_millis(),
        first_attempt.attempt,
    );
    died_before_complete.job_id = &first_attempt.job_id;
    assert_eq!(
        harness
            .processor
            .user_repo
            .publish(&SAM, &died_before_complete)
            .await
            .unwrap(),
        PublishOutcome::Published { replaced: None }
    );
    harness
        .db
        .collection::<Document>("jobs")
        .update_one(
            doc! { "_id": first_attempt.id },
            doc! { "$set": { "status": "queued", "worker_id": Bson::Null } },
        )
        .await
        .unwrap();

    let second_attempt = match harness.jobs.claim_next().await.unwrap() {
        crate::db::job::Claim::Claimed(job) => *job,
        other => panic!("expected the requeued job, got {other:?}"),
    };
    assert_eq!(second_attempt.id, first_attempt.id);
    assert_eq!(second_attempt.attempt, 2);
    harness
        .processor
        .process_job(&second_attempt)
        .await
        .unwrap();

    let job = stored_job(&harness.db, &second_attempt.id).await;
    assert_eq!(job.get_str("status").unwrap(), "completed");
    let sam = harness.stored_target("sam").await;
    assert_eq!(
        sam.get_str("published_generation").unwrap(),
        job.get_document("result")
            .unwrap()
            .get_str("generation_id")
            .unwrap()
    );
    assert_eq!(
        sam.get_document("published")
            .unwrap()
            .get_i64("attempt")
            .unwrap(),
        2
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn stale_attempt_cannot_move_the_pointer_back() {
    let server = TestServer::start(Vec::new()).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let users = &harness.processor.user_repo;
    let created = 1_800_000_000_000;

    assert_eq!(
        users
            .publish(&SAM, &harness.publication("second-attempt", created, 2))
            .await
            .unwrap(),
        PublishOutcome::Published { replaced: None }
    );
    for stale in [1, 2] {
        assert_eq!(
            users
                .publish(&SAM, &harness.publication("stale-attempt", created, stale))
                .await
                .unwrap(),
            PublishOutcome::Superseded
        );
    }
    assert_eq!(harness.published_generation("sam").await, "second-attempt");
    assert_eq!(
        users
            .publish(&SAM, &harness.publication("third-attempt", created, 3))
            .await
            .unwrap(),
        PublishOutcome::Published {
            replaced: Some("second-attempt".into())
        }
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn pointer_update_matches_the_account_by_id_and_reports_a_missing_one() {
    let server = TestServer::start(Vec::new()).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let users = &harness.processor.user_repo;
    let sam_id = harness
        .stored_target("sam")
        .await
        .get_object_id("_id")
        .unwrap();
    let reused_name = Target {
        username: "sam",
        user_id: Some(bson::oid::ObjectId::new()),
    };
    let same_account = Target {
        username: "sam",
        user_id: Some(sam_id),
    };
    let missing = Target {
        username: "jo",
        user_id: None,
    };

    for gone in [&reused_name, &missing] {
        assert_eq!(
            users
                .publish(gone, &harness.publication("unowned", 5, 1))
                .await
                .unwrap(),
            PublishOutcome::TargetMissing
        );
        assert_eq!(users.published_state(gone).await.unwrap(), None);
    }
    assert!(!harness
        .stored_target("sam")
        .await
        .contains_key("published_generation"));
    assert_eq!(
        users
            .publish(&same_account, &harness.publication("owned", 5, 1))
            .await
            .unwrap(),
        PublishOutcome::Published { replaced: None }
    );
    assert_eq!(
        users.published_state(&same_account).await.unwrap(),
        Some(crate::db::user::PublishedState {
            generation_id: "owned".into(),
            inputs_digest: Some("digest".into()),
        })
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn older_job_cannot_publish_over_a_newer_one() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, SECOND_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    let now = bson::DateTime::now().timestamp_millis();

    let newer = harness.claim(job_at("sam", &blocklists, "", now)).await;
    harness.processor.process_job(&newer).await.unwrap();
    let published = harness.stored_target("sam").await;
    let newer_generation = harness.published_generation("sam").await;

    let older = harness
        .claim(job_at("sam", &blocklists, "", now - 60_000))
        .await;
    harness.processor.process_job(&older).await.unwrap();

    let stored = stored_job(&harness.db, &older.id).await;
    assert_eq!(stored.get_str("status").unwrap(), "skipped");
    assert_eq!(
        stored
            .get_document("result")
            .unwrap()
            .get_str("skip_reason")
            .unwrap(),
        SUPERSEDED_SKIP_REASON
    );
    assert_eq!(harness.stored_target("sam").await, published);
    assert_eq!(
        generation_names(&harness.output_dir("sam")),
        [newer_generation]
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn publish_then_prune_keeps_exactly_the_current_and_previous_generations() {
    let server = TestServer::start(vec![
        Reply::new(200, b"one.example\n"),
        Reply::new(200, b"one.example\ntwo.example\n"),
        Reply::new(200, b"one.example\ntwo.example\nthree.example\n"),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    let output_dir = harness.output_dir("sam");
    let mut published = Vec::new();

    for _ in 0..3 {
        harness.build("sam", &blocklists, "").await;
        published.push(harness.published_generation("sam").await);
    }

    assert_eq!(
        generation_names(&output_dir),
        sorted(vec![published[1].clone(), published[2].clone()])
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn dropped_category_disappears_from_the_new_generation_and_from_metadata() {
    let server = TestServer::start(vec![
        Reply::new(200, b"tracked.example\n"),
        Reply::new(200, b"advert.example\n"),
        Reply::new(200, b"tracked.example\n"),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let tracking = format!("{}|first_list|tracking", server.url("/first"));
    let both = format!(
        "{tracking}\n{}|second_list|advertising",
        server.url("/second")
    );

    harness.build("sam", &both, "").await;
    assert_eq!(
        list_names(&harness.stored_target("sam").await),
        ["advertising", "all_domains", "tracking"]
    );

    let job = harness.build("sam", &tracking, "").await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    let sam = harness.stored_target("sam").await;
    assert_eq!(list_names(&sam), ["all_domains", "tracking"]);
    let generation = sam.get_str("published_generation").unwrap();
    let manifest = read_manifest(&generations_dir(&harness.output_dir("sam")).join(generation))
        .unwrap()
        .unwrap();
    assert_eq!(manifest.files.len(), 6);
    assert!(manifest.files.iter().all(|file| file.list != "advertising"));
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn unforced_build_with_an_unchanged_digest_is_skipped_and_publishes_nothing() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    let output_dir = harness.output_dir("sam");
    harness.build("sam", &blocklists, "kept.example").await;
    let published = harness.stored_target("sam").await;
    let generation = harness.published_generation("sam").await;

    let manual = harness.build("sam", &blocklists, "kept.example").await;
    let mut scheduled = queued_job("sam", snapshot(&blocklists, "# comment\nkept.example\n"));
    scheduled.insert("type", "scheduled");
    let scheduled = harness.claim(scheduled).await;
    harness.processor.process_job(&scheduled).await.unwrap();
    let scheduled = stored_job(&harness.db, &scheduled.id).await;

    for skipped in [&manual, &scheduled] {
        assert_eq!(skipped.get_str("status").unwrap(), "skipped");
        assert_eq!(
            skipped
                .get_document("result")
                .unwrap()
                .get_str("skip_reason")
                .unwrap(),
            UNCHANGED_SKIP_REASON
        );
    }
    assert_eq!(server.recorded_requests().len(), 3);
    assert_eq!(harness.stored_target("sam").await, published);
    assert_eq!(generation_names(&output_dir), [generation.as_str()]);

    std::fs::remove_file(
        generations_dir(&output_dir)
            .join(&generation)
            .join(MANIFEST_NAME),
    )
    .unwrap();
    let rebuilt = harness.build("sam", &blocklists, "kept.example").await;
    assert_eq!(rebuilt.get_str("status").unwrap(), "completed");
    assert_ne!(harness.published_generation("sam").await, generation);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn changed_whitelist_or_source_content_rebuilds_an_unforced_build() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
        Reply::new(200, SECOND_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    harness.build("sam", &blocklists, "").await;
    let first = harness.published_generation("sam").await;

    let whitelist_changed = harness.build("sam", &blocklists, "shared.example").await;
    assert_eq!(whitelist_changed.get_str("status").unwrap(), "completed");
    let second = harness.published_generation("sam").await;
    assert_ne!(second, first);

    let content_changed = harness.build("sam", &blocklists, "shared.example").await;
    assert_eq!(content_changed.get_str("status").unwrap(), "completed");
    assert_ne!(harness.published_generation("sam").await, second);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn forced_build_with_an_unchanged_digest_publishes_a_new_generation() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let blocklists = source_line(&server, "/list", "one_list");
    harness.build("sam", &blocklists, "").await;
    let first = harness.stored_target("sam").await;

    let mut forced = queued_job("sam", snapshot(&blocklists, ""));
    forced.insert("force_rebuild", true);
    let forced = harness.claim(forced).await;
    harness.processor.process_job(&forced).await.unwrap();

    let stored = stored_job(&harness.db, &forced.id).await;
    assert_eq!(stored.get_str("status").unwrap(), "completed");
    let second = harness.stored_target("sam").await;
    assert_ne!(
        second.get_str("published_generation").unwrap(),
        first.get_str("published_generation").unwrap()
    );
    assert_eq!(
        second
            .get_document("published")
            .unwrap()
            .get_str("inputs_digest")
            .unwrap(),
        first
            .get_document("published")
            .unwrap()
            .get_str("inputs_digest")
            .unwrap()
    );
    assert_eq!(generation_names(&harness.output_dir("sam")).len(), 2);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn default_target_publishes_to_default_build_and_skips_an_unchanged_build() {
    let server = TestServer::start(vec![
        Reply::new(200, FIRST_BODY),
        Reply::new(200, FIRST_BODY),
    ])
    .await;
    let harness = harness(&server).await;
    harness
        .db
        .collection::<Document>("system_config")
        .insert_one(
            doc! { "_id": "default_build", "config_fingerprint": "old", "total_domains": 9_i64 },
        )
        .await
        .unwrap();
    let blocklists = source_line(&server, "/list", "one_list");

    let first = harness.build(DEFAULT_TARGET, &blocklists, "").await;

    assert_eq!(first.get_str("status").unwrap(), "completed");
    let default_build = harness.stored_target(DEFAULT_TARGET).await;
    let generation = default_build.get_str("published_generation").unwrap();
    assert_eq!(
        generation,
        first
            .get_document("result")
            .unwrap()
            .get_str("generation_id")
            .unwrap()
    );
    assert_eq!(default_build.get_i64("total_domains").unwrap(), 2);
    assert!(default_build.get_i64("total_output_size_bytes").unwrap() > 0);
    assert!(default_build.get_datetime("last_build_at").is_ok());
    assert!(!default_build.contains_key("config_fingerprint"));
    assert_eq!(list_names(&default_build), ["all_domains", "tracking"]);
    assert_eq!(
        default_build
            .get_document("published")
            .unwrap()
            .get_i64("attempt")
            .unwrap(),
        1
    );
    assert!(harness
        .processor
        .config
        .default_dir()
        .join("output")
        .join("generations")
        .join(generation)
        .join(MANIFEST_NAME)
        .is_file());

    let second = harness.build(DEFAULT_TARGET, &blocklists, "").await;
    assert_eq!(second.get_str("status").unwrap(), "skipped");
    assert_eq!(harness.stored_target(DEFAULT_TARGET).await, default_build);
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn first_default_build_creates_the_default_build_document() {
    let server = TestServer::start(vec![Reply::new(200, FIRST_BODY)]).await;
    let harness = harness(&server).await;

    let job = harness
        .build(
            DEFAULT_TARGET,
            &source_line(&server, "/list", "one_list"),
            "",
        )
        .await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    assert!(harness
        .stored_target(DEFAULT_TARGET)
        .await
        .get_str("published_generation")
        .is_ok());
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn build_for_a_user_deleted_before_publish_fails_and_leaves_nothing_on_disk() {
    let server = TestServer::start(vec![Reply::new(200, FIRST_BODY)]).await;
    let harness = harness(&server).await;
    let job = harness
        .claim(queued_job(
            "sam",
            snapshot(&source_line(&server, "/list", "one_list"), ""),
        ))
        .await;

    let failure = harness.processor.process_job(&job).await.unwrap_err();

    assert!(matches!(
        failure.error,
        BuildError::Rejected {
            code: error_code::TARGET_MISSING,
            ..
        }
    ));
    assert!(!harness.processor.config.user_dir("sam").exists());
    assert!(harness
        .db
        .collection::<Document>("users")
        .find_one(doc! { "username": "sam" })
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        stored_job(&harness.db, &job.id)
            .await
            .get_str("status")
            .unwrap(),
        "processing"
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn whitelist_that_removes_every_domain_publishes_an_empty_combined_list() {
    let server = TestServer::start(vec![Reply::new(200, b"only.example\n")]).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;

    let job = harness
        .build(
            "sam",
            &source_line(&server, "/list", "one_list"),
            "only.example",
        )
        .await;

    assert_eq!(job.get_str("status").unwrap(), "completed");
    let sam = harness.stored_target("sam").await;
    assert_eq!(list_names(&sam), ["all_domains"]);
    assert_eq!(
        sam.get_document("stats")
            .unwrap()
            .get_i64("total_domains")
            .unwrap(),
        0
    );
    harness.db.drop().await.unwrap();
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn source_with_no_domains_still_fails_with_no_domains() {
    let server = TestServer::start(vec![Reply::new(200, b"# nothing listed\n")]).await;
    let harness = harness(&server).await;
    harness.add_user("sam").await;
    let job = harness
        .claim(queued_job(
            "sam",
            snapshot(&source_line(&server, "/list", "one_list"), ""),
        ))
        .await;

    let failure = harness.processor.process_job(&job).await.unwrap_err();

    assert!(matches!(
        failure.error,
        BuildError::Rejected {
            code: error_code::NO_DOMAINS,
            ..
        }
    ));
    assert!(generation_names(&harness.output_dir("sam")).is_empty());
    harness.db.drop().await.unwrap();
}
