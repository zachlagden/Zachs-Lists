use anyhow::{ensure, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tracing::{info, warn};

use crate::db::progress::OutputFile;

pub const GENERATIONS_DIR: &str = "generations";
pub const MANIFEST_NAME: &str = "manifest.json";
pub const MANIFEST_VERSION: u32 = 1;
pub const UNFINISHED_GENERATION_MAX_AGE: Duration = Duration::from_secs(60 * 60);
const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_LIST_NAME_LENGTH: usize = 64;

pub fn is_safe_list_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_LIST_NAME_LENGTH
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildIdentity {
    pub job_id: String,
    pub job_created_at: DateTime<Utc>,
    pub attempt: i64,
    pub inputs_digest: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct BuildOrder {
    pub job_created_at: DateTime<Utc>,
    pub attempt: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    pub name: String,
    pub list: String,
    pub format: String,
    pub domain_count: u64,
    pub size_bytes: u64,
    pub uncompressed_bytes: u64,
    pub sha256: String,
}

impl ManifestFile {
    pub fn output_file(&self) -> OutputFile {
        OutputFile {
            name: self.name.clone(),
            format: self.format.clone(),
            size_bytes: self.size_bytes,
            domain_count: self.domain_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub generation_id: String,
    pub job_id: String,
    pub job_created_at: DateTime<Utc>,
    pub attempt: i64,
    pub created_at: DateTime<Utc>,
    pub inputs_digest: String,
    pub files: Vec<ManifestFile>,
}

impl Manifest {
    pub fn order(&self) -> BuildOrder {
        BuildOrder {
            job_created_at: self.job_created_at,
            attempt: self.attempt,
        }
    }

    pub fn total_size_bytes(&self) -> u64 {
        self.files.iter().map(|file| file.size_bytes).sum()
    }
}

pub struct HashingWriter<W: Write> {
    inner: W,
    hasher: Sha256,
    written: u64,
}

impl<W: Write> HashingWriter<W> {
    pub fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            written: 0,
        }
    }

    pub fn finish(self) -> (W, String, u64) {
        (
            self.inner,
            format!("{:x}", self.hasher.finalize()),
            self.written,
        )
    }
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let accepted = self.inner.write(buffer)?;
        self.hasher.update(&buffer[..accepted]);
        self.written += accepted as u64;
        Ok(accepted)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

pub struct CountingWriter<W: Write> {
    inner: W,
    written: u64,
}

impl<W: Write> CountingWriter<W> {
    pub fn new(inner: W) -> Self {
        Self { inner, written: 0 }
    }

    pub fn finish(self) -> (W, u64) {
        (self.inner, self.written)
    }
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let accepted = self.inner.write(buffer)?;
        self.written += accepted as u64;
        Ok(accepted)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

pub fn create_new_file(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

fn sync_directory(directory: &Path) -> Result<()> {
    File::open(directory)
        .and_then(|opened| opened.sync_all())
        .with_context(|| format!("Could not sync directory {}", directory.display()))
}

fn remove_directory(directory: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(directory) {
        Err(error) if error.kind() != ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

pub fn generations_dir(output_dir: &Path) -> PathBuf {
    output_dir.join(GENERATIONS_DIR)
}

pub fn generation_dir(output_dir: &Path, generation_id: &str) -> PathBuf {
    generations_dir(output_dir).join(generation_id)
}

pub struct UnfinishedGeneration {
    generation_id: String,
    directory: PathBuf,
    parent: PathBuf,
    finished: bool,
}

impl UnfinishedGeneration {
    pub fn create(output_dir: &Path) -> Result<Self> {
        let parent = generations_dir(output_dir);
        fs::create_dir_all(&parent)
            .with_context(|| format!("Could not create {}", parent.display()))?;
        let generation_id = uuid::Uuid::new_v4().to_string();
        let directory = parent.join(&generation_id);
        fs::create_dir(&directory)
            .with_context(|| format!("Could not create {}", directory.display()))?;
        Ok(Self {
            generation_id,
            directory,
            parent,
            finished: false,
        })
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn finish(
        mut self,
        identity: BuildIdentity,
        mut files: Vec<ManifestFile>,
    ) -> Result<WrittenGeneration> {
        ensure!(!files.is_empty(), "A generation needs at least one file");
        files.sort_by(|a, b| a.name.cmp(&b.name));
        ensure!(
            files.windows(2).all(|pair| pair[0].name != pair[1].name),
            "Two lists in one generation share a file name"
        );
        let manifest = Manifest {
            version: MANIFEST_VERSION,
            generation_id: self.generation_id.clone(),
            job_id: identity.job_id,
            job_created_at: identity.job_created_at,
            attempt: identity.attempt,
            created_at: Utc::now(),
            inputs_digest: identity.inputs_digest,
            files,
        };
        let encoded = serde_json::to_vec_pretty(&manifest)?;
        ensure!(
            encoded.len() as u64 <= MAX_MANIFEST_BYTES,
            "The generation manifest is too large"
        );
        let mut manifest_file = create_new_file(&self.directory.join(MANIFEST_NAME))?;
        manifest_file.write_all(&encoded)?;
        manifest_file.sync_all()?;
        sync_directory(&self.directory)?;
        sync_directory(&self.parent)?;
        self.finished = true;
        Ok(WrittenGeneration { manifest })
    }
}

impl Drop for UnfinishedGeneration {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        if let Err(error) = remove_directory(&self.directory) {
            warn!(
                "Could not remove unfinished generation {:?}: {}",
                self.directory, error
            );
        }
    }
}

#[derive(Debug)]
pub struct WrittenGeneration {
    pub manifest: Manifest,
}

pub fn discard_generation(output_dir: &Path, generation_id: &str) -> Result<()> {
    let directory = generation_dir(output_dir, generation_id);
    remove_directory(&directory)
        .with_context(|| format!("Could not remove generation {}", directory.display()))
}

pub fn read_manifest(directory: &Path) -> Result<Option<Manifest>> {
    let path = directory.join(MANIFEST_NAME);
    let size = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    ensure!(
        size <= MAX_MANIFEST_BYTES,
        "The generation manifest is too large"
    );
    Ok(Some(serde_json::from_slice(&fs::read(&path)?)?))
}

pub fn manifest_exists(output_dir: &Path, generation_id: &str) -> bool {
    is_safe_list_name(generation_id)
        && generation_dir(output_dir, generation_id)
            .join(MANIFEST_NAME)
            .is_file()
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct PruneReport {
    pub removed: Vec<String>,
    pub kept: Vec<String>,
}

fn is_older_than(directory: &Path, age: Duration, now: SystemTime) -> Result<bool> {
    let modified = fs::metadata(directory)?.modified()?;
    Ok(now
        .duration_since(modified)
        .is_ok_and(|elapsed| elapsed > age))
}

pub fn prune_generations(
    output_dir: &Path,
    published: BuildOrder,
    keep: &[&str],
    now: SystemTime,
) -> Result<PruneReport> {
    let parent = generations_dir(output_dir);
    let mut report = PruneReport::default();
    let entries = match fs::read_dir(&parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(report),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if keep.contains(&name.as_str()) {
            report.kept.push(name);
            continue;
        }
        let directory = entry.path();
        let finished = match read_manifest(&directory) {
            Ok(manifest) => manifest,
            Err(error) => {
                warn!(
                    "Generation {:?} has an unreadable manifest: {:#}",
                    directory, error
                );
                None
            }
        };
        let removable = match finished {
            Some(manifest) => manifest.order() < published,
            None => is_older_than(&directory, UNFINISHED_GENERATION_MAX_AGE, now)?,
        };
        if removable {
            remove_directory(&directory)?;
            report.removed.push(name);
        } else {
            report.kept.push(name);
        }
    }
    report.removed.sort();
    report.kept.sort();
    if !report.removed.is_empty() {
        info!(
            "Pruned {} old generations under {:?}",
            report.removed.len(),
            parent
        );
    }
    Ok(report)
}

fn is_legacy_output_name(name: &str) -> bool {
    name.ends_with(".txt.gz") || name.ends_with(".txt") || name.ends_with(".partial")
}

pub fn remove_legacy_flat_files(output_dir: &Path) -> Result<u64> {
    let mut removed = 0;
    let entries = match fs::read_dir(output_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(removed),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            continue;
        }
        if is_legacy_output_name(&entry.file_name().to_string_lossy()) {
            fs::remove_file(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn remove_empty_directories(innermost: &Path, levels: usize) -> Result<()> {
    let mut directory = Some(innermost);
    for _ in 0..levels {
        let Some(current) = directory else {
            break;
        };
        match fs::remove_dir(current) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) if error.kind() == ErrorKind::DirectoryNotEmpty => break,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Could not remove {}", current.display()))
            }
        }
        directory = current.parent();
    }
    Ok(())
}

#[cfg(test)]
#[path = "generation_tests.rs"]
mod tests;
