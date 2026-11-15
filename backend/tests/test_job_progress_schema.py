import copy
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import mongomock
import pytest
from bson import ObjectId

from app.extensions import mongo
from app.models.job import Job
from app.utils.job_document import (
    empty_result,
    failure_result,
    initial_progress,
    normalised_result,
)

FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures"
UTC_MILLISECONDS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
HEARTBEAT_INTERVAL_SECONDS = 10


def shared_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def stored_job(**fields: Any) -> dict[str, Any]:
    document: dict[str, Any] = {
        "_id": ObjectId(),
        "job_id": str(ObjectId()),
        "user_id": ObjectId("000000000000000000000001"),
        "username": "sam",
        "type": Job.TYPE_MANUAL,
        "status": Job.STATUS_PROCESSING,
        "priority": Job.PRIORITY_NORMAL,
        "progress": initial_progress(),
        "result": None,
        "created_at": datetime(2026, 3, 4, 5, 6, 0),
        "started_at": datetime(2026, 3, 4, 5, 6, 1),
        "worker_id": "worker-a",
    }
    document.update(fields)
    return document


def timestamps(value: Any, key: str = "") -> Iterator[str]:
    if isinstance(value, dict):
        for name, nested in value.items():
            yield from timestamps(nested, name)
    elif isinstance(value, list):
        for item in value:
            yield from timestamps(item, key)
    elif isinstance(value, str) and key.endswith("_at"):
        yield value


@pytest.fixture
def jobs(monkeypatch: pytest.MonkeyPatch) -> Any:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    return db.jobs


@pytest.mark.parametrize("name", ["mid_download", "mid_generation", "completed"])
def test_progress_and_result_pass_through_unchanged(name: str) -> None:
    document = shared_fixture("job-progress.json")[name]
    stored = stored_job(
        progress=copy.deepcopy(document["progress"]),
        result=copy.deepcopy(document["result"]),
    )

    payload = Job(stored).to_dict()

    assert payload["progress"] == document["progress"]
    assert payload["result"] == document["result"]
    assert json.loads(json.dumps(payload["progress"])) == document["progress"]


def test_empty_result_has_exactly_the_keys_the_worker_writes() -> None:
    written = shared_fixture("job-progress.json")["completed"]["result"]

    assert set(empty_result()) == set(written)
    assert set(failure_result("internal", "It failed")) == set(written)


def test_result_stored_in_an_older_shape_is_served_with_every_key() -> None:
    old_shape = {
        "sources_processed": 3,
        "sources_failed": 0,
        "total_domains": 40,
        "unique_domains": 30,
        "whitelisted_removed": 2,
        "output_files": [],
        "errors": ["Abandoned"],
        "error_code": "worker_abandoned",
    }
    stored = stored_job(status=Job.STATUS_FAILED, result=copy.deepcopy(old_shape))

    served = Job(stored).to_dict()["result"]

    assert served == {
        **old_shape,
        "sources_stale": 0,
        "categories": {},
        "warnings": [],
        "skip_reason": None,
        "generation_id": None,
        "limit": None,
    }
    assert stored["result"] == old_shape


def test_result_normaliser_keeps_stored_values_and_passes_a_missing_result() -> None:
    assert normalised_result(None) is None
    assert normalised_result({"limit": {"max_domains": None, "actual_domains": 4}})[
        "limit"
    ] == {"max_domains": None, "actual_domains": 4}
    assert normalised_result({"copied_from": "alex"})["copied_from"] == "alex"
    assert normalised_result({})["output_files"] is not empty_result()["output_files"]


def test_worker_timestamps_in_the_fixture_are_utc_with_milliseconds() -> None:
    stamps = list(timestamps(shared_fixture("job-progress.json")))

    assert len(stamps) > 20
    for stamp in stamps:
        assert UTC_MILLISECONDS.match(stamp), stamp


def test_initial_progress_has_every_top_level_key_of_the_schema() -> None:
    documents = shared_fixture("job-progress.json")

    for document in documents.values():
        assert set(initial_progress()) == set(document["progress"])
    assert initial_progress() == shared_fixture("job-initial-progress.json")


def test_attempt_start_is_serialised_as_utc_with_milliseconds() -> None:
    payload = Job(
        stored_job(attempt_started_at=datetime(2026, 3, 4, 5, 7, 8, 912000))
    ).to_dict()

    assert payload["attempt_started_at"] == "2026-03-04T05:07:08.912Z"
    assert payload["started_at"] == "2026-03-04T05:06:01.000Z"


def test_attempt_start_is_null_for_jobs_stored_without_it() -> None:
    assert Job(stored_job()).to_dict()["attempt_started_at"] is None


def test_job_is_requeued_two_minutes_after_its_last_heartbeat(jobs: Any) -> None:
    now = datetime.utcnow()
    missed_heartbeats = 5
    jobs.insert_many(
        [
            stored_job(
                job_id="silent",
                heartbeat_at=now - timedelta(minutes=2, seconds=5),
            ),
            stored_job(
                job_id="late",
                heartbeat_at=now
                - timedelta(seconds=missed_heartbeats * HEARTBEAT_INTERVAL_SECONDS),
            ),
            stored_job(job_id="alive", heartbeat_at=now - timedelta(seconds=10)),
        ]
    )

    assert Job.STALE_AFTER_MINUTES == 2
    assert Job.STALE_AFTER_MINUTES * 60 >= 10 * HEARTBEAT_INTERVAL_SECONDS
    assert Job.reset_stale() == (1, 0)

    statuses = {job["job_id"]: job["status"] for job in jobs.find()}
    assert statuses == {
        "silent": Job.STATUS_QUEUED,
        "late": Job.STATUS_PROCESSING,
        "alive": Job.STATUS_PROCESSING,
    }
    requeued = jobs.find_one({"job_id": "silent"})
    assert requeued["progress"] == shared_fixture("job-initial-progress.json")
    assert requeued["worker_id"] is None
