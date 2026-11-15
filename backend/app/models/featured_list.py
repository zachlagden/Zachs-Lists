from datetime import datetime
from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument

from app.extensions import mongo


class FeaturedList:
    COLLECTION = "featured_lists"

    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    @property
    def username(self) -> str:
        return str(self._data.get("username") or "")

    @property
    def list_name(self) -> str:
        return str(self._data.get("list_name") or "")

    @property
    def order(self) -> int:
        value = self._data.get("order")
        if isinstance(value, bool) or not isinstance(value, int):
            return 0
        return value

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self._data["_id"]),
            "username": self.username,
            "list_name": self.list_name,
            "description": str(self._data.get("description") or ""),
            "order": self.order,
        }

    @classmethod
    def all_ordered(cls) -> list["FeaturedList"]:
        entries = [cls(data) for data in mongo.db[cls.COLLECTION].find()]
        return sorted(entries, key=lambda entry: (entry.order, entry._data["_id"]))

    @classmethod
    def exists(cls, username: str, list_name: str) -> bool:
        return (
            mongo.db[cls.COLLECTION].count_documents(
                {"username": username, "list_name": list_name}, limit=1
            )
            > 0
        )

    @classmethod
    def add(
        cls, username: str, list_name: str, description: str, created_by: str
    ) -> "FeaturedList":
        last = max((entry.order for entry in cls.all_ordered()), default=0)
        data: dict[str, Any] = {
            "username": username,
            "list_name": list_name,
            "description": description,
            "order": last + 1,
            "created_at": datetime.utcnow(),
            "created_by": created_by,
        }
        data["_id"] = mongo.db[cls.COLLECTION].insert_one(data).inserted_id
        return cls(data)

    @classmethod
    def set_order(cls, featured_id: ObjectId, order: int) -> "FeaturedList | None":
        data = mongo.db[cls.COLLECTION].find_one_and_update(
            {"_id": featured_id},
            {"$set": {"order": order}},
            return_document=ReturnDocument.AFTER,
        )
        return cls(data) if data else None

    @classmethod
    def remove(cls, featured_id: ObjectId) -> bool:
        return (
            mongo.db[cls.COLLECTION].delete_one({"_id": featured_id}).deleted_count > 0
        )
