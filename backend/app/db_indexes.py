import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pymongo.database import Database
from pymongo.errors import ConnectionFailure, PyMongoError

from app.models.analytics import Analytics
from app.models.blocklist_library import BlocklistLibrary
from app.models.job import Job
from app.models.limit_request import LimitRequest
from app.utils.job_document import failure_result, revision_bump

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    name: str
    keys: tuple[tuple[str, int], ...]
    options: dict[str, Any] = field(default_factory=dict)
    prepare: Callable[[Database], None] | None = None


def prepare_active_job_targets(db: Database) -> None:
    jobs = db[Job.COLLECTION]
    active_filter = {"status": {"$in": list(Job.ACTIVE_STATUSES)}}
    by_target: dict[str, list[dict[str, Any]]] = {}
    for job in jobs.find(active_filter):
        if not isinstance(job.get("target_id"), str) or not job["target_id"]:
            job["target_id"] = Job.target_id_for(job) or f"orphan:{job['_id']}"
            jobs.update_one(
                {"_id": job["_id"]},
                {"$set": {"target_id": job["target_id"]}, **revision_bump()},
            )
        by_target.setdefault(job["target_id"], []).append(job)
    for target_id, active in by_target.items():
        active.sort(
            key=lambda job: (
                job["status"] != Job.STATUS_PROCESSING,
                job.get("created_at") or datetime.min,
            )
        )
        for duplicate in active[1:]:
            cancelled = jobs.update_one(
                {"_id": duplicate["_id"], **active_filter},
                {
                    "$set": {
                        "status": Job.STATUS_FAILED,
                        "worker_id": None,
                        "claimed_at": None,
                        "heartbeat_at": None,
                        "completed_at": datetime.utcnow(),
                        "result": failure_result(
                            Job.ERROR_SUPERSEDED,
                            "Cancelled because another build for the same "
                            "lists was already active",
                        ),
                    },
                    **revision_bump(),
                },
            )
            if cancelled.modified_count:
                logger.warning(
                    "Cancelled duplicate active job %s for target %s",
                    duplicate.get("job_id"),
                    target_id,
                )


def prepare_pending_limit_requests(db: Database) -> None:
    requests = db[LimitRequest.COLLECTION]
    pending_filter = {"status": LimitRequest.STATUS_PENDING}
    by_user: dict[Any, list[dict[str, Any]]] = {}
    for request in requests.find(pending_filter):
        by_user.setdefault(request.get("user_id"), []).append(request)
    for user_id, pending in by_user.items():
        pending.sort(
            key=lambda request: (
                request.get("created_at") or datetime.min,
                request["_id"],
            ),
            reverse=True,
        )
        for duplicate in pending[1:]:
            superseded = requests.update_one(
                {"_id": duplicate["_id"], **pending_filter},
                {
                    "$set": {
                        "status": LimitRequest.STATUS_SUPERSEDED,
                        "admin_response": "Replaced by a newer request",
                        "reviewed_at": datetime.utcnow(),
                    }
                },
            )
            if superseded.modified_count:
                logger.warning(
                    "Superseded duplicate pending limit request %s for user %s",
                    duplicate["_id"],
                    user_id,
                )


ANALYTICS_RETENTION_SECONDS = Analytics.RETENTION_DAYS * 24 * 60 * 60

INDEXES: tuple[IndexSpec, ...] = (
    IndexSpec("users", "github_identity_unique", (("github_id", 1),), {"unique": True}),
    IndexSpec(
        "users", "public_list_username_unique", (("username", 1),), {"unique": True}
    ),
    IndexSpec("jobs", "job_id_1", (("job_id", 1),), {"unique": True}),
    IndexSpec(
        "jobs",
        "status_1_priority_1_created_at_1",
        (("status", 1), ("priority", 1), ("created_at", 1)),
    ),
    IndexSpec("jobs", "user_id_1_created_at_-1", (("user_id", 1), ("created_at", -1))),
    IndexSpec(
        "jobs",
        "user_id_1_status_1_completed_at_-1",
        (("user_id", 1), ("status", 1), ("completed_at", -1)),
    ),
    IndexSpec("jobs", "updated_at_1", (("updated_at", 1),)),
    IndexSpec(
        "jobs",
        "one_active_job_per_target",
        (("target_id", 1),),
        {
            "unique": True,
            "partialFilterExpression": {"status": {"$in": list(Job.ACTIVE_STATUSES)}},
        },
        prepare_active_job_targets,
    ),
    IndexSpec("cache", "url_hash_1", (("url_hash", 1),), {"unique": True}),
    IndexSpec("workers", "worker_id_1", (("worker_id", 1),), {"unique": True}),
    IndexSpec("limit_requests", "user_id_1_status_1", (("user_id", 1), ("status", 1))),
    IndexSpec(
        LimitRequest.COLLECTION,
        "one_pending_request_per_user",
        (("user_id", 1),),
        {
            "unique": True,
            "partialFilterExpression": {"status": LimitRequest.STATUS_PENDING},
        },
        prepare_pending_limit_requests,
    ),
    IndexSpec(
        "validation_tokens",
        "expires_at_1",
        (("expires_at", 1),),
        {"expireAfterSeconds": 0},
    ),
    IndexSpec("validation_tokens", "user_id_1", (("user_id", 1),)),
    IndexSpec(
        Analytics.COLLECTION,
        "analytics_scope_date",
        (("list_type", 1), ("username", 1), ("list_name", 1), ("date", 1)),
    ),
    IndexSpec(
        Analytics.COLLECTION,
        "analytics_retention",
        (("date", 1),),
        {"expireAfterSeconds": ANALYTICS_RETENTION_SECONDS},
    ),
    IndexSpec(
        Analytics.VISITORS_COLLECTION,
        "analytics_visitor_scope_date",
        (
            ("list_type", 1),
            ("username", 1),
            ("list_name", 1),
            ("date", 1),
            ("visitor", 1),
        ),
    ),
    IndexSpec(
        Analytics.VISITORS_COLLECTION,
        "analytics_visitor_retention",
        (("date", 1),),
        {"expireAfterSeconds": ANALYTICS_RETENTION_SECONDS},
    ),
)


def ensure_indexes(db: Database) -> None:
    for spec in INDEXES:
        try:
            _prepare(db, spec)
            db[spec.collection].create_index(
                list(spec.keys), name=spec.name, **spec.options
            )
        except ConnectionFailure:
            logger.exception(
                "Database unreachable while creating index %s on %s; "
                "skipping the remaining indexes",
                spec.name,
                spec.collection,
            )
            return
        except PyMongoError:
            logger.exception(
                "Could not create index %s on %s", spec.name, spec.collection
            )
    _ensure_library_indexes()


def _prepare(db: Database, spec: IndexSpec) -> None:
    if spec.prepare is None:
        return
    try:
        spec.prepare(db)
    except ConnectionFailure:
        raise
    except PyMongoError:
        logger.exception(
            "Could not prepare %s for index %s", spec.collection, spec.name
        )


def _ensure_library_indexes() -> None:
    try:
        BlocklistLibrary.ensure_indexes()
    except PyMongoError:
        logger.exception("Could not create indexes on %s", BlocklistLibrary.COLLECTION)
