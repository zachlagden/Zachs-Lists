use bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::{Client, Database};
use std::path::Path;

use crate::config::Config;

pub async fn test_database(prefix: &str) -> Database {
    let uri =
        std::env::var("SOURCE_CACHE_TEST_MONGO_URI").expect("isolated test Mongo URI is required");
    let client = Client::with_uri_str(uri).await.unwrap();
    client.database(&format!("{}_{}", prefix, uuid::Uuid::new_v4().simple()))
}

pub fn test_config(db: &Database, data_dir: &Path, worker_id: &str) -> Config {
    Config {
        mongo_uri: String::new(),
        database_name: db.name().into(),
        data_dir: data_dir.to_path_buf(),
        worker_id: worker_id.into(),
        heartbeat_interval_secs: 10,
        max_concurrent_downloads: 2,
        http_timeout_secs: 2,
        cache_ttl_days: 7,
        source_fresh_secs: 0,
        mongo_connect_timeout_secs: 2,
    }
}

pub fn initial_progress_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../tests/fixtures/job-initial-progress.json"
    ))
    .unwrap()
}

pub fn queued_job(username: &str, config_snapshot: Option<Document>) -> Document {
    let progress = bson::to_document(&initial_progress_fixture()).unwrap();
    doc! {
        "_id": ObjectId::new(),
        "job_id": uuid::Uuid::new_v4().to_string(),
        "target_id": username,
        "user_id": Bson::Null,
        "username": username,
        "type": "admin",
        "status": "queued",
        "priority": 2,
        "force_rebuild": false,
        "config_snapshot": config_snapshot.map_or(Bson::Null, Bson::Document),
        "quota_charged": false,
        "progress": progress,
        "result": Bson::Null,
        "started_at": Bson::Null,
        "completed_at": Bson::Null,
        "created_at": bson::DateTime::now(),
        "worker_id": Bson::Null,
        "claimed_at": Bson::Null,
        "heartbeat_at": Bson::Null,
        "rev": 0,
        "updated_at": bson::DateTime::now(),
    }
}

pub async fn insert_job(db: &Database, job: &Document) -> ObjectId {
    db.collection::<Document>("jobs")
        .insert_one(job)
        .await
        .unwrap();
    job.get_object_id("_id").unwrap()
}

pub async fn stored_job(db: &Database, id: &ObjectId) -> Document {
    db.collection::<Document>("jobs")
        .find_one(doc! { "_id": id })
        .await
        .unwrap()
        .unwrap()
}
