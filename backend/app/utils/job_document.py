from collections.abc import Mapping
from typing import Any


def initial_progress() -> dict[str, Any]:
    return {
        "current_step": "queued",
        "stage": "queue",
        "total_sources": 0,
        "processed_sources": 0,
        "current_source": None,
        "sources": [],
        "whitelist": None,
        "generation": None,
        "queue_position": None,
        "queue_delay_remaining_ms": None,
        "stage_started_at": None,
        "stages": {"downloading": None, "whitelist": None, "generation": None},
        "stage_snapshots": {},
    }


def empty_result() -> dict[str, Any]:
    return {
        "sources_processed": 0,
        "sources_failed": 0,
        "sources_stale": 0,
        "total_domains": 0,
        "unique_domains": 0,
        "whitelisted_removed": 0,
        "output_files": [],
        "categories": {},
        "errors": [],
        "warnings": [],
        "error_code": None,
        "skip_reason": None,
        "generation_id": None,
        "limit": None,
    }


def failure_result(error_code: str, error: str) -> dict[str, Any]:
    return {**empty_result(), "errors": [error], "error_code": error_code}


def normalised_result(result: Any) -> Any:
    if not isinstance(result, Mapping):
        return result
    return {**empty_result(), **result}


def revision_bump() -> dict[str, Any]:
    return {"$inc": {"rev": 1}, "$currentDate": {"updated_at": True}}
