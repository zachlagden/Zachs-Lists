"""
Announcement model for MongoDB.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId

from app.extensions import mongo
from app.utils.time import utc_iso


class Announcement:
    """Announcement model for site-wide admin announcements."""

    COLLECTION = "announcements"

    VALID_TYPES = ["info", "warning", "critical"]

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> Optional[str]:
        return str(self._id) if self._id else None

    @property
    def title(self) -> str:
        return self._data.get("title", "")

    @property
    def message(self) -> str:
        return self._data.get("message", "")

    @property
    def type(self) -> str:
        return self._data.get("type", "info")

    @property
    def is_active(self) -> bool:
        return self._data.get("is_active", True)

    @property
    def expires_at(self) -> Optional[datetime]:
        return self._data.get("expires_at")

    @property
    def created_by(self) -> str:
        return self._data.get("created_by", "")

    @property
    def created_at(self) -> datetime:
        return self._data.get("created_at", datetime.utcnow())

    @property
    def updated_at(self) -> datetime:
        return self._data.get("updated_at", datetime.utcnow())

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "title": self.title,
            "message": self.message,
            "type": self.type,
            "is_active": self.is_active,
            "expires_at": utc_iso(self.expires_at),
            "created_by": self.created_by,
            "created_at": utc_iso(self.created_at),
            "updated_at": utc_iso(self.updated_at),
        }

    UPDATABLE_FIELDS = ("title", "message", "type", "is_active", "expires_at")

    def update(self, **kwargs: Any) -> None:
        """Update announcement fields."""
        update_fields: Dict[str, Any] = {"updated_at": datetime.utcnow()}

        for field in self.UPDATABLE_FIELDS:
            if field in kwargs:
                update_fields[field] = kwargs[field]

        mongo.db[self.COLLECTION].update_one({"_id": self._id}, {"$set": update_fields})

        for key, value in update_fields.items():
            self._data[key] = value

    def delete(self) -> None:
        """Delete announcement from collection."""
        mongo.db[self.COLLECTION].delete_one({"_id": self._id})

    @classmethod
    def create(
        cls,
        title: str,
        message: str,
        type: str = "info",
        expires_at: Optional[datetime] = None,
        created_by: str = "",
    ) -> "Announcement":
        """Create a new announcement."""
        now = datetime.utcnow()
        data = {
            "title": title,
            "message": message,
            "type": type if type in cls.VALID_TYPES else "info",
            "is_active": True,
            "expires_at": expires_at,
            "created_by": created_by,
            "created_at": now,
            "updated_at": now,
        }

        result = mongo.db[cls.COLLECTION].insert_one(data)
        data["_id"] = result.inserted_id

        return cls(data)

    @classmethod
    def get_by_id(cls, announcement_id: str) -> Optional["Announcement"]:
        """Get announcement by ID."""
        try:
            data = mongo.db[cls.COLLECTION].find_one({"_id": ObjectId(announcement_id)})
            return cls(data) if data else None
        except Exception:
            return None

    @classmethod
    def get_active(cls) -> List["Announcement"]:
        """Get active, non-expired announcements."""
        now = datetime.utcnow()
        query = {
            "is_active": True,
            "$or": [
                {"expires_at": None},
                {"expires_at": {"$gt": now}},
            ],
        }
        cursor = mongo.db[cls.COLLECTION].find(query).sort("created_at", -1)
        return [cls(data) for data in cursor]

    @classmethod
    def get_all(cls, limit: int = 50) -> List["Announcement"]:
        """Get all announcements for admin view."""
        cursor = mongo.db[cls.COLLECTION].find().sort("created_at", -1).limit(limit)
        return [cls(data) for data in cursor]
