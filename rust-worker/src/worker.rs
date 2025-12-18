use anyhow::Result;
use mongodb::Database;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::{interval, sleep};
use tracing::{debug, error, info, warn};

use crate::config::Config;
use crate::db::job::JobRepository;
use crate::processor::JobProcessor;

/// Worker that processes jobs from the queue
pub struct Worker {
    config: Config,
    db: Database,
    shutdown: Arc<AtomicBool>,
    current_job: Arc<Mutex<Option<String>>>,
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
                Ok(Some(job)) => {
                    info!("Claimed job {} for user {}", job.job_id, job.username);

                    // Store current job for heartbeat
                    {
                        let mut current = self.current_job.lock().await;
                        *current = Some(job.job_id.clone());
                    }

                    // Create processor for this job
                    let processor = match JobProcessor::new(
                        self.config.clone(),
                        JobRepository::new(&self.db, self.config.worker_id.clone()),
                        &self.db,
                    ) {
                        Ok(p) => p,
                        Err(e) => {
                            error!("Failed to create processor: {}", e);
                            continue;
                        }
                    };

                    // Process the job
                    if let Err(e) = processor.process_job(&job).await {
                        error!("Job {} failed with error: {}", job.job_id, e);

                        // Mark as failed
                        if let Err(fail_err) = job_repo
                            .fail(&job.id, vec![e.to_string()])
                            .await
                        {
                            error!("Failed to mark job as failed: {}", fail_err);
                        }
                    }

                    // Clear current job
                    {
                        let mut current = self.current_job.lock().await;
                        *current = None;
                    }
                }
                Ok(None) => {
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
        self.release_jobs(&job_repo).await?;

        info!("Worker {} stopped", self.config.worker_id);
        Ok(())
    }

    /// Spawn heartbeat background task
    fn spawn_heartbeat_task(&self) -> tokio::task::JoinHandle<()> {
        let db = self.db.clone();
        let worker_id = self.config.worker_id.clone();
        let current_job = Arc::clone(&self.current_job);
        let heartbeat_interval = self.config.heartbeat_interval_secs;
        let shutdown = Arc::clone(&self.shutdown);

        tokio::spawn(async move {
            let job_repo = JobRepository::new(&db, worker_id);
            let mut ticker = interval(Duration::from_secs(heartbeat_interval));

            loop {
                ticker.tick().await;

                if shutdown.load(Ordering::Relaxed) {
                    break;
                }

                // Send heartbeat for current job
                let job_id = {
                    let current = current_job.lock().await;
                    current.clone()
                };

                if let Some(job_id) = job_id {
                    match job_repo.heartbeat(&job_id).await {
                        Ok(true) => debug!("Heartbeat sent for job {}", job_id),
                        Ok(false) => warn!("Heartbeat failed - job may have been reclaimed"),
                        Err(e) => error!("Heartbeat error: {}", e),
                    }
                }
            }
        })
    }

    /// Release jobs back to queue (on shutdown)
    async fn release_jobs(&self, job_repo: &JobRepository) -> Result<()> {
        let job_id = {
            let current = self.current_job.lock().await;
            current.clone()
        };

        if let Some(job_id) = job_id {
            info!("Releasing job {} back to queue", job_id);
            match job_repo.release(&job_id).await {
                Ok(true) => info!("Job {} released successfully", job_id),
                Ok(false) => warn!("Job {} could not be released", job_id),
                Err(e) => error!("Failed to release job {}: {}", job_id, e),
            }
        }

        // Release any other jobs this worker holds
        let released = job_repo.release_all().await?;
        if released > 0 {
            info!("Released {} additional jobs", released);
        }

        Ok(())
    }
}
