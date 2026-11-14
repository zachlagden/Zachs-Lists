"""
Socket.IO initialization and event handlers.
"""

import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from itsdangerous import BadSignature
from pymongo.errors import PyMongoError
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask import Flask, current_app, request, session
from flask.sessions import SecureCookieSessionInterface

from app.models.user import User
from app.utils.time import utc_iso

logger = logging.getLogger(__name__)


@dataclass
class SocketAccount:
    user_id: str
    auth_version: int
    expires_at: float


@dataclass
class AccountAccess:
    allowed: bool
    is_admin: bool
    auth_version: int
    checked_at: float


ACCESS_CACHE_SECONDS = 10.0
ADMIN_ROOMS = ("jobs:all", "stats:admin")

_connections: dict[str, SocketAccount] = {}
_account_access: dict[str, AccountAccess] = {}
_socket_app: Flask | None = None

# Create Socket.IO instance
# async_mode="gevent" for production with gunicorn gevent workers
# Falls back gracefully in development
socketio = SocketIO(
    cors_allowed_origins=[],
    async_mode="gevent",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=65536,
)


def init_socketio(app):
    """Initialize Socket.IO with Flask app."""
    global _socket_app
    _socket_app = app
    _connections.clear()
    _account_access.clear()
    socketio.init_app(app, cors_allowed_origins=[app.config["FRONTEND_URL"]])
    register_handlers()
    if not app.config.get("TESTING"):
        socketio.start_background_task(_monitor_connections, app)
    logger.info("Socket.IO initialized")
    return socketio


def _current_user() -> User | None:
    user_id = session.get("user_id")
    if not isinstance(user_id, str):
        return None
    try:
        user = User.get_by_id(user_id)
    except (ValueError, TypeError):
        return None
    if (
        not user
        or not user.is_enabled
        or user.is_banned
        or session.get("auth_version", 0) != user.auth_version
    ):
        return None
    return user


def _allowed_room(data: object, kind: str) -> str | None:
    user = _current_user()
    if user is None or not isinstance(data, dict) or len(data) != 1:
        return None
    if kind == "jobs" and data.get("all") is True and user.is_admin:
        return "jobs:all"
    if data.get("user_id") == user.id:
        return f"{kind}:{user.id}"
    return None


def _session_expiry() -> float:
    interface = current_app.session_interface
    if not isinstance(interface, SecureCookieSessionInterface):
        return 0
    serializer = interface.get_signing_serializer(current_app)
    cookie = request.cookies.get(current_app.config["SESSION_COOKIE_NAME"])
    if serializer is None or not cookie:
        return 0
    try:
        _, signed_at = serializer.loads(cookie, return_timestamp=True)
    except BadSignature:
        return 0
    return (
        signed_at.timestamp() + current_app.permanent_session_lifetime.total_seconds()
    )


def _access_for(user_id: str) -> AccountAccess:
    now = time.monotonic()
    cached = _account_access.get(user_id)
    if cached is not None and now - cached.checked_at < ACCESS_CACHE_SECONDS:
        return cached
    user = User.get_by_id(user_id)
    access = AccountAccess(
        allowed=bool(user and user.is_enabled and not user.is_banned),
        is_admin=bool(user and user.is_admin),
        auth_version=user.auth_version if user else -1,
        checked_at=now,
    )
    _account_access[user_id] = access
    return access


def _connection_allowed(sid: str, room: str | None) -> bool:
    account = _connections.get(sid)
    if account is None or account.expires_at <= time.time():
        return False
    access = _access_for(account.user_id)
    if not access.allowed or access.auth_version != account.auth_version:
        return False
    return access.is_admin or room not in ADMIN_ROOMS


def _prune_connections(room: str | None = None) -> None:
    participants = (
        list(socketio.server.manager.get_participants("/", room))
        if room
        else [(sid, None) for sid in list(_connections)]
    )
    for sid, _ in participants:
        if not _connection_allowed(sid, room):
            socketio.server.disconnect(sid, namespace="/")
    connected_users = {account.user_id for account in _connections.values()}
    for user_id in list(_account_access):
        if user_id not in connected_users:
            del _account_access[user_id]


def _monitor_connections(app: Flask) -> None:
    while _socket_app is app:
        with app.app_context():
            _prune_connections()
        socketio.sleep(15)


def _emit(event: str, data: dict, room: str) -> None:
    if _socket_app is None:
        raise RuntimeError("Realtime service is not initialised")
    with _socket_app.app_context():
        _prune_connections(room)
        socketio.emit(event, data, room=room)


def disconnect_user(user_id: str) -> None:
    """Disconnect every socket for an account whose access or role changed."""
    room = f"account:{user_id}"
    _account_access.pop(user_id, None)
    for sid, _ in list(socketio.server.manager.get_participants("/", room)):
        socketio.server.disconnect(sid, namespace="/")


def _jobs_subscription(room: str) -> dict[str, Any]:
    from app.services.job_feed import active_job_payloads

    owner = room.removeprefix("jobs:")
    acknowledgement: dict[str, Any] = {
        "success": True,
        "server_time": utc_iso(datetime.now(timezone.utc)),
    }
    try:
        acknowledgement["jobs"] = active_job_payloads(
            None if room == "jobs:all" else owner
        )
    except PyMongoError:
        logger.exception("Could not load active jobs for %s", room)
        acknowledgement["jobs"] = None
    return acknowledgement


def register_handlers():
    @socketio.on("connect")
    def handle_connect():
        user = _current_user()
        if user is None:
            return False
        expires_at = _session_expiry()
        if expires_at <= time.time():
            return False
        _connections[request.sid] = SocketAccount(
            user.id, user.auth_version, expires_at
        )
        join_room(f"account:{user.id}")
        emit("connected", {"status": "ok"})

    @socketio.on("disconnect")
    def handle_disconnect(reason=None):
        _connections.pop(request.sid, None)

    @socketio.on("subscribe:jobs")
    def handle_subscribe_jobs(data):
        room = _allowed_room(data, "jobs")
        if room is None:
            return {"error": "Access denied"}
        join_room(room)
        return _jobs_subscription(room)

    @socketio.on("unsubscribe:jobs")
    def handle_unsubscribe_jobs(data):
        room = _allowed_room(data, "jobs")
        if room is None:
            return {"error": "Access denied"}
        leave_room(room)
        return {"success": True}

    @socketio.on("subscribe:stats")
    def handle_subscribe_stats(data=None):
        user = _current_user()
        if user is None or not user.is_admin:
            return {"error": "Access denied"}
        join_room("stats:admin")
        return {"success": True}

    @socketio.on("unsubscribe:stats")
    def handle_unsubscribe_stats(data=None):
        user = _current_user()
        if user is None or not user.is_admin:
            return {"error": "Access denied"}
        leave_room("stats:admin")
        return {"success": True}

    @socketio.on("subscribe:validation")
    def handle_subscribe_validation(data):
        room = _allowed_room(data, "validation")
        if room is None:
            return {"error": "Access denied"}
        join_room(room)
        return {"success": True}

    @socketio.on("unsubscribe:validation")
    def handle_unsubscribe_validation(data):
        room = _allowed_room(data, "validation")
        if room is None:
            return {"error": "Access denied"}
        leave_room(room)
        return {"success": True}


# Event emitters


def _emit_to_job_rooms(
    event: str, job_data: dict[str, Any], user_id: str | None
) -> None:
    _emit(event, job_data, "jobs:all")
    if user_id:
        _emit(event, job_data, f"jobs:{user_id}")


def emit_job_created(job_data: dict[str, Any], user_id: str | None = None) -> None:
    _emit_to_job_rooms("job:created", job_data, user_id)


def emit_job_progress(job_data: dict[str, Any], user_id: str | None = None) -> None:
    _emit_to_job_rooms("job:progress", job_data, user_id)


def emit_job_completed(job_data: dict[str, Any], user_id: str | None = None) -> None:
    _emit_to_job_rooms("job:completed", job_data, user_id)
    emit_stats_updated()


def emit_stats_updated():
    """Emit stats:updated event to admin stats room."""
    _emit("stats:updated", {}, "stats:admin")


# Config validation events


def emit_validation_progress(user_id: str, progress: dict):
    """
    Emit config:validation_progress event during config URL validation.

    Args:
        user_id: User ID for user-specific room
        progress: Progress dictionary with current, total, url, status
    """
    room = f"validation:{user_id}"
    _emit("config:validation_progress", progress, room)


def emit_validation_complete(user_id: str, result: dict):
    """
    Emit config:validation_complete event when validation finishes.

    Args:
        user_id: User ID for user-specific room
        result: Validation result dictionary
    """
    room = f"validation:{user_id}"
    _emit("config:validation_complete", result, room)
