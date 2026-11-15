use super::*;
use chrono::TimeZone;
use std::io::Read;

fn order(minute: u32, attempt: i64) -> BuildOrder {
    BuildOrder {
        job_created_at: Utc.with_ymd_and_hms(2026, 3, 4, 5, minute, 0).unwrap(),
        attempt,
    }
}

fn identity(built: BuildOrder) -> BuildIdentity {
    BuildIdentity {
        job_id: format!("job-{}", built.job_created_at.timestamp()),
        job_created_at: built.job_created_at,
        attempt: built.attempt,
        inputs_digest: "a".repeat(64),
    }
}

fn written_file(directory: &Path, list: &str) -> ManifestFile {
    let name = format!("{list}_plain.txt.gz");
    let mut stored = HashingWriter::new(create_new_file(&directory.join(&name)).unwrap());
    stored.write_all(b"stored bytes").unwrap();
    let (_, sha256, size_bytes) = stored.finish();
    ManifestFile {
        name,
        list: list.to_string(),
        format: "plain".to_string(),
        domain_count: 1,
        size_bytes,
        uncompressed_bytes: 20,
        sha256,
    }
}

fn finished_generation(output_dir: &Path, built: BuildOrder) -> String {
    let unfinished = UnfinishedGeneration::create(output_dir).unwrap();
    let files = vec![written_file(unfinished.directory(), "all_domains")];
    unfinished
        .finish(identity(built), files)
        .unwrap()
        .manifest
        .generation_id
}

fn unfinished_directory(output_dir: &Path, name: &str) -> PathBuf {
    let directory = generation_dir(output_dir, name);
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("all_domains_plain.txt.gz"), b"half").unwrap();
    directory
}

fn names(output_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(generations_dir(output_dir))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn sorted(mut names: Vec<String>) -> Vec<String> {
    names.sort();
    names
}

#[test]
fn hashing_and_counting_writers_report_what_passed_through_them() {
    let mut hashed = HashingWriter::new(Vec::new());
    hashed.write_all(b"first ").unwrap();
    hashed.write_all(b"second").unwrap();
    let (stored, sha256, written) = hashed.finish();
    assert_eq!(stored, b"first second");
    assert_eq!(written, 12);
    assert_eq!(sha256, format!("{:x}", Sha256::digest(b"first second")));

    let mut counted = CountingWriter::new(Vec::new());
    counted.write_all(b"12345").unwrap();
    assert_eq!(counted.finish(), (b"12345".to_vec(), 5));
}

#[test]
fn finished_generation_has_a_manifest_that_reads_back_the_same() {
    let output = tempfile::tempdir().unwrap();
    let unfinished = UnfinishedGeneration::create(output.path()).unwrap();
    let directory = unfinished.directory().to_path_buf();
    let files = vec![
        written_file(&directory, "tracking"),
        written_file(&directory, "all_domains"),
    ];

    let written = unfinished.finish(identity(order(1, 2)), files).unwrap();

    let manifest = written.manifest;
    assert_eq!(manifest.version, MANIFEST_VERSION);
    assert_eq!(manifest.attempt, 2);
    assert_eq!(manifest.order(), order(1, 2));
    assert_eq!(
        manifest
            .files
            .iter()
            .map(|file| file.name.as_str())
            .collect::<Vec<_>>(),
        ["all_domains_plain.txt.gz", "tracking_plain.txt.gz"]
    );
    assert_eq!(manifest.total_size_bytes(), 24);
    assert_eq!(read_manifest(&directory).unwrap(), Some(manifest.clone()));
    assert!(manifest_exists(output.path(), &manifest.generation_id));
    let mut raw = String::new();
    File::open(directory.join(MANIFEST_NAME))
        .unwrap()
        .read_to_string(&mut raw)
        .unwrap();
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(json["generation_id"], manifest.generation_id);
    assert_eq!(json["files"][0]["sha256"], manifest.files[0].sha256);
    assert_eq!(json["files"][0]["list"], "all_domains");
}

#[test]
fn dropped_unfinished_generation_removes_its_directory() {
    let output = tempfile::tempdir().unwrap();
    let unfinished = UnfinishedGeneration::create(output.path()).unwrap();
    let directory = unfinished.directory().to_path_buf();
    written_file(&directory, "all_domains");

    drop(unfinished);

    assert!(!directory.exists());
    assert_eq!(names(output.path()), Vec::<String>::new());
}

#[test]
fn generation_without_files_or_with_a_repeated_file_name_is_not_finished() {
    let output = tempfile::tempdir().unwrap();
    let empty = UnfinishedGeneration::create(output.path()).unwrap();
    assert!(empty.finish(identity(order(1, 1)), Vec::new()).is_err());

    let repeated = UnfinishedGeneration::create(output.path()).unwrap();
    let file = written_file(repeated.directory(), "all_domains");
    assert!(repeated
        .finish(identity(order(1, 1)), vec![file.clone(), file])
        .is_err());
    assert_eq!(names(output.path()), Vec::<String>::new());
}

#[test]
fn existing_manifest_and_files_are_never_overwritten() {
    let output = tempfile::tempdir().unwrap();
    let unfinished = UnfinishedGeneration::create(output.path()).unwrap();
    let directory = unfinished.directory().to_path_buf();
    let file = written_file(&directory, "all_domains");
    assert!(create_new_file(&directory.join(&file.name)).is_err());
    fs::write(directory.join(MANIFEST_NAME), b"{}").unwrap();

    assert!(unfinished
        .finish(identity(order(1, 1)), vec![file])
        .is_err());
}

#[test]
fn publish_then_prune_keeps_exactly_current_and_previous() {
    let output = tempfile::tempdir().unwrap();
    let oldest = finished_generation(output.path(), order(1, 1));
    let older = finished_generation(output.path(), order(2, 1));
    let previous = finished_generation(output.path(), order(3, 1));
    let current = finished_generation(output.path(), order(4, 1));

    let report = prune_generations(
        output.path(),
        order(4, 1),
        &[current.as_str(), previous.as_str()],
        SystemTime::now(),
    )
    .unwrap();

    assert_eq!(report.removed, sorted(vec![oldest, older]));
    assert_eq!(
        names(output.path()),
        sorted(vec![current.clone(), previous.clone()])
    );
    assert_eq!(report.kept, sorted(vec![current, previous]));
}

#[test]
fn prune_leaves_a_finished_generation_of_a_newer_build_that_has_not_published_yet() {
    let output = tempfile::tempdir().unwrap();
    let current = finished_generation(output.path(), order(4, 1));
    let earlier_attempt = finished_generation(output.path(), order(4, 0));
    let newer_build = finished_generation(output.path(), order(5, 1));

    let report = prune_generations(
        output.path(),
        order(4, 1),
        &[current.as_str()],
        SystemTime::now(),
    )
    .unwrap();

    assert_eq!(report.removed, vec![earlier_attempt]);
    assert_eq!(names(output.path()), sorted(vec![current, newer_build]));
}

#[test]
fn prune_removes_crash_leftovers_without_a_manifest_only_after_an_hour() {
    let output = tempfile::tempdir().unwrap();
    let current = finished_generation(output.path(), order(4, 1));
    let leftover = unfinished_directory(output.path(), "leftover");
    let unreadable = unfinished_directory(output.path(), "unreadable");
    fs::write(unreadable.join(MANIFEST_NAME), b"not json").unwrap();
    fs::write(generations_dir(output.path()).join("stray-file"), b"kept").unwrap();
    let now = SystemTime::now();

    let young = prune_generations(output.path(), order(4, 1), &[current.as_str()], now).unwrap();
    assert_eq!(young.removed, Vec::<String>::new());
    assert!(leftover.exists() && unreadable.exists());

    let aged = prune_generations(
        output.path(),
        order(4, 1),
        &[current.as_str()],
        now + UNFINISHED_GENERATION_MAX_AGE + Duration::from_secs(1),
    )
    .unwrap();
    assert_eq!(aged.removed, ["leftover", "unreadable"]);
    assert_eq!(
        names(output.path()),
        sorted(vec![current, "stray-file".to_string()])
    );
}

#[test]
fn prune_of_a_target_with_no_generations_does_nothing() {
    let output = tempfile::tempdir().unwrap();
    let report = prune_generations(output.path(), order(1, 1), &[], SystemTime::now()).unwrap();
    assert_eq!(report, PruneReport::default());
}

#[test]
fn legacy_flat_files_are_removed_and_generations_are_left_alone() {
    let output = tempfile::tempdir().unwrap();
    let current = finished_generation(output.path(), order(1, 1));
    for legacy in [
        "all_domains_hosts.txt.gz",
        "tracking_plain.txt.gz",
        "all_domains.txt",
        ".all_domains_adblock.txt.gz.partial",
    ] {
        fs::write(output.path().join(legacy), b"legacy").unwrap();
    }
    fs::write(output.path().join("notes.md"), b"kept").unwrap();

    assert_eq!(remove_legacy_flat_files(output.path()).unwrap(), 4);

    let mut left: Vec<String> = fs::read_dir(output.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    left.sort();
    assert_eq!(left, [GENERATIONS_DIR, "notes.md"]);
    assert!(manifest_exists(output.path(), &current));
    assert_eq!(
        remove_legacy_flat_files(&output.path().join("missing")).unwrap(),
        0
    );
}

#[test]
fn discard_removes_one_generation_and_tolerates_a_missing_one() {
    let output = tempfile::tempdir().unwrap();
    let kept = finished_generation(output.path(), order(1, 1));
    let discarded = finished_generation(output.path(), order(2, 1));

    discard_generation(output.path(), &discarded).unwrap();
    discard_generation(output.path(), &discarded).unwrap();

    assert_eq!(names(output.path()), vec![kept]);
    assert!(!manifest_exists(output.path(), &discarded));
    assert!(!manifest_exists(output.path(), "../escape"));
}

#[test]
fn empty_directories_of_a_deleted_target_are_removed_up_to_the_first_one_in_use() {
    let data = tempfile::tempdir().unwrap();
    let users = data.path().join("users");
    let generations = users.join("sam").join("output").join(GENERATIONS_DIR);
    fs::create_dir_all(&generations).unwrap();
    fs::create_dir_all(users.join("alex")).unwrap();

    remove_empty_directories(&generations, 3).unwrap();

    assert!(!users.join("sam").exists());
    assert!(users.join("alex").exists());

    let in_use = users.join("alex").join("output").join(GENERATIONS_DIR);
    fs::create_dir_all(&in_use).unwrap();
    fs::write(users.join("alex").join("output").join("kept.txt"), b"x").unwrap();
    remove_empty_directories(&in_use, 3).unwrap();
    assert!(!in_use.exists());
    assert!(users.join("alex").join("output").join("kept.txt").exists());
}

#[test]
fn list_names_are_limited_to_safe_characters() {
    for safe in ["tracking", "all_domains", "a-b_c9"] {
        assert!(is_safe_list_name(safe));
    }
    for unsafe_name in ["", "../x", "a/b", "a.b", "a b", &"x".repeat(65)] {
        assert!(!is_safe_list_name(unsafe_name));
    }
}
