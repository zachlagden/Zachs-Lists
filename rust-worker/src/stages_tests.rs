use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::db::progress::{FormatStatus, GenerationProgress};
use crate::downloader::Source;
use crate::generation::{generations_dir, read_manifest, MANIFEST_NAME};
use crate::progress_tracker::ProgressTracker;

const STOP_BOUND: Duration = Duration::from_secs(1);

struct CancelOnFirstReport {
    cancellation: Cancellation,
    cancelled_at: Mutex<Option<Instant>>,
    reports_after_cancel: AtomicU64,
}

impl CancelOnFirstReport {
    fn new() -> Self {
        Self {
            cancellation: Cancellation::default(),
            cancelled_at: Mutex::new(None),
            reports_after_cancel: AtomicU64::new(0),
        }
    }

    fn reported(&self) {
        let mut cancelled_at = self.cancelled_at.lock().unwrap();
        if cancelled_at.is_some() {
            self.reports_after_cancel.fetch_add(1, Ordering::Relaxed);
            return;
        }
        self.cancellation.cancel();
        *cancelled_at = Some(Instant::now());
    }

    fn assert_stopped_promptly(&self) {
        let cancelled_at = self.cancelled_at.lock().unwrap().expect("work reported");
        assert!(
            cancelled_at.elapsed() < STOP_BOUND,
            "stopped {:?} after cancellation",
            cancelled_at.elapsed()
        );
    }
}

fn hosts_body(domains: usize) -> Vec<u8> {
    (0..domains)
        .map(|n| format!("0.0.0.0 d{n:07}.blocked.example\n"))
        .collect::<String>()
        .into_bytes()
}

fn body(source_index: usize, category: Option<&str>, content: Vec<u8>) -> SourceBody {
    SourceBody {
        source_index,
        category: category.map(str::to_string),
        content,
    }
}

fn extracted(bodies: Vec<SourceBody>) -> CategoryDomains {
    let extractor = DomainExtractor::new();
    let mut domains = CategoryDomains::default();
    for body in bodies {
        extract_source(
            &extractor,
            body,
            &mut domains,
            &Cancellation::default(),
            &|_| {},
        )
        .unwrap();
    }
    domains
}

fn identity() -> BuildIdentity {
    BuildIdentity {
        job_id: "job-1".into(),
        job_created_at: chrono::Utc::now(),
        attempt: 1,
        inputs_digest: "d".repeat(64),
    }
}

fn generation_names(output_dir: &std::path::Path) -> Vec<String> {
    match std::fs::read_dir(generations_dir(output_dir)) {
        Ok(entries) => entries
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn whitelisted(domains: CategoryDomains, whitelist: &str) -> WhitelistOutcome {
    let cancellation = Cancellation::default();
    let plan = plan_whitelist(whitelist, domains, &cancellation).unwrap();
    apply_whitelist(plan, &cancellation, &|_| {}).unwrap()
}

#[test]
fn extraction_counts_domains_and_keeps_the_rule_of_the_later_source() {
    let extractor = DomainExtractor::new();
    let mut domains = CategoryDomains::default();
    let cancellation = Cancellation::default();

    let later = extract_source(
        &extractor,
        body(
            1,
            Some("tracking"),
            b"||shared.example^$important\n".to_vec(),
        ),
        &mut domains,
        &cancellation,
        &|_| {},
    )
    .unwrap();
    let earlier = extract_source(
        &extractor,
        body(
            0,
            Some("tracking"),
            b"||shared.example^\n0.0.0.0 plain.example\n".to_vec(),
        ),
        &mut domains,
        &cancellation,
        &|_| {},
    )
    .unwrap();

    assert_eq!(later.domain_count, 1);
    assert_eq!(earlier.domain_count, 2);
    assert_eq!(earlier.format_breakdown.hosts, 1);
    assert_eq!(earlier.format_breakdown.adblock, 1);
    let filtered = whitelisted(domains, "");
    assert_eq!(
        filtered
            .domains
            .adblock_rules
            .get("shared.example")
            .map(AsRef::as_ref),
        Some("||shared.example^$important")
    );
    assert_eq!(filtered.progress.domains_before, 2);
}

#[test]
fn cancellation_during_extraction_stops_within_the_bound() {
    let extractor = DomainExtractor::new();
    let mut domains = CategoryDomains::default();
    let stop = CancelOnFirstReport::new();

    let outcome = extract_source(
        &extractor,
        body(0, None, hosts_body(40 * WORK_GRAIN)),
        &mut domains,
        &stop.cancellation,
        &|_| stop.reported(),
    );

    assert!(outcome.is_err());
    stop.assert_stopped_promptly();
    assert!(domains.is_empty());
}

#[test]
fn whitelist_counts_each_removed_domain_once_across_categories() {
    let domains = extracted(vec![
        body(
            0,
            Some("tracking"),
            b"keep.example\nads.cdn.example\nshared.cdn.example\n".to_vec(),
        ),
        body(
            1,
            Some("advertising"),
            b"shared.cdn.example\nother.example\n||rule.cdn.example^\n||kept-rule.example^\n"
                .to_vec(),
        ),
        body(2, Some("nsfw"), b"adult.example\nkeep.example\n".to_vec()),
    ]);
    let cancellation = Cancellation::default();
    let plan = plan_whitelist("*.cdn.example\nnot a pattern\n", domains, &cancellation).unwrap();
    assert_eq!(plan.domains_before, 7);
    assert_eq!(plan.parsed.whitelist.pattern_count(), 1);
    let reported = AtomicU64::new(0);
    let checked = AtomicU64::new(0);

    let outcome = apply_whitelist(plan, &cancellation, &|tick| {
        reported.fetch_add(tick.newly_removed, Ordering::Relaxed);
        checked.fetch_add(tick.checked, Ordering::Relaxed);
    })
    .unwrap();

    assert_eq!(reported.into_inner(), 3);
    assert_eq!(checked.into_inner(), 9);
    assert_eq!(outcome.progress.domains_checked, 7);
    assert_eq!(outcome.progress.total_removed, 3);
    assert_eq!(outcome.progress.domains_after, 4);
    assert_eq!(outcome.progress.patterns_total, 1);
    assert_eq!(outcome.progress.patterns[0].match_count, 3);
    assert!(!outcome.progress.processing);
    assert_eq!(outcome.ignored_lines, 1);
    assert_eq!(outcome.progress.warnings.len(), 1);
    assert_eq!(
        outcome
            .domains
            .adblock_rules
            .keys()
            .collect::<Vec<&String>>(),
        ["kept-rule.example"]
    );
    assert_eq!(outcome.generation.files_total, 12);
    assert_eq!(outcome.generation.domains_per_format, 1 + 2 + 2 + 3);
}

#[test]
fn cancellation_during_the_whitelist_pass_stops_within_the_bound() {
    let domains = extracted(vec![body(0, None, hosts_body(40 * WORK_GRAIN))]);
    let stop = CancelOnFirstReport::new();
    let plan = plan_whitelist("*.blocked.example\n", domains, &stop.cancellation).unwrap();

    let outcome = apply_whitelist(plan, &stop.cancellation, &|_| stop.reported());

    assert!(outcome.is_err());
    stop.assert_stopped_promptly();
}

#[test]
fn generation_progress_counts_every_file_of_every_category() {
    let output_dir = tempfile::tempdir().unwrap();
    let filtered = whitelisted(
        extracted(vec![
            body(0, Some("tracking"), hosts_body(3 * WORK_GRAIN)),
            body(
                1,
                Some("advertising"),
                b"ads.example\nd0000001.blocked.example\n".to_vec(),
            ),
            body(2, Some("nsfw"), b"adult.example\n".to_vec()),
            body(3, None, b"loose.example\n".to_vec()),
        ]),
        "",
    );
    let tracker = ProgressTracker::downloading(&[Source {
        name: "first_list".into(),
        url: "https://lists.example.com/first.txt".into(),
        category: None,
    }]);
    tracker
        .begin_whitelist(filtered.progress.domains_before, 0)
        .unwrap();
    tracker
        .begin_generation(GenerationProgress::pending(
            filtered.generation.files_total,
            filtered.generation.domains_per_format,
        ))
        .unwrap();
    let in_progress = Mutex::new(Vec::new());

    let generated = generate_outputs(
        output_dir.path().to_path_buf(),
        identity(),
        filtered.domains,
        &Cancellation::default(),
        &|event| {
            tracker.generation_event(event);
            in_progress
                .lock()
                .unwrap()
                .push(tracker.snapshot().generation.unwrap());
        },
    )
    .unwrap();

    let combined = 3 * WORK_GRAIN as u64 + 2;
    let per_format = (3 * WORK_GRAIN as u64) + 2 + 1 + 1 + combined;
    let manifest = &generated.generation.manifest;
    assert_eq!(manifest.files.len(), 15);
    assert_eq!(
        generated.categories,
        BTreeMap::from([
            ("advertising".to_string(), 2),
            ("nsfw".to_string(), 1),
            ("tracking".to_string(), 3 * WORK_GRAIN as u64),
            ("uncategorized".to_string(), 1),
        ])
    );
    let generation = tracker.snapshot().generation.unwrap();
    assert_eq!(generation.files_total, 15);
    assert_eq!(generation.files_completed, 15);
    assert_eq!(generation.current_format, None);
    for format in &generation.formats {
        assert_eq!(format.status, FormatStatus::Completed);
        assert_eq!(format.total_domains, per_format);
        assert_eq!(format.domains_written, per_format);
        assert_eq!(format.percent, 100.0);
        assert_eq!(
            format.gz_size,
            Some(
                manifest
                    .files
                    .iter()
                    .filter(|file| file.format == format.format)
                    .map(|file| file.size_bytes)
                    .sum()
            )
        );
    }
    let in_progress = in_progress.into_inner().unwrap();
    assert!(in_progress.iter().any(|seen| {
        seen.formats.iter().any(|format| {
            format.status == FormatStatus::Generating
                && format.domains_written > 0
                && format.domains_written < format.total_domains
        })
    }));
    assert!(in_progress
        .windows(2)
        .all(|pair| pair[0].files_completed <= pair[1].files_completed));
    assert_eq!(
        manifest
            .files
            .iter()
            .find(|file| file.name == "all_domains_plain.txt.gz")
            .unwrap()
            .domain_count,
        combined
    );
}

#[test]
fn generation_writes_a_manifest_whose_hashes_sizes_and_counts_match_the_files() {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let output_dir = tempfile::tempdir().unwrap();
    let filtered = whitelisted(
        extracted(vec![
            body(0, Some("tracking"), hosts_body(2 * WORK_GRAIN + 5)),
            body(1, Some("nsfw"), b"adult.example\n".to_vec()),
        ]),
        "",
    );
    let built = identity();

    let generated = generate_outputs(
        output_dir.path().to_path_buf(),
        built.clone(),
        filtered.domains,
        &Cancellation::default(),
        &|_| {},
    )
    .unwrap();

    let manifest = generated.generation.manifest;
    let directory = generations_dir(output_dir.path()).join(&manifest.generation_id);
    assert_eq!(read_manifest(&directory).unwrap(), Some(manifest.clone()));
    assert_eq!(manifest.job_id, built.job_id);
    assert_eq!(manifest.attempt, built.attempt);
    assert_eq!(manifest.inputs_digest, built.inputs_digest);
    assert_eq!(
        manifest.job_created_at.timestamp_millis(),
        built.job_created_at.timestamp_millis()
    );
    let mut on_disk: Vec<String> = std::fs::read_dir(&directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name != MANIFEST_NAME)
        .collect();
    on_disk.sort();
    let listed: Vec<&str> = manifest
        .files
        .iter()
        .map(|file| file.name.as_str())
        .collect();
    assert_eq!(on_disk, listed);
    assert_eq!(listed.len(), 9);
    for file in &manifest.files {
        assert_eq!(file.name, format!("{}_{}.txt.gz", file.list, file.format));
        let stored = std::fs::read(directory.join(&file.name)).unwrap();
        assert_eq!(file.size_bytes, stored.len() as u64);
        assert_eq!(file.sha256, format!("{:x}", Sha256::digest(&stored)));
        let mut text = String::new();
        flate2::read::GzDecoder::new(stored.as_slice())
            .read_to_string(&mut text)
            .unwrap();
        assert_eq!(file.uncompressed_bytes, text.len() as u64);
        let domains = text
            .lines()
            .filter(|line| !line.is_empty() && !line.starts_with(['#', '!']))
            .count() as u64;
        assert_eq!(file.domain_count, domains);
        let expected = match file.list.as_str() {
            "nsfw" => 1,
            _ => 2 * WORK_GRAIN as u64 + 5,
        };
        assert_eq!(file.domain_count, expected, "{}", file.name);
    }
}

#[test]
fn cancellation_during_generation_stops_within_the_bound_and_leaves_no_generation() {
    let output_dir = tempfile::tempdir().unwrap();
    let published = output_dir.path().join("all_domains_hosts.txt.gz");
    std::fs::write(&published, b"previous build").unwrap();
    let filtered = whitelisted(
        extracted(vec![body(0, Some("tracking"), hosts_body(20 * WORK_GRAIN))]),
        "",
    );
    let stop = CancelOnFirstReport::new();

    let outcome = generate_outputs(
        output_dir.path().to_path_buf(),
        identity(),
        filtered.domains,
        &stop.cancellation,
        &|event| {
            if matches!(event, GenerationEvent::DomainsWritten(..)) {
                stop.reported();
            }
        },
    );

    let error = outcome.err().expect("generation was cancelled");
    assert!(error.downcast_ref::<Cancelled>().is_some());
    stop.assert_stopped_promptly();
    assert_eq!(std::fs::read(&published).unwrap(), b"previous build");
    assert_eq!(generation_names(output_dir.path()), Vec::<String>::new());
}

#[test]
fn unusable_category_name_fails_before_a_generation_directory_exists() {
    let output_dir = tempfile::tempdir().unwrap();
    let mut domains = CategoryDomains::default();
    domains
        .by_category
        .entry(Some("all_domains".to_string()))
        .or_default()
        .insert("blocked.example".to_string());

    let outcome = generate_outputs(
        output_dir.path().to_path_buf(),
        identity(),
        domains,
        &Cancellation::default(),
        &|_| {},
    );

    assert!(outcome.is_err());
    assert!(!generations_dir(output_dir.path()).exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 1)]
async fn heartbeat_ticks_keep_running_while_extraction_blocks_one_runtime_thread() {
    let ticks = Arc::new(AtomicU64::new(0));
    let counted = Arc::clone(&ticks);
    let heartbeat = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(10));
        loop {
            ticker.tick().await;
            counted.fetch_add(1, Ordering::Relaxed);
        }
    });
    let ticks_before = ticks.load(Ordering::Relaxed);
    let started = Instant::now();

    let stage_thread = StageThread::start().unwrap();
    let extraction = stage_thread
        .run(|| {
            let extractor = DomainExtractor::new();
            let mut domains = CategoryDomains::default();
            let extraction = extract_source(
                &extractor,
                body(0, None, hosts_body(30 * WORK_GRAIN)),
                &mut domains,
                &Cancellation::default(),
                &|_| {},
            )?;
            std::thread::sleep(Duration::from_millis(300));
            Ok(extraction.domain_count)
        })
        .await
        .unwrap();

    let blocked_for = started.elapsed();
    let ticks_during = ticks.load(Ordering::Relaxed) - ticks_before;
    heartbeat.abort();
    assert_eq!(extraction, 30 * WORK_GRAIN as u64);
    assert!(blocked_for >= Duration::from_millis(300));
    assert!(
        ticks_during >= 15,
        "{ticks_during} ticks in {blocked_for:?}"
    );
}
