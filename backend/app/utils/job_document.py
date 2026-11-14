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


def revision_bump() -> dict[str, Any]:
    return {"$inc": {"rev": 1}, "$currentDate": {"updated_at": True}}
