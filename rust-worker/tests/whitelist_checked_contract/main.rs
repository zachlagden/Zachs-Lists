#[path = "../../src/extractor.rs"]
mod extractor;
#[path = "../../src/db/progress.rs"]
pub mod progress;
mod db {
    pub use crate::progress;
}
#[path = "../../src/whitelist.rs"]
mod whitelist;
#[path = "../../src/whitelist_validation.rs"]
mod whitelist_validation;

use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::io::{self, Read};
use whitelist::{WhitelistErrorCode, WhitelistManager, MAX_WHITELIST_BYTES};
use whitelist_validation::{run, validate_content, validate_reader};

#[derive(Deserialize)]
struct Fixture {
    name: String,
    content: String,
    valid: bool,
    validated_count: usize,
    #[serde(default)]
    matches: Vec<String>,
    #[serde(default)]
    nonmatches: Vec<String>,
    #[serde(default)]
    errors: Vec<(usize, String)>,
}

#[test]
#[allow(deprecated)]
fn whitelist_validation_and_execution_contract() {
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures.json")).unwrap();
    for fixture in fixtures {
        let report = validate_content(&fixture.content);
        let parsed = WhitelistManager::try_from_content(&fixture.content);
        assert_eq!(report.valid, fixture.valid, "{}", fixture.name);
        assert_eq!(parsed.is_ok(), fixture.valid, "{}", fixture.name);
        assert_eq!(
            report.validated_count, fixture.validated_count,
            "{}",
            fixture.name
        );
        let mut output = Vec::new();
        assert_eq!(
            run(fixture.content.as_bytes(), &mut output).unwrap(),
            if fixture.valid { 0 } else { 2 }
        );
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&output).unwrap(),
            serde_json::to_value(&report).unwrap()
        );
        if let Ok(manager) = parsed {
            let legacy = WhitelistManager::from_content(&fixture.content);
            assert_eq!(manager.pattern_count(), fixture.validated_count);
            for domain in fixture.matches {
                assert!(
                    manager.is_whitelisted(&domain),
                    "{}: {}",
                    fixture.name,
                    domain
                );
                assert!(legacy.is_whitelisted(&domain));
            }
            for domain in fixture.nonmatches {
                assert!(
                    !manager.is_whitelisted(&domain),
                    "{}: {}",
                    fixture.name,
                    domain
                );
                assert!(!legacy.is_whitelisted(&domain));
            }
        } else {
            let errors: Vec<(usize, String)> = report
                .errors
                .iter()
                .map(|error| {
                    (
                        error.line.unwrap(),
                        serde_json::to_value(&error.code)
                            .unwrap()
                            .as_str()
                            .unwrap()
                            .to_string(),
                    )
                })
                .collect();
            assert_eq!(errors, fixture.errors, "{}", fixture.name);
        }
    }
}

#[test]
fn whitelist_filter_and_borrowed_statistics_agree_with_overlaps_and_duplicates() {
    let manager = WhitelistManager::try_from_content("example.com\nexample.com\n@@example.com\n*.example.com\n/example/\n@@EXAMPLE.COM\nunused.net").unwrap();
    let domains: HashSet<String> = [
        "example.com",
        "sub.example.com",
        "a.b.example.com",
        "other.net",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    let refs: Vec<&String> = domains.iter().collect();
    let (stats_removed, stats_matches) = manager.filter_stats(&refs);
    let (remaining, removed, matches) = manager.filter_domains(domains.clone());
    assert_eq!(remaining, HashSet::from(["other.net".to_string()]));
    assert_eq!(removed, 3);
    assert_eq!(stats_removed, removed);
    let counts =
        |patterns: Vec<progress::WhitelistPatternMatch>| -> BTreeMap<String, (String, u64)> {
            patterns
                .into_iter()
                .map(|p| {
                    assert!(p.samples.is_empty());
                    (p.pattern, (p.pattern_type, p.match_count))
                })
                .collect()
        };
    let expected = BTreeMap::from([
        ("example.com".to_string(), ("exact".to_string(), 1)),
        ("@@example.com".to_string(), ("subdomain".to_string(), 3)),
        ("*.example.com".to_string(), ("wildcard".to_string(), 2)),
        ("/example/".to_string(), ("regex".to_string(), 3)),
        ("@@EXAMPLE.COM".to_string(), ("subdomain".to_string(), 3)),
    ]);
    assert_eq!(counts(matches.clone()), expected);
    assert_eq!(counts(stats_matches), expected);
    let progress = manager.create_progress(domains.len() as u64, remaining.len() as u64, matches);
    assert_eq!(progress.total_removed, removed);
    assert_eq!(progress.domains_before, 4);
    assert_eq!(progress.domains_after, 1);
    assert!(!progress.processing);
}

#[test]
fn whitelist_empty_and_intentionally_empty_output_are_valid() {
    let domains = HashSet::from(["example.com".to_string()]);
    let empty = WhitelistManager::try_from_content("# comment").unwrap();
    assert!(empty.is_empty());
    let refs: Vec<&String> = domains.iter().collect();
    assert_eq!(empty.filter_stats(&refs).0, 0);
    let (remaining, removed, patterns) = empty.filter_domains(domains.clone());
    assert_eq!(remaining, domains);
    assert_eq!(removed, 0);
    assert!(patterns.is_empty());
    let broad = WhitelistManager::try_from_content("*").unwrap();
    let (remaining, removed, _) = broad.filter_domains(domains);
    assert!(remaining.is_empty());
    assert_eq!(removed, 1);
}

#[test]
fn whitelist_domain_dns_length_boundaries() {
    let valid = format!(
        "{}.{}.{}.{}",
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(61)
    );
    assert_eq!(valid.len(), 253);
    assert!(WhitelistManager::try_from_content(&valid).is_ok());
    assert!(WhitelistManager::try_from_content(&format!("{}x", valid)).is_err());
    assert!(WhitelistManager::try_from_content(&format!("{}.com", "a".repeat(64))).is_err());
    assert!(WhitelistManager::try_from_content(&format!("@@{}", valid)).is_ok());
}

#[test]
fn whitelist_fingerprint_strings_preserve_case_sensitive_semantics() {
    let manager = WhitelistManager::try_from_content(
        "Example.COM\n@@Example.NET\n*.Example.ORG\n/ABC/ # ignored",
    )
    .unwrap();
    assert_eq!(
        manager.patterns_as_strings(),
        ["*.Example.ORG", "/ABC/", "@@example.net", "example.com"]
    );
    let lower =
        WhitelistManager::try_from_content("example.com\n@@example.net\n*.example.org\n/abc/")
            .unwrap();
    assert_ne!(manager.patterns_as_strings(), lower.patterns_as_strings());
}

#[test]
fn whitelist_diagnostics_never_echo_patterns() {
    let content = "/(?=private-token-123)private-token-123/\n@@credential@example.com";
    let failure = match WhitelistManager::try_from_content(content) {
        Err(error) => error,
        Ok(_) => panic!("invalid input was accepted"),
    };
    for diagnostics in [
        format!("{failure}"),
        format!("{failure:?}"),
        serde_json::to_string(&validate_content(content)).unwrap(),
    ] {
        assert!(!diagnostics.contains("private-token-123"));
        assert!(!diagnostics.contains("credential"));
        assert!(!diagnostics.contains("example.com"));
    }
}

#[test]
fn whitelist_input_ceiling_matches_for_reader_and_execution() {
    let mut content = " ".repeat(MAX_WHITELIST_BYTES - "example.com".len());
    content.push_str("example.com");
    assert!(validate_reader(content.as_bytes()).valid);
    assert!(WhitelistManager::try_from_content(&content).is_ok());
    content.push(' ');
    assert_eq!(
        validate_reader(content.as_bytes()).errors[0].code,
        WhitelistErrorCode::InputTooLarge
    );
    let error = match WhitelistManager::try_from_content(&content) {
        Err(error) => error,
        Ok(_) => panic!("oversize input was accepted"),
    };
    assert_eq!(error.errors[0].code, WhitelistErrorCode::InputTooLarge);
    let utf8 = "é".repeat(MAX_WHITELIST_BYTES / 2 + 1);
    assert_eq!(
        validate_content(&utf8).errors[0].code,
        WhitelistErrorCode::InputTooLarge
    );
}

struct CountedInput {
    bytes_read: usize,
}

impl Read for CountedInput {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        output.fill(b' ');
        self.bytes_read += output.len();
        Ok(output.len())
    }
}

#[test]
fn whitelist_reader_never_consumes_more_than_ceiling_plus_one() {
    let mut input = CountedInput { bytes_read: 0 };
    let result = validate_reader(&mut input);
    assert!(!result.valid);
    assert_eq!(input.bytes_read, MAX_WHITELIST_BYTES + 1);
    assert_eq!(result.errors[0].line, None);
    assert_eq!(result.errors[0].code, WhitelistErrorCode::InputTooLarge);
}

struct FailedInput;

impl Read for FailedInput {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("private read details"))
    }
}

#[test]
fn whitelist_reader_and_cli_errors_are_structured_and_safe() {
    let invalid_utf8 = validate_reader([0xff].as_slice());
    assert_eq!(invalid_utf8.errors[0].code, WhitelistErrorCode::InvalidUtf8);
    assert_eq!(invalid_utf8.errors[0].line, None);
    let failed_read = validate_reader(FailedInput);
    assert_eq!(
        failed_read.errors[0].code,
        WhitelistErrorCode::InputReadFailed
    );
    assert!(!serde_json::to_string(&failed_read)
        .unwrap()
        .contains("private read details"));
    let mut output = Vec::new();
    assert_eq!(run(FailedInput, &mut output).unwrap(), 2);
    assert_eq!(output.last(), Some(&b'\n'));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&output).unwrap()["valid"],
        false
    );
    assert!(run("example.com".as_bytes(), io::sink()).is_ok());
    assert!(run("example.com".as_bytes(), &mut [0_u8; 1][..]).is_err());
}

#[test]
fn whitelist_regex_engine_compilation_limits_are_checked_before_execution() {
    let result = validate_content("/a{10000000}/");
    assert!(!result.valid);
    assert_eq!(result.errors[0].line, Some(1));
    assert_eq!(result.errors[0].code, WhitelistErrorCode::RegexCompileLimit);
}

#[test]
fn whitelist_aggregate_regex_set_compilation_limit_has_line_errors() {
    let pattern = "/a{10000}/";
    assert!(WhitelistManager::try_from_content(pattern).is_ok());
    let content = vec![pattern; 100].join("\n");
    let report = validate_content(&content);
    assert!(!report.valid);
    assert_eq!(report.validated_count, 100);
    assert_eq!(report.errors.len(), 100);
    for (index, error) in report.errors.iter().enumerate() {
        assert_eq!(error.line, Some(index + 1));
        assert_eq!(error.code, WhitelistErrorCode::RegexSetCompileFailed);
    }
}

#[test]
fn whitelist_statistics_still_limit_to_twenty_patterns() {
    let content = (1..=25)
        .map(|n| format!("/a{{{n}}}/"))
        .collect::<Vec<_>>()
        .join("\n");
    let manager = WhitelistManager::try_from_content(&content).unwrap();
    let domains = HashSet::from([format!("{}.com", "a".repeat(25))]);
    let refs: Vec<&String> = domains.iter().collect();
    let (removed, matches) = manager.filter_stats(&refs);
    assert_eq!(removed, 1);
    assert_eq!(matches.len(), 20);
    assert!(matches.iter().all(|p| p.match_count == 1));
}
