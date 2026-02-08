"""
Blocklist Library model for MongoDB.
Admin-curated library of blocklist sources for the visual config editor.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId

from app.extensions import mongo


class BlocklistLibrary:
    """Model for blocklist library entries."""

    COLLECTION = "blocklist_library"

    # Valid categories (must match VALID_CATEGORIES in validators.py)
    VALID_CATEGORIES = frozenset(
        {
            "comprehensive",
            "malicious",
            "advertising",
            "tracking",
            "suspicious",
            "nsfw",
        }
    )

    # Aggressiveness levels (1-5)
    MIN_AGGRESSIVENESS = 1
    MAX_AGGRESSIVENESS = 5

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        """Get entry ID as string."""
        return str(self._id) if self._id else None

    @property
    def url(self) -> str:
        return self._data.get("url", "")

    @property
    def name(self) -> str:
        return self._data.get("name", "")

    @property
    def category(self) -> str:
        return self._data.get("category", "")

    @property
    def description(self) -> str:
        return self._data.get("description", "")

    @property
    def recommended(self) -> bool:
        return self._data.get("recommended", False)

    @property
    def aggressiveness(self) -> int:
        return self._data.get("aggressiveness", 3)

    @property
    def domain_count(self) -> int:
        return self._data.get("domain_count", 0)

    @property
    def added_by(self) -> str:
        return self._data.get("added_by", "")

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
            "url": self.url,
            "name": self.name,
            "category": self.category,
            "description": self.description,
            "recommended": self.recommended,
            "aggressiveness": self.aggressiveness,
            "domain_count": self.domain_count,
            "added_by": self.added_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    @classmethod
    def get_collection(cls):
        """Get MongoDB collection."""
        return mongo.db[cls.COLLECTION]

    @classmethod
    def get_by_id(cls, entry_id: str) -> Optional["BlocklistLibrary"]:
        """Get entry by ID."""
        try:
            data = cls.get_collection().find_one({"_id": ObjectId(entry_id)})
            return cls(data) if data else None
        except Exception:
            return None

    @classmethod
    def get_all(cls, category: Optional[str] = None) -> List["BlocklistLibrary"]:
        """Get all library entries, optionally filtered by category."""
        query = {}
        if category:
            query["category"] = category

        entries = (
            cls.get_collection()
            .find(query)
            .sort(
                [
                    ("category", 1),
                    ("recommended", -1),
                    ("name", 1),
                ]
            )
        )
        return [cls(data) for data in entries]

    @classmethod
    def get_grouped_by_category(cls) -> Dict[str, List["BlocklistLibrary"]]:
        """Get all entries grouped by category."""
        entries = cls.get_all()
        grouped = {}
        for entry in entries:
            if entry.category not in grouped:
                grouped[entry.category] = []
            grouped[entry.category].append(entry)
        return grouped

    @classmethod
    def create(
        cls,
        url: str,
        name: str,
        category: str,
        description: str = "",
        recommended: bool = False,
        aggressiveness: int = 3,
        domain_count: int = 0,
        added_by: str = "",
    ) -> "BlocklistLibrary":
        """Create a new library entry."""
        now = datetime.utcnow()
        data = {
            "url": url,
            "name": name,
            "category": category,
            "description": description,
            "recommended": recommended,
            "aggressiveness": max(
                cls.MIN_AGGRESSIVENESS, min(cls.MAX_AGGRESSIVENESS, aggressiveness)
            ),
            "domain_count": domain_count,
            "added_by": added_by,
            "created_at": now,
            "updated_at": now,
        }
        result = cls.get_collection().insert_one(data)
        data["_id"] = result.inserted_id
        return cls(data)

    def update(
        self,
        url: Optional[str] = None,
        name: Optional[str] = None,
        category: Optional[str] = None,
        description: Optional[str] = None,
        recommended: Optional[bool] = None,
        aggressiveness: Optional[int] = None,
        domain_count: Optional[int] = None,
    ) -> bool:
        """Update library entry."""
        update_data = {"updated_at": datetime.utcnow()}

        if url is not None:
            update_data["url"] = url
        if name is not None:
            update_data["name"] = name
        if category is not None:
            update_data["category"] = category
        if description is not None:
            update_data["description"] = description
        if recommended is not None:
            update_data["recommended"] = recommended
        if aggressiveness is not None:
            update_data["aggressiveness"] = max(
                self.MIN_AGGRESSIVENESS, min(self.MAX_AGGRESSIVENESS, aggressiveness)
            )
        if domain_count is not None:
            update_data["domain_count"] = domain_count

        result = self.get_collection().update_one(
            {"_id": self._id}, {"$set": update_data}
        )
        return result.modified_count > 0

    def delete(self) -> bool:
        """Delete library entry."""
        result = self.get_collection().delete_one({"_id": self._id})
        return result.deleted_count > 0

    @classmethod
    def delete_by_id(cls, entry_id: str) -> bool:
        """Delete entry by ID."""
        try:
            result = cls.get_collection().delete_one({"_id": ObjectId(entry_id)})
            return result.deleted_count > 0
        except Exception:
            return False

    @classmethod
    def url_exists(cls, url: str, exclude_id: Optional[str] = None) -> bool:
        """Check if URL already exists in library."""
        query = {"url": url}
        if exclude_id:
            try:
                query["_id"] = {"$ne": ObjectId(exclude_id)}
            except Exception:
                pass
        return cls.get_collection().count_documents(query) > 0

    @classmethod
    def ensure_indexes(cls):
        """Create indexes for the collection."""
        collection = cls.get_collection()
        collection.create_index("url", unique=True)
        collection.create_index("category")
        collection.create_index([("category", 1), ("recommended", -1), ("name", 1)])
