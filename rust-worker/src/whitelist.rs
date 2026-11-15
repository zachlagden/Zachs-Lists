use rayon::prelude::*;
use regex::{Regex, RegexBuilder, RegexSet, RegexSetBuilder};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use tracing::{debug, info, warn};

use crate::cancellation::{Cancellation, Cancelled, WORK_GRAIN};
use crate::db::progress::{WhitelistPatternMatch, WhitelistProgress};

pub const MAX_WHITELIST_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_LINE_BYTES: usize = 1024;
pub const MAX_COMPILED_PATTERNS: usize = 250;
pub const REGEX_SIZE_LIMIT_BYTES: usize = 256 * 1024;
pub const MAX_REPORTED_PROBLEMS: usize = 100;
pub const MAX_REPORTED_PATTERNS: usize = 20;
pub const SAMPLES_PER_PATTERN: usize = 5;
const PROBLEM_CONTENT_CHARS: usize = 200;
const MAX_DOMAIN_BYTES: usize = 253;
const MAX_LABEL_BYTES: usize = 63;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum WhitelistProblemCode {
    InputTooLarge,
    InvalidUtf8,
    LineTooLong,
    InvalidDomain,
    InvalidWildcard,
    MalformedRegex,
    InvalidRegex,
    UnsupportedRegex,
    RegexTooLarge,
    TooManyRegexPatterns,
}

impl WhitelistProblemCode {
    fn default_message(self) -> String {
        match self {
            Self::InputTooLarge => "Whitelist is larger than the 10 MiB limit".to_string(),
            Self::InvalidUtf8 => "Whitelist must be valid UTF-8 text".to_string(),
            Self::LineTooLong => format!("Line is longer than {MAX_LINE_BYTES} bytes"),
            Self::InvalidDomain => "Not a valid domain. Use letters, digits, hyphens and dots, \
                 such as example.com, and write internationalised names in punycode"
                .to_string(),
            Self::InvalidWildcard => "Not a valid wildcard. Use * with letters, digits, hyphens \
                 and dots, such as *.example.com"
                .to_string(),
            Self::MalformedRegex => "A regex must start and end with / and have a pattern \
                 between them. Write a literal # as \\x23, because # starts a comment"
                .to_string(),
            Self::InvalidRegex => "Invalid regex".to_string(),
            Self::UnsupportedRegex => {
                "This regex feature is not supported. Patterns use Rust regex syntax".to_string()
            }
            Self::RegexTooLarge => "Regex is too large once compiled. Simplify it or split it \
                 into several patterns"
                .to_string(),
            Self::TooManyRegexPatterns => format!(
                "Only {MAX_COMPILED_PATTERNS} regex and partial wildcard patterns are allowed"
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WhitelistProblem {
    pub line: Option<usize>,
    pub content: String,
    pub code: WhitelistProblemCode,
    pub message: String,
}

impl WhitelistProblem {
    pub fn for_input(code: WhitelistProblemCode) -> Self {
        Self {
            line: None,
            content: String::new(),
            code,
            message: code.default_message(),
        }
    }

    fn for_line(line: usize, entry: &str, rejection: Rejection) -> Self {
        let mut content: String = entry.chars().take(PROBLEM_CONTENT_CHARS).collect();
        if content.len() < entry.len() {
            content.push_str("...");
        }
        Self {
            line: Some(line),
            content,
            code: rejection.code,
            message: rejection.message,
        }
    }

    pub fn as_warning(&self) -> String {
        match self.line {
            Some(line) => format!("Whitelist line {line} was ignored: {}", self.message),
            None => format!("Whitelist was ignored: {}", self.message),
        }
    }
}

struct Rejection {
    code: WhitelistProblemCode,
    message: String,
}

impl From<WhitelistProblemCode> for Rejection {
    fn from(code: WhitelistProblemCode) -> Self {
        Self {
            code,
            message: code.default_message(),
        }
    }
}

impl From<&regex::Error> for Rejection {
    fn from(error: &regex::Error) -> Self {
        if matches!(error, regex::Error::CompiledTooBig(_)) {
            return WhitelistProblemCode::RegexTooLarge.into();
        }
        let description = error.to_string();
        let detail = description
            .lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix("error: "));
        match detail {
            Some(detail) if detail.contains("look-around") => Self {
                code: WhitelistProblemCode::UnsupportedRegex,
                message: "Lookahead and lookbehind are not supported. Patterns use Rust regex \
                          syntax"
                    .to_string(),
            },
            Some(detail) if detail.contains("backreference") => Self {
                code: WhitelistProblemCode::UnsupportedRegex,
                message: "Backreferences are not supported. Patterns use Rust regex syntax"
                    .to_string(),
            },
            Some(detail) => Self {
                code: WhitelistProblemCode::InvalidRegex,
                message: format!("Invalid regex: {detail}"),
            },
            None => WhitelistProblemCode::InvalidRegex.into(),
        }
    }
}

fn valid_domain(domain: &str) -> bool {
    if domain.len() > MAX_DOMAIN_BYTES || !domain.contains('.') {
        return false;
    }
    domain.split('.').all(|label| {
        let bytes = label.as_bytes();
        match (bytes.first(), bytes.last()) {
            (Some(first), Some(last)) => {
                bytes.len() <= MAX_LABEL_BYTES
                    && first.is_ascii_alphanumeric()
                    && last.is_ascii_alphanumeric()
                    && bytes
                        .iter()
                        .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
            }
            _ => false,
        }
    })
}

fn valid_wildcard(pattern: &str) -> bool {
    pattern.split('.').all(|label| {
        let bytes = label.as_bytes();
        match (bytes.first(), bytes.last()) {
            (Some(first), Some(last)) => {
                *first != b'-'
                    && *last != b'-'
                    && bytes
                        .iter()
                        .all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'*')
            }
            _ => false,
        }
    })
}

fn wildcard_regex(pattern: &str) -> String {
    format!("^{}$", regex::escape(pattern).replace(r"\*", ".*"))
}

fn label_suffixes(domain: &str) -> impl Iterator<Item = &str> {
    std::iter::successors(Some(domain), |rest| {
        rest.split_once('.').map(|(_, parent)| parent)
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PatternType {
    Exact,
    Wildcard,
    Regex,
    Subdomain,
}

impl std::fmt::Display for PatternType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PatternType::Exact => write!(f, "exact"),
            PatternType::Wildcard => write!(f, "wildcard"),
            PatternType::Regex => write!(f, "regex"),
            PatternType::Subdomain => write!(f, "subdomain"),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct PatternCounts {
    pub exact: usize,
    pub subdomain: usize,
    pub wildcard: usize,
    pub regex: usize,
}

#[derive(Debug, Clone)]
struct Pattern {
    original: String,
    normalized: String,
    pattern_type: PatternType,
}

#[derive(Debug, Clone, Copy, Default)]
struct SuffixRule {
    with_domain_itself: Option<usize>,
    subdomains_only: Option<usize>,
}

#[derive(Debug)]
struct CompiledPattern {
    pattern_index: usize,
    regex: Regex,
}

#[derive(Debug, Default)]
pub struct WhitelistManager {
    patterns: Vec<Pattern>,
    exact: HashMap<String, usize>,
    suffix_rules: HashMap<String, SuffixRule>,
    compiled: Vec<CompiledPattern>,
    compiled_set: Option<RegexSet>,
}

#[derive(Debug)]
pub struct ParsedWhitelist {
    pub whitelist: WhitelistManager,
    pub problems: Vec<WhitelistProblem>,
}

#[derive(Default)]
struct PatternTally<'a> {
    by_pattern: HashMap<usize, (u64, Vec<&'a str>)>,
}

impl<'a> PatternTally<'a> {
    fn record(&mut self, pattern_index: usize, domain: &'a str) {
        let (count, samples) = self.by_pattern.entry(pattern_index).or_default();
        *count += 1;
        Self::offer_sample(samples, domain);
    }

    fn offer_sample(samples: &mut Vec<&'a str>, domain: &'a str) {
        let position = samples.partition_point(|sample| *sample < domain);
        if position < SAMPLES_PER_PATTERN {
            samples.insert(position, domain);
            samples.truncate(SAMPLES_PER_PATTERN);
        }
    }

    fn merge(mut self, other: Self) -> Self {
        for (pattern_index, (other_count, other_samples)) in other.by_pattern {
            let (count, samples) = self.by_pattern.entry(pattern_index).or_default();
            *count += other_count;
            for sample in other_samples {
                Self::offer_sample(samples, sample);
            }
        }
        self
    }
}

impl WhitelistManager {
    pub fn parse(content: &str) -> ParsedWhitelist {
        let mut whitelist = Self::default();
        let mut problems = Vec::new();
        let mut seen = HashSet::new();

        for (index, raw_line) in content.lines().enumerate() {
            let entry = raw_line.split('#').next().unwrap_or_default().trim();
            if entry.is_empty() {
                continue;
            }
            if let Err(rejection) = whitelist.add_entry(entry, &mut seen) {
                problems.push(WhitelistProblem::for_line(index + 1, entry, rejection));
            }
        }

        whitelist.compile_set();

        let counts = whitelist.pattern_counts();
        info!(
            "Loaded {} whitelist patterns ({} exact, {} subdomain, {} wildcard, {} regex), {} lines ignored",
            whitelist.patterns.len(),
            counts.exact,
            counts.subdomain,
            counts.wildcard,
            counts.regex,
            problems.len()
        );

        ParsedWhitelist {
            whitelist,
            problems,
        }
    }

    fn add_entry(&mut self, entry: &str, seen: &mut HashSet<String>) -> Result<(), Rejection> {
        if entry.len() > MAX_LINE_BYTES {
            return Err(WhitelistProblemCode::LineTooLong.into());
        }
        let pattern_index = self.patterns.len();

        let (pattern_type, normalized) = if entry.starts_with('/') {
            if entry.len() <= 2 || !entry.ends_with('/') {
                return Err(WhitelistProblemCode::MalformedRegex.into());
            }
            if seen.contains(entry) {
                return Ok(());
            }
            self.compile(pattern_index, &entry[1..entry.len() - 1])?;
            (PatternType::Regex, entry.to_string())
        } else if let Some(domain) = entry.strip_prefix("@@") {
            if !valid_domain(domain) {
                return Err(WhitelistProblemCode::InvalidDomain.into());
            }
            let domain = domain.to_ascii_lowercase();
            let normalized = format!("@@{domain}");
            if seen.contains(&normalized) {
                return Ok(());
            }
            self.suffix_rules
                .entry(domain)
                .or_default()
                .with_domain_itself = Some(pattern_index);
            (PatternType::Subdomain, normalized)
        } else if entry.contains('*') {
            if !valid_wildcard(entry) {
                return Err(WhitelistProblemCode::InvalidWildcard.into());
            }
            let normalized = entry.to_ascii_lowercase();
            if seen.contains(&normalized) {
                return Ok(());
            }
            match normalized.strip_prefix("*.") {
                Some(parent) if !parent.contains('*') => {
                    self.suffix_rules
                        .entry(parent.to_string())
                        .or_default()
                        .subdomains_only = Some(pattern_index);
                }
                _ => self.compile(pattern_index, &wildcard_regex(&normalized))?,
            }
            (PatternType::Wildcard, normalized)
        } else {
            if !valid_domain(entry) {
                return Err(WhitelistProblemCode::InvalidDomain.into());
            }
            let normalized = entry.to_ascii_lowercase();
            if seen.contains(&normalized) {
                return Ok(());
            }
            self.exact.insert(normalized.clone(), pattern_index);
            (PatternType::Exact, normalized)
        };

        seen.insert(normalized.clone());
        self.patterns.push(Pattern {
            original: entry.to_string(),
            normalized,
            pattern_type,
        });
        Ok(())
    }

    fn compile(&mut self, pattern_index: usize, source: &str) -> Result<(), Rejection> {
        if self.compiled.len() >= MAX_COMPILED_PATTERNS {
            return Err(WhitelistProblemCode::TooManyRegexPatterns.into());
        }
        let regex = RegexBuilder::new(source)
            .size_limit(REGEX_SIZE_LIMIT_BYTES)
            .build()
            .map_err(|error| Rejection::from(&error))?;
        self.compiled.push(CompiledPattern {
            pattern_index,
            regex,
        });
        Ok(())
    }

    fn compile_set(&mut self) {
        if self.compiled.len() < 2 {
            return;
        }
        let sources = self.compiled.iter().map(|compiled| compiled.regex.as_str());
        match RegexSetBuilder::new(sources)
            .size_limit(REGEX_SIZE_LIMIT_BYTES * self.compiled.len())
            .build()
        {
            Ok(set) => self.compiled_set = Some(set),
            Err(error) => warn!(
                "Whitelist regex set did not compile, matching each of {} regexes separately: {}",
                self.compiled.len(),
                Rejection::from(&error).message
            ),
        }
    }

    pub fn pattern_counts(&self) -> PatternCounts {
        let mut counts = PatternCounts::default();
        for pattern in &self.patterns {
            match pattern.pattern_type {
                PatternType::Exact => counts.exact += 1,
                PatternType::Subdomain => counts.subdomain += 1,
                PatternType::Wildcard => counts.wildcard += 1,
                PatternType::Regex => counts.regex += 1,
            }
        }
        counts
    }

    #[inline]
    pub fn is_whitelisted(&self, domain: &str) -> bool {
        if self.exact.contains_key(domain) {
            return true;
        }
        if !self.suffix_rules.is_empty() {
            for (depth, suffix) in label_suffixes(domain).enumerate() {
                if let Some(rule) = self.suffix_rules.get(suffix) {
                    if rule.with_domain_itself.is_some()
                        || (depth > 0 && rule.subdomains_only.is_some())
                    {
                        return true;
                    }
                }
            }
        }
        match &self.compiled_set {
            Some(set) => set.is_match(domain),
            None => self
                .compiled
                .iter()
                .any(|compiled| compiled.regex.is_match(domain)),
        }
    }

    fn for_each_matching_pattern(&self, domain: &str, mut found: impl FnMut(usize)) {
        if let Some(pattern_index) = self.exact.get(domain) {
            found(*pattern_index);
        }
        if !self.suffix_rules.is_empty() {
            for (depth, suffix) in label_suffixes(domain).enumerate() {
                if let Some(rule) = self.suffix_rules.get(suffix) {
                    if let Some(pattern_index) = rule.with_domain_itself {
                        found(pattern_index);
                    }
                    if let Some(pattern_index) = rule.subdomains_only.filter(|_| depth > 0) {
                        found(pattern_index);
                    }
                }
            }
        }
        match &self.compiled_set {
            Some(set) => {
                for compiled_index in set.matches(domain) {
                    found(self.compiled[compiled_index].pattern_index);
                }
            }
            None => {
                for compiled in &self.compiled {
                    if compiled.regex.is_match(domain) {
                        found(compiled.pattern_index);
                    }
                }
            }
        }
    }

    pub fn pattern_count(&self) -> usize {
        self.patterns.len()
    }

    #[cfg(test)]
    pub fn partition(&self, domains: HashSet<String>) -> (HashSet<String>, Vec<String>) {
        self.partition_reporting(domains, &Cancellation::default(), &|_, _| {})
            .unwrap()
    }

    pub fn partition_reporting(
        &self,
        domains: HashSet<String>,
        cancellation: &Cancellation,
        report_checked: &(dyn Fn(usize, &[String]) + Send + Sync),
    ) -> Result<(HashSet<String>, Vec<String>), Cancelled> {
        if self.patterns.is_empty() {
            return Ok((domains, Vec::new()));
        }
        let total = domains.len();
        let unchecked: Vec<String> = domains.into_iter().collect();
        let checked: Vec<(Vec<String>, Vec<String>)> = unchecked
            .into_par_iter()
            .chunks(WORK_GRAIN)
            .map(|chunk| {
                cancellation.check()?;
                let checked = chunk.len();
                let (removed, remaining): (Vec<String>, Vec<String>) = chunk
                    .into_iter()
                    .partition(|domain| self.is_whitelisted(domain));
                report_checked(checked, &removed);
                Ok((remaining, removed))
            })
            .collect::<Result<_, Cancelled>>()?;

        let removed_total = checked.iter().map(|(_, removed)| removed.len()).sum();
        let mut remaining = HashSet::with_capacity(total - removed_total);
        let mut removed = Vec::with_capacity(removed_total);
        for (kept, dropped) in checked {
            cancellation.check()?;
            remaining.extend(kept);
            removed.extend(dropped);
        }
        debug!(
            "Whitelist filtering: {} remaining, {} removed (from {})",
            remaining.len(),
            removed.len(),
            total
        );
        Ok((remaining, removed))
    }

    #[cfg(test)]
    pub fn pattern_matches(&self, removed: &HashSet<String>) -> Vec<WhitelistPatternMatch> {
        self.pattern_matches_until_cancelled(removed, &Cancellation::default())
            .unwrap()
    }

    pub fn pattern_matches_until_cancelled(
        &self,
        removed: &HashSet<String>,
        cancellation: &Cancellation,
    ) -> Result<Vec<WhitelistPatternMatch>, Cancelled> {
        let tally = removed
            .par_iter()
            .try_fold(PatternTally::default, |mut tally, domain| {
                cancellation.check()?;
                self.for_each_matching_pattern(domain, |pattern_index| {
                    tally.record(pattern_index, domain.as_str())
                });
                Ok(tally)
            })
            .try_reduce(PatternTally::default, |left, right| Ok(left.merge(right)))?;

        let mut ranked: Vec<(usize, u64, Vec<&str>)> = tally
            .by_pattern
            .into_iter()
            .map(|(pattern_index, (count, samples))| (pattern_index, count, samples))
            .collect();
        ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        ranked.truncate(MAX_REPORTED_PATTERNS);

        Ok(ranked
            .into_iter()
            .map(|(pattern_index, match_count, samples)| {
                let pattern = &self.patterns[pattern_index];
                WhitelistPatternMatch {
                    pattern: pattern.original.clone(),
                    pattern_type: pattern.pattern_type.to_string(),
                    match_count,
                    samples: samples.into_iter().map(str::to_string).collect(),
                }
            })
            .collect())
    }

    pub fn create_progress(
        &self,
        domains_before: u64,
        domains_after: u64,
        pattern_matches: Vec<WhitelistPatternMatch>,
        warnings: Vec<String>,
    ) -> WhitelistProgress {
        WhitelistProgress {
            domains_before,
            domains_after,
            domains_checked: domains_before,
            total_removed: domains_before.saturating_sub(domains_after),
            processing: false,
            patterns_total: self.patterns.len() as u64,
            patterns: pattern_matches,
            warnings,
        }
    }

    pub fn patterns_as_strings(&self) -> Vec<String> {
        let mut patterns: Vec<String> = self
            .patterns
            .iter()
            .map(|pattern| pattern.normalized.clone())
            .collect();
        patterns.sort();
        patterns
    }
}

pub fn job_warnings(problems: &[WhitelistProblem]) -> Vec<String> {
    let mut warnings: Vec<String> = problems
        .iter()
        .take(MAX_REPORTED_PROBLEMS)
        .map(WhitelistProblem::as_warning)
        .collect();
    if problems.len() > MAX_REPORTED_PROBLEMS {
        warnings.push(format!(
            "{} more whitelist lines were ignored",
            problems.len() - MAX_REPORTED_PROBLEMS
        ));
    }
    warnings
}
