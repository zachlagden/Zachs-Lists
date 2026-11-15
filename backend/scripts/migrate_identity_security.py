import argparse
import json
import os
from datetime import datetime, timezone
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database


def preflight(database: Database, root_id: int) -> dict[str, Any]:
    provider_ids = set()
    names = set()
    roots = 0
    checked = 0
    for row in database.users.find({}, {"github_id": 1, "username": 1}):
        provider_id = row.get("github_id")
        name = row.get("username")
        if (
            type(provider_id) is not int
            or provider_id <= 0
            or not isinstance(name, str)
            or not name
        ):
            raise ValueError("Account identity requires manual review")
        if provider_id in provider_ids or name.lower() in names:
            raise ValueError("Conflicting account identities require manual review")
        provider_ids.add(provider_id)
        names.add(name.lower())
        roots += provider_id == root_id
        checked += 1
    if roots != 1:
        raise ValueError(
            "Root provider identity must match exactly one existing account"
        )
    return {
        "accounts_checked": checked,
        "root_verified": True,
        "stored_tokens": database.users.count_documents(
            {"access_token": {"$exists": True}}
        ),
    }


def run(database: Database, root_id: int, apply: bool = False) -> dict[str, Any]:
    result = preflight(database, root_id)
    result["applied"] = apply
    if not apply:
        return result
    database.users.create_index("github_id", unique=True, name="github_identity_unique")
    database.users.create_index(
        "username", unique=True, name="public_list_username_unique"
    )
    root = database.users.find_one({"github_id": root_id}, {"_id": 1})
    if root is None:
        raise ValueError("Root account changed during migration")
    database.users.update_many(
        {"github_id": {"$ne": root_id}}, {"$set": {"is_root": False}}
    )
    database.users.update_one(
        {"_id": root["_id"], "github_id": root_id}, {"$set": {"is_root": True}}
    )
    removed = database.users.update_many(
        {"access_token": {"$exists": True}}, {"$unset": {"access_token": ""}}
    )
    database.security_migration_records.update_one(
        {"_id": "immutable-identity-v1"},
        {
            "$set": {
                "applied_at": datetime.now(timezone.utc),
                "root_account_id": root["_id"],
                "tokens_removed": removed.modified_count,
            }
        },
        upsert=True,
    )
    result["tokens_removed"] = removed.modified_count
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument(
        "--root-github-id", type=int, default=int(os.environ.get("ROOT_GITHUB_ID", "0"))
    )
    args = parser.parse_args()
    client: MongoClient[dict[str, Any]]
    with MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=5000) as client:
        print(
            json.dumps(
                run(client.get_default_database(), args.root_github_id, args.apply)
            )
        )
