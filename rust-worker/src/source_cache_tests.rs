use super::*;
use bson::{doc, Bson};
use mongodb::Client;

use crate::source_cache_test_server::{Reply, TestServer};

async fn fixture(server: &TestServer) -> (Database, Downloader, Source) {
    let uri =
        std::env::var("SOURCE_CACHE_TEST_MONGO_URI").expect("isolated test Mongo URI is required");
    let client = Client::with_uri_str(uri).await.unwrap();
    let db = client.database(&format!(
        "source_cache_test_{}",
        uuid::Uuid::new_v4().simple()
    ));
    let config = Config {
        mongo_uri: String::new(),
        database_name: db.name().into(),
        data_dir: std::env::temp_dir(),
        worker_id: "fixture".into(),
        heartbeat_interval_secs: 10,
        max_concurrent_downloads: 2,
        http_timeout_secs: 2,
        cache_ttl_days: 7,
        source_fresh_secs: 0,
        mongo_connect_timeout_secs: 2,
    };
    let mut downloader = Downloader::new(config, &db).unwrap();
    downloader.test_address = Some(server.address);
    let source = Source {
        name: "fixture".into(),
        url: server.url("/List?Token=Case"),
        category: None,
    };
    (db, downloader, source)
}

async fn fresh_fixture(server: &TestServer) -> (Database, Downloader, Source) {
    let (db, mut downloader, source) = fixture(server).await;
    downloader.config.source_fresh_secs = 3600;
    (db, downloader, source)
}

async fn set_checked_seconds_ago(db: &Database, source: &Source, seconds: i64) -> BsonDateTime {
    let checked =
        BsonDateTime::from_millis(BsonDateTime::now().timestamp_millis() - seconds * 1000);
    set_metadata(db, source, doc! { "last_checked_at": checked }).await;
    checked
}

fn cache_bucket(db: &Database) -> mongodb::gridfs::GridFsBucket {
    db.gridfs_bucket(
        mongodb::options::GridFsBucketOptions::builder()
            .bucket_name("cache_files".to_string())
            .build(),
    )
}

async fn insert_entry_without_check_time(db: &Database, source: &Source, body: &[u8]) {
    use futures::io::AsyncWriteExt;

    let url_hash = Downloader::hash_url(&source.url);
    let mut upload = cache_bucket(db)
        .open_upload_stream(&url_hash)
        .await
        .unwrap();
    upload.write_all(body).await.unwrap();
    upload.close().await.unwrap();
    let now = BsonDateTime::now();
    db.collection::<bson::Document>("cache")
        .insert_one(doc! {
            "url_hash": url_hash,
            "url": &source.url,
            "gridfs_id": upload.id().clone(),
            "etag": "\"unchecked\"",
            "last_modified": Bson::Null,
            "content_hash": content_hash(body),
            "stats": {
                "size_bytes": body.len() as i64,
                "domain_count": 7_i64,
                "download_count": 3_i64,
                "access_count": 12_i64,
                "last_download_at": now,
                "last_accessed_at": now,
            },
            "created_at": now,
            "updated_at": now,
        })
        .await
        .unwrap();
}

async fn metadata(db: &Database, source: &Source) -> CacheEntry {
    CacheRepository::new(db)
        .get_entry(&Downloader::hash_url(&source.url))
        .await
        .unwrap()
        .unwrap()
}

async fn set_metadata(db: &Database, source: &Source, fields: bson::Document) {
    db.collection::<bson::Document>("cache")
        .update_one(
            doc! { "url_hash": Downloader::hash_url(&source.url) },
            doc! { "$set": fields },
        )
        .await
        .unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn changed_body_is_checked_for_manual_and_scheduled_downloads() {
    let server = TestServer::start(vec![
        Reply::new(200, b"old.example\n")
            .header("ETag", "\"old\"")
            .header("Last-Modified", "Mon, 05 Oct 2026 00:00:00 GMT"),
        Reply::new(200, b"changed.example\n").header("ETag", "\"changed\""),
        Reply::new(200, b"forced.example\n"),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    let old = downloader.download_source(&source, false).await;
    assert!(old.error.is_none(), "{:?}", old.error);
    let expired = BsonDateTime::from_millis(
        BsonDateTime::now().timestamp_millis() - 10 * 24 * 60 * 60 * 1000,
    );
    set_metadata(&db, &source, doc! { "last_checked_at": expired }).await;
    downloader
        .update_domain_count(&old.url_hash, 42)
        .await
        .unwrap();
    let changed = downloader.download_source(&source, false).await;
    assert!(changed.error.is_none(), "{:?}", changed.error);
    assert_eq!(
        changed.content.as_deref(),
        Some(b"changed.example\n".as_slice())
    );
    assert_ne!(old.content_hash, changed.content_hash);
    assert!(!changed.cache_hit);
    assert!(
        !downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    let forced = downloader.download_source(&source, true).await;
    assert_eq!(
        forced.content.as_deref(),
        Some(b"forced.example\n".as_slice())
    );
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 3);
    assert!(requests[1].contains("GET /List?Token=Case HTTP/1.1"));
    assert!(requests[1]
        .to_lowercase()
        .contains("if-none-match: \"old\""));
    assert!(requests[1]
        .to_lowercase()
        .contains("if-modified-since: mon, 05 oct 2026 00:00:00 gmt"));
    assert_ne!(
        Downloader::hash_url(&source.url),
        Downloader::hash_url(&source.url.to_lowercase())
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn not_modified_revalidates_expired_body_without_redownloading() {
    let server = TestServer::start(vec![
        Reply::new(200, b"same.example\n").header("ETag", "\"same\""),
        Reply::new(304, b"").header("ETag", "\"same\""),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none());
    let before = metadata(&db, &source).await;
    let expired = BsonDateTime::from_millis(
        BsonDateTime::now().timestamp_millis() - crate::db::cache::MAX_FALLBACK_AGE_MILLIS - 1,
    );
    set_metadata(&db, &source, doc! { "last_checked_at": expired }).await;
    downloader
        .update_domain_count(&first.url_hash, 42)
        .await
        .unwrap();
    assert_eq!(metadata(&db, &source).await.last_checked_at, Some(expired));
    let second = downloader.download_source(&source, false).await;
    assert!(second.error.is_none(), "{:?}", second.error);
    assert_eq!(second.content, first.content);
    assert_eq!(second.content_hash, first.content_hash);
    assert_eq!(second.bytes_downloaded, 0);
    assert_eq!(second.previous_domain_count, Some(42));
    assert!(second.cache_hit && !second.stale_fallback);
    let after = metadata(&db, &source).await;
    assert_eq!(before.last_downloaded_at, after.last_downloaded_at);
    assert_eq!(before.stats.last_download_at, after.stats.last_download_at);
    assert_eq!(before.stats.download_count, after.stats.download_count);
    assert!(after.last_checked_at.unwrap() > expired);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn fallback_does_not_advance_freshness_and_expired_or_legacy_cache_fails() {
    let server = TestServer::start(vec![
        Reply::new(200, b"cached.example\n"),
        Reply::new(503, b""),
        Reply::new(503, b""),
        Reply::new(503, b""),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    let before = metadata(&db, &source).await;
    let fallback = downloader.download_source(&source, false).await;
    assert!(fallback.error.is_none());
    assert!(fallback.stale_fallback && fallback.cache_hit);
    assert_eq!(fallback.last_checked_at, before.last_checked_at);
    assert!(fallback
        .warnings
        .iter()
        .any(|warning| warning.starts_with("Stale source:")));
    let after = metadata(&db, &source).await;
    assert_eq!(before.last_checked_at, after.last_checked_at);
    assert_eq!(before.last_downloaded_at, after.last_downloaded_at);
    assert_eq!(before.updated_at, after.updated_at);
    let expired = BsonDateTime::from_millis(
        BsonDateTime::now().timestamp_millis() - crate::db::cache::MAX_FALLBACK_AGE_MILLIS - 1,
    );
    set_metadata(&db, &source, doc! { "last_checked_at": expired }).await;
    downloader
        .update_domain_count(&fallback.url_hash, 100)
        .await
        .unwrap();
    let failed = downloader.download_source(&source, false).await;
    assert!(failed.error.is_some() && failed.content.is_none());
    assert_eq!(metadata(&db, &source).await.last_checked_at, Some(expired));
    set_metadata(
        &db,
        &source,
        doc! { "last_checked_at": Bson::Null, "updated_at": BsonDateTime::now() },
    )
    .await;
    let legacy = downloader.download_source(&source, false).await;
    assert!(legacy.error.is_some() && legacy.content.is_none());
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn invalid_hash_and_missing_gridfs_body_cannot_validate_a_304_or_fallback() {
    let server = TestServer::start(vec![
        Reply::new(200, b"cached.example\n").header("ETag", "\"same\""),
        Reply::new(304, b""),
        Reply::new(200, b"repaired.example\n").header("ETag", "\"repaired\""),
        Reply::new(304, b""),
        Reply::new(503, b""),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    set_metadata(&db, &source, doc! { "content_hash": "invalid" }).await;
    let corrupt = downloader.download_source(&source, false).await;
    assert!(corrupt.error.as_ref().unwrap().contains("304"));
    assert!(corrupt.content.is_none());
    assert!(corrupt
        .warnings
        .iter()
        .any(|warning| warning.contains("content hash")));
    assert!(!server.requests.lock().unwrap()[1]
        .to_lowercase()
        .contains("if-none-match"));
    let repaired = downloader.download_source(&source, false).await;
    assert!(repaired.error.is_none(), "{:?}", repaired.error);
    let entry = metadata(&db, &source).await;
    db.gridfs_bucket(
        mongodb::options::GridFsBucketOptions::builder()
            .bucket_name("cache_files".to_string())
            .build(),
    )
    .delete(Bson::ObjectId(entry.gridfs_id.unwrap()))
    .await
    .unwrap();
    let missing = downloader.download_source(&source, false).await;
    assert!(missing.error.as_ref().unwrap().contains("304") && missing.content.is_none());
    let no_fallback = downloader.download_source(&source, false).await;
    assert!(no_fallback.error.is_some() && no_fallback.content.is_none());
    assert_eq!(
        metadata(&db, &source).await.last_checked_at,
        entry.last_checked_at
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn conditional_validators_follow_only_the_verified_final_destination() {
    let server = TestServer::start(vec![
        Reply::new(302, b"").header("Location", "/original"),
        Reply::new(200, b"original.example\n").header("ETag", "\"version\""),
        Reply::new(302, b"").header("Location", "/changed"),
        Reply::new(200, b"changed.example\n").header("ETag", "\"version\""),
        Reply::new(302, b"").header("Location", "/changed"),
        Reply::new(304, b""),
        Reply::new(302, b"").header("Location", "http://127.0.0.1/private"),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    let changed = downloader.download_source(&source, false).await;
    assert_eq!(
        changed.content.as_deref(),
        Some(b"changed.example\n".as_slice())
    );
    let checked = downloader.download_source(&source, false).await;
    assert!(checked.error.is_none() && checked.cache_hit && !checked.stale_fallback);
    let unsafe_redirect = downloader.download_source(&source, false).await;
    assert!(unsafe_redirect.stale_fallback);
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 7);
    for index in [0, 1, 2, 3, 4, 6] {
        assert!(
            !requests[index].to_lowercase().contains("if-none-match"),
            "{}",
            requests[index]
        );
    }
    assert!(requests[5]
        .to_lowercase()
        .contains("if-none-match: \"version\""));
    assert_eq!(
        metadata(&db, &source).await.last_checked_at,
        checked.last_checked_at
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn oversized_and_incomplete_responses_do_not_replace_a_valid_body() {
    let server = TestServer::start(vec![
        Reply::new(200, b"valid.example\n"),
        Reply::new(200, b"").header("Content-Length", &(MAX_SOURCE_SIZE_BYTES + 1).to_string()),
        Reply::new(200, b"broken").header("Content-Length", "100"),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none());
    for _ in 0..2 {
        let fallback = downloader.download_source(&source, false).await;
        assert!(fallback.stale_fallback && fallback.error.is_none());
        assert_eq!(fallback.content, first.content);
        assert_eq!(fallback.last_checked_at, first.last_checked_at);
    }
    assert_eq!(
        metadata(&db, &source).await.last_checked_at,
        first.last_checked_at
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn metadata_write_failure_keeps_old_body_and_cannot_report_a_successful_check() {
    let server = TestServer::start(vec![
        Reply::new(200, b"old.example\n").header("ETag", "\"old\""),
        Reply::new(200, b"replacement.example\n").header("ETag", "\"replacement\""),
        Reply::new(304, b""),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none());
    let old = metadata(&db, &source).await;
    db.run_command(doc! {
        "collMod": "cache",
        "validator": { "required_fixture_field": { "$exists": true } },
        "validationLevel": "strict",
        "validationAction": "error",
    })
    .await
    .unwrap();
    let failed = downloader.download_source(&source, false).await;
    assert!(failed.error.as_ref().unwrap().contains("persist"));
    assert!(failed.content.is_none() && failed.last_checked_at.is_none());
    assert!(!failed.stale_fallback);
    let after = metadata(&db, &source).await;
    assert_eq!(after.gridfs_id, old.gridfs_id);
    assert_eq!(after.last_checked_at, old.last_checked_at);
    assert_eq!(
        CacheRepository::new(&db)
            .get_verified_content(&after)
            .await
            .unwrap(),
        first.content.unwrap()
    );
    assert_eq!(
        db.collection::<bson::Document>("cache_files.files")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    let failed_304 = downloader.download_source(&source, false).await;
    assert!(failed_304.error.as_ref().unwrap().contains("persist"));
    assert!(failed_304.content.is_none() && failed_304.last_checked_at.is_none());
    assert_eq!(
        metadata(&db, &source).await.last_checked_at,
        old.last_checked_at
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn cleanup_uses_successful_checks_instead_of_extraction_timestamps() {
    let server = TestServer::start(vec![Reply::new(200, b"old.example\n")]).await;
    let (db, downloader, source) = fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none());
    let expired = BsonDateTime::from_millis(
        BsonDateTime::now().timestamp_millis() - crate::db::cache::MAX_FALLBACK_AGE_MILLIS - 1,
    );
    set_metadata(&db, &source, doc! { "last_checked_at": expired }).await;
    downloader
        .update_domain_count(&first.url_hash, 42)
        .await
        .unwrap();
    assert!(!downloader
        .cache_repo
        .has_valid_cache(&first.url_hash, &source.url, 3600)
        .await
        .unwrap());
    assert_eq!(downloader.cache_repo.cleanup_stale(1).await.unwrap(), 1);
    assert!(downloader
        .cache_repo
        .get_entry(&first.url_hash)
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        db.collection::<bson::Document>("cache_files.files")
            .count_documents(doc! {})
            .await
            .unwrap(),
        0
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn corrupt_validators_trigger_an_unconditional_check_instead_of_blocking_freshness() {
    let server = TestServer::start(vec![
        Reply::new(200, b"old.example\n").header("ETag", "\"old\""),
        Reply::new(200, b"new.example\n"),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    set_metadata(&db, &source, doc! { "etag": "bad\r\nInjected: true" }).await;
    let checked = downloader.download_source(&source, false).await;
    assert!(checked.error.is_none() && !checked.stale_fallback);
    assert_eq!(
        checked.content.as_deref(),
        Some(b"new.example\n".as_slice())
    );
    assert!(checked
        .warnings
        .iter()
        .any(|warning| warning.contains("Invalid cached source validators")));
    assert!(!server.requests.lock().unwrap()[1]
        .to_lowercase()
        .contains("if-none-match"));
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn decompressed_source_size_is_bounded() {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    let block = vec![b'a'; 1024 * 1024];
    for _ in 0..101 {
        encoder.write_all(&block).unwrap();
    }
    let compressed = encoder.finish().unwrap();
    drop(block);
    let server = TestServer::start(vec![
        Reply::new(200, &compressed).header("Content-Encoding", "gzip")
    ])
    .await;
    let (db, mut downloader, source) = fixture(&server).await;
    downloader.config.http_timeout_secs = 10;
    let checked = downloader.download_source(&source, false).await;
    assert!(
        checked.error.as_ref().unwrap().contains("size limit"),
        "{:?}",
        checked.error
    );
    assert!(checked.content.is_none() && checked.last_checked_at.is_none());
    assert!(downloader
        .cache_repo
        .get_entry(&checked.url_hash)
        .await
        .unwrap()
        .is_none());
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn fresh_entry_is_served_without_contacting_the_upstream() {
    let server = TestServer::start(vec![Reply::new(200, b"fresh.example\n")]).await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none(), "{:?}", first.error);
    let before = metadata(&db, &source).await;
    let second = downloader.download_source(&source, false).await;
    assert!(second.error.is_none(), "{:?}", second.error);
    assert!(second.cache_hit && !second.stale_fallback);
    assert!(second.warnings.is_empty(), "{:?}", second.warnings);
    assert_eq!(second.content, first.content);
    assert_eq!(second.content_hash, first.content_hash);
    assert_eq!(second.last_checked_at, first.last_checked_at);
    assert_eq!(second.bytes_downloaded, 0);
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    let after = metadata(&db, &source).await;
    assert_eq!(before.last_checked_at, after.last_checked_at);
    assert_eq!(before.updated_at, after.updated_at);
    assert!(
        downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn entry_older_than_the_freshness_window_is_revalidated() {
    let server = TestServer::start(vec![
        Reply::new(200, b"aged.example\n").header("ETag", "\"aged\""),
        Reply::new(304, b""),
    ])
    .await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none(), "{:?}", first.error);
    let aged = set_checked_seconds_ago(&db, &source, 3601).await;
    assert!(
        !downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    let second = downloader.download_source(&source, false).await;
    assert!(second.error.is_none(), "{:?}", second.error);
    assert!(second.cache_hit && !second.stale_fallback);
    assert_eq!(second.content, first.content);
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 2);
    assert!(requests[1]
        .to_lowercase()
        .contains("if-none-match: \"aged\""));
    assert!(metadata(&db, &source).await.last_checked_at.unwrap() > aged);
    assert!(
        downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn forced_download_revalidates_a_fresh_entry() {
    let server = TestServer::start(vec![
        Reply::new(200, b"first.example\n").header("ETag", "\"first\""),
        Reply::new(304, b""),
        Reply::new(200, b"second.example\n").header("ETag", "\"second\""),
    ])
    .await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none(), "{:?}", first.error);
    let unchanged = downloader.download_source(&source, true).await;
    assert!(unchanged.error.is_none(), "{:?}", unchanged.error);
    assert!(unchanged.cache_hit && !unchanged.stale_fallback);
    assert_eq!(unchanged.content, first.content);
    assert!(unchanged.last_checked_at >= first.last_checked_at);
    let changed = downloader.download_source(&source, true).await;
    assert!(changed.error.is_none(), "{:?}", changed.error);
    assert!(!changed.cache_hit);
    assert_eq!(
        changed.content.as_deref(),
        Some(b"second.example\n".as_slice())
    );
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 3);
    assert!(requests[1]
        .to_lowercase()
        .contains("if-none-match: \"first\""));
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn fresh_entry_with_an_unusable_body_is_downloaded_again() {
    let server = TestServer::start(vec![
        Reply::new(200, b"first.example\n").header("ETag", "\"first\""),
        Reply::new(200, b"repaired.example\n"),
    ])
    .await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    set_metadata(&db, &source, doc! { "content_hash": "invalid" }).await;
    let repaired = downloader.download_source(&source, false).await;
    assert!(repaired.error.is_none(), "{:?}", repaired.error);
    assert!(!repaired.cache_hit);
    assert_eq!(
        repaired.content.as_deref(),
        Some(b"repaired.example\n".as_slice())
    );
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 2);
    assert!(!requests[1].to_lowercase().contains("if-none-match"));
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn skip_check_reads_metadata_only_and_matches_what_the_downloader_accepts() {
    let server = TestServer::start(vec![Reply::new(200, b"cached.example\n")]).await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    let first = downloader.download_source(&source, false).await;
    assert!(first.error.is_none(), "{:?}", first.error);
    let repo = &downloader.cache_repo;
    let url_hash = first.url_hash.as_str();
    assert!(repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    assert!(!repo
        .has_valid_cache(url_hash, &source.url, 0)
        .await
        .unwrap());
    assert!(!repo
        .has_valid_cache(url_hash, "http://other.example/list", 3600)
        .await
        .unwrap());
    assert!(!repo
        .has_valid_cache("missing", &source.url, 3600)
        .await
        .unwrap());
    db.collection::<bson::Document>("cache_files.chunks")
        .drop()
        .await
        .unwrap();
    assert!(repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    set_checked_seconds_ago(&db, &source, 3601).await;
    assert!(!repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    set_checked_seconds_ago(&db, &source, 0).await;
    set_metadata(&db, &source, doc! { "content_hash": Bson::Null }).await;
    assert!(!repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    set_metadata(&db, &source, doc! { "content_hash": &first.content_hash }).await;
    assert!(repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    db.collection::<bson::Document>("cache_files.files")
        .delete_many(doc! {})
        .await
        .unwrap();
    assert!(!repo
        .has_valid_cache(url_hash, &source.url, 3600)
        .await
        .unwrap());
    assert!(
        !downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn entry_without_a_check_time_is_downloaded_unconditionally_and_replaced() {
    let server = TestServer::start(vec![
        Reply::new(200, b"current.example\n").header("ETag", "\"current\"")
    ])
    .await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    insert_entry_without_check_time(&db, &source, b"unchecked.example\n").await;
    let unchecked = metadata(&db, &source).await;
    assert!(unchecked.last_checked_at.is_none() && unchecked.final_url.is_none());
    assert!(
        !downloader
            .check_all_cached(std::slice::from_ref(&source))
            .await
    );
    let result = downloader.download_source(&source, false).await;
    assert!(result.error.is_none(), "{:?}", result.error);
    assert!(!result.cache_hit && !result.stale_fallback);
    assert!(result.warnings.is_empty(), "{:?}", result.warnings);
    assert_eq!(result.previous_domain_count, Some(7));
    assert_eq!(
        result.content.as_deref(),
        Some(b"current.example\n".as_slice())
    );
    let requests = server.recorded_requests();
    assert_eq!(requests.len(), 1);
    assert!(!requests[0].to_lowercase().contains("if-none-match"));
    let replaced = metadata(&db, &source).await;
    assert!(replaced.last_checked_at.is_some());
    assert_eq!(replaced.final_url.as_deref(), Some(source.url.as_str()));
    assert_eq!(replaced.stats.download_count, 4);
    assert_ne!(replaced.gridfs_id, unchecked.gridfs_id);
    assert_eq!(
        db.collection::<bson::Document>("cache_files.files")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn entry_without_a_check_time_fails_only_its_own_source_when_upstream_is_down() {
    let server = TestServer::start(vec![
        Reply::new(503, b""),
        Reply::new(200, b"healthy.example\n"),
    ])
    .await;
    let (db, mut downloader, source) = fresh_fixture(&server).await;
    downloader.config.max_concurrent_downloads = 1;
    insert_entry_without_check_time(&db, &source, b"unchecked.example\n").await;
    let healthy = Source {
        name: "healthy".into(),
        url: server.url("/healthy"),
        category: None,
    };
    let reported = std::sync::Mutex::new(Vec::new());
    let results = downloader
        .download_sources(vec![source.clone(), healthy], false, |_, progress| {
            reported.lock().unwrap().push(progress.clone())
        })
        .await;
    assert_eq!(results.len(), 2);
    assert!(results[0].content.is_none());
    assert!(results[0].error.as_ref().unwrap().contains("HTTP 503"));
    assert!(results[1].error.is_none(), "{:?}", results[1].error);
    assert_eq!(
        results[1].content.as_deref(),
        Some(b"healthy.example\n".as_slice())
    );
    let reported = reported.into_inner().unwrap();
    assert_eq!(reported[0].status, SourceStatus::Failed);
    assert_eq!(reported[1].status, SourceStatus::Completed);
    assert!(metadata(&db, &source).await.last_checked_at.is_none());
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn cleanup_removes_entries_without_a_check_time_and_survives_a_missing_body() {
    let server = TestServer::start(vec![Reply::new(200, b"checked.example\n")]).await;
    let (db, downloader, source) = fresh_fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    let unchecked = Source {
        name: "unchecked".into(),
        url: server.url("/unchecked"),
        category: None,
    };
    let bodiless = Source {
        name: "bodiless".into(),
        url: server.url("/bodiless"),
        category: None,
    };
    insert_entry_without_check_time(&db, &unchecked, b"unchecked.example\n").await;
    insert_entry_without_check_time(&db, &bodiless, b"bodiless.example\n").await;
    cache_bucket(&db)
        .delete(Bson::ObjectId(
            metadata(&db, &bodiless).await.gridfs_id.unwrap(),
        ))
        .await
        .unwrap();
    assert_eq!(downloader.cleanup_cache().await.unwrap(), 2);
    assert!(metadata(&db, &source).await.last_checked_at.is_some());
    for removed in [&unchecked, &bodiless] {
        assert!(downloader
            .cache_repo
            .get_entry(&Downloader::hash_url(&removed.url))
            .await
            .unwrap()
            .is_none());
    }
    assert_eq!(
        db.collection::<bson::Document>("cache_files.files")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires isolated SOURCE_CACHE_TEST_MONGO_URI"]
async fn stale_fallback_warning_reaches_source_progress() {
    let server = TestServer::start(vec![
        Reply::new(200, b"cached.example\n"),
        Reply::new(503, b""),
    ])
    .await;
    let (db, downloader, source) = fixture(&server).await;
    assert!(downloader
        .download_source(&source, false)
        .await
        .error
        .is_none());
    let reported = std::sync::Mutex::new(Vec::new());
    let results = downloader
        .download_sources(vec![source.clone()], false, |_, progress| {
            reported.lock().unwrap().push(progress.clone())
        })
        .await;
    assert!(results[0].stale_fallback && results[0].error.is_none());
    let reported = reported.into_inner().unwrap();
    assert_eq!(reported.len(), 1);
    assert_eq!(reported[0].status, SourceStatus::Completed);
    assert_eq!(reported[0].cache_hit, Some(true));
    assert!(reported[0]
        .warnings
        .iter()
        .any(|warning| warning.starts_with("Stale source:") && warning.contains("HTTP 503")));
    db.drop().await.unwrap();
}
