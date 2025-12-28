use rayon::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Result of extracting from a line
#[derive(Debug, Clone, PartialEq)]
pub struct ExtractionResult {
    /// The extracted domain (lowercase, normalized)
    pub domain: String,
    /// Original adblock rule if source was adblock format (for passthrough)
    pub raw_adblock_rule: Option<String>,
}

/// Format breakdown for a source - counts domains by detected format
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct FormatBreakdown {
    pub hosts: u64,
    pub plain: u64,
    pub adblock: u64,
}

impl FormatBreakdown {
    /// Get list of detected format names
    pub fn detected_formats(&self) -> Vec<String> {
        let mut formats = Vec::new();
        if self.hosts > 0 {
            formats.push("hosts".to_string());
        }
        if self.plain > 0 {
            formats.push("plain".to_string());
        }
        if self.adblock > 0 {
            formats.push("adblock".to_string());
        }
        formats
    }

    /// Get the primary (most common) format
    pub fn primary_format(&self) -> Option<&'static str> {
        let max = self.hosts.max(self.plain).max(self.adblock);
        if max == 0 {
            return None;
        }
        if self.hosts == max {
            Some("hosts")
        } else if self.adblock == max {
            Some("adblock")
        } else {
            Some("plain")
        }
    }
}

/// Result of extraction with format breakdown
#[derive(Debug, Clone)]
pub struct ExtractionOutput {
    pub results: Vec<ExtractionResult>,
    pub format_breakdown: FormatBreakdown,
}

/// Detected format of a single line
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DetectedFormat {
    Hosts,
    Plain,
    Adblock,
}

/// Domain extractor with high-performance regex parsing
pub struct DomainExtractor {
    /// Pattern for hosts file format: IP domain
    hosts_pattern: Regex,
    /// Pattern for plain domain
    plain_pattern: Regex,
    /// Pattern for adblock format: ||domain^ with optional modifiers
    adblock_pattern: Regex,
    /// Pattern for comments
    comment_pattern: Regex,
    /// Pattern for CSS/cosmetic filter rules (to skip)
    css_filter_pattern: Regex,
    /// Pattern to detect modifiers that mean this isn't a DNS-level block
    skip_modifiers_pattern: Regex,
}

impl DomainExtractor {
    /// Create a new domain extractor
    pub fn new() -> Self {
        Self {
            // Matches: 0.0.0.0 domain.com or 127.0.0.1 domain.com
            hosts_pattern: Regex::new(r"^(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)").unwrap(),
            // Matches: just a domain on its own line
            plain_pattern: Regex::new(r"^([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)$").unwrap(),
            // Matches: ||domain.com^ or ||domain.com^$... (captures domain and optional modifiers)
            adblock_pattern: Regex::new(r"^\|\|([a-zA-Z0-9][-a-zA-Z0-9]*(?:\.[a-zA-Z0-9][-a-zA-Z0-9]*)+)\^?(\$.+)?$").unwrap(),
            // Matches comment lines
            comment_pattern: Regex::new(r"^[#!]").unwrap(),
            // Matches CSS/cosmetic filter rules (element hiding - not DNS level)
            css_filter_pattern: Regex::new(r"##|#@#|#\?#|#\$#|#\+js\(").unwrap(),
            // Matches modifiers that indicate the rule doesn't block at DNS level
            // $third-party = context-aware blocking (can't do at DNS level)
            // $badfilter = exception rule that DISABLES a blocking rule
            // $removeparam, $redirect, $csp, $replace, $cookie = browser-level features
            skip_modifiers_pattern: Regex::new(r"(?i)\$(.*,)?(third-party|badfilter|removeparam|redirect|csp|replace|cookie)").unwrap(),
        }
    }

    /// Extract domain from a single line, returns result and detected format
    fn extract_domain(&self, line: &str) -> Option<(ExtractionResult, DetectedFormat)> {
        let line = line.trim();

        // Skip empty lines and comments
        if line.is_empty() || self.comment_pattern.is_match(line) {
            return None;
        }

        // Skip CSS/cosmetic filter rules (element hiding, not DNS level)
        if self.css_filter_pattern.is_match(line) {
            return None;
        }

        // Try hosts format first (most common)
        if let Some(caps) = self.hosts_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                return Some((
                    ExtractionResult {
                        domain: domain.as_str().to_lowercase(),
                        raw_adblock_rule: None, // Not adblock format
                    },
                    DetectedFormat::Hosts,
                ));
            }
        }

        // Try adblock format
        if let Some(caps) = self.adblock_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                // Check for modifiers that mean this isn't a DNS-level block
                if let Some(modifiers) = caps.get(2) {
                    let mod_str = modifiers.as_str();
                    if self.skip_modifiers_pattern.is_match(mod_str) {
                        return None;
                    }
                }
                return Some((
                    ExtractionResult {
                        domain: domain.as_str().to_lowercase(),
                        raw_adblock_rule: Some(line.to_string()), // Preserve original rule
                    },
                    DetectedFormat::Adblock,
                ));
            }
        }

        // Try plain domain
        if let Some(caps) = self.plain_pattern.captures(line) {
            if let Some(domain) = caps.get(1) {
                return Some((
                    ExtractionResult {
                        domain: domain.as_str().to_lowercase(),
                        raw_adblock_rule: None, // Not adblock format
                    },
                    DetectedFormat::Plain,
                ));
            }
        }

        None
    }

    /// Extract domains from file content (parallel processing)
    /// Returns just the results for backward compatibility
    pub fn extract_from_content(&self, content: &str) -> Vec<ExtractionResult> {
        content
            .par_lines()
            .filter_map(|line| self.extract_domain(line).map(|(result, _)| result))
            .collect()
    }

    /// Extract domains from file content with format breakdown
    pub fn extract_from_content_with_breakdown(&self, content: &str) -> ExtractionOutput {
        use std::sync::atomic::{AtomicU64, Ordering};

        let hosts_count = AtomicU64::new(0);
        let plain_count = AtomicU64::new(0);
        let adblock_count = AtomicU64::new(0);

        let results: Vec<ExtractionResult> = content
            .par_lines()
            .filter_map(|line| {
                self.extract_domain(line).map(|(result, format)| {
                    match format {
                        DetectedFormat::Hosts => hosts_count.fetch_add(1, Ordering::Relaxed),
                        DetectedFormat::Plain => plain_count.fetch_add(1, Ordering::Relaxed),
                        DetectedFormat::Adblock => adblock_count.fetch_add(1, Ordering::Relaxed),
                    };
                    result
                })
            })
            .collect();

        ExtractionOutput {
            results,
            format_breakdown: FormatBreakdown {
                hosts: hosts_count.load(Ordering::Relaxed),
                plain: plain_count.load(Ordering::Relaxed),
                adblock: adblock_count.load(Ordering::Relaxed),
            },
        }
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

        let result = extractor.extract_domain("0.0.0.0 ads.example.com");
        assert_eq!(
            result,
            Some((
                ExtractionResult {
                    domain: "ads.example.com".to_string(),
                    raw_adblock_rule: None,
                },
                DetectedFormat::Hosts
            ))
        );

        let result = extractor.extract_domain("127.0.0.1 tracker.example.com");
        assert_eq!(
            result,
            Some((
                ExtractionResult {
                    domain: "tracker.example.com".to_string(),
                    raw_adblock_rule: None,
                },
                DetectedFormat::Hosts
            ))
        );
    }

    #[test]
    fn test_adblock_format() {
        let extractor = DomainExtractor::new();

        // Basic adblock rule - should preserve original
        let result = extractor.extract_domain("||ads.example.com^");
        assert_eq!(
            result,
            Some((
                ExtractionResult {
                    domain: "ads.example.com".to_string(),
                    raw_adblock_rule: Some("||ads.example.com^".to_string()),
                },
                DetectedFormat::Adblock
            ))
        );

        // Adblock with $important modifier - should preserve
        let result = extractor.extract_domain("||tracker.example.com^$important");
        assert_eq!(
            result,
            Some((
                ExtractionResult {
                    domain: "tracker.example.com".to_string(),
                    raw_adblock_rule: Some("||tracker.example.com^$important".to_string()),
                },
                DetectedFormat::Adblock
            ))
        );
    }

    #[test]
    fn test_third_party_skipped() {
        let extractor = DomainExtractor::new();

        // $third-party rules cannot work at DNS level - skip them
        assert_eq!(extractor.extract_domain("||facebook.com^$third-party"), None);
        assert_eq!(
            extractor.extract_domain("||tracker.com^$third-party,image"),
            None
        );
        assert_eq!(
            extractor.extract_domain("||example.com^$image,third-party"),
            None
        );
    }

    #[test]
    fn test_badfilter_exception() {
        let extractor = DomainExtractor::new();

        // $badfilter rules UNBLOCK domains - skip them
        assert_eq!(extractor.extract_domain("||facebook.com^$badfilter"), None);
        assert_eq!(extractor.extract_domain("||amazon.co.uk^$badfilter"), None);
        assert_eq!(
            extractor.extract_domain("||example.com^$third-party,badfilter"),
            None
        );
    }

    #[test]
    fn test_css_selectors_skipped() {
        let extractor = DomainExtractor::new();

        // CSS/cosmetic filters are element hiding - not DNS level
        assert_eq!(extractor.extract_domain("facebook.com##.ad-banner"), None);
        assert_eq!(extractor.extract_domain("example.com#@#.sponsored"), None);
        assert_eq!(extractor.extract_domain("site.com#?#.ad-container"), None);
        assert_eq!(extractor.extract_domain("page.com#$#.tracking"), None);
        assert_eq!(
            extractor.extract_domain("domain.com#+js(abort-on-property-read)"),
            None
        );
    }

    #[test]
    fn test_non_blocking_modifiers() {
        let extractor = DomainExtractor::new();

        // These modifiers don't block at DNS level
        assert_eq!(
            extractor.extract_domain("||example.com^$removeparam=utm"),
            None
        );
        assert_eq!(
            extractor.extract_domain("||example.com^$redirect=nooptext"),
            None
        );
        assert_eq!(
            extractor.extract_domain("||example.com^$csp=script-src 'none'"),
            None
        );
        assert_eq!(
            extractor.extract_domain("||example.com^$replace=/bad/good/"),
            None
        );
        assert_eq!(extractor.extract_domain("||example.com^$cookie"), None);
    }

    #[test]
    fn test_plain_format() {
        let extractor = DomainExtractor::new();

        let result = extractor.extract_domain("ads.example.com");
        assert_eq!(
            result,
            Some((
                ExtractionResult {
                    domain: "ads.example.com".to_string(),
                    raw_adblock_rule: None,
                },
                DetectedFormat::Plain
            ))
        );
    }

    #[test]
    fn test_comments() {
        let extractor = DomainExtractor::new();

        assert_eq!(extractor.extract_domain("# This is a comment"), None);
        assert_eq!(extractor.extract_domain("! Adblock comment"), None);
    }

    #[test]
    fn test_valid_modifiers_preserved() {
        let extractor = DomainExtractor::new();

        // $important and other valid DNS-compatible modifiers should be preserved
        let result = extractor.extract_domain("||ads.example.com^$important");
        assert!(result.is_some());
        let (extraction, format) = result.unwrap();
        assert_eq!(
            extraction.raw_adblock_rule,
            Some("||ads.example.com^$important".to_string())
        );
        assert_eq!(format, DetectedFormat::Adblock);

        // $all modifier (block everything) is valid for DNS
        let result = extractor.extract_domain("||malware.com^$all");
        assert!(result.is_some());
        let (extraction, format) = result.unwrap();
        assert_eq!(
            extraction.raw_adblock_rule,
            Some("||malware.com^$all".to_string())
        );
        assert_eq!(format, DetectedFormat::Adblock);
    }

    #[test]
    fn test_format_breakdown() {
        let extractor = DomainExtractor::new();

        let content = "0.0.0.0 host1.com\n\
                       0.0.0.0 host2.com\n\
                       ||adblock1.com^\n\
                       ||adblock2.com^$important\n\
                       ||adblock3.com^\n\
                       plain1.com\n\
                       plain2.com";

        let output = extractor.extract_from_content_with_breakdown(content);

        assert_eq!(output.results.len(), 7);
        assert_eq!(output.format_breakdown.hosts, 2);
        assert_eq!(output.format_breakdown.adblock, 3);
        assert_eq!(output.format_breakdown.plain, 2);

        let formats = output.format_breakdown.detected_formats();
        assert!(formats.contains(&"hosts".to_string()));
        assert!(formats.contains(&"adblock".to_string()));
        assert!(formats.contains(&"plain".to_string()));
    }

    #[test]
    fn test_format_breakdown_primary() {
        let mut breakdown = FormatBreakdown {
            hosts: 100,
            plain: 50,
            adblock: 25,
        };
        assert_eq!(breakdown.primary_format(), Some("hosts"));

        breakdown.adblock = 200;
        assert_eq!(breakdown.primary_format(), Some("adblock"));

        breakdown.plain = 300;
        assert_eq!(breakdown.primary_format(), Some("plain"));
    }
}
