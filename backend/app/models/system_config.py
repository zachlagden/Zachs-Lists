"""
System configuration model for default blocklist settings.

Stores default blocklist configuration and whitelist in MongoDB
instead of filesystem.
"""

from datetime import datetime
from typing import Optional

from app.extensions import mongo


class SystemConfig:
    """System configuration stored in MongoDB."""

    COLLECTION = "system_config"
    DOC_ID = "default_config"

    @classmethod
    def get_default_blocklists(cls) -> Optional[str]:
        """Get default blocklist configuration."""
        doc = mongo.db[cls.COLLECTION].find_one({"_id": cls.DOC_ID})
        return doc.get("blocklists") if doc else None

    @classmethod
    def get_default_whitelist(cls) -> Optional[str]:
        """Get default whitelist configuration."""
        doc = mongo.db[cls.COLLECTION].find_one({"_id": cls.DOC_ID})
        return doc.get("whitelist") if doc else None

    @classmethod
    def get_default_config(cls) -> dict:
        """Get both blocklists and whitelist configs."""
        doc = mongo.db[cls.COLLECTION].find_one({"_id": cls.DOC_ID})
        if doc:
            return {
                "blocklists": doc.get("blocklists", ""),
                "whitelist": doc.get("whitelist", ""),
                "updated_at": doc.get("updated_at"),
                "updated_by": doc.get("updated_by"),
            }
        return {
            "blocklists": "",
            "whitelist": "",
            "updated_at": None,
            "updated_by": None,
        }

    @classmethod
    def update_default_blocklists(cls, content: str, updated_by: str) -> None:
        """Update default blocklist configuration."""
        mongo.db[cls.COLLECTION].update_one(
            {"_id": cls.DOC_ID},
            {
                "$set": {
                    "blocklists": content,
                    "updated_at": datetime.utcnow(),
                    "updated_by": updated_by,
                },
                "$setOnInsert": {"whitelist": ""},
            },
            upsert=True,
        )

    @classmethod
    def update_default_whitelist(cls, content: str, updated_by: str) -> None:
        """Update default whitelist configuration."""
        mongo.db[cls.COLLECTION].update_one(
            {"_id": cls.DOC_ID},
            {
                "$set": {
                    "whitelist": content,
                    "updated_at": datetime.utcnow(),
                    "updated_by": updated_by,
                },
                "$setOnInsert": {"blocklists": ""},
            },
            upsert=True,
        )

    @classmethod
    def update_default_config(
        cls, blocklists: Optional[str], whitelist: Optional[str], updated_by: str
    ) -> None:
        """Update both blocklists and whitelist configs."""
        update = {
            "$set": {
                "updated_at": datetime.utcnow(),
                "updated_by": updated_by,
            }
        }
        if blocklists is not None:
            update["$set"]["blocklists"] = blocklists
        if whitelist is not None:
            update["$set"]["whitelist"] = whitelist

        mongo.db[cls.COLLECTION].update_one(
            {"_id": cls.DOC_ID},
            update,
            upsert=True,
        )
