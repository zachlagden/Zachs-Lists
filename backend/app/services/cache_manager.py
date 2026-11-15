"""
Cache manager for shared blocklist cache.

Manages downloaded blocklist content in MongoDB to avoid
redundant downloads when multiple users use the same sources.
"""

import logging
import os
from datetime import datetime, timedelta

from app.models.cache import CacheMetadata

logger = logging.getLogger(__name__)

FALLBACK_DAYS = 8
DEFAULT_CACHE_TTL_DAYS = 7


def retention_days(configured_days: int) -> int:
    return max(configured_days, FALLBACK_DAYS)


def configured_cache_ttl_days() -> int:
    try:
        return int(os.environ.get("CACHE_TTL_DAYS", ""))
    except ValueError:
        return DEFAULT_CACHE_TTL_DAYS


class CacheManager:
    """Manage shared blocklist cache in MongoDB."""

    def cleanup_stale(self, days: int | None = None) -> int:
        """
        Clean up cache entries with no successful upstream check in the retention period.

        Args:
            days: Configured retention in days, read from CACHE_TTL_DAYS when omitted

        Returns:
            Number of entries cleaned up
        """
        configured = configured_cache_ttl_days() if days is None else days
        cutoff = datetime.utcnow() - timedelta(days=retention_days(configured))
        cleaned = CacheMetadata.delete_unchecked_since(cutoff)

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} stale cache entries")

        return cleaned
