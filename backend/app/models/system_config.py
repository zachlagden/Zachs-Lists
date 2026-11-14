"""
System configuration model for default blocklist settings.

Stores default blocklist configuration and whitelist in MongoDB
instead of filesystem.
"""

from datetime import datetime
from typing import Any

from app.extensions import mongo


class SystemConfig:
    """System configuration stored in MongoDB."""

    COLLECTION = "system_config"
    DOC_ID = "default_config"
    BUILD_DOC_ID = "default_build"

    @classmethod
    def get_default_build_total_domains(cls) -> int:
        build = mongo.db[cls.COLLECTION].find_one(
            {"_id": cls.BUILD_DOC_ID}, {"total_domains": 1}
        )
        total = build.get("total_domains") if build else None
        if isinstance(total, bool) or not isinstance(total, int) or total < 0:
            return 0
        return total

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
    def update_default_config(
        cls, blocklists: str | None, whitelist: str | None, updated_by: str
    ) -> None:
        provided = {"blocklists": blocklists, "whitelist": whitelist}
        changed = {
            name: content for name, content in provided.items() if content is not None
        }
        if not changed:
            return
        untouched = {name: "" for name in provided if name not in changed}
        update: dict[str, dict[str, Any]] = {
            "$set": {
                **changed,
                "updated_at": datetime.utcnow(),
                "updated_by": updated_by,
            }
        }
        if untouched:
            update["$setOnInsert"] = untouched
        mongo.db[cls.COLLECTION].update_one({"_id": cls.DOC_ID}, update, upsert=True)

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
