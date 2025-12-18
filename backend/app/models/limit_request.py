"""
Limit Request model for MongoDB.
Handles user requests for higher domain limits.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId

from app.extensions import mongo


class LimitRequest:
    """Model for domain limit increase requests."""

    COLLECTION = "limit_requests"

    # Status constants
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_DENIED = "denied"

    # Intended use options
    INTENDED_USE_OPTIONS = ["personal", "family", "organization", "other"]

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        """Get request ID as string."""
        return str(self._id) if self._id else None

    @property
    def user_id(self) -> str:
        """Get user ID as string."""
        user_id = self._data.get("user_id")
        return str(user_id) if user_id else None

    @property
    def username(self) -> str:
        return self._data.get("username")

    @property
    def avatar_url(self) -> Optional[str]:
        return self._data.get("avatar_url")

    @property
    def current_limit(self) -> int:
        return self._data.get("current_limit", 0)

    @property
    def requested_tier(self) -> int:
        return self._data.get("requested_tier", 0)

    @property
    def reason(self) -> str:
        return self._data.get("reason", "")

    @property
    def intended_use(self) -> str:
        return self._data.get("intended_use", "personal")

    @property
    def current_usage(self) -> int:
        return self._data.get("current_usage", 0)

    @property
    def status(self) -> str:
        return self._data.get("status", self.STATUS_PENDING)

    @property
    def approved_limit(self) -> Optional[int]:
        return self._data.get("approved_limit")

    @property
    def admin_response(self) -> Optional[str]:
        return self._data.get("admin_response")

    @property
    def reviewed_by(self) -> Optional[str]:
        return self._data.get("reviewed_by")

    @property
    def created_at(self) -> datetime:
        return self._data.get("created_at", datetime.utcnow())

    @property
    def reviewed_at(self) -> Optional[datetime]:
        return self._data.get("reviewed_at")

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "user_id": self.user_id,
            "username": self.username,
            "avatar_url": self.avatar_url,
            "current_limit": self.current_limit,
            "requested_tier": self.requested_tier,
            "reason": self.reason,
            "intended_use": self.intended_use,
            "current_usage": self.current_usage,
            "status": self.status,
            "approved_limit": self.approved_limit,
            "admin_response": self.admin_response,
            "reviewed_by": self.reviewed_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
        }

    def approve(self, admin_username: str, approved_limit: int = None, response: str = None) -> None:
        """Approve the limit request."""
        from app.models.user import User

        final_limit = approved_limit or self.requested_tier

        # Update request status
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_APPROVED,
                    "approved_limit": final_limit,
                    "admin_response": response,
                    "reviewed_by": admin_username,
                    "reviewed_at": datetime.utcnow(),
                }
            },
        )

        # Update user's limit
        user = User.get_by_id(self.user_id)
        if user:
            current_limits = user._data.get("limits", {})
            current_limits["max_domains"] = final_limit
            user.set_limits(current_limits)

            # Add notification
            user.add_notification(
                notification_type="limit_request_approved",
                title="Limit Request Approved",
                message=f"Your domain limit has been increased to {final_limit:,} domains.",
                data={"new_limit": final_limit, "request_id": self.id},
            )

    def deny(self, admin_username: str, response: str = None) -> None:
        """Deny the limit request."""
        from app.models.user import User

        # Update request status
        mongo.db[self.COLLECTION].update_one(
            {"_id": self._id},
            {
                "$set": {
                    "status": self.STATUS_DENIED,
                    "admin_response": response,
                    "reviewed_by": admin_username,
                    "reviewed_at": datetime.utcnow(),
                }
            },
        )

        # Add notification to user
        user = User.get_by_id(self.user_id)
        if user:
            message = "Your request for a higher domain limit has been denied."
            if response:
                message += f" Reason: {response}"

            user.add_notification(
                notification_type="limit_request_denied",
                title="Limit Request Denied",
                message=message,
                data={"request_id": self.id},
            )

    @classmethod
    def create(
        cls,
        user,  # User instance
        requested_tier: int,
        reason: str,
        intended_use: str,
    ) -> "LimitRequest":
        """Create a new limit request."""
        request_data = {
            "user_id": ObjectId(user.id),
            "username": user.username,
            "avatar_url": user.avatar_url,
            "current_limit": user.limits.get("max_domains", 0),
            "requested_tier": requested_tier,
            "reason": reason,
            "intended_use": intended_use,
            "current_usage": user.stats.get("total_domains", 0),
            "status": cls.STATUS_PENDING,
            "approved_limit": None,
            "admin_response": None,
            "reviewed_by": None,
            "created_at": datetime.utcnow(),
            "reviewed_at": None,
        }

        result = mongo.db[cls.COLLECTION].insert_one(request_data)
        request_data["_id"] = result.inserted_id

        return cls(request_data)

    @classmethod
    def get_by_id(cls, request_id: str) -> Optional["LimitRequest"]:
        """Get request by ID."""
        try:
            data = mongo.db[cls.COLLECTION].find_one({"_id": ObjectId(request_id)})
            return cls(data) if data else None
        except Exception:
            return None

    @classmethod
    def get_pending(cls) -> List["LimitRequest"]:
        """Get all pending requests."""
        cursor = (
            mongo.db[cls.COLLECTION]
            .find({"status": cls.STATUS_PENDING})
            .sort("created_at", -1)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def get_by_status(cls, status: str, limit: int = 50) -> List["LimitRequest"]:
        """Get requests by status."""
        cursor = (
            mongo.db[cls.COLLECTION]
            .find({"status": status})
            .sort("created_at", -1)
            .limit(limit)
        )
        return [cls(data) for data in cursor]

    @classmethod
    def get_by_user(cls, user_id: str) -> List["LimitRequest"]:
        """Get all requests for a user."""
        try:
            cursor = (
                mongo.db[cls.COLLECTION]
                .find({"user_id": ObjectId(user_id)})
                .sort("created_at", -1)
            )
            return [cls(data) for data in cursor]
        except Exception:
            return []

    @classmethod
    def has_pending_request(cls, user_id: str) -> bool:
        """Check if user has a pending request."""
        try:
            count = mongo.db[cls.COLLECTION].count_documents(
                {"user_id": ObjectId(user_id), "status": cls.STATUS_PENDING}
            )
            return count > 0
        except Exception:
            return False

    @classmethod
    def count_pending(cls) -> int:
        """Count pending requests."""
        return mongo.db[cls.COLLECTION].count_documents({"status": cls.STATUS_PENDING})
