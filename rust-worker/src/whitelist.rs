use rayon::prelude::*;
use regex::{Regex, RegexSet};
use serde::Serialize;
use std::collections::HashSet;
use tracing::{debug, info, warn};

use crate::db::progress::{WhitelistPatternMatch, WhitelistProgress};

pub const MAX_WHITELIST_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WhitelistErrorCode {
    InputTooLarge,
    InvalidUtf8,
    InputReadFailed,
    InvalidDomain,
    InvalidWildcard,
    MalformedRegex,
    InvalidRegex,
    RegexCompileLimit,
    RegexSetCompileFailed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WhitelistValidationError {
    pub line: Option<usize>,
    pub code: WhitelistErrorCode,
    pub message: String,
}

impl WhitelistValidationError {
    pub fn new(line: Option<usize>, code: WhitelistErrorCode) -> Self {
        let message = match code {
            WhitelistErrorCode::InputTooLarge => "Whitelist exceeds the 10 MiB input limit",
            WhitelistErrorCode::InvalidUtf8 => "Whitelist must be valid UTF-8",
            WhitelistErrorCode::InputReadFailed => "Could not read whitelist input",
            WhitelistErrorCode::InvalidDomain => "Invalid domain pattern",
            WhitelistErrorCode::InvalidWildcard => "Invalid wildcard pattern",
            WhitelistErrorCode::MalformedRegex => "Regex must be nonempty and enclosed in slashes",
            WhitelistErrorCode::InvalidRegex => "Invalid or unsupported Rust regex syntax",
            WhitelistErrorCode::RegexCompileLimit => {
                "Regex exceeds the Rust regex compilation limit"
            }
            WhitelistErrorCode::RegexSetCompileFailed => {
                "Patterns exceed the Rust regex set compilation limit"
            }
        };
        Self {
            line,
            code,
            message: message.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct WhitelistValidationFailure {
    pub validated_count: usize,
    pub errors: Vec<WhitelistValidationError>,
}

impl std::fmt::Display for WhitelistValidationFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Whitelist validation failed with {} error(s)",
            self.errors.len()
        )
    }
}

impl std::error::Error for WhitelistValidationFailure {}

fn valid_domain(domain: &str) -> bool {
    if domain.len() > 253 || !domain.contains('.') {
        return false;
    }
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.as_bytes()[0].is_ascii_alphanumeric()
            && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

fn valid_wildcard(pattern: &str) -> bool {
    pattern.split('.').all(|label| {
        !label.is_empty()
            && label.as_bytes()[0] != b'-'
            && label.as_bytes()[label.len() - 1] != b'-'
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'*')
    })
}

fn wildcard_regex(pattern: &str) -> String {
    format!("^{}$", regex::escape(pattern).replace(r"\*", ".*"))
}

/// Pattern type for whitelist entries
#[derive(Debug, Clone, PartialEq)]
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

/// Original pattern info for progress reporting
#[derive(Debug, Clone)]
pub struct PatternInfo {
    pub original: String,
    pub pattern_type: PatternType,
}

/// Optimized whitelist manager with O(1) exact lookups and batch regex matching
pub struct WhitelistManager {
    /// O(1) lookup for exact domain matches
    exact_patterns: HashSet<String>,
    /// Subdomain patterns with pre-computed ".suffix" (no allocation during matching)
    subdomain_patterns: Vec<(String, String)>, // (exact, ".suffix")
    /// Batch regex matching for wildcard and regex patterns
    regex_set: Option<RegexSet>,
    /// Original patterns for progress reporting
    all_patterns: Vec<PatternInfo>,
}

impl WhitelistManager {
    /// Create empty whitelist manager
    pub fn new() -> Self {
        Self {
            exact_patterns: HashSet::new(),
            subdomain_patterns: Vec::new(),
            regex_set: None,
            all_patterns: Vec::new(),
        }
    }

    pub fn try_from_content(content: &str) -> Result<Self, WhitelistValidationFailure> {
        if content.len() > MAX_WHITELIST_BYTES {
            return Err(WhitelistValidationFailure {
                validated_count: 0,
                errors: vec![WhitelistValidationError::new(
                    None,
                    WhitelistErrorCode::InputTooLarge,
                )],
            });
        }

        let mut manager = Self::new();
        let mut regex_strings = Vec::new();
        let mut regex_lines = Vec::new();
        let mut errors = Vec::new();
        let mut validated_count = 0;

        for (index, line) in content.lines().enumerate() {
            let pattern = line.split('#').next().unwrap_or_default().trim();
            if pattern.is_empty() {
                continue;
            }
            validated_count += 1;
            let line_number = index + 1;
            let (pattern_type, regex_string) = if pattern.starts_with('/') || pattern.ends_with('/')
            {
                if pattern.len() <= 2 || !pattern.starts_with('/') || !pattern.ends_with('/') {
                    errors.push(WhitelistValidationError::new(
                        Some(line_number),
                        WhitelistErrorCode::MalformedRegex,
                    ));
                    continue;
                }
                (
                    PatternType::Regex,
                    Some(pattern[1..pattern.len() - 1].to_string()),
                )
            } else if let Some(domain) = pattern.strip_prefix("@@") {
                if !valid_domain(domain) {
                    errors.push(WhitelistValidationError::new(
                        Some(line_number),
                        WhitelistErrorCode::InvalidDomain,
                    ));
                    continue;
                }
                let domain = domain.to_ascii_lowercase();
                manager
                    .subdomain_patterns
                    .push((domain.clone(), format!(".{}", domain)));
                (PatternType::Subdomain, None)
            } else if pattern.contains('*') {
                if !valid_wildcard(pattern) {
                    errors.push(WhitelistValidationError::new(
                        Some(line_number),
                        WhitelistErrorCode::InvalidWildcard,
                    ));
                    continue;
                }
                (PatternType::Wildcard, Some(wildcard_regex(pattern)))
            } else {
                if !valid_domain(pattern) {
                    errors.push(WhitelistValidationError::new(
                        Some(line_number),
                        WhitelistErrorCode::InvalidDomain,
                    ));
                    continue;
                }
                manager.exact_patterns.insert(pattern.to_ascii_lowercase());
                (PatternType::Exact, None)
            };

            if let Some(regex_string) = regex_string {
                if let Err(error) = Regex::new(&regex_string) {
                    let code = match error {
                        regex::Error::CompiledTooBig(_) => WhitelistErrorCode::RegexCompileLimit,
                        _ => WhitelistErrorCode::InvalidRegex,
                    };
                    errors.push(WhitelistValidationError::new(Some(line_number), code));
                    continue;
                }
                regex_strings.push(regex_string);
                regex_lines.push(line_number);
            }
            manager.all_patterns.push(PatternInfo {
                original: pattern.to_string(),
                pattern_type,
            });
        }

        if !errors.is_empty() {
            return Err(WhitelistValidationFailure {
                validated_count,
                errors,
            });
        }
        if !regex_strings.is_empty() {
            match RegexSet::new(&regex_strings) {
                Ok(set) => manager.regex_set = Some(set),
                Err(_) => {
                    return Err(WhitelistValidationFailure {
                        validated_count,
                        errors: regex_lines
                            .into_iter()
                            .map(|line| {
                                WhitelistValidationError::new(
                                    Some(line),
                                    WhitelistErrorCode::RegexSetCompileFailed,
                                )
                            })
                            .collect(),
                    });
                }
            }
        }
        Ok(manager)
    }

    pub fn pattern_count(&self) -> usize {
        self.all_patterns.len()
    }

    /// Load whitelist from content string (optimized structure)
    #[deprecated(note = "Use try_from_content for validation, execution and fingerprinting")]
    pub fn from_content(content: &str) -> Self {
        let mut exact_patterns = HashSet::new();
        let mut subdomain_patterns = Vec::new();
        let mut regex_strings = Vec::new();
        let mut all_patterns = Vec::new();

        for line in content.lines() {
            let line = line.trim();
            // Strip inline comments (e.g., "domain.com # comment")
            let pattern = match line.find('#') {
                Some(idx) => line[..idx].trim(),
                None => line,
            };
            if pattern.is_empty() {
                continue;
            }

            // Regex pattern: /pattern/
            if pattern.starts_with('/') && pattern.ends_with('/') && pattern.len() > 2 {
                let regex_str = &pattern[1..pattern.len() - 1];
                regex_strings.push(regex_str.to_string());
                all_patterns.push(PatternInfo {
                    original: pattern.to_string(),
                    pattern_type: PatternType::Regex,
                });
            }
            // Subdomain pattern: @@domain.com
            else if pattern.starts_with("@@") {
                let domain = pattern.trim_start_matches("@@").to_lowercase();
                let dotted = format!(".{}", domain);
                subdomain_patterns.push((domain, dotted));
                all_patterns.push(PatternInfo {
                    original: pattern.to_string(),
                    pattern_type: PatternType::Subdomain,
                });
            }
            // Wildcard pattern: *.domain.com
            else if pattern.contains('*') {
                let regex_str = format!("^{}$", regex::escape(pattern).replace(r"\*", ".*"));
                regex_strings.push(regex_str);
                all_patterns.push(PatternInfo {
                    original: pattern.to_string(),
                    pattern_type: PatternType::Wildcard,
                });
            }
            // Exact match
            else {
                exact_patterns.insert(pattern.to_lowercase());
                all_patterns.push(PatternInfo {
                    original: pattern.to_string(),
                    pattern_type: PatternType::Exact,
                });
            }
        }

        // Build RegexSet for batch matching
        let regex_set = if !regex_strings.is_empty() {
            match RegexSet::new(&regex_strings) {
                Ok(set) => Some(set),
                Err(e) => {
                    warn!("Failed to compile regex set: {}", e);
                    None
                }
            }
        } else {
            None
        };

        info!(
            "Loaded {} whitelist patterns ({} exact, {} subdomain, {} regex/wildcard)",
            all_patterns.len(),
            exact_patterns.len(),
            subdomain_patterns.len(),
            regex_strings.len()
        );

        Self {
            exact_patterns,
            subdomain_patterns,
            regex_set,
            all_patterns,
        }
    }

    /// Check if a domain is whitelisted (optimized: O(1) for exact, then linear for subdomain/regex)
    #[inline]
    pub fn is_whitelisted(&self, domain: &str) -> bool {
        // O(1) exact match check
        if self.exact_patterns.contains(domain) {
            return true;
        }

        // Subdomain check with pre-computed suffixes (no allocation)
        for (exact, dotted) in &self.subdomain_patterns {
            if domain == exact || domain.ends_with(dotted.as_str()) {
                return true;
            }
        }

        // Batch regex check (single operation checks all regex patterns)
        if let Some(ref regex_set) = self.regex_set {
            if regex_set.is_match(domain) {
                return true;
            }
        }

        false
    }

    /// Check if domain matches a specific pattern
    fn matches_pattern(&self, domain: &str, pattern: &PatternInfo) -> bool {
        match pattern.pattern_type {
            PatternType::Exact => pattern.original.to_lowercase() == domain,
            PatternType::Subdomain => {
                let suffix = pattern.original.trim_start_matches("@@").to_lowercase();
                let dotted = format!(".{}", suffix);
                domain == suffix || domain.ends_with(&dotted)
            }
            PatternType::Wildcard => {
                // Convert wildcard to regex and match
                let regex_str = format!(
                    "^{}$",
                    regex::escape(&pattern.original).replace(r"\*", ".*")
                );
                if let Ok(re) = regex::Regex::new(&regex_str) {
                    re.is_match(domain)
                } else {
                    false
                }
            }
            PatternType::Regex => {
                // Compile and match the specific regex
                let regex_str = &pattern.original[1..pattern.original.len() - 1];
                if let Ok(re) = regex::Regex::new(regex_str) {
                    re.is_match(domain)
                } else {
                    false
                }
            }
        }
    }

    /// Filter domains, removing whitelisted ones (parallel, optimized)
    /// Returns (remaining_domains, removed_count, pattern_matches)
    pub fn filter_domains(
        &self,
        domains: HashSet<String>,
    ) -> (HashSet<String>, u64, Vec<WhitelistPatternMatch>) {
        if self.all_patterns.is_empty() {
            return (domains, 0, Vec::new());
        }

        let total = domains.len();

        // Partition into remaining and removed
        let (remaining, removed_domains): (HashSet<String>, Vec<String>) =
            domains.into_par_iter().partition_map(|domain| {
                if self.is_whitelisted(&domain) {
                    rayon::iter::Either::Right(domain)
                } else {
                    rayon::iter::Either::Left(domain)
                }
            });

        let removed = removed_domains.len() as u64;

        debug!(
            "Whitelist filtering: {} remaining, {} removed (from {})",
            remaining.len(),
            removed,
            total
        );

        // Count matches per pattern, deduplicating by pattern string
        use std::collections::HashMap;
        let mut pattern_counts: HashMap<String, (String, u64)> = HashMap::new();

        for p in &self.all_patterns {
            let count = removed_domains
                .iter()
                .filter(|d| self.matches_pattern(d, p))
                .count() as u64;

            if count > 0 {
                pattern_counts
                    .entry(p.original.clone())
                    .or_insert((p.pattern_type.to_string(), count));
            }
        }

        let mut pattern_matches: Vec<WhitelistPatternMatch> = pattern_counts
            .into_iter()
            .map(
                |(pattern, (pattern_type, match_count))| WhitelistPatternMatch {
                    pattern,
                    pattern_type,
                    match_count,
                    samples: Vec::new(),
                },
            )
            .collect();

        // Sort by match count descending
        pattern_matches.sort_by(|a, b| b.match_count.cmp(&a.match_count));

        // Limit to top 20
        pattern_matches.truncate(20);

        (remaining, removed, pattern_matches)
    }

    /// Whitelist removal stats over borrowed domains, without building the
    /// filtered set. Equivalent to the (removed, pattern_matches) half of
    /// filter_domains, but never clones the domains it inspects.
    pub fn filter_stats<'a>(&self, domains: &[&'a String]) -> (u64, Vec<WhitelistPatternMatch>) {
        if self.all_patterns.is_empty() {
            return (0, Vec::new());
        }

        let removed_domains: Vec<&&String> = domains
            .par_iter()
            .filter(|domain| self.is_whitelisted(domain))
            .collect();

        let removed = removed_domains.len() as u64;

        debug!(
            "Whitelist stats: {} removed (from {})",
            removed,
            domains.len()
        );

        use std::collections::HashMap;
        let mut pattern_counts: HashMap<String, (String, u64)> = HashMap::new();

        for p in &self.all_patterns {
            let count = removed_domains
                .iter()
                .filter(|d| self.matches_pattern(d, p))
                .count() as u64;

            if count > 0 {
                pattern_counts
                    .entry(p.original.clone())
                    .or_insert((p.pattern_type.to_string(), count));
            }
        }

        let mut pattern_matches: Vec<WhitelistPatternMatch> = pattern_counts
            .into_iter()
            .map(
                |(pattern, (pattern_type, match_count))| WhitelistPatternMatch {
                    pattern,
                    pattern_type,
                    match_count,
                    samples: Vec::new(),
                },
            )
            .collect();

        pattern_matches.sort_by(|a, b| b.match_count.cmp(&a.match_count));
        pattern_matches.truncate(20);

        (removed, pattern_matches)
    }

    /// Create progress report for whitelist stage
    pub fn create_progress(
        &self,
        domains_before: u64,
        domains_after: u64,
        pattern_matches: Vec<WhitelistPatternMatch>,
    ) -> WhitelistProgress {
        WhitelistProgress {
            domains_before,
            domains_after,
            total_removed: domains_before.saturating_sub(domains_after),
            processing: false,
            patterns: pattern_matches,
        }
    }

    /// Export all patterns as normalized strings for fingerprint computation
    /// Returns patterns sorted for consistent hashing
    pub fn patterns_as_strings(&self) -> Vec<String> {
        let mut patterns: Vec<String> = self
            .all_patterns
            .iter()
            .map(|p| match p.pattern_type {
                PatternType::Exact | PatternType::Subdomain => p.original.to_ascii_lowercase(),
                PatternType::Wildcard | PatternType::Regex => p.original.clone(),
            })
            .collect();
        patterns.sort();
        patterns
    }

    /// Check if whitelist is empty
    pub fn is_empty(&self) -> bool {
        self.all_patterns.is_empty()
    }
}

impl Default for WhitelistManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_pattern() {
        let manager = WhitelistManager::from_content("example.com");
        assert!(manager.is_whitelisted("example.com"));
        assert!(!manager.is_whitelisted("sub.example.com"));
        assert!(!manager.is_whitelisted("example.org"));
    }

    #[test]
    fn test_subdomain_pattern() {
        let manager = WhitelistManager::from_content("@@example.com");
        assert!(manager.is_whitelisted("example.com"));
        assert!(manager.is_whitelisted("sub.example.com"));
        assert!(manager.is_whitelisted("a.b.c.example.com"));
        assert!(!manager.is_whitelisted("example.org"));
    }

    #[test]
    fn test_wildcard_pattern() {
        let manager = WhitelistManager::from_content("*.example.com");
        assert!(manager.is_whitelisted("sub.example.com"));
        assert!(!manager.is_whitelisted("example.com"));
    }

    #[test]
    fn test_regex_pattern() {
        let manager = WhitelistManager::from_content("/google\\.(com|co\\.uk)/");
        assert!(manager.is_whitelisted("google.com"));
        assert!(manager.is_whitelisted("google.co.uk"));
        assert!(!manager.is_whitelisted("google.de"));
    }

    #[test]
    fn test_comments() {
        // Test full line comment, inline comment, and whitespace
        let manager = WhitelistManager::from_content(
            "# full line comment\nexample.com # inline comment\ntest.com\n\n  ",
        );
        assert!(manager.is_whitelisted("example.com"));
        assert!(manager.is_whitelisted("test.com"));
        assert_eq!(manager.all_patterns.len(), 2);
    }

    #[test]
    fn test_mixed_patterns() {
        let content = "example.com\n@@google.com\n*.ads.com\n/tracker\\d+\\.com/";
        let manager = WhitelistManager::from_content(content);

        // Exact
        assert!(manager.is_whitelisted("example.com"));
        // Subdomain
        assert!(manager.is_whitelisted("google.com"));
        assert!(manager.is_whitelisted("www.google.com"));
        // Wildcard
        assert!(manager.is_whitelisted("foo.ads.com"));
        // Regex
        assert!(manager.is_whitelisted("tracker1.com"));
        assert!(manager.is_whitelisted("tracker99.com"));

        // Not matched
        assert!(!manager.is_whitelisted("other.com"));
    }
}
