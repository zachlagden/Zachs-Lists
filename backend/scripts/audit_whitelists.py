import argparse
import json
import os
from collections import Counter
from collections.abc import Callable
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database

from app.utils.validators import WhitelistValidationUnavailable, run_whitelist_validator

DEFAULT_ACCOUNT = "__default__"
Validator = Callable[[bytes], dict[str, Any]]


def saved_whitelists(database: Database[Any]) -> list[tuple[str, Any]]:
    whitelists = [
        (str(user["_id"]), user.get("config", {}).get("whitelist"))
        for user in database.users.find({}, {"config.whitelist": 1})
    ]
    default = database.system_config.find_one(
        {"_id": "default_config"}, {"whitelist": 1}
    )
    if default is not None:
        whitelists.append((DEFAULT_ACCOUNT, default.get("whitelist")))
    return whitelists


def run(database: Database[Any], validate: Validator) -> dict[str, Any]:
    accounts = []
    failures = []
    totals: Counter[str] = Counter()
    checked = 0
    for account, whitelist in saved_whitelists(database):
        if not whitelist:
            continue
        checked += 1
        if not isinstance(whitelist, str):
            failures.append({"user_id": account, "reason": "whitelist is not text"})
            continue
        try:
            report = validate(whitelist.encode("utf-8"))
        except UnicodeEncodeError:
            failures.append({"user_id": account, "reason": "whitelist is not UTF-8"})
            continue
        except WhitelistValidationUnavailable as error:
            failures.append({"user_id": account, "reason": str(error)})
            continue
        if report["valid"]:
            continue
        bad_lines = dict(sorted(report["error_counts"].items()))
        totals.update(bad_lines)
        accounts.append({"user_id": account, "bad_lines": bad_lines})
    return {
        "whitelists_checked": checked,
        "whitelists_with_problems": len(accounts),
        "whitelists_not_validated": len(failures),
        "bad_lines": dict(sorted(totals.items())),
        "accounts": accounts,
        "failures": failures,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("worker_bin")
    args = parser.parse_args()
    client: MongoClient[dict[str, Any]]
    with MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=5000) as client:
        summary = run(
            client.get_default_database(),
            lambda whitelist: run_whitelist_validator(whitelist, args.worker_bin),
        )
    print(json.dumps(summary, indent=2))
