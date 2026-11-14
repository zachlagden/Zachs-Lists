import re
from collections.abc import Iterator, Mapping
from datetime import datetime, timedelta, timezone
from itertools import product
from typing import Any
from urllib.parse import urlsplit

from pymongo.errors import DuplicateKeyError

from app.extensions import mongo

NAME_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,100}")
VISITOR_PATTERN = re.compile(r"[0-9a-f]{16,64}")
COUNTRY_PATTERN = re.compile(r"[A-Z]{2}")
REFERRER_HOST_PATTERN = re.compile(r"[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")
KEY_ESCAPES = ((".", "．"), ("$", "＄"))
REFERRER_DOT = ","
OTHER = ""


class Analytics:
    COLLECTION = "analytics"
    VISITORS_COLLECTION = "analytics_visitors"

    TYPE_DEFAULT = "default"
    TYPE_USER = "user"
    LIST_TYPES = (TYPE_DEFAULT, TYPE_USER)

    SCHEMA_VERSION = 2
    RETENTION_DAYS = 90
    FORMATS = ("hosts", "plain", "adblock")
    UNKNOWN_COUNTRY = "ZZ"
    MAX_CITIES_PER_DAY = 50
    MAX_REFERRERS_PER_DAY = 20
    MAX_CITY_LENGTH = 60
    TOP_LIMIT = 20

    @staticmethod
    def today() -> datetime:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        return now.replace(hour=0, minute=0, second=0, microsecond=0)

    @classmethod
    def clamp_days(cls, days: int | None) -> int:
        if days is None:
            return 30
        return max(1, min(days, cls.RETENTION_DAYS))

    @classmethod
    def bucket_id(
        cls, list_type: str, username: str | None, list_name: str, day: datetime
    ) -> str:
        return (
            f"v{cls.SCHEMA_VERSION}:{list_type}:{username or ''}:{list_name}"
            f":{day:%Y-%m-%d}"
        )

    @classmethod
    def country_key(cls, country: str | None) -> str:
        if country and COUNTRY_PATTERN.fullmatch(country.upper()):
            return country.upper()
        return cls.UNKNOWN_COUNTRY

    @classmethod
    def city_key(cls, country: str | None, city: str | None) -> str | None:
        if not city:
            return None
        name = CONTROL_CHARACTERS.sub(" ", city).strip()[: cls.MAX_CITY_LENGTH]
        if not name:
            return None
        for raw, escaped in KEY_ESCAPES:
            name = name.replace(raw, escaped)
        return f"{cls.country_key(country)}:{name}"

    @staticmethod
    def referrer_key(referrer: str | None) -> str | None:
        if not referrer:
            return None
        try:
            host = urlsplit(referrer.strip()).hostname
        except ValueError:
            return None
        if not host or not REFERRER_HOST_PATTERN.fullmatch(host):
            return None
        return host.replace(".", REFERRER_DOT)

    @classmethod
    def record_download(
        cls,
        list_type: str,
        list_name: str,
        username: str | None,
        format_type: str,
        visitor_hash: str | None = None,
        country: str | None = None,
        city: str | None = None,
        referrer: str | None = None,
        size_bytes: int = 0,
        now: datetime | None = None,
    ) -> None:
        if list_type not in cls.LIST_TYPES:
            raise ValueError(f"Unknown list type: {list_type!r}")
        if not NAME_PATTERN.fullmatch(list_name):
            raise ValueError(f"Invalid list name: {list_name!r}")
        if username is not None and not NAME_PATTERN.fullmatch(username):
            raise ValueError(f"Invalid username: {username!r}")
        if format_type not in cls.FORMATS:
            raise ValueError(f"Unknown format: {format_type!r}")
        if visitor_hash is not None and not VISITOR_PATTERN.fullmatch(visitor_hash):
            raise ValueError("Visitor hash must be lowercase hexadecimal")

        moment = now or datetime.now(timezone.utc).replace(tzinfo=None)
        day = moment.replace(hour=0, minute=0, second=0, microsecond=0)
        bucket_id = cls.bucket_id(list_type, username, list_name, day)
        identity = {
            "list_type": list_type,
            "username": username,
            "list_name": list_name,
            "date": day,
        }

        if visitor_hash is not None:
            cls._record_visitor(bucket_id, identity, visitor_hash)

        increments = {
            "requests": 1,
            "bandwidth_bytes": max(size_bytes, 0),
            f"formats.{format_type}": 1,
            f"hours.h{moment.hour:02d}": 1,
            f"countries.{cls.country_key(country)}": 1,
        }
        created = {"schema_version": cls.SCHEMA_VERSION, **identity}
        city_choices = cls._choices(cls.city_key(country, city))
        referrer_choices = cls._choices(cls.referrer_key(referrer))
        collection = mongo.db[cls.COLLECTION]
        for city_choice, referrer_choice in product(city_choices, referrer_choices):
            query, update = cls._day_update(
                bucket_id, increments, created, city_choice, referrer_choice
            )
            try:
                collection.update_one(query, update, upsert=True)
                return
            except DuplicateKeyError:
                if collection.update_one(query, update).matched_count:
                    return
        raise RuntimeError(f"Day document {bucket_id} matched no update")

    @classmethod
    def _record_visitor(
        cls, bucket_id: str, identity: Mapping[str, Any], visitor_hash: str
    ) -> None:
        try:
            mongo.db[cls.VISITORS_COLLECTION].insert_one(
                {
                    "_id": f"{bucket_id}:{visitor_hash}",
                    **identity,
                    "visitor": visitor_hash,
                }
            )
        except DuplicateKeyError:
            return

    @staticmethod
    def _choices(key: str | None) -> tuple[str | None, ...]:
        return (None,) if key is None else (key, OTHER)

    @classmethod
    def _day_update(
        cls,
        bucket_id: str,
        increments: Mapping[str, int],
        created: Mapping[str, Any],
        city_choice: str | None,
        referrer_choice: str | None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        inc = dict(increments)
        add_to_set: dict[str, str] = {}
        conditions: list[dict[str, Any]] = []
        for field, choice, limit in (
            ("cities", city_choice, cls.MAX_CITIES_PER_DAY),
            ("referrers", referrer_choice, cls.MAX_REFERRERS_PER_DAY),
        ):
            if choice is None:
                continue
            if choice == OTHER:
                inc[f"{field}_other"] = 1
                continue
            inc[f"{field}.{choice}"] = 1
            add_to_set[f"{field}_keys"] = choice
            conditions.append(
                {
                    "$or": [
                        {f"{field}_keys": choice},
                        {f"{field}_keys.{limit - 1}": {"$exists": False}},
                    ]
                }
            )
        query: dict[str, Any] = {"_id": bucket_id}
        if conditions:
            query["$and"] = conditions
        update: dict[str, Any] = {"$inc": inc, "$setOnInsert": dict(created)}
        if add_to_set:
            update["$addToSet"] = add_to_set
        return query, update

    @classmethod
    def _scope(
        cls,
        days: int,
        list_type: str | None,
        username: str | None,
        list_name: str | None,
    ) -> tuple[dict[str, Any], list[datetime]]:
        today = cls.today()
        period = [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
        match: dict[str, Any] = {"date": {"$gte": period[0], "$lte": today}}
        if list_type is not None:
            match["list_type"] = list_type
        if username is not None:
            match["username"] = username
        if list_name is not None:
            match["list_name"] = list_name
        return match, period

    @classmethod
    def report(
        cls,
        days: int,
        list_type: str | None = None,
        username: str | None = None,
        list_name: str | None = None,
    ) -> dict[str, Any]:
        match, period = cls._scope(days, list_type, username, list_name)
        daily = {
            day: {"requests": 0, "unique_visitors": 0, "bandwidth_bytes": 0}
            for day in period
        }
        formats = dict.fromkeys(cls.FORMATS, 0)
        hourly = [0] * 24
        countries: dict[str, int] = {}
        cities: dict[str, int] = {}
        referrers: dict[str, int] = {}

        documents = mongo.db[cls.COLLECTION].find(
            {**match, "schema_version": cls.SCHEMA_VERSION},
            {
                "date": 1,
                "requests": 1,
                "bandwidth_bytes": 1,
                "formats": 1,
                "hours": 1,
                "countries": 1,
                "cities": 1,
                "referrers": 1,
            },
        )
        for document in documents:
            entry = daily.get(document.get("date"))
            if entry is None:
                continue
            entry["requests"] += _count(document.get("requests"))
            entry["bandwidth_bytes"] += _count(document.get("bandwidth_bytes"))
            for name, count in _counts(document.get("formats")):
                if name in formats:
                    formats[name] += count
            for name, count in _counts(document.get("hours")):
                if re.fullmatch(r"h([01][0-9]|2[0-3])", name):
                    hourly[int(name[1:])] += count
            for target, field in (
                (countries, "countries"),
                (cities, "cities"),
                (referrers, "referrers"),
            ):
                for name, count in _counts(document.get(field)):
                    target[name] = target.get(name, 0) + count

        for day, visitors in cls._daily_unique_visitors(match).items():
            if day in daily:
                daily[day]["unique_visitors"] = visitors

        return {
            "period_days": days,
            "totals": {
                "requests": sum(entry["requests"] for entry in daily.values()),
                "unique_visitors": cls._unique_visitors(match),
                "bandwidth_bytes": sum(
                    entry["bandwidth_bytes"] for entry in daily.values()
                ),
            },
            "daily": [
                {"date": f"{day:%Y-%m-%d}", **entry} for day, entry in daily.items()
            ],
            "formats": formats,
            "hourly": hourly,
            "top_countries": [
                {"code": code, "requests": count}
                for code, count in _top(countries, cls.TOP_LIMIT)
            ],
            "top_cities": [
                _city_entry(key, count) for key, count in _top(cities, cls.TOP_LIMIT)
            ],
            "top_referrers": [
                {"host": key.replace(REFERRER_DOT, "."), "requests": count}
                for key, count in _top(referrers, cls.TOP_LIMIT)
            ],
        }

    @classmethod
    def public_report(cls, days: int) -> dict[str, Any]:
        report = cls.report(days, list_type=cls.TYPE_DEFAULT)
        return {
            name: report[name] for name in ("period_days", "totals", "daily", "formats")
        }

    @classmethod
    def admin_report(cls, days: int) -> dict[str, Any]:
        return {
            "period_days": days,
            "overall": cls.report(days),
            "default_lists": cls.report(days, list_type=cls.TYPE_DEFAULT),
            "user_lists": cls.report(days, list_type=cls.TYPE_USER),
        }

    @classmethod
    def _unique_visitors(cls, match: Mapping[str, Any]) -> int:
        rows = list(
            mongo.db[cls.VISITORS_COLLECTION].aggregate(
                [
                    {"$match": dict(match)},
                    {"$group": {"_id": "$visitor"}},
                    {"$count": "visitors"},
                ],
                allowDiskUse=True,
            )
        )
        return _count(rows[0].get("visitors")) if rows else 0

    @classmethod
    def _daily_unique_visitors(cls, match: Mapping[str, Any]) -> dict[datetime, int]:
        rows = mongo.db[cls.VISITORS_COLLECTION].aggregate(
            [
                {"$match": dict(match)},
                {"$group": {"_id": {"date": "$date", "visitor": "$visitor"}}},
                {"$group": {"_id": "$_id.date", "visitors": {"$sum": 1}}},
            ],
            allowDiskUse=True,
        )
        return {row["_id"]: _count(row.get("visitors")) for row in rows}

    @classmethod
    def get_default_list_totals(cls) -> dict[str, int]:
        rows = list(
            mongo.db[cls.COLLECTION].aggregate(
                [
                    {
                        "$match": {
                            "list_type": cls.TYPE_DEFAULT,
                            "schema_version": cls.SCHEMA_VERSION,
                        }
                    },
                    {
                        "$group": {
                            "_id": None,
                            "total_requests": {"$sum": "$requests"},
                            "total_bandwidth": {"$sum": "$bandwidth_bytes"},
                        }
                    },
                ]
            )
        )
        totals = rows[0] if rows else {}
        return {
            "total_requests": _count(totals.get("total_requests")),
            "total_bandwidth": _count(totals.get("total_bandwidth")),
            "period_days": cls.RETENTION_DAYS,
        }


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return max(int(value), 0)


def _counts(value: Any) -> Iterator[tuple[str, int]]:
    if not isinstance(value, dict):
        return
    for name, count in value.items():
        if isinstance(name, str):
            yield name, _count(count)


def _top(counts: Mapping[str, int], limit: int) -> list[tuple[str, int]]:
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [item for item in ranked[:limit] if item[1] > 0]


def _city_entry(key: str, count: int) -> dict[str, Any]:
    country, _, name = key.partition(":")
    for raw, escaped in KEY_ESCAPES:
        name = name.replace(escaped, raw)
    return {"country": country, "city": name, "requests": count}
