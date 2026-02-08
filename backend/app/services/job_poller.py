"""
Job status poller for WebSocket updates.

Polls MongoDB for active jobs and emits consolidated WebSocket updates.
This replaces the many granular Socket.IO events with a single job:progress event
that contains the full job state.
"""

import logging
import threading
import time
import copy
from typing import Dict, Set, Any

from app.models.job import Job

logger = logging.getLogger(__name__)


class JobStatusPoller:
    """
    Polls job status from MongoDB and emits WebSocket updates.

    Features:
    - Polls every 500ms for responsive updates
    - Only emits when job state has changed
    - Tracks completed jobs to emit job:completed event
    - Thread-safe singleton pattern
    """

    POLL_INTERVAL = 0.5  # 500ms

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.active_jobs: Dict[str, Dict[str, Any]] = {}  # job_id -> last snapshot
        self.completed_emitted: Set[str] = set()  # job_ids we've emitted completed for
        self._running = False
        self._thread = None
        self._app = None
        self._initialized = True

    def init_app(self, app):
        """Initialize with Flask app context."""
        self._app = app
        self.start()

    def start(self):
        """Start background polling thread."""
        if self._running:
            return

        self._running = True
        self._thread = threading.Thread(
            target=self._poll_loop,
            name="JobStatusPoller",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"Job status poller started (interval: {self.POLL_INTERVAL}s)")

    def stop(self):
        """Stop the poller."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        logger.info("Job status poller stopped")

    def _poll_loop(self):
        """Main polling loop."""
        while self._running:
            try:
                if self._app:
                    with self._app.app_context():
                        self._check_jobs()
            except Exception as e:
                logger.exception(f"Error in job poller: {e}")

            time.sleep(self.POLL_INTERVAL)

    def _check_jobs(self):
        """Query active jobs and emit updates for changed ones."""
        from app.socketio import emit_job_progress, emit_job_completed

        # Get all active jobs (queued or processing)
        active_jobs = Job.get_active()
        current_ids = set()

        for job in active_jobs:
            current_ids.add(job.job_id)
            current_snapshot = job.get_progress_snapshot()
            last_snapshot = self.active_jobs.get(job.job_id)

            # Check if job state has changed
            if last_snapshot != current_snapshot:
                # Emit progress update
                emit_job_progress(job)
                self.active_jobs[job.job_id] = copy.deepcopy(current_snapshot)

        # Check for newly completed jobs
        for job_id in list(self.active_jobs.keys()):
            if job_id not in current_ids:
                # Job is no longer active, might be completed/failed/skipped
                if job_id not in self.completed_emitted:
                    job = Job.get_by_id(job_id)
                    if job and job.status in (
                        Job.STATUS_COMPLETED,
                        Job.STATUS_FAILED,
                        Job.STATUS_SKIPPED,
                    ):
                        emit_job_completed(
                            job.to_dict(), str(job.user_id) if job.user_id else None
                        )
                        self.completed_emitted.add(job_id)
                        logger.debug(f"Emitted completion for job {job_id[:8]}")

                # Clean up tracking
                del self.active_jobs[job_id]

        # Periodically clean up completed_emitted set to prevent memory growth
        if len(self.completed_emitted) > 1000:
            # Keep only the most recent 500
            self.completed_emitted = set(list(self.completed_emitted)[-500:])


# Singleton instance
job_poller = JobStatusPoller()
