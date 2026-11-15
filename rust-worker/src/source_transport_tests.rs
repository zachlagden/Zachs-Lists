use super::*;

use crate::source_cache_test_server::{Reply, TestServer};

const TIMEOUT_NO_REPLY_REACHES: Duration = Duration::from_secs(60);

#[test]
fn validators_are_bounded_and_bound_to_the_exact_destination() {
    let mut validators = SourceValidators {
        final_url: "https://source.example/List?Token=Case".into(),
        etag: Some("\"version\"".into()),
        last_modified: None,
    };
    let exact = parse_source_url(&validators.final_url).unwrap();
    assert_eq!(
        validators.headers_for(&exact).unwrap()[IF_NONE_MATCH],
        "\"version\""
    );
    for other in [
        "https://source.example/list?Token=Case",
        "https://source.example/List?token=case",
        "https://other.example/List?Token=Case",
    ] {
        assert!(validators
            .headers_for(&parse_source_url(other).unwrap())
            .unwrap()
            .is_empty());
    }
    validators.etag = Some("bad\r\nInjected: true".into());
    assert!(validators.headers_for(&exact).is_err());
    validators.etag = Some("a".repeat(8193));
    assert!(validators.headers_for(&exact).is_err());
}

#[tokio::test]
async fn redirect_destinations_remain_validated_and_redirect_count_is_bounded() {
    let server = TestServer::start(vec![
        Reply::new(302, b"").header("Location", "http://127.0.0.1/private")
    ])
    .await;
    let result = get_source_for_test(
        &server.url("/start"),
        TIMEOUT_NO_REPLY_REACHES,
        None,
        server.address,
    )
    .await;
    assert!(result
        .unwrap_err()
        .to_string()
        .contains("publicly addressable"));
    assert_eq!(server.requests.lock().unwrap().len(), 1);
    let server = TestServer::start(
        (0..6)
            .map(|_| Reply::new(302, b"").header("Location", "/loop"))
            .collect(),
    )
    .await;
    let result = get_source_for_test(
        &server.url("/start"),
        TIMEOUT_NO_REPLY_REACHES,
        None,
        server.address,
    )
    .await;
    assert!(result.unwrap_err().to_string().contains("redirect exceeds"));
    assert_eq!(server.requests.lock().unwrap().len(), 6);
}

#[tokio::test]
async fn transport_timeout_bounds_the_complete_redirect_chain() {
    let server = TestServer::start(vec![Reply::new(200, b"late.example\n").stalled_after(0)]).await;
    let result = get_source_for_test(
        &server.url("/never-answered"),
        Duration::from_millis(50),
        None,
        server.address,
    )
    .await;
    assert!(result.is_err());
}

#[test]
fn redirects_never_downgrade_https_or_accept_credentials_and_private_hosts() {
    let current = parse_source_url("https://source.example/List?Token=Case").unwrap();
    for target in [
        "http://other.example/List",
        "https://127.0.0.1/private",
        "https://user@other.example/List",
        "file:///etc/passwd",
    ] {
        assert!(redirect_target(&current, target).is_err(), "{target}");
    }
    let target = redirect_target(&current, "/Changed?Token=Case").unwrap();
    assert_eq!(target.as_str(), "https://source.example/Changed?Token=Case");
}
