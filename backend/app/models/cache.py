"""
Cache model for MongoDB.

Stores blocklist cache content and metadata directly in MongoDB.
"""

import hashlib
from datetime import datetime
from typing import Optional, Dict, Any
from bson import ObjectId, Binary

from app.extensions import mongo


class CacheMetadata:
    """Cache model for storing blocklist content and metadata."""

    COLLECTION = "cache"

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        return str(self._id) if self._id else None

    @property
    def url_hash(self) -> str:
        return self._data.get("url_hash")

    @property
    def url(self) -> str:
        return self._data.get("url")

    @property
    def etag(self) -> Optional[str]:
        return self._data.get("etag")

    @property
    def last_modified(self) -> Optional[str]:
        return self._data.get("last_modified")

    @property
    def content_hash(self) -> Optional[str]:
        return self._data.get("content_hash")

    @property
    def stats(self) -> Dict[str, Any]:
        return self._data.get("stats", {})

    @property
    def updated_at(self) -> datetime:
        return self._data.get("updated_at", datetime.utcnow())

    @property
    def created_at(self) -> datetime:
        return self._data.get("created_at", datetime.utcnow())

    @property
    def content(self) -> Optional[bytes]:
        """Get binary content."""
        content_data = self._data.get("content")
        if content_data is not None:
            return bytes(content_data)
        return None

    # Serialization
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "url_hash": self.url_hash,
            "url": self.url,
            "etag": self.etag,
            "last_modified": self.last_modified,
            "stats": self.stats,
            "updated_at": self.updated_at.isoformat(),
            "created_at": self.created_at.isoformat(),
        }

    # Class methods
    @classmethod
    def get_by_url_hash(cls, url_hash: str) -> Optional["CacheMetadata"]:
        """Get cache metadata by URL hash."""
        data = mongo.db[cls.COLLECTION].find_one({"url_hash": url_hash})
        return cls(data) if data else None

    @classmethod
    def upsert(
        cls,
        url_hash: str,
        url: str,
        content: bytes,
        etag: str = None,
        last_modified: str = None,
        domain_count: int = 0,
    ) -> "CacheMetadata":
        """Create or update cache entry with content."""
        now = datetime.utcnow()
        content_hash = hashlib.sha256(content).hexdigest()

        mongo.db[cls.COLLECTION].update_one(
            {"url_hash": url_hash},
            {
                "$set": {
                    "url": url,
                    "content": Binary(content),
                    "etag": etag,
                    "last_modified": last_modified,
                    "content_hash": content_hash,
                    "stats.size_bytes": len(content),
                    "stats.domain_count": domain_count,
                    "stats.last_download_at": now,
                    "updated_at": now,
                },
                "$inc": {"stats.download_count": 1},
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

        return cls.get_by_url_hash(url_hash)

    @classmethod
    def get_content(cls, url_hash: str) -> Optional[bytes]:
        """Get cached content by URL hash."""
        data = mongo.db[cls.COLLECTION].find_one(
            {"url_hash": url_hash},
            {"content": 1}
        )
        if data and data.get("content"):
            return bytes(data["content"])
        return None

    @classmethod
    def touch(cls, url_hash: str) -> None:
        """Update last accessed time."""
        mongo.db[cls.COLLECTION].update_one(
            {"url_hash": url_hash},
            {
                "$set": {"stats.last_accessed_at": datetime.utcnow()},
                "$inc": {"stats.access_count": 1},
            },
        )

    @classmethod
    def get_total_size(cls) -> int:
        """Get total size of all cached content."""
        pipeline = [
            {"$group": {"_id": None, "total": {"$sum": "$stats.size_bytes"}}}
        ]
        result = list(mongo.db[cls.COLLECTION].aggregate(pipeline))
        return result[0]["total"] if result else 0

    @classmethod
    def get_stale_entries(cls, days: int = 30) -> list:
        """Get cache entries not updated in specified days."""
        from datetime import timedelta

        cutoff = datetime.utcnow() - timedelta(days=days)
        cursor = mongo.db[cls.COLLECTION].find({"updated_at": {"$lt": cutoff}})
        return [cls(data) for data in cursor]

    @classmethod
    def delete_by_url_hash(cls, url_hash: str) -> bool:
        """Delete cache metadata entry."""
        result = mongo.db[cls.COLLECTION].delete_one({"url_hash": url_hash})
        return result.deleted_count > 0

    @classmethod
    def update_domain_count(cls, url_hash: str, domain_count: int) -> bool:
        """
        Update domain count for a cache entry.

        Args:
            url_hash: URL hash to update
            domain_count: Actual domain count (after extraction)

        Returns:
            True if updated
        """
        result = mongo.db[cls.COLLECTION].update_one(
            {"url_hash": url_hash},
            {
                "$set": {
                    "stats.domain_count": domain_count,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        return result.modified_count > 0
