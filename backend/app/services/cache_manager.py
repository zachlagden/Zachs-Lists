"""
Cache manager for shared blocklist cache.

Manages downloaded blocklist content in MongoDB to avoid
redundant downloads when multiple users use the same sources.
"""

import logging
from app.models.cache import CacheMetadata

logger = logging.getLogger(__name__)


class CacheManager:
    """Manage shared blocklist cache in MongoDB."""

    def cleanup_stale(self, days: int = 30) -> int:
        """
        Clean up cache entries not accessed in specified days.

        Args:
            days: Number of days after which to consider stale

        Returns:
            Number of entries cleaned up
        """
        stale_entries = CacheMetadata.get_stale_entries(days=days)
        cleaned = 0

        for entry in stale_entries:
            CacheMetadata.delete_by_url_hash(entry.url_hash)
            cleaned += 1

        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} stale cache entries")

        return cleaned
