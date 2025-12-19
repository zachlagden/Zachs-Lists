"""
Socket.IO initialization and event handlers.
"""

import logging
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask import request

logger = logging.getLogger(__name__)

# Create Socket.IO instance
# async_mode="gevent" for production with gunicorn gevent workers
# Falls back gracefully in development
socketio = SocketIO(
    cors_allowed_origins="*",
    async_mode="gevent",
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
)


def init_socketio(app):
    """Initialize Socket.IO with Flask app."""
    socketio.init_app(app)
    register_handlers()
    logger.info("Socket.IO initialized")
    return socketio


def register_handlers():
    """Register Socket.IO event handlers."""

    @socketio.on("connect")
    def handle_connect():
        """Handle client connection."""
        logger.debug(f"Client connected: {request.sid}")
        emit("connected", {"status": "ok"})

    @socketio.on("disconnect")
    def handle_disconnect():
        """Handle client disconnection."""
        logger.debug(f"Client disconnected: {request.sid}")

    @socketio.on("subscribe:jobs")
    def handle_subscribe_jobs(data):
        """
        Subscribe to job updates.

        Args:
            data: {"user_id": str} for user-specific jobs, or {"all": true} for all jobs (admin)
        """
        if data.get("all"):
            join_room("jobs:all")
            logger.debug(f"Client {request.sid} subscribed to all jobs")
        elif data.get("user_id"):
            room = f"jobs:{data['user_id']}"
            join_room(room)
            logger.debug(f"Client {request.sid} subscribed to {room}")

    @socketio.on("unsubscribe:jobs")
    def handle_unsubscribe_jobs(data):
        """Unsubscribe from job updates."""
        if data.get("all"):
            leave_room("jobs:all")
        elif data.get("user_id"):
            leave_room(f"jobs:{data['user_id']}")

    @socketio.on("subscribe:stats")
    def handle_subscribe_stats():
        """Subscribe to stats updates (admin only)."""
        join_room("stats:admin")
        logger.debug(f"Client {request.sid} subscribed to admin stats")

    @socketio.on("unsubscribe:stats")
    def handle_unsubscribe_stats():
        """Unsubscribe from stats updates."""
        leave_room("stats:admin")

    @socketio.on("subscribe:validation")
    def handle_subscribe_validation(data):
        """
        Subscribe to config validation progress updates.

        Args:
            data: {"user_id": str}
        """
        if data.get("user_id"):
            room = f"validation:{data['user_id']}"
            join_room(room)
            logger.debug(f"Client {request.sid} subscribed to {room}")

    @socketio.on("unsubscribe:validation")
    def handle_unsubscribe_validation(data):
        """Unsubscribe from config validation updates."""
        if data.get("user_id"):
            leave_room(f"validation:{data['user_id']}")


# Event emitters

def emit_job_created(job_data: dict, user_id: str = None):
    """
    Emit job:created event.

    Args:
        job_data: Job dictionary from job.to_dict()
        user_id: User ID for user-specific room
    """
    # Emit to all jobs room (for admin)
    socketio.emit("job:created", job_data, room="jobs:all")

    # Emit to user-specific room
    if user_id:
        socketio.emit("job:created", job_data, room=f"jobs:{user_id}")


def emit_job_updated(job_data: dict, user_id: str = None):
    """
    Emit job:updated event (for status changes and progress).

    Args:
        job_data: Job dictionary from job.to_dict()
        user_id: User ID for user-specific room
    """
    # Emit to all jobs room (for admin)
    socketio.emit("job:updated", job_data, room="jobs:all")

    # Emit to user-specific room
    if user_id:
        socketio.emit("job:updated", job_data, room=f"jobs:{user_id}")


def emit_job_completed(job_data: dict, user_id: str = None):
    """
    Emit job:completed event.

    Args:
        job_data: Job dictionary from job.to_dict()
        user_id: User ID for user-specific room
    """
    # Emit to all jobs room (for admin)
    socketio.emit("job:completed", job_data, room="jobs:all")

    # Emit to user-specific room
    if user_id:
        socketio.emit("job:completed", job_data, room=f"jobs:{user_id}")

    # Also emit stats update for admin dashboard
    emit_stats_updated()


def emit_job_progress(job):
    """
    Emit job:progress event with full job state.

    This is the consolidated event that replaces granular updates.
    Called by JobStatusPoller every 500ms when job state changes.

    For queued jobs, includes queue_info with position and worker stats.

    Args:
        job: Job instance
    """
    from app.models.job import Job

    job_data = job.to_dict()
    user_id = str(job.user_id) if job.user_id else None

    # Add queue info for queued jobs
    if job.status == Job.STATUS_QUEUED:
        queue_stats = Job.get_queue_stats()
        job_data["queue_info"] = {
            "position": Job.get_queue_position(job.job_id),
            "total_queued": queue_stats["queue_length"],
            "active_workers": queue_stats["active_workers"],
            "jobs_processing": queue_stats["processing_count"],
        }

    # Emit to all jobs room (for admin)
    socketio.emit("job:progress", job_data, room="jobs:all")

    # Emit to user-specific room
    if user_id:
        socketio.emit("job:progress", job_data, room=f"jobs:{user_id}")


def emit_stats_updated():
    """Emit stats:updated event to admin stats room."""
    socketio.emit("stats:updated", {}, room="stats:admin")


# Enhanced progress event emitters


def emit_stage_changed(job_id: str, stage: str, progress: dict, user_id: str = None):
    """
    Emit job:stage_changed event when job transitions between stages.

    Args:
        job_id: Job ID
        stage: New stage (queue, downloading, whitelist, generation, completed)
        progress: Enhanced progress dictionary
        user_id: User ID for user-specific room
    """
    data = {"job_id": job_id, "stage": stage, "progress": progress}
    socketio.emit("job:stage_changed", data, room="jobs:all")
    if user_id:
        socketio.emit("job:stage_changed", data, room=f"jobs:{user_id}")


def emit_source_update(job_id: str, source_progress: dict, user_id: str = None):
    """
    Emit job:source_update event for per-source progress updates.

    Args:
        job_id: Job ID
        source_progress: Source progress dictionary from SourceProgress.to_dict()
        user_id: User ID for user-specific room
    """
    data = {"job_id": job_id, "source": source_progress}
    socketio.emit("job:source_update", data, room="jobs:all")
    if user_id:
        socketio.emit("job:source_update", data, room=f"jobs:{user_id}")


def emit_download_progress(
    job_id: str,
    source_id: str,
    bytes_downloaded: int,
    bytes_total: int = None,
    user_id: str = None,
):
    """
    Emit job:download_progress event for byte-level download progress.

    Args:
        job_id: Job ID
        source_id: Source URL hash
        bytes_downloaded: Bytes downloaded so far
        bytes_total: Total bytes (None if unknown)
        user_id: User ID for user-specific room
    """
    data = {
        "job_id": job_id,
        "source_id": source_id,
        "bytes_downloaded": bytes_downloaded,
        "bytes_total": bytes_total,
    }
    socketio.emit("job:download_progress", data, room="jobs:all")
    if user_id:
        socketio.emit("job:download_progress", data, room=f"jobs:{user_id}")


def emit_whitelist_update(job_id: str, whitelist_progress: dict, user_id: str = None):
    """
    Emit job:whitelist_update event for whitelist filtering progress.

    Args:
        job_id: Job ID
        whitelist_progress: Whitelist progress dictionary
        user_id: User ID for user-specific room
    """
    data = {"job_id": job_id, "whitelist": whitelist_progress}
    socketio.emit("job:whitelist_update", data, room="jobs:all")
    if user_id:
        socketio.emit("job:whitelist_update", data, room=f"jobs:{user_id}")


def emit_format_update(job_id: str, format_progress: dict, user_id: str = None):
    """
    Emit job:format_update event for output format generation progress.

    Args:
        job_id: Job ID
        format_progress: Format progress dictionary from FormatProgress.to_dict()
        user_id: User ID for user-specific room
    """
    data = {"job_id": job_id, "format": format_progress}
    socketio.emit("job:format_update", data, room="jobs:all")
    if user_id:
        socketio.emit("job:format_update", data, room=f"jobs:{user_id}")


def emit_job_skipped(job_id: str, reason: str, user_id: str = None):
    """
    Emit job:skipped event when a job is skipped.

    Args:
        job_id: Job ID
        reason: Reason the job was skipped
        user_id: User ID for user-specific room
    """
    data = {"job_id": job_id, "reason": reason}
    socketio.emit("job:skipped", data, room="jobs:all")
    if user_id:
        socketio.emit("job:skipped", data, room=f"jobs:{user_id}")
    # Also emit stats update for admin dashboard
    emit_stats_updated()


# Config validation events

def emit_validation_progress(user_id: str, progress: dict):
    """
    Emit config:validation_progress event during config URL validation.

    Args:
        user_id: User ID for user-specific room
        progress: Progress dictionary with current, total, url, status
    """
    room = f"validation:{user_id}"
    socketio.emit("config:validation_progress", progress, room=room)


def emit_validation_complete(user_id: str, result: dict):
    """
    Emit config:validation_complete event when validation finishes.

    Args:
        user_id: User ID for user-specific room
        result: Validation result dictionary
    """
    room = f"validation:{user_id}"
    socketio.emit("config:validation_complete", result, room=room)
