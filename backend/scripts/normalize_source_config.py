import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database

from app.utils.validators import validate_config_syntax

MIGRATION = "source-config-three-fields-v1"


def normalize(content: str) -> str:
    lines = []
    for raw in content.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        ending = raw[len(line) :]
        if not line.strip().startswith("#") and len(line.split("|")) == 4:
            line = "|".join(line.split("|")[:3])
        lines.append(line + ending)
    return "".join(lines)


def run(database: Database, apply: bool = False) -> dict[str, Any]:
    targets = []
    for user in database.users.find({}, {"config.blocklists": 1}):
        content = user.get("config", {}).get("blocklists", "")
        if content:
            targets.append((database.users, user["_id"], "config.blocklists", content))
    default = database.system_config.find_one({"_id": "default_config"})
    if default:
        targets.append(
            (
                database.system_config,
                default["_id"],
                "blocklists",
                default.get("blocklists", ""),
            )
        )
    changes = []
    for collection, identifier, field, content in targets:
        normalized = normalize(content)
        if validate_config_syntax(normalized, 1000).has_errors:
            raise ValueError("Configuration requires manual review; migration stopped")
        if normalized != content:
            changes.append((collection, identifier, field, content, normalized))
    for collection, identifier, field, content, normalized in changes if apply else []:
        record_id = f"{MIGRATION}:{collection.name}:{identifier}"
        digest = hashlib.sha256(content.encode()).hexdigest()
        database.security_migration_records.update_one(
            {"_id": record_id},
            {
                "$setOnInsert": {
                    "migration": MIGRATION,
                    "collection": collection.name,
                    "target_id": identifier,
                    "field": field,
                    "original": content,
                    "normalized": normalized,
                    "original_hash": digest,
                    "created_at": datetime.now(timezone.utc),
                }
            },
            upsert=True,
        )
        archived = database.security_migration_records.find_one({"_id": record_id})
        if archived is None or archived.get("original_hash") != digest:
            raise ValueError("Migration record conflicts with current data; stopped")
        update: dict[str, Any] = {"$set": {field: normalized}}
        if collection.name == "users":
            update["$inc"] = {"config.revision": 1}
        result = collection.update_one({"_id": identifier, field: content}, update)
        if result.matched_count != 1:
            raise ValueError("Configuration changed during migration; stopped")
        database.security_migration_records.update_one(
            {"_id": record_id}, {"$set": {"applied_at": datetime.now(timezone.utc)}}
        )
    return {
        "migration": MIGRATION,
        "configs_checked": len(targets),
        "configs_changed": len(changes),
        "applied": apply,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    client: MongoClient[dict[str, Any]]
    with MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=5000) as client:
        print(json.dumps(run(client.get_default_database(), args.apply)))
