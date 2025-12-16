use anyhow::Result;
use rayon::prelude::*;
use regex::Regex;
use std::collections::HashSet;
use std::path::Path;
use tokio::fs;
use tracing::{debug, warn};

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

    /// Validate a domain (fast checks only - extraction patterns already validate format)
    #[inline]
    pub fn is_valid_domain(&self, domain: &str) -> bool {
        // Fast checks only - regex already validated during extraction
        domain.len() >= 4 && domain.len() <= 253 && domain.contains('.')
    }

    /// Extract domains from file content (parallel processing)
    /// Note: Extraction patterns already validate domain format, so no secondary validation needed
    pub fn extract_from_content(&self, content: &str) -> Vec<String> {
        content
            .par_lines()
            .filter_map(|line| self.extract_domain(line))
            // Skip secondary validation - extraction patterns already validate format
            // .filter(|domain| self.is_valid_domain(domain))
            .collect()
    }

    /// Extract domains from a file
    pub async fn extract_from_file(&self, path: &Path) -> Result<Vec<String>> {
        let content = fs::read_to_string(path).await?;
        Ok(self.extract_from_content(&content))
    }

    /// Extract and deduplicate domains from multiple files
    pub async fn extract_from_files(&self, paths: Vec<&Path>) -> Result<HashSet<String>> {
        let mut all_domains = HashSet::new();

        for path in paths {
            if !path.exists() {
                warn!("File not found: {:?}", path);
                continue;
            }

            let domains = self.extract_from_file(path).await?;
            debug!("Extracted {} domains from {:?}", domains.len(), path);

            for domain in domains {
                all_domains.insert(domain);
            }
        }

        Ok(all_domains)
    }

    /// Merge multiple domain sets with deduplication
    pub fn merge_domains(domain_sets: Vec<Vec<String>>) -> HashSet<String> {
        let total_estimate: usize = domain_sets.iter().map(|s| s.len()).sum();
        let mut result = HashSet::with_capacity(total_estimate);

        for domains in domain_sets {
            for domain in domains {
                result.insert(domain);
            }
        }

        result
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

    #[test]
    fn test_domain_validation() {
        let extractor = DomainExtractor::new();

        assert!(extractor.is_valid_domain("example.com"));
        assert!(extractor.is_valid_domain("sub.example.com"));
        assert!(extractor.is_valid_domain("a.b.c.d.example.com"));
        assert!(!extractor.is_valid_domain("localhost"));
        assert!(!extractor.is_valid_domain("com"));
        assert!(!extractor.is_valid_domain(""));
    }
}
