"""
Cache model for MongoDB.

Stores blocklist cache content in GridFS and metadata in a separate collection.
GridFS allows storing files larger than MongoDB's 16MB document limit.
"""

import logging
from datetime import datetime
from typing import Optional, Dict, Any

from gridfs import GridFS

from app.extensions import mongo

logger = logging.getLogger(__name__)


class CacheMetadata:
    """Cache model for storing blocklist content (GridFS) and metadata."""

    COLLECTION = "cache"
    GRIDFS_COLLECTION = "cache_files"

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def url_hash(self) -> str:
        return self._data["url_hash"]

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
    def delete_unchecked_since(cls, cutoff: datetime) -> int:
        collection = mongo.db[cls.COLLECTION]
        stale = collection.find(
            {
                "$or": [
                    {"last_checked_at": {"$lt": cutoff}},
                    {"last_checked_at": None},
                ]
            },
            {"gridfs_id": 1, "last_checked_at": 1},
        )
        deleted = 0
        for data in stale:
            gridfs_id = data.get("gridfs_id")
            result = collection.delete_one(
                {
                    "_id": data["_id"],
                    "gridfs_id": gridfs_id,
                    "last_checked_at": data.get("last_checked_at"),
                }
            )
            if result.deleted_count == 0:
                continue
            deleted += 1
            if gridfs_id is not None:
                try:
                    cls._get_gridfs().delete(gridfs_id)
                except Exception:
                    logger.exception("Could not remove an expired cached source body")
        return deleted
