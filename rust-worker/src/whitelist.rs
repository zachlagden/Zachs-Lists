use anyhow::Result;
use rayon::prelude::*;
use regex::RegexSet;
use std::collections::HashSet;
use std::path::Path;
use tokio::fs;
use tracing::{debug, info, warn};

use crate::db::progress::{WhitelistPatternMatch, WhitelistProgress};

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
    /// Regex pattern strings (for identifying which regex matched)
    regex_pattern_strings: Vec<String>,
}

impl WhitelistManager {
    /// Create empty whitelist manager
    pub fn new() -> Self {
        Self {
            exact_patterns: HashSet::new(),
            subdomain_patterns: Vec::new(),
            regex_set: None,
            all_patterns: Vec::new(),
            regex_pattern_strings: Vec::new(),
        }
    }

    /// Load whitelist from file
    pub async fn from_file(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::new());
        }

        let content = fs::read_to_string(path).await?;
        Ok(Self::from_content(&content))
    }

    /// Load whitelist from content string (optimized structure)
    pub fn from_content(content: &str) -> Self {
        let mut exact_patterns = HashSet::new();
        let mut subdomain_patterns = Vec::new();
        let mut regex_strings = Vec::new();
        let mut all_patterns = Vec::new();
        let mut regex_pattern_strings = Vec::new();

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
                regex_pattern_strings.push(pattern.to_string());
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
                let regex_str = format!(
                    "^{}$",
                    regex::escape(pattern).replace(r"\*", ".*")
                );
                regex_strings.push(regex_str);
                regex_pattern_strings.push(pattern.to_string());
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
            regex_pattern_strings.len()
        );

        Self {
            exact_patterns,
            subdomain_patterns,
            regex_set,
            all_patterns,
            regex_pattern_strings,
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
            PatternType::Exact => {
                pattern.original.to_lowercase() == domain
            }
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
        let (remaining, removed_domains): (HashSet<String>, Vec<String>) = domains
            .into_par_iter()
            .partition_map(|domain| {
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
            .map(|(pattern, (pattern_type, match_count))| WhitelistPatternMatch {
                pattern,
                pattern_type,
                match_count,
                samples: Vec::new(),
            })
            .collect();

        // Sort by match count descending
        pattern_matches.sort_by(|a, b| b.match_count.cmp(&a.match_count));

        // Limit to top 20
        pattern_matches.truncate(20);

        (remaining, removed, pattern_matches)
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
        let manager = WhitelistManager::from_content("# full line comment\nexample.com # inline comment\ntest.com\n\n  ");
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
