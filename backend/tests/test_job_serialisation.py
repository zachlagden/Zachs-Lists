from datetime import datetime, timezone
from typing import Any

from bson import ObjectId

from app.models.job import Job


def stored_job(**overrides: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "_id": ObjectId("000000000000000000000002"),
        "job_id": "11111111-2222-3333-4444-555555555555",
        "user_id": ObjectId("000000000000000000000001"),
        "username": "sam",
        "type": Job.TYPE_MANUAL,
        "status": Job.STATUS_COMPLETED,
        "priority": Job.PRIORITY_NORMAL,
        "progress": {"stage": "completed"},
        "result": {"errors": []},
        "created_at": datetime(2026, 1, 2, 3, 4, 5, 678000),
        "started_at": datetime(2026, 1, 2, 3, 4, 6),
        "completed_at": datetime(2026, 1, 2, 3, 5, 7, 9000),
        "worker_id": "worker-1",
    }
    document.update(overrides)
    return document


def test_timestamps_are_utc_with_milliseconds_and_zone() -> None:
    payload = Job(stored_job()).to_dict()

    assert payload["created_at"] == "2026-01-02T03:04:05.678Z"
    assert payload["started_at"] == "2026-01-02T03:04:06.000Z"
    assert payload["completed_at"] == "2026-01-02T03:05:07.009Z"


def test_aware_timestamps_are_converted_to_utc() -> None:
    created = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    payload = Job(stored_job(created_at=created)).to_dict()

    assert payload["created_at"] == "2026-01-02T03:04:05.000Z"


def test_read_force_rebuild_and_attempts_default_when_unset() -> None:
    payload = Job(stored_job()).to_dict()

    assert payload["read"] is False
    assert payload["force_rebuild"] is False
    assert payload["attempts"] == 0


def test_read_force_rebuild_and_attempts_reflect_stored_values() -> None:
    payload = Job(stored_job(read=True, force_rebuild=True, stale_attempts=2)).to_dict()

    assert payload["read"] is True
    assert payload["force_rebuild"] is True
    assert payload["attempts"] == 2


def test_unset_timestamps_stay_null() -> None:
    payload = Job(
        stored_job(status=Job.STATUS_QUEUED, started_at=None, completed_at=None)
    ).to_dict()

    assert payload["started_at"] is None
    assert payload["completed_at"] is None
    assert payload["created_at"].endswith("Z")


def test_revision_and_update_time_are_serialised() -> None:
    payload = Job(
        stored_job(rev=12, updated_at=datetime(2026, 1, 2, 3, 5, 7, 9000))
    ).to_dict()

    assert payload["rev"] == 12
    assert payload["updated_at"] == "2026-01-02T03:05:07.009Z"


def test_revision_and_update_time_default_for_jobs_stored_without_them() -> None:
    payload = Job(stored_job()).to_dict()

    assert payload["rev"] == 0
    assert payload["updated_at"] is None


def test_attempts_come_from_the_claim_counter_when_it_is_stored() -> None:
    payload = Job(stored_job(attempt=3, stale_attempts=1)).to_dict()

    assert payload["attempts"] == 3


def test_attempts_fall_back_to_stale_resets_when_the_counter_is_unusable() -> None:
    payload = Job(stored_job(attempt="many", stale_attempts=2)).to_dict()

    assert payload["attempts"] == 2
