use rayon::prelude::*;
use regex::Regex;
use std::collections::HashSet;

/// Domain extractor with high-performance regex parsing
pub struct DomainExtractor {
    /// Pattern for hosts file format: IP domain
    hosts_pattern: Regex,
    /// Pattern for plain domain
    plain_pattern: Regex,
    /// Pattern for adblock format: ||domain^
    adblock_pattern: Regex,
    /// Pattern for comments
    comment_pattern: Regex,
    // Note: domain_validator regex removed - extraction patterns already validate format
}

impl DomainExtractor {
    /// Create a new domain extractor
    pub fn new() -> Self {
        Self {
            // Matches: 0.0.0.0 domain.com or 127.0.0.1 domain.com
            hosts_pattern: Regex::new(r"^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)").unwrap(),
            // Matches: just a domain on its own line
            plain_pattern: Regex::new(r"^([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)$").unwrap(),
            // Matches: ||domain.com^ or ||domain.com^$...
            adblock_pattern: Regex::new(r"^\|\|([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)\^").unwrap(),
            // Matches comment lines
            comment_pattern: Regex::new(r"^[#!]").unwrap(),
        }
    }

    /// Extract domain from a single line
    fn extract_domain(&self, line: &str) -> Option<String> {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || self.comment_pattern.is_match(line) {
            return None;
        }

        // Try hosts format first (most common)
        if let Some(caps) = self.hosts_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                return Some(domain.as_str().to_lowercase());
            }
        }

        // Try adblock format
        if let Some(caps) = self.adblock_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                return Some(domain.as_str().to_lowercase());
            }
        }

        // Try plain domain
        if let Some(caps) = self.plain_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                return Some(domain.as_str().to_lowercase());
            }
        }

        None
    }

    /// Extract domains from file content (parallel processing)
    pub fn extract_from_content(&self, content: &str) -> Vec<String> {
        content
            .par_lines()
            .filter_map(|line| self.extract_domain(line))
            .collect()
    }

    /// Sort domains alphabetically (parallel sort)
    pub fn sort_domains(domains: HashSet<String>) -> Vec<String> {
        let mut sorted: Vec<String> = domains.into_iter().collect();
        sorted.par_sort_unstable();
        sorted
    }
}

impl Default for DomainExtractor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hosts_format() {
        let extractor = DomainExtractor::new();

        assert_eq!(
            extractor.extract_domain("0.0.0.0 ads.example.com"),
            Some("ads.example.com".to_string())
        );
        assert_eq!(
            extractor.extract_domain("127.0.0.1 tracker.example.com"),
            Some("tracker.example.com".to_string())
        );
    }

    #[test]
    fn test_adblock_format() {
        let extractor = DomainExtractor::new();

        assert_eq!(
            extractor.extract_domain("||ads.example.com^"),
            Some("ads.example.com".to_string())
        );
        assert_eq!(
            extractor.extract_domain("||tracker.example.com^$third-party"),
            Some("tracker.example.com".to_string())
        );
    }

    #[test]
    fn test_plain_format() {
        let extractor = DomainExtractor::new();

        assert_eq!(
            extractor.extract_domain("ads.example.com"),
            Some("ads.example.com".to_string())
        );
    }

    #[test]
    fn test_comments() {
        let extractor = DomainExtractor::new();

        assert_eq!(extractor.extract_domain("# This is a comment"), None);
        assert_eq!(extractor.extract_domain("! Adblock comment"), None);
    }
}
