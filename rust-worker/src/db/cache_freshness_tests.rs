use super::*;

fn entry(checked_at: Option<i64>, body: &[u8]) -> CacheEntry {
    CacheEntry {
        url_hash: "fixture".into(),
        url: Some("https://source.example/List?Token=Case".into()),
        final_url: Some("https://source.example/List?Token=Case".into()),
        gridfs_id: Some(ObjectId::new()),
        etag: None,
        last_modified: None,
        content_hash: Some(content_hash(body)),
        last_checked_at: checked_at.map(BsonDateTime::from_millis),
        last_downloaded_at: checked_at.map(BsonDateTime::from_millis),
        stats: CacheStats {
            size_bytes: body.len() as i64,
            ..Default::default()
        },
        updated_at: Some(BsonDateTime::now()),
    }
}

#[test]
fn fallback_boundary_is_inclusive_and_requires_a_successful_check() {
    let now = 2 * MAX_FALLBACK_AGE_MILLIS;
    assert!(
        entry(Some(now - MAX_FALLBACK_AGE_MILLIS), b"domain.example")
            .allows_fallback_at(BsonDateTime::from_millis(now))
    );
    assert!(
        !entry(Some(now - MAX_FALLBACK_AGE_MILLIS - 1), b"domain.example")
            .allows_fallback_at(BsonDateTime::from_millis(now))
    );
    assert!(
        !entry(Some(now + 1), b"domain.example").allows_fallback_at(BsonDateTime::from_millis(now))
    );
    let mut legacy = entry(None, b"domain.example");
    legacy.stats.last_download_at = Some(BsonDateTime::from_millis(now));
    assert!(!legacy.allows_fallback_at(BsonDateTime::from_millis(now)));
}

#[test]
fn cache_body_requires_matching_hash_and_size() {
    let mut cached = entry(Some(0), b"domain.example");
    assert!(cached.verify_body(b"domain.example").is_ok());
    assert!(cached.verify_body(b"changedexample").is_err());
    cached.content_hash = None;
    assert!(cached.verify_body(b"domain.example").is_err());
    cached.content_hash = Some(content_hash(b"domain.example"));
    cached.stats.size_bytes = -1;
    assert!(cached.verify_body(b"domain.example").is_err());
    cached.stats.size_bytes = MAX_SOURCE_SIZE_BYTES as i64 + 1;
    assert!(cached.verify_body(b"domain.example").is_err());
    assert!(entry(Some(0), b"").verify_body(b"").is_ok());
}
