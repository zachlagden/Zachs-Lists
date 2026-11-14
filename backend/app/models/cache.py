"""
Cache model for MongoDB.

Stores blocklist cache content in GridFS and metadata in a separate collection.
GridFS allows storing files larger than MongoDB's 16MB document limit.
"""

from datetime import datetime
from typing import Optional, Dict, Any

from gridfs import GridFS

from app.extensions import mongo


class CacheMetadata:
    """Cache model for storing blocklist content (GridFS) and metadata."""

    COLLECTION = "cache"
    GRIDFS_COLLECTION = "cache_files"

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def url_hash(self) -> str:
        return self._data.get("url_hash")

    @property
    def stats(self) -> Dict[str, Any]:
        return self._data.get("stats", {})

    # Class methods
    @classmethod
    def _get_gridfs(cls) -> GridFS:
        """Get GridFS instance for cache files."""
        return GridFS(mongo.db, collection=cls.GRIDFS_COLLECTION)

    @classmethod
    def get_by_url_hash(cls, url_hash: str) -> Optional["CacheMetadata"]:
        """Get cache metadata by URL hash."""
        data = mongo.db[cls.COLLECTION].find_one({"url_hash": url_hash})
        return cls(data) if data else None

    @classmethod
    def get_total_size(cls) -> int:
        """Get total size of all cached content."""
        pipeline = [{"$group": {"_id": None, "total": {"$sum": "$stats.size_bytes"}}}]
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
        """Delete cache metadata entry and associated GridFS file."""
        # Get gridfs_id before deleting metadata
        data = mongo.db[cls.COLLECTION].find_one(
            {"url_hash": url_hash}, {"gridfs_id": 1}
        )

        # Delete GridFS file if exists
        if data and data.get("gridfs_id"):
            try:
                fs = cls._get_gridfs()
                fs.delete(data["gridfs_id"])
            except Exception:
                pass  # Ignore if file already deleted

        # Delete metadata document
        result = mongo.db[cls.COLLECTION].delete_one({"url_hash": url_hash})
        return result.deleted_count > 0
