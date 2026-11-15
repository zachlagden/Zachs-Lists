use super::*;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use crate::db::progress::{FormatStatus, GenerationProgress};
use crate::downloader::Source;
use crate::generation::{generations_dir, read_manifest, MANIFEST_NAME};
use crate::progress_tracker::ProgressTracker;

const STAGE_POOL_THREADS: usize = 2;
const TICKS_WHILE_BLOCKED: usize = 15;
const BLOCKED_STAGE_WAIT: Duration = Duration::from_secs(30);

struct CancelOnFirstReport {
    cancellation: Cancellation,
    chunks_reported: AtomicU64,
}

impl CancelOnFirstReport {
    fn new() -> Self {
        Self {
            cancellation: Cancellation::default(),
            chunks_reported: AtomicU64::new(0),
        }
    }

    fn reported(&self) {
        self.chunks_reported.fetch_add(1, Ordering::SeqCst);
        self.cancellation.cancel();
    }

    fn assert_stopped_within_one_chunk_per_thread(&self) {
        let chunks_reported = self.chunks_reported.load(Ordering::SeqCst);
        assert!(
            (1..=STAGE_POOL_THREADS as u64).contains(&chunks_reported),
            "{chunks_reported} chunks were reported on {STAGE_POOL_THREADS} threads"
        );
    }
}

fn on_stage_pool<T: Send>(work: impl FnOnce() -> T + Send) -> T {
    rayon::ThreadPoolBuilder::new()
        .num_threads(STAGE_POOL_THREADS)
        .build()
        .unwrap()
        .install(work)
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
        abp: false,
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
fn cancellation_during_extraction_stops_within_one_chunk_per_thread() {
    let extractor = DomainExtractor::new();
    let mut domains = CategoryDomains::default();
    let stop = CancelOnFirstReport::new();

    let outcome = on_stage_pool(|| {
        extract_source(
            &extractor,
            body(0, None, hosts_body(40 * WORK_GRAIN)),
            &mut domains,
            &stop.cancellation,
            &|_| stop.reported(),
        )
    });

    assert!(outcome.is_err());
    stop.assert_stopped_within_one_chunk_per_thread();
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

fn counted_one_by_one(domains: &CategoryDomains) -> u64 {
    domains
        .by_category
        .values()
        .flatten()
        .collect::<HashSet<&String>>()
        .len() as u64
}

#[test]
fn measurement_counts_a_shared_domain_once_and_includes_the_category_left_out() {
    let bodies = || {
        vec![
            body(
                0,
                Some("tracking"),
                b"first.example\nshared.example\n".to_vec(),
            ),
            body(
                1,
                Some("advertising"),
                b"shared.example\nsecond.example\nads.cdn.example\n".to_vec(),
            ),
            body(
                2,
                Some("nsfw"),
                b"adult.example\nfirst.example\nadult.cdn.example\n".to_vec(),
            ),
        ]
    };

    let unfiltered = whitelisted(extracted(bodies()), "");
    assert_eq!(unfiltered.domains_in_all_categories, 6);
    assert_eq!(counted_one_by_one(&unfiltered.domains), 6);
    assert_eq!(unfiltered.generation.domains_per_format, 2 + 3 + 3 + 4);

    let filtered = whitelisted(extracted(bodies()), "*.cdn.example\nshared.example\n");
    assert_eq!(filtered.domains_in_all_categories, 3);
    assert_eq!(counted_one_by_one(&filtered.domains), 3);
    assert_eq!(filtered.progress.domains_after, 3);

    let only_left_out = whitelisted(
        extracted(vec![body(0, Some("nsfw"), b"adult.example\n".to_vec())]),
        "",
    );
    assert_eq!(only_left_out.domains_in_all_categories, 1);
}

#[test]
fn cancellation_during_the_measurement_stops_before_the_whitelist_is_parsed() {
    let domains = extracted(vec![
        body(0, Some("tracking"), hosts_body(4 * WORK_GRAIN)),
        body(1, Some("nsfw"), hosts_body(4 * WORK_GRAIN)),
    ]);
    let cancellation = Cancellation::default();
    cancellation.cancel();

    assert!(plan_whitelist("", domains, &cancellation).is_err());
}

#[test]
fn cancellation_during_the_whitelist_pass_stops_within_one_chunk_per_thread() {
    let domains = extracted(vec![body(0, None, hosts_body(40 * WORK_GRAIN))]);
    let stop = CancelOnFirstReport::new();
    let plan = plan_whitelist("*.blocked.example\n", domains, &stop.cancellation).unwrap();

    let outcome = on_stage_pool(|| apply_whitelist(plan, &stop.cancellation, &|_| stop.reported()));

    assert!(outcome.is_err());
    stop.assert_stopped_within_one_chunk_per_thread();
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
        abp: false,
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

fn list_lines(output_dir: &std::path::Path, generation_id: &str, file: &str) -> Vec<String> {
    use std::io::Read;

    let stored = std::fs::read(generations_dir(output_dir).join(generation_id).join(file)).unwrap();
    let mut text = String::new();
    flate2::read::GzDecoder::new(stored.as_slice())
        .read_to_string(&mut text)
        .unwrap();
    text.lines()
        .filter(|line| !line.is_empty() && !line.starts_with(['#', '!']))
        .map(str::to_string)
        .collect()
}

fn generated_tracking_lists(abp: bool) -> [Vec<String>; 3] {
    let output_dir = tempfile::tempdir().unwrap();
    let mut source = body(
        0,
        Some("tracking"),
        b"*.Wild.example.com\nplain.example.com\n||rule.example.com^$important\n".to_vec(),
    );
    source.abp = abp;
    let filtered = whitelisted(extracted(vec![source]), "");
    let generated = generate_outputs(
        output_dir.path().to_path_buf(),
        identity(),
        filtered.domains,
        &Cancellation::default(),
        &|_| {},
    )
    .unwrap();
    let generation_id = generated.generation.manifest.generation_id;
    ["hosts", "plain", "adblock"]
        .map(|format| format!("tracking_{format}.txt.gz"))
        .map(|file| list_lines(output_dir.path(), &generation_id, &file))
}

#[test]
fn wildcard_line_of_an_abp_source_reaches_all_three_output_formats() {
    let [hosts, plain, adblock] = generated_tracking_lists(true);
    assert_eq!(
        hosts,
        [
            "0.0.0.0 plain.example.com",
            "0.0.0.0 rule.example.com",
            "0.0.0.0 wild.example.com"
        ]
    );
    assert_eq!(
        plain,
        ["plain.example.com", "rule.example.com", "wild.example.com"]
    );
    assert_eq!(
        adblock,
        [
            "||plain.example.com^",
            "||rule.example.com^$important",
            "||wild.example.com^"
        ]
    );
}

#[test]
fn wildcard_line_of_a_source_without_the_abp_flag_is_still_dropped() {
    let [hosts, plain, adblock] = generated_tracking_lists(false);
    assert_eq!(
        hosts,
        ["0.0.0.0 plain.example.com", "0.0.0.0 rule.example.com"]
    );
    assert_eq!(plain, ["plain.example.com", "rule.example.com"]);
    assert_eq!(
        adblock,
        ["||plain.example.com^", "||rule.example.com^$important"]
    );
}

#[test]
fn cancellation_during_generation_stops_within_one_chunk_per_thread_and_leaves_no_generation() {
    let output_dir = tempfile::tempdir().unwrap();
    let published = output_dir.path().join("all_domains_hosts.txt.gz");
    std::fs::write(&published, b"previous build").unwrap();
    let filtered = whitelisted(
        extracted(vec![body(0, Some("tracking"), hosts_body(20 * WORK_GRAIN))]),
        "",
    );
    let stop = CancelOnFirstReport::new();

    let outcome = on_stage_pool(|| {
        generate_outputs(
            output_dir.path().to_path_buf(),
            identity(),
            filtered.domains,
            &stop.cancellation,
            &|event| {
                if matches!(event, GenerationEvent::DomainsWritten(..)) {
                    stop.reported();
                }
            },
        )
    });

    let error = outcome.err().expect("generation was cancelled");
    assert!(error.downcast_ref::<Cancelled>().is_some());
    stop.assert_stopped_within_one_chunk_per_thread();
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
    let (tick, ticks) = std::sync::mpsc::channel();
    let heartbeat = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(10));
        loop {
            ticker.tick().await;
            if tick.send(()).is_err() {
                return;
            }
        }
    });

    let stage_thread = StageThread::start().unwrap();
    let (extracted, ticks_while_blocked) = stage_thread
        .run(move || {
            ticks.try_iter().for_each(drop);
            let extractor = DomainExtractor::new();
            let mut domains = CategoryDomains::default();
            let extraction = extract_source(
                &extractor,
                body(0, None, hosts_body(30 * WORK_GRAIN)),
                &mut domains,
                &Cancellation::default(),
                &|_| {},
            )?;
            let ticks_while_blocked = (0..TICKS_WHILE_BLOCKED)
                .map_while(|_| ticks.recv_timeout(BLOCKED_STAGE_WAIT).ok())
                .count();
            Ok((extraction.domain_count, ticks_while_blocked))
        })
        .await
        .unwrap();

    heartbeat.abort();
    assert_eq!(extracted, 30 * WORK_GRAIN as u64);
    assert_eq!(ticks_while_blocked, TICKS_WHILE_BLOCKED);
}
