//! Whether a finished build already produced the list files this job would write.
//!
//! The last successful build stores its config hash and list-file hostname
//! together (`stats.config_hash` and `stats.generator_host` on the user, and
//! `generator_host` on the default build record). A later job may skip only
//! when both still match. Copy-on-match uses the same hostname comparison, so
//! it does not treat files stamped for another host as current.
//!
//! The hostname value is `Config::generator_host`, which is also what the
//! generator writes into the files.

/// Config hash and list-file hostname loaded from the last successful build.
///
/// `generator_host` is absent when the hash was stored before the hostname
/// was recorded. That absence does not match.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StoredBuildStamp {
    pub config_hash: Option<String>,
    pub generator_host: Option<String>,
}

impl StoredBuildStamp {
    /// Both the config hash and the list-file hostname match this build.
    pub fn matches(&self, config_hash: &str, generator_host: &str) -> bool {
        self.config_hash.as_deref() == Some(config_hash)
            && generator_host_matches(self.generator_host.as_deref(), generator_host)
    }
}

/// The recorded hostname is the one this process stamps on list files.
pub fn generator_host_matches(stored_generator_host: Option<&str>, generator_host: &str) -> bool {
    stored_generator_host == Some(generator_host)
}

/// Skip a non-scheduled, non-forced job only when the last build's config
/// hash and list-file hostname both match and every source is cached.
pub fn should_skip_unchanged_build(
    scheduled: bool,
    force_rebuild: bool,
    all_sources_cached: bool,
    stored: &StoredBuildStamp,
    config_hash: &str,
    generator_host: &str,
) -> bool {
    !scheduled
        && !force_rebuild
        && all_sources_cached
        && stored.matches(config_hash, generator_host)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(config_hash: Option<&str>, generator_host: Option<&str>) -> StoredBuildStamp {
        StoredBuildStamp {
            config_hash: config_hash.map(str::to_string),
            generator_host: generator_host.map(str::to_string),
        }
    }

    #[test]
    fn hostname_change_defeats_an_unchanged_config_hash() {
        let stored = stamp(Some("hash-aaa"), Some("lists.example.test"));
        assert!(stored.matches("hash-aaa", "lists.example.test"));
        assert!(!stored.matches("hash-aaa", "files.example.test"));
        assert!(!should_skip_unchanged_build(
            false,
            false,
            true,
            &stored,
            "hash-aaa",
            "files.example.test",
        ));
        assert!(should_skip_unchanged_build(
            false,
            false,
            true,
            &stored,
            "hash-aaa",
            "lists.example.test",
        ));
    }

    #[test]
    fn skip_requires_hash_host_and_cached_sources() {
        let cases = [
            (
                false,
                false,
                true,
                Some("hash-aaa"),
                Some("lists.example.test"),
                true,
            ),
            (
                false,
                false,
                true,
                Some("hash-bbb"),
                Some("lists.example.test"),
                false,
            ),
            (
                false,
                false,
                true,
                Some("hash-aaa"),
                Some("files.example.test"),
                false,
            ),
            (false, false, true, Some("hash-aaa"), None, false),
            (false, false, true, None, Some("lists.example.test"), false),
            (
                false,
                false,
                false,
                Some("hash-aaa"),
                Some("lists.example.test"),
                false,
            ),
            (
                true,
                false,
                true,
                Some("hash-aaa"),
                Some("lists.example.test"),
                false,
            ),
            (
                false,
                true,
                true,
                Some("hash-aaa"),
                Some("lists.example.test"),
                false,
            ),
        ];

        for (scheduled, force, cached, hash, host, expect_skip) in cases {
            let stored = stamp(hash, host);
            assert_eq!(
                should_skip_unchanged_build(
                    scheduled,
                    force,
                    cached,
                    &stored,
                    "hash-aaa",
                    "lists.example.test",
                ),
                expect_skip,
                "scheduled={scheduled} force={force} cached={cached} hash={hash:?} host={host:?}"
            );
        }
    }

    #[test]
    fn missing_hostname_does_not_match_the_fallback_host() {
        let fallback = crate::generator_host::BLOCKLIST_GENERATOR_HOST;
        let stored = stamp(Some("hash-aaa"), None);
        assert!(!generator_host_matches(None, fallback));
        assert!(!stored.matches("hash-aaa", fallback));
        assert!(stamp(Some("hash-aaa"), Some(fallback)).matches("hash-aaa", fallback));
    }

    #[test]
    fn hostname_comparison_is_exact() {
        assert!(!generator_host_matches(
            Some("Lists.Example.TEST"),
            "lists.example.test"
        ));
        assert!(!generator_host_matches(
            Some(" lists.example.test"),
            "lists.example.test"
        ));
        assert!(!generator_host_matches(Some(""), "lists.example.test"));
        assert!(generator_host_matches(
            Some("lists.example.test:8443"),
            "lists.example.test:8443"
        ));
    }
}
