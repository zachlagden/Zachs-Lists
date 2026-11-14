import copy
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import pytest
from bson import ObjectId

from app.models.job import Job
from app.utils.job_document import initial_progress

FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures"
UTC_MILLISECONDS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


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
