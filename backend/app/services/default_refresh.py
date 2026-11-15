import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.models.job import Job
from app.services.build_admission import DEFAULT_TARGET, AdmissionError, admit_build
from app.services.default_sync import SyncResult, sync_default_config, sync_enabled

logger = logging.getLogger(__name__)

SUNDAY = 6
HOURLY_SYNC_MINUTE = 15
DEFAULT_REBUILD_HOUR = 6
DEFAULT_REBUILD_MINUTE = 30


@dataclass(frozen=True)
class RefreshResult:
    sync: SyncResult | None
    job_id: str | None = None
    build_refusal: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sync": self.sync.to_dict() if self.sync is not None else None,
            "job_id": self.job_id,
            "build_refusal": self.build_refusal,
        }


def sync_now(force: bool) -> RefreshResult:
    result = sync_default_config(force=force, refetch=True)
    if not result.build_needed:
        return RefreshResult(result)
    return _with_build(result, Job.TYPE_ADMIN)


def hourly_check(now: datetime) -> RefreshResult | None:
    if not sync_enabled():
        return None
    result = sync_default_config()
    if not result.build_needed:
        return RefreshResult(result)
    if weekly_rebuild_still_to_come(now):
        logger.info("Default lists changed; the weekly rebuild will build them")
        return RefreshResult(result)
    return _with_build(result, Job.TYPE_SCHEDULED)


def weekly_rebuild() -> RefreshResult:
    result = sync_default_config() if sync_enabled() else None
    return _with_build(result, Job.TYPE_SCHEDULED)


def weekly_rebuild_still_to_come(now: datetime) -> bool:
    return now.weekday() == SUNDAY and (now.hour, now.minute) < (
        DEFAULT_REBUILD_HOUR,
        DEFAULT_REBUILD_MINUTE,
    )


def _with_build(result: SyncResult | None, job_type: str) -> RefreshResult:
    try:
        job = admit_build(DEFAULT_TARGET, job_type, None)
    except AdmissionError as refusal:
        logger.warning(
            "Default build not queued (%s): %s", refusal.code, refusal.message
        )
        return RefreshResult(result, build_refusal=refusal.code)
    logger.info("Queued default build %s", job.job_id)
    return RefreshResult(result, job_id=job.job_id)
