import logging
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from bson import ObjectId
from flask import current_app
from pymongo.collection import Collection
from pymongo.database import Database

from app.extensions import mongo
from app.models.job import Job
from app.models.limit_request import LimitRequest
from app.models.user import User

logger = logging.getLogger(__name__)

METHOD_EXACT = "exact"
METHOD_STORED = "stored"
METHOD_BUILD = "build"
SOURCE_JOB_RESULT = "job_result"
SOURCE_LIST_METADATA = "list_metadata"
COMBINED_LIST = "all_domains"
CATEGORY_LEFT_OUT_OF_COMBINED_LIST = "nsfw"
LIMIT_EXCEEDED_CODE = "domain_limit_exceeded"
NOTIFICATION_TYPE = "domain_limit_exceeded"
NOTIFICATION_TITLE = "Your lists are over the domain limit"
RESOLVED_BY_BUILD = "build"
RESOLVED_BY_AUDIT = "audit"
REASON_WITHIN_LIMIT = "The latest build is within the limit"
REASON_AUDIT_WITHIN_LIMIT = "The audit measured the lists within the limit"
REASON_LIMIT_RAISED = "The limit now covers the measured count"
MAX_RESOLVE_REASON_LENGTH = 200
CONSEQUENCE_BEFORE_ENFORCING = (
    "Builds over the limit will start to fail once the limit is enforced. "
    "Your current lists stay published."
)
CONSEQUENCE_WHEN_ENFORCING = (
    "Builds over the limit fail, and your current lists stay published."
)


@dataclass(frozen=True)
class Usage:
    domains: int
    at_least: int
    source: str

    @property
    def is_exact(self) -> bool:
        return self.domains == self.at_least


@dataclass(frozen=True)
class ReviewChange:
    opened: bool = False
    refreshed: bool = False
    resolved: bool = False
    notified: bool = False


def _count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _combined_with_left_out(combined: int, left_out: int, source: str) -> Usage:
    return Usage(combined + left_out, max(combined, left_out), source)


def usage_from_job_result(result: Any) -> Usage | None:
    if not isinstance(result, Mapping):
        return None
    combined = _count(result.get("unique_domains"))
    categories = result.get("categories")
    if combined is None or not isinstance(categories, Mapping) or not categories:
        return None
    left_out = _count(categories.get(CATEGORY_LEFT_OUT_OF_COMBINED_LIST, 0))
    if left_out is None:
        return None
    return _combined_with_left_out(combined, left_out, SOURCE_JOB_RESULT)


def usage_from_list_metadata(lists: Any) -> Usage | None:
    if not isinstance(lists, list):
        return None
    counts: dict[str, int] = {}
    for entry in lists:
        if not isinstance(entry, Mapping):
            continue
        name = entry.get("name")
        count = _count(entry.get("domain_count"))
        if isinstance(name, str) and count is not None:
            counts[name] = count
    if COMBINED_LIST not in counts:
        return None
    return _combined_with_left_out(
        counts[COMBINED_LIST],
        counts.get(CATEGORY_LEFT_OUT_OF_COMBINED_LIST, 0),
        SOURCE_LIST_METADATA,
    )


def stored_usage(database: Database[Any], user_row: Mapping[str, Any]) -> Usage | None:
    last_completed = database[Job.COLLECTION].find_one(
        {"user_id": user_row["_id"], "status": Job.STATUS_COMPLETED},
        {"result.unique_domains": 1, "result.categories": 1},
        sort=[("completed_at", -1)],
    )
    from_job = usage_from_job_result((last_completed or {}).get("result"))
    if from_job is not None:
        return from_job
    return usage_from_list_metadata(user_row.get("lists"))


def current_usage(user: User) -> Usage | None:
    return stored_usage(mongo.db, {"_id": ObjectId(user.id), "lists": user.lists})


def effective_max_domains(
    user_row: Mapping[str, Any], default_max_domains: int, root_github_id: int | None
) -> int | None:
    is_root = (
        type(root_github_id) is int
        and root_github_id > 0
        and user_row.get("github_id") == root_github_id
    )
    if is_root or user_row.get("is_admin") is True:
        return None
    overrides = user_row.get("limits")
    override = (
        _count(overrides.get("max_domains")) if isinstance(overrides, Mapping) else None
    )
    return override if override is not None else default_max_domains


def enforcing_domain_limit() -> bool:
    return bool(current_app.config.get("ENFORCE_DOMAIN_LIMIT", False))


def notification_message(
    actual_domains: int, max_domains: int, method: str, enforcing: bool
) -> str:
    measured = f"{actual_domains:,}"
    if method == METHOD_STORED:
        measured = f"about {measured}"
    return (
        f"Your lists contain {measured} domains across all categories. "
        f"Your limit is {max_domains:,}. "
        f"{CONSEQUENCE_WHEN_ENFORCING if enforcing else CONSEQUENCE_BEFORE_ENFORCING} "
        "To get back within the limit, remove some sources, "
        "or request a higher limit from your dashboard."
    )


def _notification(
    actual_domains: int, max_domains: int, method: str, now: datetime, enforcing: bool
) -> dict[str, Any]:
    return {
        "id": str(uuid.uuid4()),
        "type": NOTIFICATION_TYPE,
        "title": NOTIFICATION_TITLE,
        "message": notification_message(actual_domains, max_domains, method, enforcing),
        "data": {"actual_domains": actual_domains, "max_domains": max_domains},
        "read": False,
        "created_at": now,
    }


def flag_over_limit(
    users: Collection[Any],
    user_id: ObjectId,
    actual_domains: int,
    max_domains: int,
    method: str,
    now: datetime,
    enforcing: bool,
) -> ReviewChange:
    opened = User.open_limit_review(
        user_id, actual_domains, max_domains, method, now, users
    )
    refreshed = not opened and User.refresh_limit_review(
        user_id,
        {
            "actual_domains": actual_domains,
            "max_domains": max_domains,
            "method": method,
        },
        users,
    )
    notified = User.notify_limit_review_once(
        user_id,
        _notification(actual_domains, max_domains, method, now, enforcing),
        now,
        users,
    )
    return ReviewChange(opened=opened, refreshed=refreshed, notified=notified)


def record_job_result(job: Job) -> ReviewChange:
    result = job.result
    measured = result.get("limit") if isinstance(result, Mapping) else None
    if job.user_id is None or not isinstance(measured, Mapping):
        return ReviewChange()
    if measured.get("max_domains", 0) is None:
        return ReviewChange()
    actual_domains = _count(measured.get("actual_domains"))
    max_domains = _count(measured.get("max_domains"))
    if actual_domains is None or max_domains is None:
        logger.warning("Job %s carries an unreadable limit measurement", job.job_id)
        return ReviewChange()
    user = User.get_by_id(str(job.user_id))
    if user is None or user.is_admin:
        return ReviewChange()

    current_limit = _count(user.limits.get("max_domains"))
    if current_limit is None:
        logger.warning(
            "User %s has an unreadable domain limit, so job %s is judged against "
            "the limit it was built with",
            user.id,
            job.job_id,
        )
    else:
        max_domains = max(max_domains, current_limit)
    users = mongo.db[User.COLLECTION]
    now = datetime.utcnow()
    if actual_domains > max_domains:
        change = flag_over_limit(
            users,
            job.user_id,
            actual_domains,
            max_domains,
            METHOD_BUILD,
            now,
            enforcing_domain_limit(),
        )
        if change.opened:
            logger.info(
                "Opened a domain limit review for %s after job %s",
                user.username,
                job.job_id,
            )
        return change
    if job.status != Job.STATUS_COMPLETED:
        return ReviewChange()
    resolved = User.resolve_limit_review(
        job.user_id, RESOLVED_BY_BUILD, REASON_WITHIN_LIMIT, now, users=users
    )
    if resolved:
        logger.info(
            "Resolved the domain limit review for %s after job %s",
            user.username,
            job.job_id,
        )
    return ReviewChange(resolved=resolved)


def limit_changed(user: User, changed_by: str) -> bool:
    max_domains = user.limits["max_domains"]
    user_id = ObjectId(user.id)
    resolved = User.resolve_limit_review(
        user_id,
        changed_by,
        REASON_LIMIT_RAISED,
        datetime.utcnow(),
        covered_by_limit=max_domains,
    )
    if not resolved:
        User.refresh_limit_review(user_id, {"max_domains": max_domains})
    return resolved


def resolve_by_admin(user_id: ObjectId, admin_username: str, reason: str) -> bool:
    return User.resolve_limit_review(user_id, admin_username, reason, datetime.utcnow())


def percent_over(actual_domains: int, max_domains: int) -> float:
    if max_domains <= 0:
        return 0.0
    return round((actual_domains - max_domains) / max_domains * 100, 1)


def open_reviews(page: int, per_page: int) -> tuple[list[dict[str, Any]], int]:
    is_open = {"limit_review.status": User.LIMIT_REVIEW_OPEN}
    users = mongo.db[User.COLLECTION]
    total = users.count_documents(is_open)
    rows = [
        User(row)
        for row in users.find(is_open, {"username": 1, "limit_review": 1})
        .sort([("limit_review.actual_domains", -1), ("_id", 1)])
        .skip((page - 1) * per_page)
        .limit(per_page)
    ]
    awaiting_decision = {
        request["user_id"]
        for request in mongo.db[LimitRequest.COLLECTION].find(
            {
                "user_id": {"$in": [ObjectId(row.id) for row in rows]},
                "status": LimitRequest.STATUS_PENDING,
            },
            {"user_id": 1},
        )
    }
    reviews = []
    for row in rows:
        review = row.serialized_limit_review() or {}
        actual_domains = _count(review.get("actual_domains")) or 0
        max_domains = _count(review.get("max_domains")) or 0
        reviews.append(
            {
                "user_id": row.id,
                "username": row.username,
                "max_domains": max_domains,
                "actual_domains": actual_domains,
                "percent_over": percent_over(actual_domains, max_domains),
                "method": review.get("method"),
                "detected_at": review.get("detected_at"),
                "notified": review.get("notified_at") is not None,
                "has_pending_request": ObjectId(row.id) in awaiting_decision,
            }
        )
    return reviews, total
