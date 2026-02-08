"""
Cache manager for shared blocklist cache.

Manages downloaded blocklist content in MongoDB to avoid
redundant downloads when multiple users use the same sources.
"""

import hashlib
import logging
from typing import Optional, Dict, Any

from app.models.cache import CacheMetadata
from app.services.http_client import HTTPClient
from app.utils.security import check_content_safety

logger = logging.getLogger(__name__)


class CacheManager:
    """Manage shared blocklist cache in MongoDB."""

    @staticmethod
    def url_to_hash(url: str) -> str:
        """
        Convert URL to hash for cache key.

        Args:
            url: URL to hash

        Returns:
            SHA256 hash of URL
        """
        return hashlib.sha256(url.encode()).hexdigest()

    def get_or_download(
        self,
        url: str,
        http_client: HTTPClient = None,
        force_download: bool = False,
    ) -> Optional[bytes]:
        """
        Get content from cache or download if needed.

        Args:
            url: URL to get content for
            http_client: HTTP client instance (creates one if not provided)
            force_download: Force download even if cached

        Returns:
            Content bytes or None on failure
        """
        url_hash = self.url_to_hash(url)

        # Load existing metadata for conditional request
        etag = None
        last_modified = None
        cached_entry = None

        if not force_download:
            cached_entry = CacheMetadata.get_by_url_hash(url_hash)
            if cached_entry:
                etag = cached_entry.etag
                last_modified = cached_entry.last_modified

        # Create HTTP client if not provided
        own_client = http_client is None
        if own_client:
            http_client = HTTPClient()

        try:
            # Download with conditional request
            content, new_etag, new_last_modified, was_modified = http_client.download(
                url,
                etag=None if force_download else etag,
                last_modified=None if force_download else last_modified,
            )

            if not was_modified and cached_entry:
                # Return cached content from MongoDB
                logger.debug(f"Using cached content for {url}")
                CacheMetadata.touch(url_hash)
                return cached_entry.content

            if content:
                # Check content safety
                if not check_content_safety(content):
                    logger.warning(f"Unsafe content detected for {url}")
                    return None

                # Count domains (rough estimate)
                domain_count = content.count(b"\n")

                # Save to MongoDB
                CacheMetadata.upsert(
                    url_hash=url_hash,
                    url=url,
                    content=content,
                    etag=new_etag,
                    last_modified=new_last_modified,
                    domain_count=domain_count,
                )

                logger.debug(f"Cached content for {url}: {len(content)} bytes")
                return content

            return None

        except Exception as e:
            logger.error(f"Failed to get content for {url}: {e}")

            # If download fails but we have cache, return cached content
            if cached_entry and cached_entry.content:
                logger.info(f"Using stale cache for {url}")
                return cached_entry.content

            return None

        finally:
            if own_client:
                http_client.close()

    def get_cached_content(self, url: str) -> Optional[bytes]:
        """
        Get cached content without downloading.

        Args:
            url: URL to get cached content for

        Returns:
            Cached content or None if not cached
        """
        url_hash = self.url_to_hash(url)
        return CacheMetadata.get_content(url_hash)

    def is_cached(self, url: str) -> bool:
        """Check if URL is cached."""
        url_hash = self.url_to_hash(url)
        entry = CacheMetadata.get_by_url_hash(url_hash)
        return entry is not None and entry.content is not None

    def get_cache_metadata(self, url: str) -> Optional[Dict[str, Any]]:
        """Get cache metadata for a URL."""
        url_hash = self.url_to_hash(url)
        entry = CacheMetadata.get_by_url_hash(url_hash)
        if entry:
            return {
                "url": entry.url,
                "url_hash": entry.url_hash,
                "etag": entry.etag,
                "last_modified": entry.last_modified,
                "content_hash": entry.content_hash,
                "size_bytes": entry.stats.get("size_bytes", 0),
                "domain_count": entry.stats.get("domain_count", 0),
                "updated_at": (
                    entry.updated_at.isoformat() if entry.updated_at else None
                ),
            }
        return None

    def invalidate(self, url: str) -> bool:
        """
        Invalidate cache for a URL.

        Args:
            url: URL to invalidate

        Returns:
            True if cache was invalidated
        """
        url_hash = self.url_to_hash(url)
        deleted = CacheMetadata.delete_by_url_hash(url_hash)
        if deleted:
            logger.info(f"Invalidated cache for {url}")
        return deleted

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

    def get_previous_domain_count(self, url: str) -> Optional[int]:
        """
        Get domain count from previous successful download.

        Used for calculating domain change (+/-) vs last run.

        Args:
            url: URL to check

        Returns:
            Previous domain count or None if not available
        """
        metadata = self.get_cache_metadata(url)
        if metadata:
            return metadata.get("domain_count")
        return None

    def update_domain_count(self, url: str, domain_count: int) -> None:
        """
        Update the domain count in cache metadata.

        Called after extracting domains to store the accurate count
        (since the initial count is just an estimate from newline count).

        Args:
            url: URL to update
            domain_count: Actual domain count
        """
        url_hash = self.url_to_hash(url)
        CacheMetadata.update_domain_count(url_hash, domain_count)

    @classmethod
    def get_total_size(cls) -> int:
        """Get total size of all cached content."""
        return CacheMetadata.get_total_size()
