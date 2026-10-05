import importlib.util
from pathlib import Path
from typing import Any

import mongomock
import pytest

path = Path(__file__).resolve().parents[1] / "scripts/normalize_source_config.py"
spec = importlib.util.spec_from_file_location("source_migration", path)
assert spec is not None and spec.loader is not None
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def test_archives_original_and_updates_conditionally() -> None:
    database: Any = mongomock.MongoClient().default
    original = "# Example comment\r\nhttps://example.com/one|First|tracking|legacy\r\n"
    database.users.insert_one(
        {"_id": "example-user", "config": {"blocklists": original}}
    )
    assert migration.run(database)["configs_changed"] == 1
    assert database.users.find_one()["config"]["blocklists"] == original
    assert migration.run(database, apply=True)["configs_changed"] == 1
    assert database.security_migration_records.find_one()["original"] == original
    updated = database.users.find_one()["config"]
    assert updated["revision"] == 1
    assert updated["blocklists"].endswith("|tracking\r\n")
    assert migration.run(database, apply=True)["configs_changed"] == 0


def test_preflight_failure_does_not_partially_apply() -> None:
    database: Any = mongomock.MongoClient().default
    valid_legacy = "https://example.com/one|First|tracking|legacy"
    database.users.insert_many(
        [
            {"_id": "example-one", "config": {"blocklists": valid_legacy}},
            {
                "_id": "example-two",
                "config": {"blocklists": "http://127.0.0.1/private"},
            },
        ]
    )
    with pytest.raises(ValueError):
        migration.run(database, apply=True)
    assert database.security_migration_records.count_documents({}) == 0
    assert (
        database.users.find_one({"_id": "example-one"})["config"]["blocklists"]
        == valid_legacy
    )
