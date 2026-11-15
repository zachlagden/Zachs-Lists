import logging
import uuid
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError, PyMongoError

from app.extensions import mongo
from app.models.job import Job
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services.default_sync import pin_repository_sources
from app.utils.job_document import initial_progress, revision_bump
from app.utils.time import next_week_start, utc_iso, week_start
from app.utils.validators import MAX_CONFIG_SOURCES, validate_blocklist_config

logger = logging.getLogger(__name__)

DEFAULT_TARGET = Job.DEFAULT_TARGET_ID
JOB_TYPES = (Job.TYPE_MANUAL, Job.TYPE_SCHEDULED, Job.TYPE_ADMIN)
MANUAL_COOLDOWN_MINUTES = 5
RECENT_MANUAL_BUILD_MINUTES = 30
REFUNDABLE_ERROR_CODES = (
    "internal",
    "all_sources_failed",
    Job.ERROR_WORKER_ABANDONED,
    Job.ERROR_SUPERSEDED,
)
EPOCH = datetime(1970, 1, 1)
WEEKLY_REBUILD_SKIPPED_TYPE = "weekly_rebuild_skipped"
WEEKLY_REBUILD_SKIPPED_TITLE = "Your weekly rebuild was skipped"


class AdmissionError(Exception):
    def __init__(self, code: str, message: str, status: int, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details

    def to_response(self) -> dict[str, Any]:
        return {"error": self.message, "code": self.code, **self.details}


def admit_build(
    target: User | str,
    job_type: str,
    requested_by: User | None,
    force_rebuild: bool = False,
) -> Job:
    if job_type not in JOB_TYPES:
        raise ValueError(f"Unknown job type: {job_type}")
    if isinstance(target, User):
        return _admit_user_build(target, job_type, requested_by, force_rebuild)
    if target == DEFAULT_TARGET:
        return _admit_default_build(job_type, force_rebuild)
    raise ValueError(f"Unknown build target: {target}")


def refund_quota_if_due(job_id: str) -> bool:
    job = mongo.db[Job.COLLECTION].find_one_and_update(
        {
            "job_id": job_id,
            **_refund_due(),
        },
        {"$set": {"quota_refunded": True}, **revision_bump()},
    )
    if job is None:
        return False
    refunded = _refund_charge(job["user_id"], job["created_at"])
    logger.info(
        "Quota refund for job %s: %s",
        job_id,
        "applied" if refunded else "not applied, the charged week has ended",
    )
    return refunded


def refund_missed_quota() -> int:
    current_week = week_start(datetime.utcnow())
    missed = mongo.db[Job.COLLECTION].find(
        {"created_at": {"$gte": current_week}, **_refund_due()}, {"job_id": 1}
    )
    return sum(1 for job in list(missed) if refund_quota_if_due(job["job_id"]))


def _refund_due() -> dict[str, Any]:
    return {
        "quota_charged": True,
        "quota_refunded": {"$ne": True},
        "$or": [
            {"status": Job.STATUS_SKIPPED},
            {
                "status": Job.STATUS_FAILED,
                "result.error_code": {"$in": list(REFUNDABLE_ERROR_CODES)},
            },
        ],
    }


def queue_scheduled_user_builds() -> tuple[int, int]:
    queued = 0
    skipped = 0
    for user in User.get_all_enabled():
        if Job.user_completed_recently(
            ObjectId(user.id),
            minutes=RECENT_MANUAL_BUILD_MINUTES,
            job_type=Job.TYPE_MANUAL,
        ):
            logger.info("Skipping %s: recent manual build", user.username)
            skipped += 1
            continue
        try:
            admit_build(user, Job.TYPE_SCHEDULED, None)
            queued += 1
        except AdmissionError as refusal:
            if refusal.code == "no_config":
                continue
            if refusal.code == "invalid_config":
                _report_refused_weekly_rebuild(user, refusal)
            else:
                logger.info(
                    "Skipping %s (%s): %s", user.username, refusal.code, refusal.message
                )
            skipped += 1
        except Exception:
            logger.exception("Failed to queue rebuild for %s", user.username)
    return queued, skipped


def weekly_rebuild_skipped_message(first_error: str | None) -> str:
    problem = f' The first problem is "{first_error}".' if first_error else ""
    return (
        "The weekly rebuild of your lists was skipped because your saved "
        f"configuration is not valid.{problem} "
        "Your current lists stay published until you fix and save the configuration."
    )


def _report_refused_weekly_rebuild(user: User, refusal: AdmissionError) -> None:
    errors = [str(error) for error in refusal.details.get("errors") or []]
    logger.warning(
        "Weekly rebuild refused for user %s: configuration validation errors: %d",
        user.id,
        len(errors),
    )
    try:
        User.notify_unless_unread(
            ObjectId(user.id),
            {
                "id": str(uuid.uuid4()),
                "type": WEEKLY_REBUILD_SKIPPED_TYPE,
                "title": WEEKLY_REBUILD_SKIPPED_TITLE,
                "message": weekly_rebuild_skipped_message(
                    errors[0] if errors else None
                ),
                "data": {"error_count": len(errors)},
                "read": False,
                "created_at": datetime.utcnow(),
            },
        )
    except PyMongoError:
        logger.exception(
            "Could not notify user %s that the weekly rebuild was refused", user.id
        )


def _admit_user_build(
    target: User, job_type: str, requested_by: User | None, force_rebuild: bool
) -> Job:
    user = User.get_by_id(target.id)
    if user is None:
        raise AdmissionError("user_not_found", "User not found", 404)
    blocklists = user.get_config("blocklists.conf")
    if not blocklists or not blocklists.strip():
        raise AdmissionError("no_config", "No blocklist configuration found", 400)

    limits = user.limits
    config_snapshot: dict[str, Any] = {
        "blocklists": blocklists,
        "whitelist": user.get_config("whitelist.txt") or "",
        "revision": user.config_revision,
        "limits": {
            "max_domains": None if user.is_admin else limits["max_domains"],
            "max_source_lists": limits["max_source_lists"],
        },
    }
    _refuse_invalid_config(blocklists, limits["max_source_lists"])

    user_id = ObjectId(user.id)
    now = datetime.utcnow()
    _refuse_active_build(user.id, user, now)

    charges_quota = job_type == Job.TYPE_MANUAL and not (
        requested_by is not None and requested_by.is_admin
    )
    if charges_quota:
        cooldown_remaining = Job.get_cooldown_remaining(
            user_id, cooldown_minutes=MANUAL_COOLDOWN_MINUTES
        )
        if cooldown_remaining > 0:
            minutes, seconds = divmod(cooldown_remaining, 60)
            raise AdmissionError(
                "cooldown",
                f"Please wait {minutes}m {seconds}s before triggering another build",
                429,
                cooldown_remaining=cooldown_remaining,
                remaining_updates=user.get_remaining_manual_updates(now),
            )
        if not _charge_quota(user_id, limits["manual_updates_per_week"], now):
            raise AdmissionError(
                "weekly_limit",
                "Weekly manual update limit reached",
                429,
                remaining=0,
                remaining_updates=0,
                resets_at=utc_iso(next_week_start(now)),
            )

    priority = (
        Job.PRIORITY_LOW if job_type == Job.TYPE_SCHEDULED else Job.PRIORITY_NORMAL
    )
    document = _job_document(
        target_id=user.id,
        user_id=user_id,
        username=user.username,
        job_type=job_type,
        priority=priority,
        force_rebuild=force_rebuild,
        config_snapshot=config_snapshot,
        quota_charged=charges_quota,
        created_at=now,
    )
    return _insert_job(document, user, charges_quota)


def _admit_default_build(job_type: str, force_rebuild: bool) -> Job:
    stored = SystemConfig.get_default_config()
    config_snapshot: dict[str, Any] = {
        "blocklists": pin_repository_sources(stored["blocklists"]),
        "whitelist": stored["whitelist"],
        "revision": None,
        "limits": None,
    }
    _refuse_invalid_config(stored["blocklists"], MAX_CONFIG_SOURCES)
    now = datetime.utcnow()
    _refuse_active_build(DEFAULT_TARGET, None, now)
    document = _job_document(
        target_id=DEFAULT_TARGET,
        user_id=None,
        username=DEFAULT_TARGET,
        job_type=job_type,
        priority=Job.PRIORITY_HIGH,
        force_rebuild=force_rebuild,
        config_snapshot=config_snapshot,
        quota_charged=False,
        created_at=now,
    )
    return _insert_job(document, None, False)


def _refuse_invalid_config(blocklists: str, max_sources: int) -> None:
    errors = validate_blocklist_config(blocklists, max_sources)
    if errors:
        raise AdmissionError(
            "invalid_config", "Blocklist configuration is invalid", 400, errors=errors
        )


def _refuse_active_build(target_id: str, user: User | None, now: datetime) -> None:
    active = Job.get_active_for_target(target_id)
    if active is not None:
        raise _build_active(active, user, now)


def _build_active(active: Job, user: User | None, now: datetime) -> AdmissionError:
    details: dict[str, Any] = {"job_id": active.job_id}
    if user is not None:
        details["remaining_updates"] = user.get_remaining_manual_updates(now)
    return AdmissionError(
        "build_active", "A build is already in progress", 409, **details
    )


def _charge_quota(user_id: ObjectId, weekly_limit: int, now: datetime) -> bool:
    if weekly_limit <= 0:
        return False
    current_week = week_start(now)
    stored_week_is_old = {
        "$lt": [{"$ifNull": ["$stats.week_reset_at", EPOCH]}, current_week]
    }
    result = mongo.db[User.COLLECTION].update_one(
        {
            "_id": user_id,
            "$or": [
                {"stats.week_reset_at": {"$not": {"$gte": current_week}}},
                {"stats.manual_updates_this_week": {"$not": {"$gte": weekly_limit}}},
            ],
        },
        [
            {
                "$set": {
                    "stats.manual_updates_this_week": {
                        "$cond": [
                            stored_week_is_old,
                            1,
                            {
                                "$add": [
                                    {"$ifNull": ["$stats.manual_updates_this_week", 0]},
                                    1,
                                ]
                            },
                        ]
                    },
                    "stats.week_reset_at": current_week,
                }
            }
        ],
    )
    return result.matched_count == 1


def _refund_charge(user_id: ObjectId, charged_at: datetime) -> bool:
    charged_week = week_start(charged_at)
    result = mongo.db[User.COLLECTION].update_one(
        {
            "_id": user_id,
            "stats.week_reset_at": {
                "$gte": charged_week,
                "$lt": charged_week + timedelta(days=7),
            },
            "stats.manual_updates_this_week": {"$gt": 0},
        },
        {"$inc": {"stats.manual_updates_this_week": -1}},
    )
    return result.modified_count == 1


def _job_document(
    *,
    target_id: str,
    user_id: ObjectId | None,
    username: str,
    job_type: str,
    priority: int,
    force_rebuild: bool,
    config_snapshot: dict[str, Any],
    quota_charged: bool,
    created_at: datetime,
) -> dict[str, Any]:
    return {
        "job_id": str(uuid.uuid4()),
        "target_id": target_id,
        "user_id": user_id,
        "username": username,
        "type": job_type,
        "status": Job.STATUS_QUEUED,
        "priority": priority,
        "force_rebuild": force_rebuild,
        "config_snapshot": config_snapshot,
        "quota_charged": quota_charged,
        "progress": initial_progress(),
        "result": None,
        "started_at": None,
        "completed_at": None,
        "created_at": created_at,
        "worker_id": None,
        "claimed_at": None,
        "heartbeat_at": None,
        "rev": 0,
        "updated_at": created_at,
    }


def _insert_job(
    document: dict[str, Any], user: User | None, quota_charged: bool
) -> Job:
    created_at: datetime = document["created_at"]
    try:
        inserted = mongo.db[Job.COLLECTION].insert_one(document)
    except DuplicateKeyError:
        if user is not None and quota_charged:
            _refund_charge(ObjectId(user.id), created_at)
        active = Job.get_active_for_target(document["target_id"])
        if active is None:
            raise
        current = User.get_by_id(user.id) if user is not None else None
        raise _build_active(active, current, created_at) from None
    except PyMongoError:
        if user is not None and quota_charged:
            _refund_charge(ObjectId(user.id), created_at)
        raise
    document["_id"] = inserted.inserted_id
    job = Job(document)
    logger.info(
        "Admitted %s build %s for %s", job.job_type, job.job_id, document["target_id"]
    )
    return job
