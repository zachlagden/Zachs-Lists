use anyhow::{anyhow, Result};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use tracing::debug;

use crate::cancellation::{Cancellation, Cancelled, WORK_GRAIN};
use crate::db::progress::WhitelistProgress;
use crate::extractor::{DomainExtractor, FormatBreakdown};
use crate::generation::{BuildIdentity, UnfinishedGeneration, WrittenGeneration};
use crate::generator::{
    category_list_names, GenerationControl, GenerationEvent, OutputFormat, OutputGenerator,
    UNCATEGORIZED_LIST_NAME,
};
use crate::whitelist::{job_warnings, ParsedWhitelist, WhitelistManager};

const CATEGORY_LEFT_OUT_OF_COMBINED_LIST: &str = "nsfw";

type StageWork = Box<dyn FnOnce() + Send>;

pub struct StageThread {
    queue: std::sync::mpsc::Sender<StageWork>,
}

impl StageThread {
    pub fn start() -> std::io::Result<Self> {
        let (queue, queued) = std::sync::mpsc::channel::<StageWork>();
        std::thread::Builder::new()
            .name("build-stages".to_string())
            .spawn(move || {
                for work in queued {
                    work();
                }
            })?;
        Ok(Self { queue })
    }

    pub async fn run<T, W>(&self, work: W) -> Result<T>
    where
        T: Send + 'static,
        W: FnOnce() -> Result<T> + Send + 'static,
    {
        let (finished, outcome) = tokio::sync::oneshot::channel();
        self.queue
            .send(Box::new(move || {
                if finished.send(work()).is_err() {
                    debug!("A build stage finished after its build had stopped");
                }
            }))
            .map_err(|_| anyhow!("The build stage thread has stopped"))?;
        outcome
            .await
            .map_err(|_| anyhow!("A build stage stopped without a result"))?
    }
}

pub struct RankedRule {
    rule: Box<str>,
    source_index: u32,
}

impl AsRef<str> for RankedRule {
    fn as_ref(&self) -> &str {
        &self.rule
    }
}

/// Domains organized by category for per-category output generation
#[derive(Default)]
pub struct CategoryDomains {
    /// Map from category name to domains in that category
    /// None key = uncategorized sources
    pub by_category: HashMap<Option<String>, HashSet<String>>,
    /// Raw adblock rules keyed by domain (for adblock output passthrough)
    /// Only populated for domains that came from adblock-format sources
    pub adblock_rules: HashMap<String, RankedRule>,
}

impl CategoryDomains {
    pub fn is_empty(&self) -> bool {
        self.by_category.values().all(HashSet::is_empty)
    }

    pub fn category_count(&self) -> usize {
        self.by_category.len()
    }
}

fn unique_count<'a>(
    sets: impl Iterator<Item = &'a HashSet<String>>,
    cancellation: &Cancellation,
) -> Result<u64, Cancelled> {
    let sets: Vec<&HashSet<String>> = sets.collect();
    if let [only] = sets.as_slice() {
        return Ok(only.len() as u64);
    }
    let mut unique: HashSet<&String> = HashSet::new();
    for set in sets {
        for (position, domain) in set.iter().enumerate() {
            if position % WORK_GRAIN == 0 {
                cancellation.check()?;
            }
            unique.insert(domain);
        }
    }
    Ok(unique.len() as u64)
}

pub struct SourceExtraction {
    pub domain_count: u64,
    pub format_breakdown: FormatBreakdown,
}

pub struct SourceBody {
    pub source_index: usize,
    pub category: Option<String>,
    pub content: Vec<u8>,
}

pub fn extract_source(
    extractor: &DomainExtractor,
    body: SourceBody,
    domains: &mut CategoryDomains,
    cancellation: &Cancellation,
    report_extracted: &(dyn Fn(u64) + Send + Sync),
) -> Result<SourceExtraction, Cancelled> {
    let SourceBody {
        source_index,
        category,
        content,
    } = body;
    let extraction = {
        let text = String::from_utf8_lossy(&content);
        extractor.extract(&text, cancellation, report_extracted)?
    };
    drop(content);

    let domain_count = extraction.domain_count();
    let source_index = u32::try_from(source_index).unwrap_or(u32::MAX);
    let category_set = domains.by_category.entry(category).or_default();
    for batch in extraction.batches {
        for (position, extracted) in batch.into_iter().enumerate() {
            if position % WORK_GRAIN == 0 {
                cancellation.check()?;
            }
            if let Some(rule) = extracted.raw_adblock_rule {
                let from_later_source = domains
                    .adblock_rules
                    .get(&extracted.domain)
                    .is_none_or(|kept| kept.source_index <= source_index);
                if from_later_source {
                    domains.adblock_rules.insert(
                        extracted.domain.clone(),
                        RankedRule {
                            rule: rule.into_boxed_str(),
                            source_index,
                        },
                    );
                }
            }
            category_set.insert(extracted.domain);
        }
    }

    Ok(SourceExtraction {
        domain_count,
        format_breakdown: extraction.format_breakdown,
    })
}

pub struct WhitelistPlan {
    pub domains: CategoryDomains,
    pub parsed: ParsedWhitelist,
    pub domains_before: u64,
}

pub fn plan_whitelist(
    whitelist_content: &str,
    domains: CategoryDomains,
    cancellation: &Cancellation,
) -> Result<WhitelistPlan, Cancelled> {
    let domains_before = unique_count(domains.by_category.values(), cancellation)?;
    let parsed = WhitelistManager::parse(whitelist_content);
    Ok(WhitelistPlan {
        domains,
        parsed,
        domains_before,
    })
}

pub struct GenerationPlan {
    pub files_total: u64,
    pub domains_per_format: u64,
}

pub struct WhitelistOutcome {
    pub domains: CategoryDomains,
    pub progress: WhitelistProgress,
    pub ignored_lines: usize,
    pub generation: GenerationPlan,
    pub domains_in_all_categories: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WhitelistTick {
    pub checked: u64,
    pub newly_removed: u64,
}

pub fn apply_whitelist(
    plan: WhitelistPlan,
    cancellation: &Cancellation,
    report: &(dyn Fn(WhitelistTick) + Send + Sync),
) -> Result<WhitelistOutcome, Cancelled> {
    let WhitelistPlan {
        domains,
        parsed: ParsedWhitelist {
            whitelist,
            problems,
        },
        domains_before,
    } = plan;

    let mut filtered = CategoryDomains {
        by_category: HashMap::new(),
        adblock_rules: domains.adblock_rules,
    };
    let mut removed_domains: HashSet<String> = HashSet::new();
    for (category, category_domains) in domains.by_category {
        let removed_before = &removed_domains;
        let report_new_removals = |checked: usize, removed: &[String]| {
            let new = removed
                .iter()
                .filter(|domain| !removed_before.contains(*domain))
                .count();
            report(WhitelistTick {
                checked: checked as u64,
                newly_removed: new as u64,
            });
        };
        let (remaining, removed) =
            whitelist.partition_reporting(category_domains, cancellation, &report_new_removals)?;
        removed_domains.extend(removed);
        if !remaining.is_empty() {
            filtered.by_category.insert(category, remaining);
        }
    }
    let pattern_matches =
        whitelist.pattern_matches_until_cancelled(&removed_domains, cancellation)?;
    let domains_after = domains_before.saturating_sub(removed_domains.len() as u64);
    for (position, domain) in removed_domains.iter().enumerate() {
        if position % WORK_GRAIN == 0 {
            cancellation.check()?;
        }
        filtered.adblock_rules.remove(domain);
    }
    drop(removed_domains);

    let combined = unique_count(
        filtered
            .by_category
            .iter()
            .filter(|(category, _)| !left_out_of_combined_list(category))
            .map(|(_, category_domains)| category_domains),
        cancellation,
    )?;
    let in_categories: u64 = filtered
        .by_category
        .values()
        .map(|category_domains| category_domains.len() as u64)
        .sum();
    let generation = GenerationPlan {
        files_total: ((filtered.by_category.len() + 1) * OutputFormat::all().len()) as u64,
        domains_per_format: in_categories + combined,
    };

    Ok(WhitelistOutcome {
        domains: filtered,
        progress: whitelist.create_progress(
            domains_before,
            domains_after,
            pattern_matches,
            job_warnings(&problems),
        ),
        ignored_lines: problems.len(),
        generation,
        domains_in_all_categories: domains_after,
    })
}

fn left_out_of_combined_list(category: &Option<String>) -> bool {
    category.as_deref() == Some(CATEGORY_LEFT_OUT_OF_COMBINED_LIST)
}

fn sorted_until_cancelled(
    domains: HashSet<String>,
    cancellation: &Cancellation,
) -> Result<Vec<String>, Cancelled> {
    cancellation.check()?;
    let sorted = DomainExtractor::sort_domains(domains);
    cancellation.check()?;
    Ok(sorted)
}

pub struct GeneratedOutput {
    pub generation: WrittenGeneration,
    pub categories: BTreeMap<String, u64>,
}

pub fn generate_outputs(
    output_dir: PathBuf,
    identity: BuildIdentity,
    domains: CategoryDomains,
    cancellation: &Cancellation,
    report: &(dyn Fn(GenerationEvent) + Send + Sync),
) -> Result<GeneratedOutput> {
    category_list_names(domains.by_category.keys())?;
    let unfinished = UnfinishedGeneration::create(&output_dir)?;
    let generator = OutputGenerator::new(unfinished.directory());
    let control = GenerationControl {
        cancellation,
        report,
    };

    let adblock_rules = domains.adblock_rules;
    let mut sorted_by_category: HashMap<Option<String>, Vec<String>> = HashMap::new();
    for (category, category_domains) in domains.by_category {
        sorted_by_category.insert(
            category,
            sorted_until_cancelled(category_domains, cancellation)?,
        );
    }
    let categories: BTreeMap<String, u64> = sorted_by_category
        .iter()
        .map(|(category, sorted)| {
            (
                category
                    .clone()
                    .unwrap_or_else(|| UNCATEGORIZED_LIST_NAME.to_string()),
                sorted.len() as u64,
            )
        })
        .collect();

    let mut files =
        generator.generate_all_categories(&sorted_by_category, &adblock_rules, &control)?;

    let mut combined: HashSet<String> = HashSet::new();
    for (category, sorted) in sorted_by_category {
        if left_out_of_combined_list(&category) {
            continue;
        }
        for (position, domain) in sorted.into_iter().enumerate() {
            if position % WORK_GRAIN == 0 {
                cancellation.check()?;
            }
            combined.insert(domain);
        }
    }
    let combined_sorted = sorted_until_cancelled(combined, cancellation)?;
    files.extend(generator.generate_all(&combined_sorted, &adblock_rules, &control)?);
    cancellation.check()?;

    Ok(GeneratedOutput {
        generation: unfinished.finish(identity, files)?,
        categories,
    })
}

#[cfg(test)]
#[path = "stages_tests.rs"]
mod tests;
