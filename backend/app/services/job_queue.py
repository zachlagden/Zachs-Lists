"""
Job creation service.

Creates jobs in MongoDB. Processing is handled by separate worker processes.
"""

import logging
from bson import ObjectId

from app.models.user import User
from app.models.job import Job

logger = logging.getLogger(__name__)


def create_job(
    user: User, job_type: str = Job.TYPE_MANUAL, force_rebuild: bool = False
) -> Job:
    """
    Create a new job for a user.

    Workers will poll MongoDB and claim this job for processing.

    Args:
        user: User to process for
        job_type: Type of job (manual, scheduled, admin)
        force_rebuild: If True, worker bypasses all caching optimizations

    Returns:
        Created Job instance
    """
    # Create job record with normal priority for user jobs
    job = Job.create(
        user_id=ObjectId(user.id),
        username=user.username,
        job_type=job_type,
        priority=Job.PRIORITY_NORMAL,
        force_rebuild=force_rebuild,
    )

    # Emit Socket.IO event
    try:
        from app.socketio import emit_job_created

        emit_job_created(job.to_dict(), user.id)
    except Exception:
        pass  # Silently fail if Socket.IO not available

    logger.info(f"Created job {job.job_id} for user {user.username}")
    return job


def create_default_job(
    job_type: str = Job.TYPE_SCHEDULED, force_rebuild: bool = False
) -> Job:
    """
    Create a job for default lists.

    Default jobs have high priority and will be processed first.

    Args:
        job_type: Type of job (scheduled, admin)
        force_rebuild: If True, worker bypasses all caching optimizations

    Returns:
        Created Job instance
    """
    # Create job record with high priority for default jobs
    job = Job.create_default(
        job_type=job_type,
        priority=Job.PRIORITY_HIGH,
        force_rebuild=force_rebuild,
    )

    # Emit Socket.IO event
    try:
        from app.socketio import emit_job_created

        emit_job_created(job.to_dict(), None)
    except Exception:
        pass  # Silently fail if Socket.IO not available

    logger.info(f"Created default lists job {job.job_id}")
    return job


def queue_length() -> int:
    """Get number of jobs waiting in queue."""
    return Job.count_queued()


def processing_count() -> int:
    """Get number of jobs currently processing."""
    return Job.count_processing()


# Legacy class interface for backward compatibility with existing imports
class JobQueue:
    """
    Legacy interface for job creation.

    The actual job processing is now handled by separate worker processes.
    This class is kept for backward compatibility with existing imports.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def init_app(self, app):
        """Initialize with Flask app context (no-op, kept for compatibility)."""
        pass

    @classmethod
    def queue_job(
        cls, user: User, job_type: str = Job.TYPE_MANUAL, force_rebuild: bool = False
    ) -> Job:
        """Queue a new job for a user."""
        return create_job(user, job_type, force_rebuild=force_rebuild)

    @classmethod
    def queue_default_job(
        cls, job_type: str = Job.TYPE_SCHEDULED, force_rebuild: bool = False
    ) -> Job:
        """Queue a job for default lists."""
        return create_default_job(job_type, force_rebuild=force_rebuild)

    @classmethod
    def queue_length(cls) -> int:
        """Get number of jobs waiting in queue."""
        return queue_length()

    @classmethod
    def processing_count(cls) -> int:
        """Get number of jobs currently processing."""
        return processing_count()

    @classmethod
    def is_running(cls) -> bool:
        """Check if queue is running (always True, workers are separate)."""
        return True
