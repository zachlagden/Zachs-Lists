import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from flask import Flask
from pymongo.errors import PyMongoError

from app.extensions import mongo
from app.models.job import Job
from app.services import job_feed
from app.services.job_feed import CLIENT_PROJECTION, QueueInfo

logger = logging.getLogger(__name__)

DEFAULT_ACTIVE_INTERVAL_SECONDS = 0.5
DEFAULT_IDLE_INTERVAL_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 30.0
WRITE_ORDER_OVERLAP = timedelta(seconds=2)
NEW_JOB_WINDOW = timedelta(minutes=10)
TERMINAL_RETENTION = timedelta(minutes=15)
MAX_TRACKED_JOBS = 5000
MAX_SIDE_EFFECT_ATTEMPTS = 5
TERMINAL_STATUSES = (Job.STATUS_COMPLETED, Job.STATUS_FAILED, Job.STATUS_SKIPPED)

SideEffect = Callable[[Job], object]


@dataclass
class RelayedJob:
    rev: int
    status: str
    updated_at: datetime
    queue_info: QueueInfo | None = None


@dataclass
class FailedSideEffects:
    names: tuple[str, ...]
    attempts: int


def _terminal_side_effects() -> dict[str, SideEffect]:
    from app.services.build_admission import refund_quota_if_due
    from app.services.limit_review import record_job_result

    return {
        "quota refund": lambda job: refund_quota_if_due(job.job_id),
        "limit review": record_job_result,
    }


class JobStatusPoller:
    def __init__(self) -> None:
        self._relayed: dict[str, RelayedJob] = {}
        self._failed_side_effects: dict[str, FailedSideEffects] = {}
        self._watermark: datetime | None = None
        self._started_at: datetime | None = None
        self._active_interval = DEFAULT_ACTIVE_INTERVAL_SECONDS
        self._idle_interval = DEFAULT_IDLE_INTERVAL_SECONDS
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._app: Flask | None = None

    def init_app(self, app: Flask) -> None:
        self._app = app
        self._active_interval = float(
            app.config.get("JOB_POLL_ACTIVE_SECONDS", DEFAULT_ACTIVE_INTERVAL_SECONDS)
        )
        self._idle_interval = float(
            app.config.get("JOB_POLL_IDLE_SECONDS", DEFAULT_IDLE_INTERVAL_SECONDS)
        )
        self.start()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._poll_loop, name="JobStatusPoller", daemon=True
        )
        self._thread.start()
        logger.info(
            "Job status poller started (active %.1fs, idle %.1fs)",
            self._active_interval,
            self._idle_interval,
        )

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2)
        logger.info("Job status poller stopped")

    def has_active_jobs(self) -> bool:
        return any(
            relayed.status not in TERMINAL_STATUSES
            for relayed in self._relayed.values()
        )

    def _poll_loop(self) -> None:
        if self._app is None:
            raise RuntimeError("Job status poller has no Flask app")
        database_failures = 0
        while not self._stop.is_set():
            try:
                with self._app.app_context():
                    changed = self.poll_once()
                database_failures = 0
                busy = changed or self.has_active_jobs()
                delay = self._active_interval if busy else self._idle_interval
            except PyMongoError:
                database_failures += 1
                delay = min(
                    self._idle_interval * 2 ** (database_failures - 1),
                    MAX_BACKOFF_SECONDS,
                )
                logger.exception(
                    "Job poller could not use the database, retrying in %.1fs", delay
                )
            except Exception:
                delay = self._idle_interval
                logger.exception("Job poller tick failed")
            self._stop.wait(delay)

    def poll_once(self) -> bool:
        if self._watermark is None:
            self._begin()
        watermark = self._watermark
        if watermark is None:
            raise RuntimeError("Job status poller has no watermark")
        self._retry_failed_side_effects()
        documents = list(
            mongo.db[Job.COLLECTION]
            .find(
                {"updated_at": {"$gt": watermark - WRITE_ORDER_OVERLAP}},
                CLIENT_PROJECTION,
            )
            .sort("updated_at", 1)
        )
        changed = [job for job in map(Job, documents) if self._is_unsent(job)]
        if not changed:
            return False

        newest = max(
            (job.updated_at for job in changed if job.updated_at), default=watermark
        )
        if newest > watermark:
            watermark = max(watermark, min(newest, job_feed.database_time()))

        rows: list[tuple[Job, QueueInfo]] | None = None
        if any(job.status == Job.STATUS_QUEUED for job in changed):
            rows = job_feed.queued_jobs_with_positions()
        queue = {job.job_id: info for job, info in rows or []}
        status_changed = False
        for job in changed:
            try:
                if self._relay(job, queue.get(job.job_id), watermark):
                    status_changed = True
            except PyMongoError:
                raise
            except Exception:
                logger.exception("Could not relay job %s", job.job_id)
        if status_changed:
            if rows is None:
                rows = job_feed.queued_jobs_with_positions()
            self._relay_queue_positions(rows, watermark)

        self._watermark = watermark
        self._evict(watermark)
        return True

    def _begin(self) -> None:
        from app.services.build_admission import refund_missed_quota

        now = job_feed.database_time()
        refunded = refund_missed_quota()
        if refunded:
            logger.info("Refunded %d builds that ended while offline", refunded)
        self._relayed = {
            document["job_id"]: RelayedJob(
                int(document.get("rev") or 0), document["status"], now
            )
            for document in mongo.db[Job.COLLECTION].find(
                {
                    "status": {"$in": list(Job.ACTIVE_STATUSES)},
                    "updated_at": {"$lte": now},
                },
                {"job_id": 1, "rev": 1, "status": 1},
            )
        }
        self._started_at = now
        self._watermark = now

    def _is_unsent(self, job: Job) -> bool:
        known = self._relayed.get(job.job_id)
        return known is None or job.rev > known.rev

    def _is_new(self, job: Job, watermark: datetime) -> bool:
        started_at = self._started_at or watermark
        floor = max(started_at - WRITE_ORDER_OVERLAP, watermark - NEW_JOB_WINDOW)
        return job.created_at > floor

    def _relay(self, job: Job, info: QueueInfo | None, watermark: datetime) -> bool:
        from app.socketio import (
            emit_job_completed,
            emit_job_created,
            emit_job_progress,
        )

        known = self._relayed.get(job.job_id)
        terminal = job.status in TERMINAL_STATUSES
        record = RelayedJob(job.rev, job.status, job.updated_at or watermark, info)
        if known is not None and job.rev < known.rev:
            return False
        already_finished = (
            known.status in TERMINAL_STATUSES
            if known is not None
            else not self._is_new(job, watermark)
        )
        if terminal and already_finished:
            self._relayed[job.job_id] = record
            return False

        payload: dict[str, Any] = job.to_dict()
        if info is not None and job.status == Job.STATUS_QUEUED:
            payload["queue_info"] = info
        user_id = str(job.user_id) if job.user_id else None
        if terminal:
            failed = self._run_side_effects(job, tuple(_terminal_side_effects()))
            if failed:
                self._failed_side_effects[job.job_id] = FailedSideEffects(failed, 1)
        try:
            if known is None and self._is_new(job, watermark):
                emit_job_created(payload, user_id)
            if terminal:
                emit_job_completed(payload, user_id)
            else:
                emit_job_progress(payload, user_id)
        except PyMongoError:
            raise
        except Exception:
            logger.exception(
                "Could not emit the events of job %s at revision %d",
                job.job_id,
                job.rev,
            )
        self._relayed[job.job_id] = record
        return known is None or known.status != job.status

    def _run_side_effects(self, job: Job, names: tuple[str, ...]) -> tuple[str, ...]:
        side_effects = _terminal_side_effects()
        failed: list[str] = []
        for name in names:
            try:
                side_effects[name](job)
            except PyMongoError:
                raise
            except Exception:
                logger.exception("The %s of job %s failed", name, job.job_id)
                failed.append(name)
        return tuple(failed)

    def _retry_failed_side_effects(self) -> None:
        for job_id, pending in list(self._failed_side_effects.items()):
            job = Job.get_by_id(job_id)
            if job is None or job.status not in TERMINAL_STATUSES:
                del self._failed_side_effects[job_id]
                continue
            still_failed = self._run_side_effects(job, pending.names)
            attempts = pending.attempts + 1
            if not still_failed:
                del self._failed_side_effects[job_id]
            elif attempts >= MAX_SIDE_EFFECT_ATTEMPTS:
                del self._failed_side_effects[job_id]
                logger.error(
                    "Gave up on the %s of job %s after %d attempts",
                    " and ".join(still_failed),
                    job_id,
                    attempts,
                )
            else:
                self._failed_side_effects[job_id] = FailedSideEffects(
                    still_failed, attempts
                )

    def _relay_queue_positions(
        self, rows: list[tuple[Job, QueueInfo]], watermark: datetime
    ) -> None:
        for job, info in rows:
            known = self._relayed.get(job.job_id)
            if known is not None and known.queue_info == info:
                continue
            try:
                self._relay(job, info, watermark)
            except PyMongoError:
                raise
            except Exception:
                logger.exception("Could not relay queue position of %s", job.job_id)

    def _evict(self, watermark: datetime) -> None:
        cutoff = watermark - TERMINAL_RETENTION
        self._relayed = {
            job_id: relayed
            for job_id, relayed in self._relayed.items()
            if relayed.status not in TERMINAL_STATUSES or relayed.updated_at >= cutoff
        }
        overflow = len(self._relayed) - MAX_TRACKED_JOBS
        if overflow <= 0:
            return
        oldest_finished = sorted(
            (
                (relayed.updated_at, job_id)
                for job_id, relayed in self._relayed.items()
                if relayed.status in TERMINAL_STATUSES
            )
        )
        for _, job_id in oldest_finished[:overflow]:
            del self._relayed[job_id]


job_poller = JobStatusPoller()
