import hashlib
import hmac
import logging
import time
from threading import Lock

from flask import current_app, request
from pymongo.errors import ConnectionFailure

from app.models.analytics import Analytics
from app.services import geoip
from app.utils.client_ip import get_client_ip

logger = logging.getLogger(__name__)

UNKNOWN_IP = "unknown"
VISITOR_HASH_LENGTH = 16
REPEAT_LOG_SECONDS = 600
DATABASE_PAUSE_SECONDS = 30


class FailureLog:
    def __init__(self, repeat_seconds: float = REPEAT_LOG_SECONDS) -> None:
        self._repeat_seconds = repeat_seconds
        self._lock = Lock()
        self._last_logged: dict[tuple[str, str, int | None], float] = {}
        self._suppressed: dict[tuple[str, str, int | None], int] = {}

    def report(self, stage: str, error: Exception) -> None:
        code = getattr(error, "code", None)
        kind = (stage, type(error).__name__, code if isinstance(code, int) else None)
        now = time.monotonic()
        with self._lock:
            last = self._last_logged.get(kind)
            if last is not None and now - last < self._repeat_seconds:
                self._suppressed[kind] = self._suppressed.get(kind, 0) + 1
                return
            suppressed = self._suppressed.pop(kind, 0)
            self._last_logged[kind] = now
        logger.error(
            "Download analytics failed at %s with %s (MongoDB code %s): %s. "
            "%d identical failures were not logged since the last report; "
            "this kind is logged at most once every %d seconds.",
            stage,
            kind[1],
            kind[2],
            error,
            suppressed,
            int(self._repeat_seconds),
            exc_info=error,
        )

    def reset(self) -> None:
        with self._lock:
            self._last_logged.clear()
            self._suppressed.clear()


class DatabasePause:
    def __init__(self, seconds: float = DATABASE_PAUSE_SECONDS) -> None:
        self._seconds = seconds
        self._until = 0.0

    def start(self) -> None:
        self._until = time.monotonic() + self._seconds

    def active(self) -> bool:
        return time.monotonic() < self._until

    def reset(self) -> None:
        self._until = 0.0


failures = FailureLog()
database_pause = DatabasePause()


def keyed_ip_hash(ip: str, purpose: str) -> str:
    key = str(current_app.config["SECRET_KEY"]).encode()
    digest = hmac.new(key, f"{purpose}:{ip}".encode(), hashlib.sha256)
    return digest.hexdigest()[:VISITOR_HASH_LENGTH]


def visitor_hash(ip: str) -> str:
    return keyed_ip_hash(ip, "analytics-visitor")


def access_log_hash(ip: str) -> str:
    return keyed_ip_hash(ip, "account-access")


def _locate(ip: str) -> tuple[str | None, str | None]:
    try:
        return geoip.locate(current_app.config.get("GEOIP_DATABASE_PATH") or "", ip)
    except Exception as error:
        failures.report("geoip lookup", error)
        return None, None


def record_download(
    list_type: str,
    list_name: str,
    username: str | None,
    format_type: str,
    size_bytes: int,
) -> None:
    if request.method != "GET" or database_pause.active():
        return
    try:
        ip = get_client_ip()
        known = ip != UNKNOWN_IP
        country, city = _locate(ip) if known else (None, None)
        Analytics.record_download(
            list_type=list_type,
            list_name=list_name,
            username=username or None,
            format_type=format_type,
            visitor_hash=visitor_hash(ip) if known else None,
            country=country,
            city=city,
            referrer=request.headers.get("Referer"),
            size_bytes=size_bytes,
        )
    except ConnectionFailure as error:
        database_pause.start()
        failures.report("database connection", error)
    except Exception as error:
        failures.report("recording", error)
