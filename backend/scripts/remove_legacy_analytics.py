import argparse
import json
import os
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database

from app.models.analytics import Analytics

LEGACY_FILTER: dict[str, Any] = {"schema_version": {"$ne": Analytics.SCHEMA_VERSION}}


def run(database: Database, apply: bool = False) -> dict[str, Any]:
    collection = database[Analytics.COLLECTION]
    legacy = collection.count_documents(LEGACY_FILTER)
    current = collection.count_documents({"schema_version": Analytics.SCHEMA_VERSION})
    oldest = collection.find_one(LEGACY_FILTER, {"date": 1}, sort=[("date", 1)])
    newest = collection.find_one(LEGACY_FILTER, {"date": 1}, sort=[("date", -1)])
    deleted = collection.delete_many(LEGACY_FILTER).deleted_count if apply else 0
    return {
        "legacy_documents": legacy,
        "current_documents": current,
        "oldest_legacy_date": str(oldest.get("date")) if oldest else None,
        "newest_legacy_date": str(newest.get("date")) if newest else None,
        "deleted": deleted,
        "applied": apply,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    client: MongoClient[dict[str, Any]]
    with MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=5000) as client:
        print(json.dumps(run(client.get_default_database(), args.apply)))
