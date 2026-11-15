//! Hostname stamped on generated blocklist files.
//!
//! The fallback string is `backend/app/blocklist_generator_host.txt`, which
//! `app.generator_host` also reads. Derivation matches `host_from_public_url`
//! there. Keep the cases in this module's tests aligned with
//! `backend/tests/test_generator_host.py`.

use std::env;

use url::Url;

/// Fallback when `FRONTEND_URL` has no hostname. Upstream output stays
/// `lists.zachlagden.uk` because that is the only copy of this constant.
pub const BLOCKLIST_GENERATOR_HOST: &str =
    include_str!("../../backend/app/blocklist_generator_host.txt").trim_ascii();

/// Host the worker should stamp, from the environment.
///
/// `BLOCKLIST_GENERATOR_HOST` wins when it is non-empty. Otherwise the host
/// is derived from `FRONTEND_URL`.
pub fn from_env() -> String {
    let explicit = env::var("BLOCKLIST_GENERATOR_HOST").ok();
    let public_url = env::var("FRONTEND_URL").ok();
    resolve(explicit.as_deref(), public_url.as_deref())
}

pub fn resolve(explicit: Option<&str>, public_url: Option<&str>) -> String {
    if let Some(host) = explicit.map(str::trim).filter(|host| !host.is_empty()) {
        return host.to_string();
    }
    host_from_public_url(public_url)
}

pub fn host_from_public_url(public_url: Option<&str>) -> String {
    let Some(raw) = public_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return BLOCKLIST_GENERATOR_HOST.to_string();
    };
    let Ok(url) = Url::parse(raw) else {
        return BLOCKLIST_GENERATOR_HOST.to_string();
    };
    let Some(hostname) = url.host_str().map(bare_hostname) else {
        return BLOCKLIST_GENERATOR_HOST.to_string();
    };
    match explicit_port(&url) {
        Some(port) if port != 80 && port != 443 => format!("{hostname}:{port}"),
        _ => hostname.to_string(),
    }
}

/// `host_str` keeps the brackets around an IPv6 address. `urlparse().hostname` does not.
fn bare_hostname(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host)
}

/// Port written in the URL, including scheme defaults.
///
/// `Url::port` hides ports 80 and 443. Python's `urlparse().port` reports
/// them, and the caller then drops both values.
fn explicit_port(url: &Url) -> Option<u16> {
    let rest = url.as_str().get(url.scheme().len() + "://".len()..)?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let hostport = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let port_text = if let Some(after_bracket) = hostport.strip_prefix('[') {
        after_bracket.split_once(']')?.1.strip_prefix(':')?
    } else {
        hostport.split_once(':')?.1
    };
    port_text.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_constant_matches_the_shared_file() {
        assert_eq!(BLOCKLIST_GENERATOR_HOST, "lists.zachlagden.uk");
    }

    #[test]
    fn host_matches_frontend_url_rules() {
        let fallback = BLOCKLIST_GENERATOR_HOST;
        let cases = [
            (None, fallback),
            (Some(""), fallback),
            (Some("   "), fallback),
            (Some("https://lists.example.test"), "lists.example.test"),
            (
                Some("https://lists.example.test:8443/app"),
                "lists.example.test:8443",
            ),
            (Some("http://localhost:5173"), "localhost:5173"),
            (Some("https://lists.example.test:443"), "lists.example.test"),
            (Some("http://lists.example.test:80/x"), "lists.example.test"),
            (Some("http://lists.example.test:443"), "lists.example.test"),
            (Some("https://lists.example.test:80"), "lists.example.test"),
            (
                Some("https://Lists.Example.TEST/path"),
                "lists.example.test",
            ),
            (
                Some("https://user:secret@lists.example.test:8443/x"),
                "lists.example.test:8443",
            ),
            (Some("http://[::1]/"), "::1"),
            (Some("http://[::1]:8080/"), "::1:8080"),
            (Some("not a url"), fallback),
            (Some("lists.example.test"), fallback),
        ];

        for (input, expected) in cases {
            assert_eq!(host_from_public_url(input), expected, "input: {input:?}");
        }
    }

    #[test]
    fn explicit_host_wins_over_frontend_url() {
        assert_eq!(
            resolve(
                Some(" files.example.test "),
                Some("https://other.example.test")
            ),
            "files.example.test"
        );
        assert_eq!(
            resolve(Some("  "), Some("https://lists.example.test:8443/app")),
            "lists.example.test:8443"
        );
        assert_eq!(resolve(None, None), BLOCKLIST_GENERATOR_HOST);
    }
}
