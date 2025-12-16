use anyhow::Result;
use bson::{doc, oid::ObjectId, DateTime as BsonDateTime};
use chrono::Utc;
use mongodb::{
    options::{FindOneAndUpdateOptions, ReturnDocument},
    Collection, Database,
};
use serde::{Deserialize, Serialize};

use super::progress::{JobProgress, JobResult};

/// Job type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    Manual,
    Scheduled,
    Admin,
}

/// Job status enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Processing,
    Completed,
    Failed,
    Skipped,
}

/// Job document from MongoDB
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    #[serde(rename = "_id")]
    pub id: ObjectId,
    pub job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<ObjectId>,
    pub username: String,
    #[serde(rename = "type")]
    pub job_type: JobType,
    pub status: JobStatus,
    pub priority: i32,
    pub progress: JobProgress,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<JobResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<BsonDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<BsonDateTime>,
    pub created_at: BsonDateTime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worker_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<BsonDateTime>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heartbeat_at: Option<BsonDateTime>,
    #[serde(default)]
    pub read: bool,
}

/// Job repository for MongoDB operations
pub struct JobRepository {
    collection: Collection<Job>,
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

    /// Claim the next available job (atomic operation)
    pub async fn claim_next(&self) -> Result<Option<Job>> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());

        let filter = doc! {
            "status": "queued",
            "worker_id": null
        };

        let update = doc! {
            "$set": {
                "status": "processing",
                "worker_id": &self.worker_id,
                "claimed_at": now,
                "heartbeat_at": now,
                "started_at": now
            }
        };

        let options = FindOneAndUpdateOptions::builder()
            .sort(doc! { "priority": 1, "created_at": 1 })
            .return_document(ReturnDocument::After)
            .build();

        let result = self
            .collection
            .find_one_and_update(filter, update)
            .with_options(options)
            .await?;

        Ok(result)
    }

    /// Update job progress
    pub async fn update_progress(&self, job_id: &ObjectId, progress: &JobProgress) -> Result<()> {
        let progress_doc = bson::to_document(progress)?;

        self.collection
            .update_one(
                doc! { "_id": job_id },
                doc! { "$set": { "progress": progress_doc } },
            )
            .await?;

        Ok(())
    }

    /// Update heartbeat timestamp
    pub async fn heartbeat(&self, job_id: &str) -> Result<bool> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());

        let result = self
            .collection
            .update_one(
                doc! {
                    "job_id": job_id,
                    "worker_id": &self.worker_id,
                    "status": "processing"
                },
                doc! { "$set": { "heartbeat_at": now } },
            )
            .await?;

        Ok(result.modified_count > 0)
    }

    /// Complete a job successfully
    pub async fn complete(&self, job_id: &ObjectId, result: JobResult) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let result_doc = bson::to_document(&result)?;

        self.collection
            .update_one(
                doc! { "_id": job_id },
                doc! {
                    "$set": {
                        "status": "completed",
                        "completed_at": now,
                        "result": result_doc
                    }
                },
            )
            .await?;

        Ok(())
    }

    /// Fail a job
    pub async fn fail(&self, job_id: &ObjectId, errors: Vec<String>) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let result = JobResult::failure(errors);
        let result_doc = bson::to_document(&result)?;

        self.collection
            .update_one(
                doc! { "_id": job_id },
                doc! {
                    "$set": {
                        "status": "failed",
                        "completed_at": now,
                        "result": result_doc
                    }
                },
            )
            .await?;

        Ok(())
    }

    /// Skip a job
    pub async fn skip(&self, job_id: &ObjectId, reason: String) -> Result<()> {
        let now = BsonDateTime::from_millis(Utc::now().timestamp_millis());
        let result = JobResult::skipped(reason);
        let result_doc = bson::to_document(&result)?;

        self.collection
            .update_one(
                doc! { "_id": job_id },
                doc! {
                    "$set": {
                        "status": "skipped",
                        "completed_at": now,
                        "result": result_doc
                    }
                },
            )
            .await?;

        Ok(())
    }

    /// Release a job back to the queue (on shutdown)
    pub async fn release(&self, job_id: &str) -> Result<bool> {
        let result = self
            .collection
            .update_one(
                doc! {
                    "job_id": job_id,
                    "worker_id": &self.worker_id,
                    "status": "processing"
                },
                doc! {
                    "$set": {
                        "status": "queued",
                        "worker_id": null,
                        "claimed_at": null,
                        "heartbeat_at": null,
                        "started_at": null
                    }
                },
            )
            .await?;

        Ok(result.modified_count > 0)
    }

    /// Release all jobs held by this worker
    pub async fn release_all(&self) -> Result<u64> {
        let result = self
            .collection
            .update_many(
                doc! {
                    "worker_id": &self.worker_id,
                    "status": "processing"
                },
                doc! {
                    "$set": {
                        "status": "queued",
                        "worker_id": null,
                        "claimed_at": null,
                        "heartbeat_at": null,
                        "started_at": null
                    }
                },
            )
            .await?;

        Ok(result.modified_count)
    }
}
