import logging
from dataclasses import dataclass, field
from typing import Any

from pymongo.database import Database
from pymongo.errors import ConnectionFailure, PyMongoError

from app.models.blocklist_library import BlocklistLibrary

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    name: str
    keys: tuple[tuple[str, int], ...]
    options: dict[str, Any] = field(default_factory=dict)


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
    try:
        BlocklistLibrary.ensure_indexes()
    except PyMongoError:
        logger.exception("Could not create indexes on %s", BlocklistLibrary.COLLECTION)
