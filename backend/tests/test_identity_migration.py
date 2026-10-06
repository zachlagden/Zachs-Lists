import importlib.util
from pathlib import Path
from typing import Any

import mongomock
import pytest

path = Path(__file__).resolve().parents[1] / "scripts/migrate_identity_security.py"
spec = importlib.util.spec_from_file_location("identity_migration", path)
assert spec is not None and spec.loader is not None
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def test_identity_migration_is_verified_and_idempotent() -> None:
    database: Any = mongomock.MongoClient().default
    database.users.insert_many(
        [
            {"github_id": 1001, "username": "sam", "access_token": "example-token"},
            {"github_id": 1002, "username": "alex"},
        ]
    )
    result = migration.run(database, 1001)
    assert result["stored_tokens"] == 1 and not result["applied"]
    assert database.users.count_documents({"access_token": {"$exists": True}}) == 1
    migration.run(database, 1001, apply=True)
    assert database.users.count_documents({"access_token": {"$exists": True}}) == 0
    assert database.users.find_one({"github_id": 1001})["is_root"]
    assert not database.users.find_one({"github_id": 1002})["is_root"]
    assert migration.run(database, 1001, apply=True)["tokens_removed"] == 0


def test_ambiguous_identity_stops_before_changes() -> None:
    database: Any = mongomock.MongoClient().default
    database.users.insert_many(
        [
            {"github_id": 1001, "username": "sam"},
            {"github_id": 1001, "username": "alex"},
        ]
    )
    with pytest.raises(ValueError):
        migration.run(database, 1001, apply=True)
    assert database.security_migration_records.count_documents({}) == 0
