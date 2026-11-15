"""
Job model for MongoDB.
"""

from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple, cast
from bson import ObjectId

from app.extensions import mongo
from app.utils.job_document import (
    failure_result,
    initial_progress,
    normalised_result,
    revision_bump,
)
from app.utils.time import utc_iso


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
    PRIORITY_HIGH = 1
    PRIORITY_NORMAL = 2
    PRIORITY_LOW = 3

    DEFAULT_TARGET_ID = "__default__"
    ACTIVE_STATUSES = (STATUS_QUEUED, STATUS_PROCESSING)
    COOLDOWN_STATUSES = (STATUS_COMPLETED, STATUS_SKIPPED)
    ERROR_WORKER_ABANDONED = "worker_abandoned"
    ERROR_SUPERSEDED = "superseded"

    # Stale resets a job may accumulate before it is abandoned as unbuildable
    MAX_STALE_ATTEMPTS = 3

    STALE_AFTER_MINUTES = 2

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> Optional[str]:
        return str(self._id) if self._id else None

    @property
    def job_id(self) -> str:
        return cast(str, self._data.get("job_id"))

    @property
    def user_id(self) -> Optional[ObjectId]:
        return self._data.get("user_id")

    @property
    def username(self) -> Optional[str]:
        return self._data.get("username")

    @staticmethod
    def target_id_for(document: Dict[str, Any]) -> Optional[str]:
        stored = document.get("target_id")
        if isinstance(stored, str) and stored:
            return stored
        if document.get("user_id"):
            return str(document["user_id"])
        if document.get("username") == Job.DEFAULT_TARGET_ID:
            return Job.DEFAULT_TARGET_ID
        return None

    @property
    def target_id(self) -> Optional[str]:
        return self.target_id_for(self._data)

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
    def attempt_started_at(self) -> Optional[datetime]:
        return self._data.get("attempt_started_at")

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

    @property
    def rev(self) -> int:
        return int(self._data.get("rev") or 0)

    @property
    def attempts(self) -> int:
        attempt = self._data.get("attempt")
        if isinstance(attempt, int) and not isinstance(attempt, bool):
            return attempt
        return int(self._data.get("stale_attempts") or 0)

    @property
    def updated_at(self) -> Optional[datetime]:
        return self._data.get("updated_at")

    # Serialization
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "job_id": self.job_id,
            "user_id": str(self.user_id) if self.user_id else None,
            "username": self.username,
            "target_id": self.target_id,
            "type": self.job_type,
            "status": self.status,
            "priority": self.priority,
            "progress": self.progress,
            "result": normalised_result(self.result),
            "started_at": utc_iso(self.started_at),
            "attempt_started_at": utc_iso(self.attempt_started_at),
            "completed_at": utc_iso(self.completed_at),
            "created_at": utc_iso(self.created_at),
            "worker_id": self.worker_id,
            "read": bool(self._data.get("read", False)),
            "force_rebuild": bool(self._data.get("force_rebuild", False)),
            "attempts": self.attempts,
            "rev": self.rev,
            "updated_at": utc_iso(self.updated_at),
        }

    # Class methods
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
        cls, user_id: ObjectId, limit: int = 20, status: Optional[str] = None
    ) -> List["Job"]:
        """Get jobs for a user."""
        query: Dict[str, Any] = {"user_id": user_id}
        if status:
            query["status"] = status

        cursor = (
            mongo.db[cls.COLLECTION].find(query).sort("created_at", -1).limit(limit)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def page_for_user(
        cls, user_id: ObjectId, page: int, per_page: int
    ) -> Tuple[List["Job"], int]:
        query: Dict[str, Any] = {"user_id": user_id}
        total = mongo.db[cls.COLLECTION].count_documents(query)
        cursor = (
            mongo.db[cls.COLLECTION]
            .find(query)
            .sort([("created_at", -1), ("_id", -1)])
            .skip((page - 1) * per_page)
            .limit(per_page)
        )
        return [cls(data) for data in cursor], total

    @classmethod
    def get_recent(cls, limit: int = 50) -> List["Job"]:
        """Get recent jobs."""
        cursor = mongo.db[cls.COLLECTION].find().sort("created_at", -1).limit(limit)
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
            {
                "user_id": user_id,
                "status": cls.STATUS_FAILED,
                "read": {"$ne": True},
            },
            {"$set": {"read": True}, **revision_bump()},
        )

    # Worker-related methods for distributed processing

    @classmethod
    def reset_stale(
        cls,
        timeout_minutes: int = STALE_AFTER_MINUTES,
        max_attempts: int = MAX_STALE_ATTEMPTS,
    ) -> Tuple[int, int]:
        """
        Reset jobs from dead workers back to queued status.
        A job is considered stale if it's been processing for longer than
        timeout_minutes without a heartbeat update.

        A job whose worker keeps dying (for example one that exhausts the
        container memory limit every run) would otherwise be requeued forever
        and monopolise the worker pool, so it is failed once it has burned
        through max_attempts.

        Args:
            timeout_minutes: Minutes since last heartbeat before job is considered stale
            max_attempts: Stale resets a job may accumulate before it is failed

        Returns:
            Tuple of (jobs requeued, jobs abandoned)
        """
        stale_threshold = datetime.utcnow() - timedelta(minutes=timeout_minutes)
        stale_filter = {
            "status": cls.STATUS_PROCESSING,
            "heartbeat_at": {"$lt": stale_threshold},
        }

        abandoned = mongo.db[cls.COLLECTION].update_many(
            {**stale_filter, "stale_attempts": {"$gte": max_attempts}},
            {
                "$set": {
                    "status": cls.STATUS_FAILED,
                    "worker_id": None,
                    "claimed_at": None,
                    "heartbeat_at": None,
                    "completed_at": datetime.utcnow(),
                    "result": failure_result(
                        cls.ERROR_WORKER_ABANDONED,
                        f"Abandoned after {max_attempts} attempts that each "
                        f"died before completing (worker crashed or ran out of memory)",
                    ),
                },
                **revision_bump(),
            },
        )

        requeued = mongo.db[cls.COLLECTION].update_many(
            stale_filter,
            {
                "$set": {
                    "status": cls.STATUS_QUEUED,
                    "worker_id": None,
                    "claimed_at": None,
                    "heartbeat_at": None,
                    "progress": initial_progress(),
                },
                "$inc": {"stale_attempts": 1, "rev": 1},
                "$currentDate": {"updated_at": True},
            },
        )

        return requeued.modified_count, abandoned.modified_count

    @classmethod
    def get_active(cls) -> List["Job"]:
        """
        Get all active jobs (queued or processing).
        Used by the job status poller for WebSocket updates.

        Returns:
            List of active jobs sorted by priority then created_at
        """
        cursor = (
            mongo.db[cls.COLLECTION]
            .find({"status": {"$in": [cls.STATUS_QUEUED, cls.STATUS_PROCESSING]}})
            .sort([("priority", 1), ("created_at", 1)])
        )
        return [cls(data) for data in cursor]

    @classmethod
    def count_queued(cls) -> int:
        """Count jobs waiting in queue."""
        return mongo.db[cls.COLLECTION].count_documents({"status": cls.STATUS_QUEUED})

    # Cooldown and scheduling methods

    @classmethod
    def get_active_for_target(cls, target_id: str) -> Optional["Job"]:
        data = mongo.db[cls.COLLECTION].find_one(
            {"target_id": target_id, "status": {"$in": list(cls.ACTIVE_STATUSES)}}
        )
        return cls(data) if data else None

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
    def last_ended_at(cls, user_id: ObjectId) -> Optional[datetime]:
        last_ended = mongo.db[cls.COLLECTION].find_one(
            {
                "user_id": user_id,
                "status": {"$in": list(cls.COOLDOWN_STATUSES)},
                "completed_at": {"$type": "date"},
            },
            {"completed_at": 1},
            sort=[("completed_at", -1)],
        )
        return last_ended["completed_at"] if last_ended else None

    @classmethod
    def get_cooldown_remaining(
        cls, user_id: ObjectId, cooldown_minutes: int = 5
    ) -> int:
        """
        Get remaining cooldown time in seconds for a user.
        Returns 0 if no cooldown active.
        """
        last_ended = mongo.db[cls.COLLECTION].find_one(
            {
                "user_id": user_id,
                "type": cls.TYPE_MANUAL,
                "status": {"$in": list(cls.COOLDOWN_STATUSES)},
                "completed_at": {"$type": "date"},
            },
            {"completed_at": 1},
            sort=[("completed_at", -1)],
        )
        if last_ended is None:
            return 0

        elapsed = (datetime.utcnow() - last_ended["completed_at"]).total_seconds()
        cooldown_seconds = cooldown_minutes * 60
        remaining = cooldown_seconds - elapsed

        return max(0, int(remaining))
