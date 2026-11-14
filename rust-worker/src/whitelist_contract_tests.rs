use crate::whitelist::{
    job_warnings, WhitelistManager, WhitelistProblemCode, MAX_COMPILED_PATTERNS, MAX_LINE_BYTES,
    MAX_REPORTED_PATTERNS, MAX_REPORTED_PROBLEMS, MAX_WHITELIST_BYTES,
};
use crate::whitelist_validation::{
    run, validate_content, validate_reader, EXIT_INVALID, EXIT_VALID,
};
use serde::Deserialize;
use std::collections::{BTreeMap, HashSet};
use std::io::{self, Read};
use std::time::Instant;

#[derive(Deserialize)]
struct Case {
    name: String,
    input: String,
    expected: serde_json::Value,
    #[serde(default)]
    matches: Vec<String>,
    #[serde(default)]
    nonmatches: Vec<String>,
}

fn usable(content: &str) -> WhitelistManager {
    WhitelistManager::parse(content).whitelist
}

fn owned(domains: &[&str]) -> HashSet<String> {
    domains.iter().map(|domain| domain.to_string()).collect()
}

#[test]
fn shared_whitelist_cases_produce_the_expected_validator_output() {
    let cases: Vec<Case> =
        serde_json::from_str(include_str!("../../tests/fixtures/whitelist-cases.json"))
            .expect("valid shared fixtures");
    assert!(!cases.is_empty());
    for case in cases {
        let mut output = Vec::new();
        let exit_code = run(case.input.as_bytes(), &mut output).unwrap();
        let printed: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(printed, case.expected, "{}", case.name);
        let expected_exit = if case.expected["valid"] == true {
            EXIT_VALID
        } else {
            EXIT_INVALID
        };
        assert_eq!(exit_code, expected_exit, "{}", case.name);

        let whitelist = usable(&case.input);
        for domain in &case.matches {
            assert!(whitelist.is_whitelisted(domain), "{}: {domain}", case.name);
        }
        for domain in &case.nonmatches {
            assert!(!whitelist.is_whitelisted(domain), "{}: {domain}", case.name);
        }
    }
}

#[test]
fn a_bad_line_is_reported_and_every_other_pattern_still_matches() {
    let parsed = WhitelistManager::parse(
        "exact.example\n/(?=bad)bad/\n@@parent.example\n*.wild.example\n/^good[0-9]+\\.example$/\n/^([a-z])\\1$/\nad*.partial.example",
    );
    let problems: Vec<(Option<usize>, WhitelistProblemCode, &str)> = parsed
        .problems
        .iter()
        .map(|problem| (problem.line, problem.code, problem.content.as_str()))
        .collect();
    assert_eq!(
        problems,
        [
            (
                Some(2),
                WhitelistProblemCode::UnsupportedRegex,
                "/(?=bad)bad/"
            ),
            (
                Some(6),
                WhitelistProblemCode::UnsupportedRegex,
                "/^([a-z])\\1$/"
            ),
        ]
    );
    for domain in [
        "exact.example",
        "parent.example",
        "a.b.parent.example",
        "a.wild.example",
        "good42.example",
        "ads.partial.example",
    ] {
        assert!(parsed.whitelist.is_whitelisted(domain), "{domain}");
    }
    for domain in ["wild.example", "bad", "good.example", "other.example"] {
        assert!(!parsed.whitelist.is_whitelisted(domain), "{domain}");
    }
}

#[test]
fn wildcards_match_lowercased_domains_whatever_case_they_were_written_in() {
    let whitelist = usable("*.Example.COM\nAD*.Partial.Example");
    assert!(whitelist.is_whitelisted("sub.example.com"));
    assert!(whitelist.is_whitelisted("ads.partial.example"));
    assert!(!whitelist.is_whitelisted("example.com"));
}

#[test]
fn subdomain_entries_match_by_label_and_not_by_text_suffix() {
    let content: String = (0..1000).map(|n| format!("@@site{n}.example\n")).collect();
    let whitelist = usable(&content);
    assert!(whitelist.is_whitelisted("site999.example"));
    assert!(whitelist.is_whitelisted("a.b.c.site0.example"));
    assert!(!whitelist.is_whitelisted("notsite0.example"));
    assert!(!whitelist.is_whitelisted("site0.example.other"));
    assert!(!whitelist.is_whitelisted("example"));
}

#[test]
fn syntax_errors_carry_the_regex_engine_reason() {
    let parsed = WhitelistManager::parse("/[unclosed/");
    assert_eq!(parsed.problems[0].code, WhitelistProblemCode::InvalidRegex);
    assert!(parsed.problems[0].message.starts_with("Invalid regex: "));
    assert!(!parsed.problems[0].message.contains('\n'));
}

#[test]
fn partition_and_pattern_matches_count_overlaps_once_per_pattern_with_sorted_samples() {
    let whitelist = usable(
        "example.com\nexample.com\n@@example.com\n*.example.com\n/example/\n@@EXAMPLE.COM\nunused.net",
    );
    let domains = owned(&[
        "example.com",
        "g.example.com",
        "f.example.com",
        "e.example.com",
        "d.example.com",
        "c.example.com",
        "b.example.com",
        "a.b.example.com",
        "other.net",
    ]);
    let (remaining, removed) = whitelist.partition(domains);
    assert_eq!(remaining, owned(&["other.net"]));
    assert_eq!(removed.len(), 8);

    let removed: HashSet<String> = removed.into_iter().collect();
    let matches = whitelist.pattern_matches(&removed);
    let summary: Vec<(&str, &str, u64, Vec<&str>)> = matches
        .iter()
        .map(|found| {
            (
                found.pattern.as_str(),
                found.pattern_type.as_str(),
                found.match_count,
                found.samples.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    let first_five = vec![
        "a.b.example.com",
        "b.example.com",
        "c.example.com",
        "d.example.com",
        "e.example.com",
    ];
    assert_eq!(
        summary,
        [
            ("@@example.com", "subdomain", 8, first_five.clone()),
            ("/example/", "regex", 8, first_five.clone()),
            ("*.example.com", "wildcard", 7, first_five),
            ("example.com", "exact", 1, vec!["example.com"]),
        ]
    );
    assert_eq!(whitelist.pattern_matches(&removed), matches);

    let progress = whitelist.create_progress(9, 1, matches, vec!["warning".to_string()]);
    assert_eq!(progress.total_removed, 8);
    assert!(!progress.processing);
    assert_eq!(progress.warnings, ["warning"]);
}

#[test]
fn an_empty_whitelist_keeps_every_domain_and_a_broad_wildcard_removes_them_all() {
    let domains = owned(&["example.com"]);
    let empty = usable("# comment");
    let (remaining, removed) = empty.partition(domains.clone());
    assert_eq!(remaining, domains);
    assert!(removed.is_empty());
    assert!(empty.pattern_matches(&HashSet::new()).is_empty());

    let (remaining, removed) = usable("*").partition(domains);
    assert!(remaining.is_empty());
    assert_eq!(removed, ["example.com"]);
}

#[test]
fn pattern_matches_report_only_the_top_patterns() {
    let content: String = (1..=25).map(|n| format!("/a{{{n}}}/\n")).collect();
    let whitelist = usable(&content);
    let removed = HashSet::from([format!("{}.com", "a".repeat(25))]);
    let matches = whitelist.pattern_matches(&removed);
    assert_eq!(matches.len(), MAX_REPORTED_PATTERNS);
    assert_eq!(matches[0].pattern, "/a{1}/");
    assert_eq!(matches[19].pattern, "/a{20}/");
}

#[test]
fn domain_length_limits_follow_dns() {
    let longest = format!(
        "{}.{}.{}.{}",
        "a".repeat(63),
        "b".repeat(63),
        "c".repeat(63),
        "d".repeat(61)
    );
    assert_eq!(longest.len(), 253);
    assert!(validate_content(&longest).valid);
    assert!(validate_content(&format!("@@{longest}")).valid);
    assert!(!validate_content(&format!("{longest}x")).valid);
    assert!(!validate_content(&format!("{}.com", "a".repeat(64))).valid);
}

#[test]
fn fingerprint_strings_are_normalised_deduplicated_and_skip_unusable_lines() {
    let whitelist = usable(
        "Example.COM\nexample.com\n@@Example.NET\n*.Example.ORG\n/ABC/ # ignored\n/(?=x)x/\nnot a domain",
    );
    assert_eq!(
        whitelist.patterns_as_strings(),
        ["*.example.org", "/ABC/", "@@example.net", "example.com"]
    );
    assert_ne!(
        whitelist.patterns_as_strings(),
        usable("example.com\n@@example.net\n*.example.org\n/abc/").patterns_as_strings()
    );
}

#[test]
fn job_warnings_name_the_line_without_repeating_its_content_and_are_capped() {
    let parsed = WhitelistManager::parse("/(?=private-token)private-token/\ngood.example");
    assert_eq!(
        job_warnings(&parsed.problems),
        ["Whitelist line 1 was ignored: Lookahead and lookbehind are not supported. Patterns use Rust regex syntax"]
    );

    let many = "not_valid\n".repeat(MAX_REPORTED_PROBLEMS + 7);
    let warnings = job_warnings(&WhitelistManager::parse(&many).problems);
    assert_eq!(warnings.len(), MAX_REPORTED_PROBLEMS + 1);
    assert_eq!(
        warnings.last().map(String::as_str),
        Some("7 more whitelist lines were ignored")
    );
}

#[test]
fn the_validator_caps_reported_errors_and_still_counts_every_one() {
    let content = format!(
        "{}/(?=x)x/\n",
        "not_valid\n".repeat(MAX_REPORTED_PROBLEMS + 7)
    );
    let result = validate_content(&content);
    assert!(!result.valid);
    assert_eq!(result.errors.len(), MAX_REPORTED_PROBLEMS);
    assert_eq!(
        result.error_counts,
        BTreeMap::from([
            (
                WhitelistProblemCode::InvalidDomain,
                MAX_REPORTED_PROBLEMS + 7
            ),
            (WhitelistProblemCode::UnsupportedRegex, 1),
        ])
    );
}

#[test]
fn regex_size_and_count_limits_reject_only_the_lines_over_them() {
    let parsed = WhitelistManager::parse("/a{10000000}/\n/^small$/");
    assert_eq!(parsed.problems.len(), 1);
    assert_eq!(parsed.problems[0].line, Some(1));
    assert_eq!(parsed.problems[0].code, WhitelistProblemCode::RegexTooLarge);
    assert!(parsed.whitelist.is_whitelisted("small"));

    let content: String = (0..MAX_COMPILED_PATTERNS + 2)
        .map(|n| format!("/^n{n}$/\n"))
        .collect();
    let parsed = WhitelistManager::parse(&content);
    let lines: Vec<Option<usize>> = parsed.problems.iter().map(|problem| problem.line).collect();
    assert_eq!(
        lines,
        [
            Some(MAX_COMPILED_PATTERNS + 1),
            Some(MAX_COMPILED_PATTERNS + 2)
        ]
    );
    assert!(parsed
        .problems
        .iter()
        .all(|problem| problem.code == WhitelistProblemCode::TooManyRegexPatterns));
    assert!(parsed.whitelist.is_whitelisted("n0"));
    assert!(parsed
        .whitelist
        .is_whitelisted(&format!("n{}", MAX_COMPILED_PATTERNS - 1)));
    assert!(!parsed
        .whitelist
        .is_whitelisted(&format!("n{MAX_COMPILED_PATTERNS}")));
}

#[test]
fn simple_wildcards_do_not_count_towards_the_regex_limit() {
    let content: String = (0..MAX_COMPILED_PATTERNS * 4)
        .map(|n| format!("*.site{n}.example\n"))
        .collect();
    let parsed = WhitelistManager::parse(&content);
    assert!(parsed.problems.is_empty());
    assert!(parsed.whitelist.is_whitelisted("a.site999.example"));
    assert!(!parsed.whitelist.is_whitelisted("site999.example"));
}

#[test]
fn over_long_lines_are_rejected_and_their_content_is_shortened() {
    let line = format!("{}.example", "a".repeat(MAX_LINE_BYTES));
    let result = validate_content(&line);
    assert_eq!(result.errors[0].code, WhitelistProblemCode::LineTooLong);
    assert_eq!(result.errors[0].content, format!("{}...", "a".repeat(200)));
    assert!(validate_content(&format!("example.com # {}", "a".repeat(MAX_LINE_BYTES))).valid);
}

#[test]
fn the_input_ceiling_is_enforced_for_text_and_for_readers() {
    let mut content = " ".repeat(MAX_WHITELIST_BYTES - "example.com".len());
    content.push_str("example.com");
    assert!(validate_reader(content.as_bytes()).unwrap().valid);
    content.push(' ');
    let from_reader = validate_reader(content.as_bytes()).unwrap();
    assert_eq!(
        from_reader.errors[0].code,
        WhitelistProblemCode::InputTooLarge
    );
    assert_eq!(from_reader.errors[0].line, None);
    assert_eq!(
        validate_content(&content).errors[0].code,
        WhitelistProblemCode::InputTooLarge
    );
}

struct EndlessInput {
    bytes_read: usize,
}

impl Read for EndlessInput {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        output.fill(b' ');
        self.bytes_read += output.len();
        Ok(output.len())
    }
}

#[test]
fn the_reader_stops_one_byte_past_the_ceiling() {
    let mut input = EndlessInput { bytes_read: 0 };
    let result = validate_reader(&mut input).unwrap();
    assert!(!result.valid);
    assert_eq!(input.bytes_read, MAX_WHITELIST_BYTES + 1);
}

struct FailedInput;

impl Read for FailedInput {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("read failed"))
    }
}

#[test]
fn unreadable_input_and_unwritable_output_are_failures_and_bad_bytes_are_invalid() {
    assert!(validate_reader(FailedInput).is_err());
    assert!(run(FailedInput, io::sink()).is_err());
    assert!(run("example.com".as_bytes(), &mut [0_u8; 1][..]).is_err());

    let mut output = Vec::new();
    assert_eq!(run([0xff].as_slice(), &mut output).unwrap(), EXIT_INVALID);
    let printed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(printed["errors"][0]["code"], "invalid_utf8");
    assert_eq!(printed["errors"][0]["line"], serde_json::Value::Null);
    assert_eq!(output.last(), Some(&b'\n'));
}

#[test]
#[ignore = "timing run, prints wall time for 2 million domains"]
fn matcher_timing_over_two_million_domains() {
    let mut lines = Vec::new();
    for k in 0..450 {
        lines.push(format!("@@site{}.tld{}.net", k, k % 50));
    }
    for r in 0..30 {
        lines.push(format!("/^n[0-9]+\\.site9{r:04}\\.tld[0-9]+\\.net$/"));
    }
    for w in 0..10 {
        lines.push(format!("*.site8000{w}.tld{w}.net"));
    }
    let domains: HashSet<String> = (0..2_000_000u32)
        .map(|i| format!("n{}.site{}.tld{}.net", i, i % 100_000, i % 50))
        .collect();

    let started = Instant::now();
    let parsed = WhitelistManager::parse(&lines.join("\n"));
    assert!(parsed.problems.is_empty());
    let parse_time = started.elapsed();
    let (remaining, removed) = parsed.whitelist.partition(domains);
    let partition_time = started.elapsed() - parse_time;
    let removed: HashSet<String> = removed.into_iter().collect();
    let matches = parsed.whitelist.pattern_matches(&removed);
    println!(
        "removed={} remaining={} patterns_reported={} parse={:?} partition={:?} total={:?}",
        removed.len(),
        remaining.len(),
        matches.len(),
        parse_time,
        partition_time,
        started.elapsed()
    );
    assert_eq!(removed.len(), 9800);
    assert_eq!(remaining.len(), 1_990_200);
}
