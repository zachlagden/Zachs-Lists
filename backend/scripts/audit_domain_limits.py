import argparse
import gzip
import json
import os
import re
from collections import Counter
from collections.abc import Mapping
from datetime import datetime
from pathlib import Path
from typing import Any

from pymongo import MongoClient
from pymongo.database import Database

from app.config import Config
from app.models.user import User
from app.services.limit_review import (
    COMBINED_LIST,
    METHOD_EXACT,
    METHOD_STORED,
    REASON_AUDIT_WITHIN_LIMIT,
    RESOLVED_BY_AUDIT,
    effective_max_domains,
    flag_over_limit,
    stored_usage,
)

SAFE_IDENTIFIER = re.compile(r"[A-Za-z0-9_-]+")
PLAIN_SUFFIX = "_plain.txt.gz"
MANIFEST_NAME = "manifest.json"
GENERATION_FIELD = "published_generation"
VERDICT_OVER = "over"
VERDICT_WITHIN = "within"
VERDICT_UNCERTAIN = "uncertain"


class MeasurementError(Exception):
    pass


def published_generation(user_row: Mapping[str, Any]) -> str | None:
    generation = user_row.get(GENERATION_FIELD)
    if isinstance(generation, Mapping):
        generation = generation.get("id")
    return generation if isinstance(generation, str) and generation else None


def published_output_dir(
    users_dir: Path, username: str, generation_id: str | None
) -> Path:
    if not SAFE_IDENTIFIER.fullmatch(username):
        raise MeasurementError("username is not a safe directory name")
    output_dir = users_dir / username / "output"
    if generation_id is None:
        return output_dir
    if not SAFE_IDENTIFIER.fullmatch(generation_id):
        raise MeasurementError("generation id is not a safe directory name")
    generation_dir = output_dir / "generations" / generation_id
    if not (generation_dir / MANIFEST_NAME).is_file():
        raise MeasurementError("published generation has no manifest")
    return generation_dir


def category_plain_files(output_dir: Path) -> list[Path]:
    if not output_dir.is_dir():
        raise MeasurementError("output directory is missing")
    files = sorted(
        path
        for path in output_dir.glob(f"*{PLAIN_SUFFIX}")
        if path.is_file() and path.name != f"{COMBINED_LIST}{PLAIN_SUFFIX}"
    )
    if not files:
        raise MeasurementError("no category files are published")
    return files


def count_unique_domains(paths: list[Path]) -> int:
    domains: set[bytes] = set()
    for path in paths:
        try:
            with gzip.open(path, "rb") as lines:
                for raw in lines:
                    line = raw.strip()
                    if line and not line.startswith(b"#"):
                        domains.add(line.lower())
        except (OSError, EOFError):
            raise MeasurementError("a category file could not be read") from None
    return len(domains)


def exact_domain_count(users_dir: Path, user_row: Mapping[str, Any]) -> int:
    username = user_row.get("username")
    if not isinstance(username, str):
        raise MeasurementError("username is missing")
    output_dir = published_output_dir(
        users_dir, username, published_generation(user_row)
    )
    return count_unique_domains(category_plain_files(output_dir))


def verdict(domains: int, at_least: int, max_domains: int) -> str:
    if at_least > max_domains:
        return VERDICT_OVER
    if domains <= max_domains:
        return VERDICT_WITHIN
    return VERDICT_UNCERTAIN


def has_open_review(user_row: Mapping[str, Any]) -> bool:
    review = user_row.get("limit_review")
    return (
        isinstance(review, Mapping) and review.get("status") == User.LIMIT_REVIEW_OPEN
    )


def keeps_better_measurement(user_row: Mapping[str, Any], method: str) -> bool:
    return (
        method == METHOD_STORED
        and has_open_review(user_row)
        and user_row["limit_review"].get("method") != METHOD_STORED
    )


def run(
    database: Database[Any],
    apply: bool,
    default_max_domains: int,
    root_github_id: int | None,
    users_dir: Path | None = None,
    enforcing: bool = False,
) -> dict[str, Any]:
    method = METHOD_EXACT if users_dir is not None else METHOD_STORED
    totals: Counter[str] = Counter(
        users_with_lists=0,
        measured=0,
        exempt=0,
        not_measured=0,
        over_limit=0,
        needs_exact_measurement=0,
        open_reviews_now_within_limit=0,
        reviews_opened=0,
        reviews_refreshed=0,
        reviews_resolved=0,
        notifications_sent=0,
    )
    over_limit: list[dict[str, Any]] = []
    needs_exact: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    projection = {
        "username": 1,
        "github_id": 1,
        "is_admin": 1,
        "limits": 1,
        "lists": 1,
        "limit_review": 1,
        GENERATION_FIELD: 1,
    }
    published = list(database.users.find({"lists.0": {"$exists": True}}, projection))
    for user_row in published:
        totals["users_with_lists"] += 1
        user_id = str(user_row["_id"])
        max_domains = effective_max_domains(
            user_row, default_max_domains, root_github_id
        )
        if max_domains is None:
            totals["exempt"] += 1
            continue

        if users_dir is not None:
            try:
                domains = exact_domain_count(users_dir, user_row)
            except MeasurementError as error:
                failures.append({"user_id": user_id, "reason": str(error)})
                totals["not_measured"] += 1
                continue
            at_least = domains
        else:
            usage = stored_usage(database, user_row)
            if usage is None:
                totals["not_measured"] += 1
                continue
            domains, at_least = usage.domains, usage.at_least
        totals["measured"] += 1

        account = {
            "user_id": user_id,
            "username": user_row.get("username"),
            "max_domains": max_domains,
            "actual_domains": domains,
            "over_by": domains - max_domains,
            "method": method,
            "upper_bound": domains != at_least,
            "has_open_review": has_open_review(user_row),
        }
        outcome = verdict(domains, at_least, max_domains)
        if outcome == VERDICT_UNCERTAIN:
            totals["needs_exact_measurement"] += 1
            needs_exact.append({**account, "at_least": at_least})
            continue
        if outcome == VERDICT_WITHIN:
            if not has_open_review(user_row):
                continue
            totals["open_reviews_now_within_limit"] += 1
            if apply and User.resolve_limit_review(
                user_row["_id"],
                RESOLVED_BY_AUDIT,
                REASON_AUDIT_WITHIN_LIMIT,
                datetime.utcnow(),
                users=database.users,
            ):
                totals["reviews_resolved"] += 1
            continue

        totals["over_limit"] += 1
        over_limit.append(account)
        if not apply or keeps_better_measurement(user_row, method):
            continue
        change = flag_over_limit(
            database.users,
            user_row["_id"],
            domains,
            max_domains,
            method,
            datetime.utcnow(),
            enforcing,
        )
        totals["reviews_opened"] += change.opened
        totals["reviews_refreshed"] += change.refreshed
        totals["notifications_sent"] += change.notified

    return {
        "applied": apply,
        "method": method,
        "totals": dict(totals),
        "over_limit": sorted(over_limit, key=lambda account: -account["over_by"]),
        "needs_exact_measurement": needs_exact,
        "failures": failures,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--exact", action="store_true")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument(
        "--root-github-id", type=int, default=int(os.environ.get("ROOT_GITHUB_ID", "0"))
    )
    args = parser.parse_args()
    if args.exact and args.data_dir is None:
        parser.error("--exact needs --data-dir")
    if args.data_dir is not None and not args.exact:
        parser.error("--data-dir is only read with --exact")
    client: MongoClient[dict[str, Any]]
    with MongoClient(os.environ["MONGO_URI"], serverSelectionTimeoutMS=5000) as client:
        summary = run(
            client.get_default_database(),
            args.apply,
            Config.DEFAULT_MAX_DOMAINS,
            args.root_github_id,
            args.data_dir / "users" if args.exact else None,
            Config.ENFORCE_DOMAIN_LIMIT,
        )
    print(json.dumps(summary, indent=2))
