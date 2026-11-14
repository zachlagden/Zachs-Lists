use super::*;
use std::collections::BTreeSet;
use std::time::Duration;

use crate::test_support::{
    initial_progress_fixture, insert_job, queued_job, stored_job, test_database,
};

fn claimed(claim: Claim) -> Job {
    match claim {
        Claim::Claimed(job) => *job,
        other => panic!("expected a claimed job, got {other:?}"),
    }
}

fn revision(job: &Document) -> i64 {
    match job.get("rev") {
        Some(Bson::Int32(value)) => i64::from(*value),
        Some(Bson::Int64(value)) => *value,
        other => panic!("rev is not an integer: {other:?}"),
    }
}

fn updated_at(job: &Document) -> bson::DateTime {
    *job.get_datetime("updated_at").unwrap()
}

fn as_json(value: &Bson) -> serde_json::Value {
    value.clone().into_relaxed_extjson()
}

async fn requeue_as_the_stale_reset_does(db: &Database, id: &ObjectId) {
    db.collection::<Document>("jobs")
        .update_one(
            doc! { "_id": id },
            doc! { "$set": { "status": "queued", "worker_id": Bson::Null } },
        )
        .await
        .unwrap();
}

async fn pause() {
    tokio::time::sleep(Duration::from_millis(5)).await;
}

#[test]
fn initial_queue_progress_matches_the_shared_fixture() {
    assert_eq!(
        as_json(&Bson::Document(initial_queue_progress())),
        initial_progress_fixture()
    );
}

#[test]
fn worker_error_codes_match_the_shared_fixture() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/job-error-codes.json")).unwrap();
    let expected: BTreeSet<&str> = fixture["worker"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    assert_eq!(BTreeSet::from(error_code::ALL), expected);
}

#[test]
fn results_always_carry_an_error_code_key() {
    let failed = bson::to_document(&JobResult::failure(
        error_code::NO_SOURCES,
        vec!["No valid sources in config".into()],
    ))
    .unwrap();
    assert_eq!(failed.get_str("error_code").unwrap(), "no_sources");

    let succeeded = bson::to_document(&JobResult::success(1, 0, 2, 2, 0, Vec::new())).unwrap();
    assert_eq!(succeeded.get("error_code"), Some(&Bson::Null));

    let skipped = bson::to_document(&JobResult::skipped("unchanged")).unwrap();
    assert_eq!(skipped.get("error_code"), Some(&Bson::Null));
    assert_eq!(skipped.get_str("skip_reason").unwrap(), "unchanged");
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn claim_takes_the_lease_and_counts_the_attempt() {
    let db = test_database("job_lease_test").await;
    let id = insert_job(&db, &queued_job("sam", None)).await;
    let worker_a = JobRepository::new(&db, "worker-a".into());
    let worker_b = JobRepository::new(&db, "worker-b".into());

    let job = claimed(worker_a.claim_next().await.unwrap());
    assert_eq!(job.id, id);
    assert_eq!(job.attempt, 1);

    let first = stored_job(&db, &id).await;
    assert_eq!(first.get_str("status").unwrap(), "processing");
    assert_eq!(first.get_str("worker_id").unwrap(), "worker-a");
    assert_eq!(revision(&first), 1);
    let first_start = *first.get_datetime("started_at").unwrap();
    assert_eq!(first.get_datetime("claimed_at").unwrap(), &first_start);
    assert_eq!(first.get_datetime("heartbeat_at").unwrap(), &first_start);
    assert_eq!(updated_at(&first), first_start);

    assert!(matches!(
        worker_b.claim_next().await.unwrap(),
        Claim::NoneQueued
    ));
    assert_eq!(stored_job(&db, &id).await, first);

    pause().await;
    requeue_as_the_stale_reset_does(&db, &id).await;
    let again = claimed(worker_b.claim_next().await.unwrap());
    assert_eq!(again.attempt, 2);

    let second = stored_job(&db, &id).await;
    assert_eq!(second.get_str("worker_id").unwrap(), "worker-b");
    assert_eq!(second.get_datetime("started_at").unwrap(), &first_start);
    assert!(*second.get_datetime("claimed_at").unwrap() > first_start);
    assert_eq!(revision(&second), 2);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn writes_from_a_worker_that_lost_the_lease_change_nothing() {
    let db = test_database("job_lease_test").await;
    let id = insert_job(&db, &queued_job("sam", None)).await;
    let worker_a = JobRepository::new(&db, "worker-a".into());
    let worker_b = JobRepository::new(&db, "worker-b".into());

    claimed(worker_a.claim_next().await.unwrap());
    requeue_as_the_stale_reset_does(&db, &id).await;
    claimed(worker_b.claim_next().await.unwrap());
    let held_by_b = stored_job(&db, &id).await;

    let progress = JobProgress::downloading(3);
    let result = JobResult::success(1, 0, 1, 1, 0, Vec::new());
    assert!(matches!(
        worker_a.update_progress(&id, &progress).await,
        Err(JobWriteError::LeaseLost)
    ));
    assert!(matches!(
        worker_a.complete(&id, &result).await,
        Err(JobWriteError::LeaseLost)
    ));
    assert!(matches!(
        worker_a
            .fail(&id, error_code::INTERNAL, vec!["failed".into()])
            .await,
        Err(JobWriteError::LeaseLost)
    ));
    assert!(matches!(
        worker_a.skip(&id, "unchanged").await,
        Err(JobWriteError::LeaseLost)
    ));
    assert!(matches!(
        worker_a.release(&id).await,
        Err(JobWriteError::LeaseLost)
    ));
    assert!(!worker_a.heartbeat(&id).await.unwrap());
    assert_eq!(worker_a.release_all().await.unwrap(), 0);
    assert_eq!(stored_job(&db, &id).await, held_by_b);

    let mut previous = held_by_b;
    pause().await;
    assert!(worker_b.heartbeat(&id).await.unwrap());
    let after_heartbeat = stored_job(&db, &id).await;
    assert_eq!(revision(&after_heartbeat), revision(&previous) + 1);
    assert!(updated_at(&after_heartbeat) > updated_at(&previous));
    previous = after_heartbeat;

    pause().await;
    worker_b.update_progress(&id, &progress).await.unwrap();
    let after_progress = stored_job(&db, &id).await;
    assert_eq!(
        after_progress
            .get_document("progress")
            .unwrap()
            .get_str("stage")
            .unwrap(),
        "downloading"
    );
    assert_eq!(revision(&after_progress), revision(&previous) + 1);
    assert!(updated_at(&after_progress) > updated_at(&previous));
    previous = after_progress;

    pause().await;
    worker_b.complete(&id, &result).await.unwrap();
    let completed = stored_job(&db, &id).await;
    assert_eq!(completed.get_str("status").unwrap(), "completed");
    assert_eq!(completed.get_str("worker_id").unwrap(), "worker-b");
    assert_eq!(revision(&completed), revision(&previous) + 1);
    assert!(updated_at(&completed) > updated_at(&previous));

    assert!(matches!(
        worker_b.update_progress(&id, &progress).await,
        Err(JobWriteError::LeaseLost)
    ));
    assert_eq!(stored_job(&db, &id).await, completed);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn fail_and_skip_end_the_job_under_the_lease() {
    let db = test_database("job_lease_test").await;
    let failing = insert_job(&db, &queued_job("sam", None)).await;
    let worker = JobRepository::new(&db, "worker-a".into());

    claimed(worker.claim_next().await.unwrap());
    worker
        .fail(
            &failing,
            error_code::ALL_SOURCES_FAILED,
            vec!["All source downloads failed".into()],
        )
        .await
        .unwrap();
    let failed = stored_job(&db, &failing).await;
    assert_eq!(failed.get_str("status").unwrap(), "failed");
    assert_eq!(revision(&failed), 2);
    let result = failed.get_document("result").unwrap();
    assert_eq!(result.get_str("error_code").unwrap(), "all_sources_failed");
    assert_eq!(
        as_json(result.get("errors").unwrap()),
        serde_json::json!(["All source downloads failed"])
    );

    let skipping = insert_job(&db, &queued_job("alex", None)).await;
    claimed(worker.claim_next().await.unwrap());
    worker.skip(&skipping, "unchanged").await.unwrap();
    let skipped = stored_job(&db, &skipping).await;
    assert_eq!(skipped.get_str("status").unwrap(), "skipped");
    assert_eq!(revision(&skipped), 2);
    let result = skipped.get_document("result").unwrap();
    assert_eq!(result.get_str("skip_reason").unwrap(), "unchanged");
    assert_eq!(result.get("error_code"), Some(&Bson::Null));
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn unreadable_claimed_job_is_failed_and_the_next_claim_proceeds() {
    let db = test_database("job_lease_test").await;
    let mut unreadable = queued_job("sam", None);
    unreadable.insert("job_id", 42);
    unreadable.insert("priority", 1);
    unreadable.insert("attempt", "many");
    let unreadable_id = insert_job(&db, &unreadable).await;
    let readable_id = insert_job(&db, &queued_job("alex", None)).await;
    let worker = JobRepository::new(&db, "worker-a".into());

    assert!(matches!(
        worker.claim_next().await.unwrap(),
        Claim::Unusable
    ));
    let failed = stored_job(&db, &unreadable_id).await;
    assert_eq!(failed.get_str("status").unwrap(), "failed");
    let result = failed.get_document("result").unwrap();
    assert_eq!(result.get_str("error_code").unwrap(), "internal");
    assert_eq!(
        as_json(result.get("errors").unwrap()),
        serde_json::json!([INTERNAL_ERROR_MESSAGE])
    );
    assert_eq!(failed.get_i32("attempt").unwrap(), 1);

    assert_eq!(claimed(worker.claim_next().await.unwrap()).id, readable_id);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn job_stored_before_snapshots_and_revisions_is_claimed() {
    let db = test_database("job_lease_test").await;
    let mut legacy = queued_job("sam", None);
    for field in ["config_snapshot", "rev", "updated_at", "target_id"] {
        legacy.remove(field);
    }
    legacy.insert("stale_attempts", 1);
    let id = insert_job(&db, &legacy).await;
    let worker = JobRepository::new(&db, "worker-a".into());

    let job = claimed(worker.claim_next().await.unwrap());
    assert!(job.config_snapshot.is_none());
    assert_eq!(job.attempt, 1);
    let stored = stored_job(&db, &id).await;
    assert_eq!(revision(&stored), 1);
    assert_eq!(stored.get_i32("stale_attempts").unwrap(), 1);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn release_requeues_with_initial_progress_and_keeps_the_attempt() {
    let db = test_database("job_lease_test").await;
    let first = insert_job(&db, &queued_job("sam", None)).await;
    let worker = JobRepository::new(&db, "worker-a".into());

    claimed(worker.claim_next().await.unwrap());
    worker
        .update_progress(&first, &JobProgress::downloading(3))
        .await
        .unwrap();
    let before = stored_job(&db, &first).await;
    pause().await;
    worker.release(&first).await.unwrap();

    let released = stored_job(&db, &first).await;
    assert_eq!(released.get_str("status").unwrap(), "queued");
    for field in ["worker_id", "claimed_at", "heartbeat_at"] {
        assert_eq!(released.get(field), Some(&Bson::Null), "{field}");
    }
    assert_eq!(
        as_json(released.get("progress").unwrap()),
        initial_progress_fixture()
    );
    assert_eq!(released.get_i32("attempt").unwrap(), 1);
    assert_eq!(released.get("started_at"), before.get("started_at"));
    assert!(released.get("stale_attempts").is_none());
    assert_eq!(revision(&released), revision(&before) + 1);
    assert!(updated_at(&released) > updated_at(&before));

    assert_eq!(claimed(worker.claim_next().await.unwrap()).attempt, 2);
    worker
        .update_progress(&first, &JobProgress::downloading(3))
        .await
        .unwrap();
    assert_eq!(worker.release_all().await.unwrap(), 1);
    let released_again = stored_job(&db, &first).await;
    assert_eq!(released_again.get_str("status").unwrap(), "queued");
    assert_eq!(
        as_json(released_again.get("progress").unwrap()),
        initial_progress_fixture()
    );
    assert_eq!(released_again.get_i32("attempt").unwrap(), 2);
    db.drop().await.unwrap();
}
