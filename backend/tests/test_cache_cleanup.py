import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import mongomock
import pytest
from bson import ObjectId

from app.models import cache
from app.models.cache import CacheMetadata
from app.services import cache_manager
from app.services.cache_manager import CacheManager, retention_days


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Any:
    db: Any = mongomock.MongoClient().db
    monkeypatch.setattr(cache, "mongo", Mock(db=db))
    return db


@pytest.fixture
def bodies(monkeypatch: pytest.MonkeyPatch) -> Mock:
    gridfs = Mock()
    monkeypatch.setattr(CacheMetadata, "_get_gridfs", Mock(return_value=gridfs))
    return gridfs


def test_shared_cache_retention_contract() -> None:
    path = Path(__file__).resolve().parents[2] / "tests/fixtures/cache-retention.json"
    fixture = json.loads(path.read_text())
    assert cache_manager.FALLBACK_DAYS == fixture["fallback_days"]
    for case in fixture["cases"]:
        assert retention_days(case["configured_days"]) == case["retention_days"], case


def test_cleanup_follows_the_last_successful_check(
    database: Any, bodies: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CACHE_TTL_DAYS", "7")
    now = datetime.utcnow()
    expired_body, unchecked_body, valid_body = ObjectId(), ObjectId(), ObjectId()
    database.cache.insert_many(
        [
            {
                "url_hash": "expired",
                "gridfs_id": expired_body,
                "last_checked_at": now - timedelta(days=8, minutes=1),
                "updated_at": now,
            },
            {"url_hash": "unchecked", "gridfs_id": unchecked_body, "updated_at": now},
            {"url_hash": "bodiless", "last_checked_at": None, "updated_at": now},
            {
                "url_hash": "valid",
                "gridfs_id": valid_body,
                "last_checked_at": now - timedelta(days=7, hours=23),
                "updated_at": now - timedelta(days=60),
            },
        ]
    )

    assert CacheManager().cleanup_stale() == 3

    assert [entry["url_hash"] for entry in database.cache.find()] == ["valid"]
    assert {call.args[0] for call in bodies.delete.call_args_list} == {
        expired_body,
        unchecked_body,
    }


def test_cleanup_honours_a_longer_configured_retention(
    database: Any, bodies: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("CACHE_TTL_DAYS", "30")
    now = datetime.utcnow()
    database.cache.insert_many(
        [
            {"url_hash": "kept", "last_checked_at": now - timedelta(days=29)},
            {"url_hash": "removed", "last_checked_at": now - timedelta(days=31)},
        ]
    )

    assert CacheManager().cleanup_stale() == 1
    assert [entry["url_hash"] for entry in database.cache.find()] == ["kept"]


def test_cleanup_leaves_an_entry_refreshed_after_it_was_selected(
    database: Any, bodies: Mock
) -> None:
    now = datetime.utcnow()
    stale_body, fresh_body = ObjectId(), ObjectId()
    collection = database.cache
    collection.insert_one(
        {
            "url_hash": "refreshed",
            "gridfs_id": stale_body,
            "last_checked_at": now - timedelta(days=40),
        }
    )
    selected = list(collection.find({}))
    collection.update_one(
        {"url_hash": "refreshed"},
        {"$set": {"gridfs_id": fresh_body, "last_checked_at": now}},
    )
    selected_before_refresh = Mock(wraps=collection)
    selected_before_refresh.find = Mock(return_value=selected)
    cache.mongo.db = {CacheMetadata.COLLECTION: selected_before_refresh}

    assert CacheMetadata.delete_unchecked_since(now - timedelta(days=8)) == 0

    assert collection.find_one({"url_hash": "refreshed"})["gridfs_id"] == fresh_body
    bodies.delete.assert_not_called()


def test_cleanup_continues_when_a_body_is_already_gone(
    database: Any, bodies: Mock
) -> None:
    bodies.delete.side_effect = RuntimeError("missing body")
    database.cache.insert_many(
        [
            {"url_hash": "first", "gridfs_id": ObjectId()},
            {"url_hash": "second", "gridfs_id": ObjectId()},
        ]
    )

    assert CacheManager().cleanup_stale(days=7) == 2
    assert database.cache.count_documents({}) == 0


def test_invalid_configured_retention_uses_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CACHE_TTL_DAYS", "weekly")
    assert cache_manager.configured_cache_ttl_days() == 7
    monkeypatch.delenv("CACHE_TTL_DAYS")
    assert cache_manager.configured_cache_ttl_days() == 7
