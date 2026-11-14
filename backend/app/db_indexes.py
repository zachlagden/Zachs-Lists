import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from pymongo.database import Database
from pymongo.errors import ConnectionFailure, PyMongoError

from app.models.blocklist_library import BlocklistLibrary
from app.models.job import Job

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
                {"_id": job["_id"]}, {"$set": {"target_id": job["target_id"]}}
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
                        "result": {
                            "sources_processed": 0,
                            "sources_failed": 0,
                            "total_domains": 0,
                            "unique_domains": 0,
                            "whitelisted_removed": 0,
                            "output_files": [],
                            "errors": [
                                "Cancelled because another build for the same "
                                "lists was already active"
                            ],
                            "error_code": Job.ERROR_SUPERSEDED,
                        },
                    }
                },
            )
            if cancelled.modified_count:
                logger.warning(
                    "Cancelled duplicate active job %s for target %s",
                    duplicate.get("job_id"),
                    target_id,
                )


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
        "validation_tokens",
        "expires_at_1",
        (("expires_at", 1),),
        {"expireAfterSeconds": 0},
    ),
    IndexSpec("validation_tokens", "user_id_1", (("user_id", 1),)),
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
