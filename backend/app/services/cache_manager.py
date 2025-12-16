"""
Cache manager for shared blocklist cache.

Manages downloaded blocklist content in a shared cache to avoid
redundant downloads when multiple users use the same sources.
"""

import os
import json
import hashlib
import logging
from datetime import datetime
from typing import Optional, Dict, Any

from flask import current_app

from app.models.cache import CacheMetadata
from app.services.http_client import HTTPClient
from app.utils.security import check_content_safety

logger = logging.getLogger(__name__)


class CacheManager:
    """Manage shared blocklist cache."""

    def __init__(self, cache_dir: str = None):
        """
        Initialize cache manager.

        Args:
            cache_dir: Cache directory path (uses config default if not specified)
        """
        self.cache_dir = cache_dir

    def _get_cache_dir(self) -> str:
        """Get cache directory, with fallback to config."""
        if self.cache_dir:
            return self.cache_dir
        return current_app.config["CACHE_DIR"]

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

    def get_cache_path(self, url_hash: str) -> str:
        """Get path for cached content."""
        return os.path.join(self._get_cache_dir(), url_hash, "content.txt")

    def get_metadata_path(self, url_hash: str) -> str:
        """Get path for cache metadata JSON."""
        return os.path.join(self._get_cache_dir(), url_hash, "metadata.json")

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
        cache_path = self.get_cache_path(url_hash)
        metadata_path = self.get_metadata_path(url_hash)

        # Load existing metadata
        etag = None
        last_modified = None

        if not force_download and os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    metadata = json.load(f)
                    etag = metadata.get("etag")
                    last_modified = metadata.get("last_modified")
            except Exception as e:
                logger.warning(f"Failed to load cache metadata for {url}: {e}")

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

            if not was_modified and os.path.exists(cache_path):
                # Return cached content
                logger.debug(f"Using cached content for {url}")
                with open(cache_path, "rb") as f:
                    return f.read()

            if content:
                # Check content safety
                if not check_content_safety(content):
                    logger.warning(f"Unsafe content detected for {url}")
                    return None

                # Update cache
                self._save_to_cache(
                    url_hash,
                    url,
                    content,
                    new_etag,
                    new_last_modified,
                )

                return content

            return None

        except Exception as e:
            logger.error(f"Failed to get content for {url}: {e}")

            # If download fails but we have cache, return cached content
            if os.path.exists(cache_path):
                logger.info(f"Using stale cache for {url}")
                with open(cache_path, "rb") as f:
                    return f.read()

            return None

        finally:
            if own_client:
                http_client.close()

    def _save_to_cache(
        self,
        url_hash: str,
        url: str,
        content: bytes,
        etag: str = None,
        last_modified: str = None,
    ) -> None:
        """
        Save content and metadata to cache.

        Args:
            url_hash: Hash of URL
            url: Original URL
            content: Content to cache
            etag: ETag header
            last_modified: Last-Modified header
        """
        cache_path = self.get_cache_path(url_hash)
        metadata_path = self.get_metadata_path(url_hash)

        # Create directory
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)

        # Save content
        with open(cache_path, "wb") as f:
            f.write(content)

        # Calculate content hash
        content_hash = hashlib.sha256(content).hexdigest()

        # Count domains (rough estimate)
        domain_count = content.count(b"\n")

        # Save metadata
        metadata = {
            "url": url,
            "url_hash": url_hash,
            "etag": etag,
            "last_modified": last_modified,
            "content_hash": content_hash,
            "size_bytes": len(content),
            "domain_count": domain_count,
            "updated_at": datetime.utcnow().isoformat(),
        }

        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        # Update database metadata
        try:
            CacheMetadata.upsert(
                url_hash=url_hash,
                url=url,
                etag=etag,
                last_modified=last_modified,
                content_hash=content_hash,
                size_bytes=len(content),
                domain_count=domain_count,
            )
        except Exception as e:
            logger.error(f"Failed to update cache metadata in DB: {e}")

        logger.debug(f"Cached content for {url}: {len(content)} bytes")

    def get_cached_content(self, url: str) -> Optional[bytes]:
        """
        Get cached content without downloading.

        Args:
            url: URL to get cached content for

        Returns:
            Cached content or None if not cached
        """
        url_hash = self.url_to_hash(url)
        cache_path = self.get_cache_path(url_hash)

        if os.path.exists(cache_path):
            with open(cache_path, "rb") as f:
                return f.read()

        return None

    def is_cached(self, url: str) -> bool:
        """Check if URL is cached."""
        url_hash = self.url_to_hash(url)
        return os.path.exists(self.get_cache_path(url_hash))

    def get_cache_metadata(self, url: str) -> Optional[Dict[str, Any]]:
        """Get cache metadata for a URL."""
        url_hash = self.url_to_hash(url)
        metadata_path = self.get_metadata_path(url_hash)

        if os.path.exists(metadata_path):
            with open(metadata_path, "r") as f:
                return json.load(f)

        return None

    def invalidate(self, url: str) -> bool:
        """
        Invalidate cache for a URL.

        Args:
            url: URL to invalidate

        Returns:
            True if cache was invalidated
        """
        import shutil

        url_hash = self.url_to_hash(url)
        cache_dir = os.path.join(self._get_cache_dir(), url_hash)

        if os.path.exists(cache_dir):
            shutil.rmtree(cache_dir)
            CacheMetadata.delete_by_url_hash(url_hash)
            logger.info(f"Invalidated cache for {url}")
            return True

        return False

    def cleanup_stale(self, days: int = 30) -> int:
        """
        Clean up cache entries not accessed in specified days.

        Args:
            days: Number of days after which to consider stale

        Returns:
            Number of entries cleaned up
        """
        import shutil
        from datetime import timedelta

        stale_entries = CacheMetadata.get_stale_entries(days=days)
        cleaned = 0

        for entry in stale_entries:
            cache_dir = os.path.join(self._get_cache_dir(), entry.url_hash)
            if os.path.exists(cache_dir):
                shutil.rmtree(cache_dir)

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
        metadata_path = self.get_metadata_path(url_hash)

        if os.path.exists(metadata_path):
            try:
                with open(metadata_path, "r") as f:
                    metadata = json.load(f)

                metadata["domain_count"] = domain_count
                metadata["domain_count_updated_at"] = datetime.utcnow().isoformat()

                with open(metadata_path, "w") as f:
                    json.dump(metadata, f, indent=2)

                # Also update in database
                CacheMetadata.update_domain_count(url_hash, domain_count)

            except Exception as e:
                logger.warning(f"Failed to update domain count for {url}: {e}")

    @classmethod
    def get_total_size(cls) -> int:
        """Get total size of cache directory."""
        cache_dir = current_app.config["CACHE_DIR"]
        total = 0

        for dirpath, dirnames, filenames in os.walk(cache_dir):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    total += os.path.getsize(filepath)
                except OSError:
                    pass

        return total
