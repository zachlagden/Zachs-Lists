use anyhow::Result;
use bson::oid::ObjectId;
use mongodb::Database;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{interval, sleep, timeout};
use tracing::{debug, error, info, warn};

use crate::cancellation::Cancellation;
use crate::config::Config;
use crate::db::job::{Claim, Job, JobRepository, JobWriteError};
use crate::db::progress::JobProgress;
use crate::db::progress::{error_code, INTERNAL_ERROR_MESSAGE};
use crate::db::worker::WorkerRegistry;
use crate::processor::{BuildError, BuildFailure, JobProcessor};

const SHUTDOWN_CHECK_INTERVAL: Duration = Duration::from_millis(100);
const SHUTDOWN_STOP_TIMEOUT: Duration = Duration::from_secs(3);

struct ActiveJob {
    id: ObjectId,
    job_id: String,
    cancellation: Cancellation,
}

enum JobEnd {
    Finished(Result<(), BuildFailure>),
    Panicked(tokio::task::JoinError),
    ShutDown,
}

/// Worker that processes jobs from the queue
pub struct Worker {
    config: Config,
    db: Database,
    shutdown: Arc<AtomicBool>,
    current_job: Arc<Mutex<Option<ActiveJob>>>,
}

impl Worker {
    /// Create a new worker
    pub fn new(config: Config, db: Database, shutdown: Arc<AtomicBool>) -> Self {
        Self {
            config,
            db,
            shutdown,
            current_job: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the worker main loop
    pub async fn run(&self) -> Result<()> {
        info!("Worker {} starting", self.config.worker_id);

        let job_repo = JobRepository::new(&self.db, self.config.worker_id.clone());

        // Start heartbeat task
        let heartbeat_handle = self.spawn_heartbeat_task();

        // Main job processing loop
        loop {
            if self.shutdown.load(Ordering::Relaxed) {
                info!("Shutdown signal received, stopping worker");
                break;
            }

            // Try to claim a job
            match job_repo.claim_next().await {
                Ok(Claim::Claimed(job)) => {
                    info!(
                        "Claimed job {} for user {} (attempt {})",
                        job.job_id, job.username, job.attempt
                    );
                    self.run_job(&job_repo, *job).await;
                }
                Ok(Claim::Unusable) => {
                    warn!("Failed an unreadable job and moved on");
                }
                Ok(Claim::NoneQueued) => {
                    // No jobs available, wait before polling again
                    debug!("No jobs available, waiting...");
                    sleep(Duration::from_secs(2)).await;
                }
                Err(e) => {
                    error!("Failed to claim job: {}", e);
                    sleep(Duration::from_secs(5)).await;
                }
            }
        }

        // Cleanup
        heartbeat_handle.abort();

        match job_repo.release_all().await {
            Ok(0) => {}
            Ok(released) => info!("Released {} jobs still held by this worker", released),
            Err(e) => error!("Failed to release held jobs: {}", e),
        }

        let registry = WorkerRegistry::new(&self.db, self.config.worker_id.clone());
        if let Err(e) = registry.deregister().await {
            error!("Failed to deregister worker: {}", e);
        }

        info!("Worker {} stopped", self.config.worker_id);
        Ok(())
    }

    async fn run_job(&self, job_repo: &JobRepository, job: Job) {
        let cancellation = Cancellation::default();
        self.set_current_job(Some(ActiveJob {
            id: job.id,
            job_id: job.job_id.clone(),
            cancellation: cancellation.clone(),
        }))
        .await;

        let job_id = job.id;
        let job_name = job.job_id.clone();

        match JobProcessor::new(
            self.config.clone(),
            JobRepository::new(&self.db, self.config.worker_id.clone()),
            &self.db,
            cancellation.clone(),
        ) {
            Ok(processor) => {
                let build = tokio::spawn(async move { processor.process_job(&job).await });
                let end = self.wait_for_build(build, &cancellation).await;
                self.settle(job_repo, &job_id, &job_name, end).await;
            }
            Err(e) => {
                error!("Failed to create processor for job {}: {:#}", job_name, e);
                self.fail_internal(job_repo, &job_id, &job_name, None).await;
            }
        }

        self.set_current_job(None).await;
    }

    async fn wait_for_build(
        &self,
        mut build: JoinHandle<Result<(), BuildFailure>>,
        cancellation: &Cancellation,
    ) -> JobEnd {
        loop {
            tokio::select! {
                joined = &mut build => {
                    return match joined {
                        Ok(outcome) => JobEnd::Finished(outcome),
                        Err(panic) => JobEnd::Panicked(panic),
                    };
                }
                _ = sleep(SHUTDOWN_CHECK_INTERVAL) => {
                    if self.shutdown.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }

        cancellation.cancel();
        build.abort();
        if timeout(SHUTDOWN_STOP_TIMEOUT, &mut build).await.is_err() {
            warn!(
                "Build did not stop within {:?}; releasing its job anyway",
                SHUTDOWN_STOP_TIMEOUT
            );
        }
        JobEnd::ShutDown
    }

    async fn settle(
        &self,
        job_repo: &JobRepository,
        job_id: &ObjectId,
        job_name: &str,
        end: JobEnd,
    ) {
        let failure = match end {
            JobEnd::Finished(Ok(())) => return,
            JobEnd::Finished(Err(failure)) => failure,
            JobEnd::Panicked(panic) => {
                error!("Job {} panicked: {}", job_name, panic);
                self.fail_internal(job_repo, job_id, job_name, None).await;
                return;
            }
            JobEnd::ShutDown => {
                info!("Releasing job {} back to the queue", job_name);
                Self::log_write(job_name, job_repo.release(job_id).await);
                return;
            }
        };
        let progress = failure.progress.as_deref();
        match failure.error {
            BuildError::Cancelled | BuildError::LeaseLost => {
                warn!(
                    "Stopped job {} because this worker no longer holds its lease",
                    job_name
                );
            }
            BuildError::Rejected { code, message } => {
                info!("Job {} failed ({}): {}", job_name, code, message);
                Self::log_write(
                    job_name,
                    job_repo.fail(job_id, code, vec![message], progress).await,
                );
            }
            BuildError::OverDomainLimit { limit, message } => {
                info!(
                    "Job {} failed ({}): {}",
                    job_name,
                    error_code::DOMAIN_LIMIT_EXCEEDED,
                    message
                );
                Self::log_write(
                    job_name,
                    job_repo
                        .fail_over_domain_limit(job_id, message, limit, progress)
                        .await,
                );
            }
            BuildError::Internal(e) => {
                error!("Job {} failed with an internal error: {:#}", job_name, e);
                self.fail_internal(job_repo, job_id, job_name, progress)
                    .await;
            }
        }
    }

    async fn fail_internal(
        &self,
        job_repo: &JobRepository,
        job_id: &ObjectId,
        job_name: &str,
        progress: Option<&JobProgress>,
    ) {
        let written = job_repo
            .fail(
                job_id,
                error_code::INTERNAL,
                vec![INTERNAL_ERROR_MESSAGE.to_string()],
                progress,
            )
            .await;
        Self::log_write(job_name, written);
    }

    fn log_write(job_name: &str, written: Result<(), JobWriteError>) {
        match written {
            Ok(()) => {}
            Err(JobWriteError::LeaseLost) => warn!(
                "Wrote nothing for job {} because this worker no longer holds its lease",
                job_name
            ),
            Err(e) => error!("Failed to write the outcome of job {}: {}", job_name, e),
        }
    }

    async fn set_current_job(&self, active: Option<ActiveJob>) {
        let mut current = self.current_job.lock().await;
        *current = active;
    }

    /// Spawn heartbeat background task
    fn spawn_heartbeat_task(&self) -> JoinHandle<()> {
        let db = self.db.clone();
        let worker_id = self.config.worker_id.clone();
        let current_job = Arc::clone(&self.current_job);
        let heartbeat_interval = self.config.heartbeat_interval_secs;
        let shutdown = Arc::clone(&self.shutdown);

        tokio::spawn(async move {
            let job_repo = JobRepository::new(&db, worker_id.clone());
            let registry = WorkerRegistry::new(&db, worker_id);
            let mut ticker = interval(Duration::from_secs(heartbeat_interval));

            loop {
                ticker.tick().await;

                if shutdown.load(Ordering::Relaxed) {
                    break;
                }

                // Send heartbeat for current job
                let active = {
                    let current = current_job.lock().await;
                    current
                        .as_ref()
                        .map(|job| (job.id, job.job_id.clone(), job.cancellation.clone()))
                };

                let job_name = active.as_ref().map(|(_, name, _)| name.as_str());
                if let Err(e) = registry.heartbeat(job_name).await {
                    error!("Worker heartbeat error: {}", e);
                }

                if let Some((id, name, cancellation)) = active {
                    match job_repo.heartbeat(&id).await {
                        Ok(true) => debug!("Heartbeat sent for job {}", name),
                        Ok(false) => {
                            warn!("Lease on job {} is lost; cancelling the build", name);
                            cancellation.cancel();
                        }
                        Err(e) => error!("Heartbeat error: {}", e),
                    }
                }
            }
        })
    }
}
