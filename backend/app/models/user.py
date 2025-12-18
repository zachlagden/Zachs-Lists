"""
User model for MongoDB.
"""

import os
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId
from flask import current_app

from app.extensions import mongo


class User:
    """User model representing a GitHub-authenticated user."""

    COLLECTION = "users"

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        """Get user ID as string."""
        return str(self._id) if self._id else None

    @property
    def github_id(self) -> int:
        return self._data.get("github_id")

    @property
    def username(self) -> str:
        return self._data.get("username")

    @property
    def email(self) -> Optional[str]:
        return self._data.get("email")

    @property
    def avatar_url(self) -> Optional[str]:
        return self._data.get("avatar_url")

    @property
    def name(self) -> Optional[str]:
        """GitHub display name."""
        return self._data.get("name")

    @property
    def is_enabled(self) -> bool:
        return self._data.get("is_enabled", True)

    @property
    def banned_until(self) -> Optional[datetime]:
        """Get ban expiration time (None if not banned)."""
        return self._data.get("banned_until")

    @property
    def ban_reason(self) -> Optional[str]:
        """Get reason for ban."""
        return self._data.get("ban_reason")

    @property
    def is_banned(self) -> bool:
        """Check if user is currently banned."""
        banned_until = self.banned_until
        if banned_until is None:
            return False
        # Check if ban has expired
        if banned_until < datetime.utcnow():
            return False
        return True

    @property
    def is_admin(self) -> bool:
        return self.username == current_app.config.get("ADMIN_USERNAME")

    @property
    def limits(self) -> Dict[str, int]:
        # Admins have no limits
        if self.is_admin:
            return {
                "max_source_lists": 999999,
                "max_domains": 999999999,
                "max_config_size_mb": 999999,
                "manual_updates_per_week": 999999,
            }

        defaults = {
            "max_source_lists": current_app.config["DEFAULT_MAX_SOURCE_LISTS"],
            "max_domains": current_app.config["DEFAULT_MAX_DOMAINS"],
            "max_config_size_mb": current_app.config["DEFAULT_MAX_CONFIG_SIZE_MB"],
            "manual_updates_per_week": current_app.config[
                "DEFAULT_MANUAL_UPDATES_PER_WEEK"
            ],
        }
        user_limits = self._data.get("limits", {})
        return {**defaults, **user_limits}

    @property
    def notifications(self) -> List[Dict[str, Any]]:
        """Get user notifications."""
        return self._data.get("notifications", [])

    @property
    def stats(self) -> Dict[str, Any]:
        defaults = {
            "total_domains": 0,
            "total_output_size_bytes": 0,
            "last_build_at": None,
            "manual_updates_this_week": 0,
            "week_reset_at": datetime.utcnow(),
        }
        user_stats = self._data.get("stats", {})
        return {**defaults, **user_stats}

    @property
    def lists(self) -> List[Dict[str, Any]]:
        return self._data.get("lists", [])

    @property
    def ip_log(self) -> List[Dict[str, Any]]:
        """Get IP access log."""
        return self._data.get("ip_log", [])

    @property
    def created_at(self) -> datetime:
        return self._data.get("created_at", datetime.utcnow())

    @property
    def updated_at(self) -> datetime:
        return self._data.get("updated_at", datetime.utcnow())

    # Path methods (for output files still on filesystem)
    def get_user_dir(self) -> str:
        """Get user's data directory."""
        return os.path.join(current_app.config["USERS_DIR"], self.username)

    def get_output_dir(self) -> str:
        """Get user's output directory."""
        return os.path.join(self.get_user_dir(), "output")

    def get_output_path(self, list_name: str, format_type: str) -> str:
        """Get path to output file for a specific list and format."""
        filename = f"{list_name}_{format_type}.txt"
        return os.path.join(self.get_output_dir(), filename)

    def get_config_hash(self) -> str:
        """Compute SHA256 hash of blocklists.conf + whitelist.txt for change detection."""
        import hashlib

        blocklists = self.get_config("blocklists.conf") or ""
        whitelist = self.get_config("whitelist.txt") or ""
        combined = f"{blocklists}\n---SEPARATOR---\n{whitelist}"
        return hashlib.sha256(combined.encode("utf-8")).hexdigest()

    # Config methods
    CONFIG_SCHEMA_VERSION = 1
    _CONFIG_FIELD_MAP = {
        "blocklists.conf": "blocklists",
        "whitelist.txt": "whitelist",
    }

    @property
    def config(self) -> Dict[str, Any]:
        """Get user config object from MongoDB."""
        return self._data.get("config", {})

    def save_config(self, filename: str, content: str) -> None:
        """Save config to MongoDB."""
        field = self._CONFIG_FIELD_MAP.get(filename)
        if not field:
            raise ValueError(f"Unknown config file: {filename}")

        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    f"config.{field}": content,
                    "config.version": self.CONFIG_SCHEMA_VERSION,
                    "updated_at": datetime.utcnow(),
                }
            },
        )
        # Update local cache
        if "config" not in self._data:
            self._data["config"] = {}
        self._data["config"][field] = content

        # Ensure output directory still exists for generated files
        os.makedirs(self.get_output_dir(), mode=0o755, exist_ok=True)

    def get_config(self, filename: str) -> Optional[str]:
        """Get config from MongoDB."""
        field = self._CONFIG_FIELD_MAP.get(filename)
        if not field:
            return None

        config = self._data.get("config", {})
        return config.get(field)

    # List methods
    def get_list(self, name: str) -> Optional[Dict[str, Any]]:
        """Get a specific list by name."""
        for lst in self.lists:
            if lst.get("name") == name:
                return lst
        return None

    def set_list_visibility(self, name: str, is_public: bool) -> None:
        """Set visibility for a list."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id, "lists.name": name},
            {"$set": {"lists.$.is_public": is_public, "updated_at": datetime.utcnow()}},
        )

    def update_lists(self, lists_data: List[Dict[str, Any]]) -> None:
        """Update user's lists."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {"$set": {"lists": lists_data, "updated_at": datetime.utcnow()}},
        )

    # Stats methods
    def update_stats(
        self, total_domains: int = None, total_output_size_bytes: int = None
    ) -> None:
        """Update user statistics."""
        update = {"updated_at": datetime.utcnow()}
        if total_domains is not None:
            update["stats.total_domains"] = total_domains
        if total_output_size_bytes is not None:
            update["stats.total_output_size_bytes"] = total_output_size_bytes
        update["stats.last_build_at"] = datetime.utcnow()

        mongo.db[self.COLLECTION].update_one({"_id": self._id}, {"$set": update})

    def can_do_manual_update(self) -> bool:
        """Check if user can perform a manual update."""
        # Admins can always do manual updates
        if self.is_admin:
            return True

        stats = self.stats
        week_reset = stats.get("week_reset_at", datetime.utcnow() - timedelta(days=8))

        # Check if week has reset
        if datetime.utcnow() - week_reset > timedelta(days=7):
            # Reset counter
            mongo.db[self.COLLECTION].update_one(
                {"_id": self._id},
                {
                    "$set": {
                        "stats.manual_updates_this_week": 0,
                        "stats.week_reset_at": datetime.utcnow(),
                    }
                },
            )
            return True

        return stats.get("manual_updates_this_week", 0) < self.limits[
            "manual_updates_per_week"
        ]

    def increment_manual_updates(self) -> None:
        """Increment manual update counter."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id}, {"$inc": {"stats.manual_updates_this_week": 1}}
        )

    def get_remaining_manual_updates(self) -> int:
        """Get remaining manual updates for this week."""
        stats = self.stats
        used = stats.get("manual_updates_this_week", 0)
        limit = self.limits["manual_updates_per_week"]
        return max(0, limit - used)

    # Admin methods
    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable user."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {"$set": {"is_enabled": enabled, "updated_at": datetime.utcnow()}},
        )

    def set_limits(self, limits: Dict[str, int]) -> None:
        """Set custom limits for user."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {"$set": {"limits": limits, "updated_at": datetime.utcnow()}},
        )

    def ban(self, until: datetime, reason: str = None) -> None:
        """Ban user until a specific time."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "banned_until": until,
                    "ban_reason": reason,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    def unban(self) -> None:
        """Remove ban from user."""
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$unset": {"banned_until": "", "ban_reason": ""},
                "$set": {"updated_at": datetime.utcnow()},
            },
        )

    # Notification methods
    def add_notification(
        self,
        notification_type: str,
        title: str,
        message: str,
        data: Dict[str, Any] = None,
    ) -> str:
        """Add a notification for the user."""
        import uuid

        notification_id = str(uuid.uuid4())
        notification = {
            "id": notification_id,
            "type": notification_type,
            "title": title,
            "message": message,
            "data": data or {},
            "read": False,
            "created_at": datetime.utcnow(),
        }

        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$push": {"notifications": {"$each": [notification], "$position": 0}},
                "$set": {"updated_at": datetime.utcnow()},
            },
        )
        return notification_id

    def mark_notification_read(self, notification_id: str) -> bool:
        """Mark a notification as read."""
        result = mongo.db[self.COLLECTION].update_one(
            {"_id": self._id, "notifications.id": notification_id},
            {"$set": {"notifications.$.read": True}},
        )
        return result.modified_count > 0

    def get_unread_notifications(self) -> List[Dict[str, Any]]:
        """Get unread notifications."""
        return [n for n in self.notifications if not n.get("read", False)]

    def log_ip_access(self, ip: str) -> None:
        """Log an IP address access (hashed for privacy)."""
        import hashlib

        # Hash IP for privacy (consistent with analytics)
        ip_hash = hashlib.sha256(ip.encode()).hexdigest()[:16]
        now = datetime.utcnow()

        # Check if this IP hash already exists
        existing = mongo.db[self.COLLECTION].find_one(
            {"_id": self._id, "ip_log.ip_hash": ip_hash},
            {"ip_log.$": 1}
        )

        if existing:
            # Update existing entry
            mongo.db[self.COLLECTION].update_one(
                {"_id": self._id, "ip_log.ip_hash": ip_hash},
                {
                    "$set": {"ip_log.$.last_seen": now},
                    "$inc": {"ip_log.$.access_count": 1},
                }
            )
        else:
            # Add new IP entry
            mongo.db[self.COLLECTION].update_one(
                {"_id": self._id},
                {
                    "$push": {
                        "ip_log": {
                            "ip_hash": ip_hash,
                            "first_seen": now,
                            "last_seen": now,
                            "access_count": 1,
                        }
                    }
                }
            )

    def delete_with_data(self) -> None:
        """Delete user and their data."""
        import shutil

        # Delete files
        user_dir = self.get_user_dir()
        if os.path.exists(user_dir):
            shutil.rmtree(user_dir)

        # Delete from database
        mongo.db[self.COLLECTION].delete_one({"_id": self._id})

    # Serialization
    def _serialize_notifications(self, unread_only: bool = False) -> List[Dict[str, Any]]:
        """Serialize notifications with proper datetime formatting."""
        notifications = self.get_unread_notifications() if unread_only else self.notifications
        return [
            {
                "id": n.get("id"),
                "type": n.get("type"),
                "title": n.get("title"),
                "message": n.get("message"),
                "data": n.get("data", {}),
                "read": n.get("read", False),
                "created_at": (
                    n["created_at"].isoformat()
                    if n.get("created_at")
                    else None
                ),
            }
            for n in notifications
        ]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "username": self.username,
            "name": self.name,
            "email": self.email,
            "avatar_url": self.avatar_url,
            "is_admin": self.is_admin,
            "is_enabled": self.is_enabled,
            "limits": self.limits,
            "stats": {
                **self.stats,
                "last_build_at": (
                    self.stats["last_build_at"].isoformat()
                    if self.stats.get("last_build_at")
                    else None
                ),
                "week_reset_at": (
                    self.stats["week_reset_at"].isoformat()
                    if self.stats.get("week_reset_at")
                    else None
                ),
            },
            "lists": self.lists,
            "remaining_updates": self.get_remaining_manual_updates(),
            "notifications": self._serialize_notifications(unread_only=True),
            "created_at": self.created_at.isoformat(),
        }

    def to_admin_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for admin API responses."""
        base = self.to_dict()
        base["github_id"] = self.github_id
        base["is_banned"] = self.is_banned
        base["banned_until"] = (
            self.banned_until.isoformat() if self.banned_until else None
        )
        base["ban_reason"] = self.ban_reason
        # Serialize IP log with proper datetime formatting
        base["ip_log"] = [
            {
                "ip_hash": entry.get("ip_hash"),
                "first_seen": (
                    entry["first_seen"].isoformat()
                    if entry.get("first_seen")
                    else None
                ),
                "last_seen": (
                    entry["last_seen"].isoformat()
                    if entry.get("last_seen")
                    else None
                ),
                "access_count": entry.get("access_count", 0),
            }
            for entry in self.ip_log
        ]
        return base

    # Class methods
    @classmethod
    def get_by_id(cls, user_id: str) -> Optional["User"]:
        """Get user by ID."""
        try:
            data = mongo.db[cls.COLLECTION].find_one({"_id": ObjectId(user_id)})
            return cls(data) if data else None
        except Exception:
            return None

    @classmethod
    def get_by_username(cls, username: str) -> Optional["User"]:
        """Get user by username."""
        data = mongo.db[cls.COLLECTION].find_one({"username": username})
        return cls(data) if data else None

    @classmethod
    def get_by_github_id(cls, github_id: int) -> Optional["User"]:
        """Get user by GitHub ID."""
        data = mongo.db[cls.COLLECTION].find_one({"github_id": github_id})
        return cls(data) if data else None

    @classmethod
    def find_or_create_from_github(
        cls,
        github_id: int,
        username: str,
        email: str = None,
        avatar_url: str = None,
        access_token: str = None,
        name: str = None,
    ) -> "User":
        """Find existing user or create new one from GitHub data."""
        existing = cls.get_by_github_id(github_id)

        if existing:
            # Update user info
            mongo.db[cls.COLLECTION].update_one(
                {"_id": existing._id},
                {
                    "$set": {
                        "username": username,
                        "email": email,
                        "avatar_url": avatar_url,
                        "access_token": access_token,
                        "name": name,
                        "updated_at": datetime.utcnow(),
                    }
                },
            )
            return cls.get_by_github_id(github_id)

        # Create new user
        user_data = {
            "github_id": github_id,
            "username": username,
            "name": name,
            "email": email,
            "avatar_url": avatar_url,
            "access_token": access_token,
            "is_enabled": True,
            "limits": {},
            "stats": {
                "total_domains": 0,
                "total_output_size_bytes": 0,
                "last_build_at": None,
                "manual_updates_this_week": 0,
                "week_reset_at": datetime.utcnow(),
            },
            "lists": [],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }

        result = mongo.db[cls.COLLECTION].insert_one(user_data)
        user_data["_id"] = result.inserted_id

        return cls(user_data)

    @classmethod
    def get_all(cls, page: int = 1, per_page: int = 20) -> List["User"]:
        """Get all users with pagination."""
        skip = (page - 1) * per_page
        cursor = (
            mongo.db[cls.COLLECTION]
            .find()
            .sort("created_at", -1)
            .skip(skip)
            .limit(per_page)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def get_all_enabled(cls) -> List["User"]:
        """Get all enabled users."""
        cursor = mongo.db[cls.COLLECTION].find({"is_enabled": True})
        return [cls(data) for data in cursor]

    @classmethod
    def count(cls, is_enabled: bool = None) -> int:
        """Count users."""
        query = {}
        if is_enabled is not None:
            query["is_enabled"] = is_enabled
        return mongo.db[cls.COLLECTION].count_documents(query)
