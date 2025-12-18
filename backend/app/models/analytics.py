"""
Analytics model for MongoDB.
"""

from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId

from app.extensions import mongo


class Analytics:
    """Analytics model for tracking list access statistics."""

    COLLECTION = "analytics"

    # List types
    TYPE_DEFAULT = "default"
    TYPE_USER = "user"

    def __init__(self, data: Dict[str, Any]):
        self._data = data
        self._id = data.get("_id")

    @property
    def id(self) -> str:
        return str(self._id) if self._id else None

    @property
    def list_type(self) -> str:
        return self._data.get("list_type")

    @property
    def list_name(self) -> str:
        return self._data.get("list_name")

    @property
    def username(self) -> Optional[str]:
        return self._data.get("username")

    @property
    def date(self) -> datetime:
        return self._data.get("date")

    @property
    def requests(self) -> int:
        return self._data.get("requests", 0)

    @property
    def unique_ips(self) -> int:
        return self._data.get("unique_ips", 0)

    @property
    def formats(self) -> Dict[str, int]:
        return self._data.get("formats", {"hosts": 0, "plain": 0, "adblock": 0})

    @property
    def bandwidth_bytes(self) -> int:
        return self._data.get("bandwidth_bytes", 0)

    @property
    def geo(self) -> Dict[str, Dict[str, int]]:
        return self._data.get("geo", {"countries": {}, "cities": {}})

    @property
    def hourly_distribution(self) -> List[int]:
        return self._data.get("hourly_distribution", [0] * 24)

    @property
    def top_referrers(self) -> List[Dict[str, Any]]:
        return self._data.get("top_referrers", [])

    # Serialization
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "list_type": self.list_type,
            "list_name": self.list_name,
            "username": self.username,
            "date": self.date.isoformat() if self.date else None,
            "requests": self.requests,
            "unique_ips": self.unique_ips,
            "formats": self.formats,
            "bandwidth_bytes": self.bandwidth_bytes,
            "geo": self.geo,
            "hourly_distribution": self.hourly_distribution,
            "top_referrers": self.top_referrers,
        }

    # Class methods for recording analytics
    @classmethod
    def record_request(
        cls,
        list_type: str,
        list_name: str,
        username: str = None,
        format_type: str = "hosts",
        ip_hash: str = None,
        country: str = None,
        city: str = None,
        referrer: str = None,
        size_bytes: int = 0,
    ) -> None:
        """Record a list request."""
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        hour = datetime.utcnow().hour

        # Build update operations
        update = {
            "$inc": {
                "requests": 1,
                f"formats.{format_type}": 1,
                "bandwidth_bytes": size_bytes,
                f"hourly_distribution.{hour}": 1,
            },
            "$setOnInsert": {
                "list_type": list_type,
                "list_name": list_name,
                "username": username,
                "date": today,
                "unique_ips": 0,
                "ip_hashes": [],
                "top_referrers": [],
            },
        }

        # Track unique IPs
        if ip_hash:
            update["$addToSet"] = {"ip_hashes": ip_hash}

        # Track geo data
        if country:
            update["$inc"][f"geo.countries.{country}"] = 1
        if city:
            update["$inc"][f"geo.cities.{city}"] = 1

        # Upsert the document
        mongo.db[cls.COLLECTION].update_one(
            {
                "list_type": list_type,
                "list_name": list_name,
                "username": username,
                "date": today,
            },
            update,
            upsert=True,
        )

        # Update unique IP count (separate operation to count array length)
        if ip_hash:
            mongo.db[cls.COLLECTION].update_one(
                {
                    "list_type": list_type,
                    "list_name": list_name,
                    "username": username,
                    "date": today,
                },
                [
                    {
                        "$set": {
                            "unique_ips": {"$size": {"$ifNull": ["$ip_hashes", []]}}
                        }
                    }
                ],
            )

        # Track referrers (update top 10)
        if referrer:
            cls._update_referrer(list_type, list_name, username, today, referrer)

    @classmethod
    def _update_referrer(
        cls,
        list_type: str,
        list_name: str,
        username: str,
        date: datetime,
        referrer: str,
    ) -> None:
        """Update top referrers list."""
        # Get current document
        doc = mongo.db[cls.COLLECTION].find_one(
            {
                "list_type": list_type,
                "list_name": list_name,
                "username": username,
                "date": date,
            }
        )

        if not doc:
            return

        referrers = doc.get("top_referrers", [])

        # Find existing referrer
        found = False
        for ref in referrers:
            if ref.get("url") == referrer:
                ref["count"] += 1
                found = True
                break

        if not found:
            referrers.append({"url": referrer, "count": 1})

        # Sort and keep top 10
        referrers.sort(key=lambda x: x["count"], reverse=True)
        referrers = referrers[:10]

        mongo.db[cls.COLLECTION].update_one(
            {
                "list_type": list_type,
                "list_name": list_name,
                "username": username,
                "date": date,
            },
            {"$set": {"top_referrers": referrers}},
        )

    @classmethod
    def get_stats(
        cls,
        list_type: str = None,
        list_name: str = None,
        username: str = None,
        days: int = 30,
    ) -> Dict[str, Any]:
        """Get aggregated statistics for a time period."""
        cutoff = datetime.utcnow() - timedelta(days=days)

        match = {"date": {"$gte": cutoff}}
        if list_type:
            match["list_type"] = list_type
        if list_name:
            match["list_name"] = list_name
        if username:
            match["username"] = username

        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": None,
                    "total_requests": {"$sum": "$requests"},
                    "total_unique_ips": {"$sum": "$unique_ips"},
                    "total_bandwidth": {"$sum": "$bandwidth_bytes"},
                    "hosts_requests": {"$sum": "$formats.hosts"},
                    "plain_requests": {"$sum": "$formats.plain"},
                    "adblock_requests": {"$sum": "$formats.adblock"},
                }
            },
        ]

        result = list(mongo.db[cls.COLLECTION].aggregate(pipeline))

        if not result:
            return {
                "total_requests": 0,
                "total_unique_ips": 0,
                "total_bandwidth": 0,
                "formats": {"hosts": 0, "plain": 0, "adblock": 0},
            }

        data = result[0]
        return {
            "total_requests": data.get("total_requests", 0),
            "total_unique_ips": data.get("total_unique_ips", 0),
            "total_bandwidth": data.get("total_bandwidth", 0),
            "formats": {
                "hosts": data.get("hosts_requests", 0),
                "plain": data.get("plain_requests", 0),
                "adblock": data.get("adblock_requests", 0),
            },
        }

    @classmethod
    def get_daily_stats(
        cls,
        list_type: str = None,
        list_name: str = None,
        username: str = None,
        days: int = 30,
    ) -> List[Dict[str, Any]]:
        """Get daily statistics for charting."""
        cutoff = datetime.utcnow() - timedelta(days=days)

        match = {"date": {"$gte": cutoff}}
        if list_type:
            match["list_type"] = list_type
        if list_name:
            match["list_name"] = list_name
        if username:
            match["username"] = username

        pipeline = [
            {"$match": match},
            {
                "$group": {
                    "_id": "$date",
                    "requests": {"$sum": "$requests"},
                    "unique_ips": {"$sum": "$unique_ips"},
                    "bandwidth": {"$sum": "$bandwidth_bytes"},
                }
            },
            {"$sort": {"_id": 1}},
        ]

        result = list(mongo.db[cls.COLLECTION].aggregate(pipeline))

        return [
            {
                "date": item["_id"].isoformat(),
                "requests": item["requests"],
                "unique_ips": item["unique_ips"],
                "bandwidth": item["bandwidth"],
            }
            for item in result
        ]

    @classmethod
    def get_geo_stats(
        cls,
        list_type: str = None,
        list_name: str = None,
        username: str = None,
        days: int = 30,
    ) -> Dict[str, Dict[str, int]]:
        """Get geographic distribution statistics."""
        cutoff = datetime.utcnow() - timedelta(days=days)

        match = {"date": {"$gte": cutoff}}
        if list_type:
            match["list_type"] = list_type
        if list_name:
            match["list_name"] = list_name
        if username:
            match["username"] = username

        # Aggregate country data
        pipeline = [
            {"$match": match},
            {"$project": {"countries": {"$objectToArray": "$geo.countries"}}},
            {"$unwind": "$countries"},
            {
                "$group": {
                    "_id": "$countries.k",
                    "count": {"$sum": "$countries.v"},
                }
            },
            {"$sort": {"count": -1}},
            {"$limit": 20},
        ]

        countries = {
            item["_id"]: item["count"]
            for item in mongo.db[cls.COLLECTION].aggregate(pipeline)
        }

        return {"countries": countries}

    @classmethod
    def get_default_list_totals(cls) -> Dict[str, Any]:
        """Get total statistics for all default lists."""
        pipeline = [
            {"$match": {"list_type": cls.TYPE_DEFAULT}},
            {
                "$group": {
                    "_id": None,
                    "total_requests": {"$sum": "$requests"},
                    "total_bandwidth": {"$sum": "$bandwidth_bytes"},
                }
            },
        ]

        result = list(mongo.db[cls.COLLECTION].aggregate(pipeline))

        if not result:
            return {"total_requests": 0, "total_bandwidth": 0}

        return {
            "total_requests": result[0].get("total_requests", 0),
            "total_bandwidth": result[0].get("total_bandwidth", 0),
        }
