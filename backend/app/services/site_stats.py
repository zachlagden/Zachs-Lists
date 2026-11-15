import logging
import os
from typing import Any

from app.models.analytics import Analytics
from app.models.system_config import SystemConfig
from app.models.user import User
from app.utils.timed_cache import TimedCache

logger = logging.getLogger(__name__)

PUBLIC_STATS_SECONDS = 300
PUBLIC_REPORT_SECONDS = 300
STORAGE_SECONDS = 60

_public_stats: TimedCache[dict[str, Any]] = TimedCache(PUBLIC_STATS_SECONDS)
_public_reports: TimedCache[dict[str, Any]] = TimedCache(PUBLIC_REPORT_SECONDS)
_storage: TimedCache[int] = TimedCache(STORAGE_SECONDS)


def _load_public_stats() -> dict[str, Any]:
    totals = Analytics.get_default_list_totals()
    return {
        "total_domains": SystemConfig.get_default_build_total_domains(),
        "total_requests": totals["total_requests"],
        "total_bandwidth_bytes": totals["total_bandwidth"],
        "user_count": User.count(is_enabled=True),
        "period_days": totals["period_days"],
    }


def public_stats() -> dict[str, Any]:
    return _public_stats.get("public", _load_public_stats)


def public_report(days: int) -> dict[str, Any]:
    return _public_reports.get(days, lambda: Analytics.public_report(days))


def _directory_bytes(path: str) -> int:
    total = 0
    unreadable = 0
    for directory, _, filenames in os.walk(path):
        for filename in filenames:
            try:
                total += os.path.getsize(os.path.join(directory, filename))
            except OSError:
                unreadable += 1
    if unreadable:
        logger.warning("Skipped %d unreadable files while sizing %s", unreadable, path)
    return total


def storage_bytes(path: str) -> int:
    return _storage.get(path, lambda: _directory_bytes(path))


def clear_caches() -> None:
    _public_stats.clear()
    _public_reports.clear()
    _storage.clear()
