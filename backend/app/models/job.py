"""
Job model for MongoDB.
"""

import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId
from pymongo import ReturnDocument

from app.extensions import mongo


class Job:
    """Job model representing a blocklist processing job."""

    COLLECTION = "jobs"

    # Job statuses
    STATUS_QUEUED = "queued"
    STATUS_PROCESSING = "processing"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_SKIPPED = "skipped"

    # Job types
    TYPE_MANUAL = "manual"
    TYPE_SCHEDULED = "scheduled"
    TYPE_ADMIN = "admin"

    # Priority levels (lower number = higher priority)
    PRIORITY_HIGH = 1  # Default/admin jobs
    PRIORITY_NORMAL = 2  # User jobs

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        return str(self._id) if self._id else None

    @property
    def job_id(self) -> str:
        return self._data.get("job_id")

    @property
    def user_id(self) -> ObjectId:
        return self._data.get("user_id")

    @property
    def username(self) -> str:
        return self._data.get("username")

    @property
    def job_type(self) -> str:
        return self._data.get("type", self.TYPE_MANUAL)

    @property
    def status(self) -> str:
        return self._data.get("status", self.STATUS_QUEUED)

    @property
    def progress(self) -> Dict[str, Any]:
        return self._data.get("progress", {})

    @property
    def result(self) -> Optional[Dict[str, Any]]:
        return self._data.get("result")

    @property
    def started_at(self) -> Optional[datetime]:
        return self._data.get("started_at")

    @property
    def completed_at(self) -> Optional[datetime]:
        return self._data.get("completed_at")

    @property
    def created_at(self) -> datetime:
        return self._data.get("created_at", datetime.utcnow())

    @property
    def priority(self) -> int:
        return self._data.get("priority", self.PRIORITY_NORMAL)

    @property
    def worker_id(self) -> Optional[str]:
        return self._data.get("worker_id")

    @property
    def claimed_at(self) -> Optional[datetime]:
        return self._data.get("claimed_at")

    @property
    def heartbeat_at(self) -> Optional[datetime]:
        return self._data.get("heartbeat_at")

    # Status methods
    def start(self) -> None:
        """Mark job as processing."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_PROCESSING,
                    "started_at": datetime.utcnow(),
                }
            },
        )
        self._data["status"] = self.STATUS_PROCESSING
        self._data["started_at"] = datetime.utcnow()
        self._emit_update()

    def update_progress(self, progress: Dict[str, Any]) -> None:
        """Update job progress in MongoDB. WebSocket updates are handled by JobStatusPoller."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id}, {"$set": {"progress": progress}}
        )
        self._data["progress"] = progress
        # Note: We no longer emit here - JobStatusPoller polls and emits consolidated updates

    def complete(self, result: Dict[str, Any]) -> None:
        """Mark job as completed."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_COMPLETED,
                    "completed_at": datetime.utcnow(),
                    "result": result,
                }
            },
        )
        self._data["status"] = self.STATUS_COMPLETED
        self._data["completed_at"] = datetime.utcnow()
        self._data["result"] = result
        self._emit_completed()

    def fail(self, errors: List[str]) -> None:
        """Mark job as failed."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_FAILED,
                    "completed_at": datetime.utcnow(),
                    "result": {"errors": errors},
                }
            },
        )
        self._data["status"] = self.STATUS_FAILED
        self._data["completed_at"] = datetime.utcnow()
        self._data["result"] = {"errors": errors}
        self._emit_completed()

    def skip(self, reason: str) -> None:
        """Mark job as skipped (e.g., when another job is already running)."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_SKIPPED,
                    "completed_at": datetime.utcnow(),
                    "result": {"skip_reason": reason},
                }
            },
        )
        self._data["status"] = self.STATUS_SKIPPED
        self._data["completed_at"] = datetime.utcnow()
        self._data["result"] = {"skip_reason": reason}
        self._emit_skipped(reason)

    def _emit_skipped(self, reason: str) -> None:
        """Emit job skipped via Socket.IO."""
        try:
            from app.socketio import emit_job_skipped
            user_id = str(self.user_id) if self.user_id else None
            emit_job_skipped(self.job_id, reason, user_id)
        except Exception:
            pass  # Silently fail if Socket.IO not available

    def _emit_update(self) -> None:
        """Emit job update via Socket.IO."""
        try:
            from app.socketio import emit_job_updated
            user_id = str(self.user_id) if self.user_id else None
            emit_job_updated(self.to_dict(), user_id)
        except Exception:
            pass  # Silently fail if Socket.IO not available

    def _emit_completed(self) -> None:
        """Emit job completed via Socket.IO."""
        try:
            from app.socketio import emit_job_completed
            user_id = str(self.user_id) if self.user_id else None
            emit_job_completed(self.to_dict(), user_id)
        except Exception:
            pass  # Silently fail if Socket.IO not available

    # Serialization
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "job_id": self.job_id,
            "user_id": str(self.user_id) if self.user_id else None,
            "username": self.username,
            "type": self.job_type,
            "status": self.status,
            "priority": self.priority,
            "progress": self.progress,
            "result": self.result,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "created_at": self.created_at.isoformat(),
            "worker_id": self.worker_id,
        }

    def get_progress_snapshot(self) -> Dict[str, Any]:
        """Get a snapshot of job state for comparison in poller."""
        return {
            "status": self.status,
            "progress": self.progress,
            "result": self.result,
        }

    # Class methods
    @classmethod
    def create(
        cls,
        user_id: ObjectId,
        username: str,
        job_type: str = TYPE_MANUAL,
        priority: int = PRIORITY_NORMAL,
    ) -> "Job":
        """Create a new job."""
        job_data = {
            "job_id": str(uuid.uuid4()),
            "user_id": user_id,
            "username": username,
            "type": job_type,
            "status": cls.STATUS_QUEUED,
            "priority": priority,
            "progress": {
                "current_step": "queued",
                "stage": "queue",
                "total_sources": 0,
                "processed_sources": 0,
                "current_source": None,
                "sources": [],
                "whitelist": None,
                "generation": None,
                "queue_position": None,
                "queue_delay_remaining_ms": None,
                "stage_started_at": None,
            },
            "result": None,
            "started_at": None,
            "completed_at": None,
            "created_at": datetime.utcnow(),
            "worker_id": None,
            "claimed_at": None,
            "heartbeat_at": None,
        }

        result = mongo.db[cls.COLLECTION].insert_one(job_data)
        job_data["_id"] = result.inserted_id

        return cls(job_data)

    @classmethod
    def create_default(
        cls, job_type: str = TYPE_SCHEDULED, priority: int = PRIORITY_HIGH
    ) -> "Job":
        """Create a job for default lists (no user). High priority by default."""
        job_data = {
            "job_id": str(uuid.uuid4()),
            "user_id": None,
            "username": "__default__",
            "type": job_type,
            "status": cls.STATUS_QUEUED,
            "priority": priority,
            "progress": {
                "current_step": "queued",
                "stage": "queue",
                "total_sources": 0,
                "processed_sources": 0,
                "current_source": None,
                "sources": [],
                "whitelist": None,
                "generation": None,
                "queue_position": None,
                "queue_delay_remaining_ms": None,
                "stage_started_at": None,
            },
            "result": None,
            "started_at": None,
            "completed_at": None,
            "created_at": datetime.utcnow(),
            "worker_id": None,
            "claimed_at": None,
            "heartbeat_at": None,
        }

        result = mongo.db[cls.COLLECTION].insert_one(job_data)
        job_data["_id"] = result.inserted_id

        return cls(job_data)

    @classmethod
    def get_by_id(cls, job_id: str) -> Optional["Job"]:
        """Get job by ID (either _id or job_id)."""
        # Try job_id first
        data = mongo.db[cls.COLLECTION].find_one({"job_id": job_id})
        if data:
            return cls(data)

        # Try ObjectId
        try:
            data = mongo.db[cls.COLLECTION].find_one({"_id": ObjectId(job_id)})
            return cls(data) if data else None
        except Exception:
            return None

    @classmethod
    def get_by_user(
        cls, user_id: ObjectId, limit: int = 20, status: str = None
    ) -> List["Job"]:
        """Get jobs for a user."""
        query = {"user_id": user_id}
        if status:
            query["status"] = status

        cursor = (
            mongo.db[cls.COLLECTION]
            .find(query)
            .sort("created_at", -1)
            .limit(limit)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def get_recent(cls, limit: int = 50) -> List["Job"]:
        """Get recent jobs."""
        cursor = (
            mongo.db[cls.COLLECTION].find().sort("created_at", -1).limit(limit)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def get_queued(cls) -> List["Job"]:
        """Get queued jobs."""
        cursor = (
            mongo.db[cls.COLLECTION]
            .find({"status": cls.STATUS_QUEUED})
            .sort("created_at", 1)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def count_processing(cls) -> int:
        """Count currently processing jobs."""
        return mongo.db[cls.COLLECTION].count_documents(
            {"status": cls.STATUS_PROCESSING}
        )

    @classmethod
    def count_today(cls) -> int:
        """Count jobs created today."""
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        return mongo.db[cls.COLLECTION].count_documents({"created_at": {"$gte": today}})

    @classmethod
    def has_unread_failures(cls, user_id: ObjectId) -> bool:
        """Check if user has unread job failures."""
        return (
            mongo.db[cls.COLLECTION].count_documents(
                {
                    "user_id": user_id,
                    "status": cls.STATUS_FAILED,
                    "read": {"$ne": True},
                }
            )
            > 0
        )

    @classmethod
    def mark_failures_read(cls, user_id: ObjectId) -> None:
        """Mark all user's failed jobs as read."""
        mongo.db[cls.COLLECTION].update_many(
            {"user_id": user_id, "status": cls.STATUS_FAILED},
            {"$set": {"read": True}},
        )

    # Worker-related methods for distributed processing

    @classmethod
    def claim_next(cls, worker_id: str) -> Optional["Job"]:
        """
        Atomically claim the highest priority unclaimed job.
        Uses MongoDB's findOneAndUpdate for distributed locking.

        Args:
            worker_id: Unique identifier of the worker claiming the job

        Returns:
            The claimed Job if one was available, None otherwise
        """
        now = datetime.utcnow()
        doc = mongo.db[cls.COLLECTION].find_one_and_update(
            {
                "status": cls.STATUS_QUEUED,
                "worker_id": None,
            },
            {
                "$set": {
                    "status": cls.STATUS_PROCESSING,
                    "worker_id": worker_id,
                    "claimed_at": now,
                    "heartbeat_at": now,
                    "started_at": now,
                }
            },
            sort=[("priority", 1), ("created_at", 1)],  # priority ASC (1=high), then FIFO
            return_document=ReturnDocument.AFTER,
        )
        return cls(doc) if doc else None

    @classmethod
    def heartbeat(cls, job_id: str, worker_id: str) -> bool:
        """
        Update heartbeat timestamp for a job being processed.

        Args:
            job_id: The job_id of the job
            worker_id: The worker's unique identifier

        Returns:
            True if heartbeat was updated, False if job not found or not owned by worker
        """
        result = mongo.db[cls.COLLECTION].update_one(
            {
                "job_id": job_id,
                "worker_id": worker_id,
                "status": cls.STATUS_PROCESSING,
            },
            {"$set": {"heartbeat_at": datetime.utcnow()}},
        )
        return result.modified_count > 0

    @classmethod
    def release(cls, job_id: str, worker_id: str) -> bool:
        """
        Release a job back to the queue (e.g., on worker shutdown or error).

        Args:
            job_id: The job_id of the job
            worker_id: The worker's unique identifier

        Returns:
            True if job was released, False if job not found or not owned by worker
        """
        result = mongo.db[cls.COLLECTION].update_one(
            {
                "job_id": job_id,
                "worker_id": worker_id,
                "status": cls.STATUS_PROCESSING,
            },
            {
                "$set": {
                    "status": cls.STATUS_QUEUED,
                    "worker_id": None,
                    "claimed_at": None,
                    "heartbeat_at": None,
                    "started_at": None,
                }
            },
        )
        return result.modified_count > 0

    @classmethod
    def reset_stale(cls, timeout_minutes: int = 10) -> int:
        """
        Reset jobs from dead workers back to queued status.
        A job is considered stale if it's been processing for longer than
        timeout_minutes without a heartbeat update.

        Args:
            timeout_minutes: Minutes since last heartbeat before job is considered stale

        Returns:
            Number of jobs reset
        """
        stale_threshold = datetime.utcnow() - timedelta(minutes=timeout_minutes)
        result = mongo.db[cls.COLLECTION].update_many(
            {
                "status": cls.STATUS_PROCESSING,
                "heartbeat_at": {"$lt": stale_threshold},
            },
            {
                "$set": {
                    "status": cls.STATUS_QUEUED,
                    "worker_id": None,
                    "claimed_at": None,
                    "heartbeat_at": None,
                    "started_at": None,
                }
            },
        )
        return result.modified_count

    @classmethod
    def get_active(cls) -> List["Job"]:
        """
        Get all active jobs (queued or processing).
        Used by the job status poller for WebSocket updates.

        Returns:
            List of active jobs sorted by priority then created_at
        """
        cursor = mongo.db[cls.COLLECTION].find(
            {"status": {"$in": [cls.STATUS_QUEUED, cls.STATUS_PROCESSING]}}
        ).sort([("priority", 1), ("created_at", 1)])
        return [cls(data) for data in cursor]

    @classmethod
    def count_queued(cls) -> int:
        """Count jobs waiting in queue."""
        return mongo.db[cls.COLLECTION].count_documents(
            {"status": cls.STATUS_QUEUED}
        )

    @classmethod
    def get_queue_position(cls, job_id: str) -> int:
        """
        Get the position of a job in the queue (1-based).
        Returns 0 if job is not queued.
        """
        job = cls.get_by_id(job_id)
        if not job or job.status != cls.STATUS_QUEUED:
            return 0

        # Count jobs ahead in queue (higher priority or same priority but earlier)
        count = mongo.db[cls.COLLECTION].count_documents({
            "status": cls.STATUS_QUEUED,
            "$or": [
                {"priority": {"$lt": job.priority}},  # Higher priority (lower number)
                {
                    "priority": job.priority,
                    "created_at": {"$lt": job.created_at}
                }
            ]
        })
        return count + 1  # 1-based position

    @classmethod
    def get_active_worker_count(cls) -> int:
        """Count the number of active workers (distinct worker_ids processing jobs)."""
        pipeline = [
            {"$match": {"status": cls.STATUS_PROCESSING, "worker_id": {"$ne": None}}},
            {"$group": {"_id": "$worker_id"}},
            {"$count": "count"}
        ]
        result = list(mongo.db[cls.COLLECTION].aggregate(pipeline))
        return result[0]["count"] if result else 0

    @classmethod
    def get_queue_stats(cls) -> dict:
        """
        Get comprehensive queue statistics.
        Returns dict with queue_length, active_workers, processing_count.
        """
        return {
            "queue_length": cls.count_queued(),
            "active_workers": cls.get_active_worker_count(),
            "processing_count": cls.count_processing(),
        }

    # Cooldown and scheduling methods

    @classmethod
    def has_active_job_for_user(cls, user_id: ObjectId) -> bool:
        """
        Check if user has any active job (queued or processing).
        Used to prevent duplicate builds.
        """
        return (
            mongo.db[cls.COLLECTION].count_documents(
                {
                    "user_id": user_id,
                    "status": {"$in": [cls.STATUS_QUEUED, cls.STATUS_PROCESSING]},
                }
            )
            > 0
        )

    @classmethod
    def get_last_completed_for_user(
        cls, user_id: ObjectId, job_type: str = None
    ) -> Optional["Job"]:
        """
        Get the most recently completed job for a user.
        Optionally filter by job type (manual, scheduled, admin).
        """
        query = {
            "user_id": user_id,
            "status": cls.STATUS_COMPLETED,
        }
        if job_type:
            query["type"] = job_type

        doc = (
            mongo.db[cls.COLLECTION]
            .find(query)
            .sort("completed_at", -1)
            .limit(1)
        )
        docs = list(doc)
        return cls(docs[0]) if docs else None

    @classmethod
    def user_completed_recently(
        cls, user_id: ObjectId, minutes: int = 5, job_type: str = None
    ) -> bool:
        """
        Check if user completed a job within the last N minutes.
        Used for cooldown enforcement.
        """
        cutoff = datetime.utcnow() - timedelta(minutes=minutes)
        query = {
            "user_id": user_id,
            "status": cls.STATUS_COMPLETED,
            "completed_at": {"$gte": cutoff},
        }
        if job_type:
            query["type"] = job_type

        return mongo.db[cls.COLLECTION].count_documents(query) > 0

    @classmethod
    def get_cooldown_remaining(cls, user_id: ObjectId, cooldown_minutes: int = 5) -> int:
        """
        Get remaining cooldown time in seconds for a user.
        Returns 0 if no cooldown active.
        """
        last_job = cls.get_last_completed_for_user(user_id, job_type=cls.TYPE_MANUAL)
        if not last_job or not last_job.completed_at:
            return 0

        elapsed = (datetime.utcnow() - last_job.completed_at).total_seconds()
        cooldown_seconds = cooldown_minutes * 60
        remaining = cooldown_seconds - elapsed

        return max(0, int(remaining))
