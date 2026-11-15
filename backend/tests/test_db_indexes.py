import logging
from typing import Any

import mongomock
import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app import db_indexes
from app.db_indexes import INDEXES, ensure_indexes
from app.extensions import mongo

LIBRARY_INDEXES = {"url_1", "category_1", "category_1_recommended_-1_name_1"}


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Any:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    return db


def index_names(database: Any, collection: str) -> set[str]:
    return set(database[collection].index_information()) - {"_id_"}


def expected_names(collection: str) -> set[str]:
    return {spec.name for spec in INDEXES if spec.collection == collection}


def test_ensure_indexes_creates_every_named_index_and_is_repeatable(
    database: Any,
) -> None:
    ensure_indexes(database)
    ensure_indexes(database)

    assert index_names(database, "users") == {
        "github_identity_unique",
        "public_list_username_unique",
    }
    assert index_names(database, "jobs") == {
        "job_id_1",
        "status_1_priority_1_created_at_1",
        "user_id_1_created_at_-1",
        "user_id_1_status_1_completed_at_-1",
        "updated_at_1",
        "one_active_job_per_target",
    }
    assert index_names(database, "cache") == {"url_hash_1"}
    assert index_names(database, "workers") == {"worker_id_1"}
    assert index_names(database, "limit_requests") == {
        "user_id_1_status_1",
        "one_pending_request_per_user",
    }
    assert index_names(database, "validation_tokens") == {"expires_at_1", "user_id_1"}
    assert index_names(database, "blocklist_library") == LIBRARY_INDEXES


def test_index_keys_and_options(database: Any) -> None:
    ensure_indexes(database)

    users = database.users.index_information()
    assert users["github_identity_unique"]["key"] == [("github_id", 1)]
    assert users["github_identity_unique"]["unique"] is True
    assert users["public_list_username_unique"]["key"] == [("username", 1)]
    assert users["public_list_username_unique"]["unique"] is True

    jobs = database.jobs.index_information()
    assert jobs["job_id_1"]["unique"] is True
    assert jobs["status_1_priority_1_created_at_1"]["key"] == [
        ("status", 1),
        ("priority", 1),
        ("created_at", 1),
    ]
    assert jobs["user_id_1_created_at_-1"]["key"] == [
        ("user_id", 1),
        ("created_at", -1),
    ]
    assert jobs["user_id_1_status_1_completed_at_-1"]["key"] == [
        ("user_id", 1),
        ("status", 1),
        ("completed_at", -1),
    ]
    assert jobs["one_active_job_per_target"]["key"] == [("target_id", 1)]
    assert jobs["one_active_job_per_target"]["unique"] is True
    assert jobs["one_active_job_per_target"]["partialFilterExpression"] == {
        "status": {"$in": ["queued", "processing"]}
    }
    assert "unique" not in jobs["updated_at_1"]
    assert "expireAfterSeconds" not in jobs["updated_at_1"]

    assert database.cache.index_information()["url_hash_1"]["unique"] is True
    assert database.workers.index_information()["worker_id_1"]["unique"] is True

    tokens = database.validation_tokens.index_information()
    assert tokens["expires_at_1"]["key"] == [("expires_at", 1)]
    assert tokens["expires_at_1"]["expireAfterSeconds"] == 0
    assert "expireAfterSeconds" not in tokens["user_id_1"]


def test_index_names_are_unique_per_collection() -> None:
    names = [(spec.collection, spec.name) for spec in INDEXES]
    assert len(names) == len(set(names))


def test_failing_index_is_logged_and_does_not_stop_the_rest(
    database: Any, caplog: pytest.LogCaptureFixture
) -> None:
    database.jobs.insert_many(
        [
            {"job_id": "duplicate", "target_id": "000000000000000000000001"},
            {"job_id": "duplicate", "target_id": "000000000000000000000002"},
        ]
    )

    with caplog.at_level(logging.ERROR, logger=db_indexes.__name__):
        ensure_indexes(database)

    failures = [record for record in caplog.records if record.exc_info]
    assert len(failures) == 1
    assert "job_id_1" in failures[0].getMessage()
    assert index_names(database, "jobs") == expected_names("jobs") - {"job_id_1"}
    for collection in ("users", "cache", "workers", "validation_tokens"):
        assert index_names(database, collection) == expected_names(collection)
    assert index_names(database, "blocklist_library") == LIBRARY_INDEXES


def test_failing_library_index_is_logged(
    database: Any, caplog: pytest.LogCaptureFixture
) -> None:
    database.blocklist_library.insert_many(
        [{"url": "https://example.com/list"}, {"url": "https://example.com/list"}]
    )

    with caplog.at_level(logging.ERROR, logger=db_indexes.__name__):
        ensure_indexes(database)

    failures = [record for record in caplog.records if record.exc_info]
    assert len(failures) == 1
    assert "blocklist_library" in failures[0].getMessage()
    assert index_names(database, "jobs") == expected_names("jobs")


def test_unreachable_database_stops_after_the_first_attempt(
    caplog: pytest.LogCaptureFixture,
) -> None:
    attempts: list[str] = []

    class UnreachableCollection:
        def create_index(self, keys: Any, **options: Any) -> str:
            attempts.append(options["name"])
            raise ServerSelectionTimeoutError("no servers available")

    class UnreachableDatabase:
        def __getitem__(self, name: str) -> UnreachableCollection:
            return UnreachableCollection()

    unreachable: Any = UnreachableDatabase()
    with caplog.at_level(logging.ERROR, logger=db_indexes.__name__):
        ensure_indexes(unreachable)

    assert attempts == [INDEXES[0].name]
    assert len([record for record in caplog.records if record.exc_info]) == 1


def test_analytics_indexes_cover_scoped_reads_and_retention(database: Any) -> None:
    ensure_indexes(database)

    days = database.analytics.index_information()
    assert set(days) - {"_id_"} == {"analytics_scope_date", "analytics_retention"}
    assert days["analytics_scope_date"]["key"] == [
        ("list_type", 1),
        ("username", 1),
        ("list_name", 1),
        ("date", 1),
    ]
    assert days["analytics_retention"]["key"] == [("date", 1)]
    assert days["analytics_retention"]["expireAfterSeconds"] == 90 * 24 * 60 * 60

    visitors = database.analytics_visitors.index_information()
    assert set(visitors) - {"_id_"} == {
        "analytics_visitor_scope_date",
        "analytics_visitor_retention",
    }
    assert visitors["analytics_visitor_scope_date"]["key"][-2:] == [
        ("date", 1),
        ("visitor", 1),
    ]
    assert visitors["analytics_visitor_retention"]["expireAfterSeconds"] == (
        90 * 24 * 60 * 60
    )
