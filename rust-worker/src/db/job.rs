use bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::{
    options::{FindOneAndUpdateOptions, ReturnDocument},
    Collection, Database,
};
use serde::{Deserialize, Serialize};
use tracing::error;

use super::progress::{
    error_code, JobProgress, JobResult, LimitMeasurement, INTERNAL_ERROR_MESSAGE,
};

/// Job type enum
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    #[default]
    Manual,
    Scheduled,
    Admin,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConfigSnapshot {
    pub blocklists: String,
    #[serde(default)]
    pub whitelist: Option<String>,
    #[serde(default)]
    pub limits: Option<SnapshotLimits>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct SnapshotLimits {
    #[serde(default)]
    pub max_domains: Option<i64>,
    #[serde(default)]
    pub max_source_lists: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Job {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub job_id: String,
    pub username: String,
    #[serde(default)]
    pub user_id: Option<ObjectId>,
    pub created_at: bson::DateTime,
    #[serde(rename = "type", default)]
    pub job_type: JobType,
    #[serde(default)]
    pub force_rebuild: bool,
    #[serde(default)]
    pub config_snapshot: Option<ConfigSnapshot>,
    #[serde(default)]
    pub attempt: i64,
}

impl Job {
    fn snapshot_limit(&self, chosen: fn(&SnapshotLimits) -> Option<i64>) -> Option<u64> {
        let limits = self.config_snapshot.as_ref()?.limits.as_ref()?;
        chosen(limits).and_then(|limit| u64::try_from(limit).ok())
    }

    pub fn max_domains(&self) -> Option<u64> {
        self.snapshot_limit(|limits| limits.max_domains)
    }

    pub fn max_source_lists(&self) -> Option<u64> {
        self.snapshot_limit(|limits| limits.max_source_lists)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum JobWriteError {
    #[error("the job lease is no longer held by this worker")]
    LeaseLost,
    #[error(transparent)]
    Database(#[from] mongodb::error::Error),
    #[error(transparent)]
    Encode(#[from] bson::ser::Error),
}

#[derive(Debug)]
pub enum Claim {
    Claimed(Box<Job>),
    Unusable,
    NoneQueued,
}

pub fn initial_queue_progress() -> Document {
    doc! {
        "current_step": "queued",
        "stage": "queue",
        "total_sources": 0,
        "processed_sources": 0,
        "current_source": Bson::Null,
        "sources": [],
        "whitelist": Bson::Null,
        "generation": Bson::Null,
        "queue_position": Bson::Null,
        "queue_delay_remaining_ms": Bson::Null,
        "stage_started_at": Bson::Null,
        "stages": {
            "downloading": Bson::Null,
            "whitelist": Bson::Null,
            "generation": Bson::Null,
        },
        "stage_snapshots": {},
    }
}

fn increment_or_start(field: &str) -> Document {
    let path = format!("${field}");
    doc! {
        "$cond": [
            { "$isNumber": &path },
            { "$add": [&path, 1] },
            1,
        ]
    }
}

fn requeue_fields() -> Document {
    doc! {
        "status": "queued",
        "worker_id": Bson::Null,
        "claimed_at": Bson::Null,
        "heartbeat_at": Bson::Null,
        "progress": initial_queue_progress(),
    }
}

fn revision_bump(set: Document) -> Document {
    doc! {
        "$set": set,
        "$inc": { "rev": 1 },
        "$currentDate": { "updated_at": true },
    }
}

/// Job repository for MongoDB operations
#[derive(Clone)]
pub struct JobRepository {
    collection: Collection<Document>,
    worker_id: String,
}

impl JobRepository {
    /// Create a new job repository
    pub fn new(db: &Database, worker_id: String) -> Self {
        Self {
            collection: db.collection("jobs"),
            worker_id,
        }
    }

    pub async fn claim_next(&self) -> Result<Claim, JobWriteError> {
        let filter = doc! {
            "status": "queued",
            "worker_id": null
        };

        let update = vec![doc! {
            "$set": {
                "status": "processing",
                "worker_id": &self.worker_id,
                "claimed_at": "$$NOW",
                "heartbeat_at": "$$NOW",
                "started_at": { "$ifNull": ["$started_at", "$$NOW"] },
                "attempt_started_at": "$$NOW",
                "attempt": increment_or_start("attempt"),
                "rev": increment_or_start("rev"),
                "updated_at": "$$NOW",
            }
        }];

        let options = FindOneAndUpdateOptions::builder()
            .sort(doc! { "priority": 1, "created_at": 1 })
            .return_document(ReturnDocument::After)
            .build();

        let Some(document) = self
            .collection
            .find_one_and_update(filter, update)
            .with_options(options)
            .await?
        else {
            return Ok(Claim::NoneQueued);
        };

        let stored_id = document.get("_id").cloned().unwrap_or(Bson::Null);
        match bson::from_document::<Job>(document) {
            Ok(job) => Ok(Claim::Claimed(Box::new(job))),
            Err(unreadable) => {
                error!("Claimed job {stored_id} cannot be read: {unreadable}");
                self.write_failure(
                    &stored_id,
                    &JobResult::failure(
                        error_code::INTERNAL,
                        vec![INTERNAL_ERROR_MESSAGE.to_string()],
                    ),
                    None,
                )
                .await?;
                Ok(Claim::Unusable)
            }
        }
    }

    async fn update_under_lease(
        &self,
        stored_id: &Bson,
        update: Document,
    ) -> Result<(), JobWriteError> {
        let result = self
            .collection
            .update_one(
                doc! {
                    "_id": stored_id.clone(),
                    "worker_id": &self.worker_id,
                    "status": "processing"
                },
                update,
            )
            .await?;

        if result.matched_count == 0 {
            return Err(JobWriteError::LeaseLost);
        }
        Ok(())
    }

    async fn write_under_lease(
        &self,
        stored_id: &Bson,
        set: Document,
    ) -> Result<(), JobWriteError> {
        self.update_under_lease(stored_id, revision_bump(set)).await
    }

    async fn write_failure(
        &self,
        stored_id: &Bson,
        result: &JobResult,
        progress: Option<&JobProgress>,
    ) -> Result<(), JobWriteError> {
        let mut set = doc! {
            "status": "failed",
            "completed_at": bson::DateTime::now(),
            "result": bson::to_document(result)?,
        };
        if let Some(progress) = progress {
            set.insert("progress", bson::to_document(progress)?);
        }
        self.write_under_lease(stored_id, set).await
    }

    pub async fn write_progress_fields(
        &self,
        job_id: &ObjectId,
        fields: Document,
    ) -> Result<(), JobWriteError> {
        self.write_under_lease(&Bson::ObjectId(*job_id), fields)
            .await
    }

    pub async fn heartbeat(&self, job_id: &ObjectId) -> Result<bool, JobWriteError> {
        let written = self
            .update_under_lease(
                &Bson::ObjectId(*job_id),
                doc! { "$set": { "heartbeat_at": bson::DateTime::now() } },
            )
            .await;
        match written {
            Ok(()) => Ok(true),
            Err(JobWriteError::LeaseLost) => Ok(false),
            Err(failed) => Err(failed),
        }
    }

    pub async fn complete(
        &self,
        job_id: &ObjectId,
        result: &JobResult,
        progress: &JobProgress,
    ) -> Result<(), JobWriteError> {
        self.write_under_lease(
            &Bson::ObjectId(*job_id),
            doc! {
                "status": "completed",
                "completed_at": bson::DateTime::now(),
                "result": bson::to_document(result)?,
                "progress": bson::to_document(progress)?,
            },
        )
        .await
    }

    pub async fn fail(
        &self,
        job_id: &ObjectId,
        code: &str,
        errors: Vec<String>,
        progress: Option<&JobProgress>,
    ) -> Result<(), JobWriteError> {
        self.write_failure(
            &Bson::ObjectId(*job_id),
            &JobResult::failure(code, errors),
            progress,
        )
        .await
    }

    pub async fn fail_over_domain_limit(
        &self,
        job_id: &ObjectId,
        error: String,
        limit: LimitMeasurement,
        progress: Option<&JobProgress>,
    ) -> Result<(), JobWriteError> {
        self.write_failure(
            &Bson::ObjectId(*job_id),
            &JobResult::over_domain_limit(error, limit),
            progress,
        )
        .await
    }

    pub async fn skip(&self, job_id: &ObjectId, reason: &str) -> Result<(), JobWriteError> {
        self.write_under_lease(
            &Bson::ObjectId(*job_id),
            doc! {
                "status": "skipped",
                "completed_at": bson::DateTime::now(),
                "result": bson::to_document(&JobResult::skipped(reason))?,
                "progress": initial_queue_progress(),
            },
        )
        .await
    }

    pub async fn release(&self, job_id: &ObjectId) -> Result<(), JobWriteError> {
        self.write_under_lease(&Bson::ObjectId(*job_id), requeue_fields())
            .await
    }

    pub async fn release_all(&self) -> Result<u64, JobWriteError> {
        let result = self
            .collection
            .update_many(
                doc! {
                    "worker_id": &self.worker_id,
                    "status": "processing"
                },
                revision_bump(requeue_fields()),
            )
            .await?;

        Ok(result.modified_count)
    }
}

#[cfg(test)]
#[path = "job_tests.rs"]
mod tests;
