"""
Job queue statistics.

Jobs are created by app.services.build_admission and processed by separate
worker processes.
"""

from app.models.job import Job


def queue_length() -> int:
    """Get number of jobs waiting in queue."""
    return Job.count_queued()


def processing_count() -> int:
    """Get number of jobs currently processing."""
    return Job.count_processing()


# Legacy class interface for backward compatibility with existing imports
class JobQueue:
    """
    Legacy interface for queue statistics.

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
