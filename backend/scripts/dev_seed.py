"""
Seed a throwaway local MongoDB and data directory with fictional accounts,
builds and published lists, then print a session cookie for each account.

Usage:
  FLASK_ENV=development PYTHONPATH=backend \
    uv run --no-project python backend/scripts/dev_seed.py
  FLASK_ENV=development PYTHONPATH=backend \
    uv run --no-project python backend/scripts/dev_seed.py --cookies-only

MONGO_URI defaults to mongodb://127.0.0.1:27030/zachs_lists_dev and DATA_DIR
to zl-dev-data in the system temporary directory. Every run drops the database
and rebuilds the data directory, unless --cookies-only is given.
"""

import argparse
import copy
import gzip
import hashlib
import json
import logging
import os
import random
import shutil
import sys
import tempfile
import uuid
from collections import deque
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from bson import ObjectId
from pymongo import MongoClient
from pymongo.database import Database
from pymongo.errors import PyMongoError
from pymongo.uri_parser import parse_uri

if TYPE_CHECKING:
    from flask import Flask

    from app.models.user import User

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
DEFAULT_MONGO_URI = "mongodb://127.0.0.1:27030/zachs_lists_dev"
DEFAULT_DATA_DIR = os.path.join(tempfile.gettempdir(), "zl-dev-data")
DATA_DIR_MARKER = ".zl-dev-seed"
SEEDED_DIRECTORIES = ("users", "default")

DEV_WORKER_PREFIX = "dev-"
SEED_WORKER_ID = "dev-seed-worker"
DEFAULT_TARGET_ID = "__default__"
DEFAULT_BUILD_DOCUMENT_ID = "default_build"

FORMATS = ("hosts", "plain", "adblock")
COMBINED_LIST = "all_domains"
UNCATEGORISED_LIST = "uncategorized"
CATEGORY_LEFT_OUT_OF_COMBINED_LIST = "nsfw"
GENERATIONS_DIR = "generations"
MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1
SAMPLE_DOMAINS_PER_LIST = 150

DOWNLOADED = "downloaded"
CACHED = "cached"
STALE = "stale"
FAILED = "failed"
CONCURRENT_DOWNLOADS = 3
BYTES_PER_DOMAIN = 26
DOWNLOAD_STEPS = {DOWNLOADED: 3, CACHED: 1, STALE: 2, FAILED: 3}
DOWNLOAD_TIME_MS = {DOWNLOADED: 1840, CACHED: 85, STALE: 2150, FAILED: 60000}
STALE_SOURCE_WARNING = (
    "Stale source: upstream check failed (Source returned HTTP 503 Service "
    "Unavailable); using a verified cache body checked within 8 days"
)
FAILED_SOURCE_ERROR = (
    "Source check failed (Source request timed out); no verified cache body "
    "checked within 8 days is available"
)
UNCHANGED_SKIP_REASON = "Nothing changed since the last build"
SUPERSEDED_SKIP_REASON = (
    "A newer build has already published these lists, so this build was not published"
)
ALL_SOURCES_FAILED_CODE = "all_sources_failed"
ALL_SOURCES_FAILED_MESSAGE = "All source downloads failed"
DOMAIN_LIMIT_EXCEEDED_CODE = "domain_limit_exceeded"

STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"
TYPE_MANUAL = "manual"
TYPE_SCHEDULED = "scheduled"
PRIORITY_HIGH = 1
PRIORITY_NORMAL = 2
PRIORITY_LOW = 3

ANALYTICS_DAYS = 30
MID_DOWNLOAD_TICKS = 6
RANDOM_SEED = 20260101


class Refusal(Exception):
    pass


@dataclass(frozen=True)
class DevEnvironment:
    mongo_uri: str
    database_name: str
    data_dir: Path


@dataclass(frozen=True)
class SeedSource:
    name: str
    url: str
    category: str
    domains: int
    outcome: str = DOWNLOADED
    change: int | None = 0


@dataclass(frozen=True)
class LibrarySource:
    name: str
    title: str
    path: str
    category: str
    domains: int
    description: str
    recommended: bool
    aggressiveness: int

    @property
    def url(self) -> str:
        return f"https://lists.example.org/{self.path}"

    def source(self, outcome: str = DOWNLOADED, change: int | None = 0) -> SeedSource:
        return SeedSource(
            self.name, self.url, self.category, self.domains, outcome, change
        )


@dataclass(frozen=True)
class BuildNumbers:
    categories: dict[str, int]
    combined: int
    extracted: int
    removed: int
    downloaded: int

    @property
    def lists(self) -> dict[str, int]:
        if not self.categories:
            return {}
        return {**self.categories, COMBINED_LIST: self.combined}

    @property
    def measured(self) -> int:
        return self.combined + self.categories.get(
            CATEGORY_LEFT_OUT_OF_COMBINED_LIST, 0
        )


@dataclass(frozen=True)
class Target:
    target_id: str
    user_id: ObjectId | None
    username: str
    output_dir: Path

    @property
    def is_default(self) -> bool:
        return self.target_id == DEFAULT_TARGET_ID

    @property
    def collection(self) -> str:
        return "system_config" if self.is_default else "users"

    @property
    def filter(self) -> dict[str, Any]:
        if self.is_default:
            return {"_id": DEFAULT_BUILD_DOCUMENT_ID}
        return {"_id": self.user_id, "username": self.username}


@dataclass(frozen=True)
class Account:
    username: str
    name: str
    github_id: int
    is_admin: bool
    joined_days_ago: int
    sources: tuple[SeedSource, ...]
    whitelist: str

    @property
    def email(self) -> str:
        return f"{self.username}@example.com"


class Clock:
    def __init__(self, moment: datetime) -> None:
        self.moment = moment

    def __call__(self) -> datetime:
        return self.moment

    def advance(self, seconds: float) -> datetime:
        self.moment += timedelta(seconds=seconds)
        return self.moment


LIBRARY = (
    LibrarySource(
        "acme_everything",
        "Acme Everything",
        "combined/everything.txt",
        "comprehensive",
        2_104_880,
        "A broad list that covers adverts, trackers and known bad hosts.",
        True,
        3,
    ),
    LibrarySource(
        "acme_ads_basic",
        "Acme Ads Basic",
        "ads/basic.txt",
        "advertising",
        412_380,
        "The most common advertising hosts, with few false positives.",
        True,
        1,
    ),
    LibrarySource(
        "acme_ads_extended",
        "Acme Ads Extended",
        "ads/extended.txt",
        "advertising",
        1_950_112,
        "A larger advertising list that also blocks sponsored content hosts.",
        False,
        4,
    ),
    LibrarySource(
        "acme_trackers",
        "Acme Trackers",
        "tracking/trackers.txt",
        "tracking",
        884_907,
        "Analytics and cross-site tracking hosts.",
        True,
        2,
    ),
    LibrarySource(
        "acme_telemetry",
        "Acme Telemetry",
        "tracking/telemetry.txt",
        "tracking",
        240_316,
        "Telemetry endpoints used by desktop and mobile apps.",
        False,
        3,
    ),
    LibrarySource(
        "sample_malware",
        "Sample Malware Hosts",
        "security/malware.txt",
        "malicious",
        1_204_556,
        "Hosts that are known to serve malware.",
        True,
        2,
    ),
    LibrarySource(
        "sample_phishing",
        "Sample Phishing Hosts",
        "security/phishing.txt",
        "malicious",
        760_431,
        "Hosts used in phishing campaigns.",
        True,
        2,
    ),
    LibrarySource(
        "sample_suspicious",
        "Sample Suspicious Hosts",
        "security/suspicious.txt",
        "suspicious",
        1_310_774,
        "Newly registered and low-reputation hosts.",
        False,
        4,
    ),
    LibrarySource(
        "sample_annoyances",
        "Sample Annoyances",
        "annoyances/popups.txt",
        "suspicious",
        96_204,
        "Pop-up, survey and fake download hosts.",
        False,
        5,
    ),
    LibrarySource(
        "sample_adult",
        "Sample Adult Content",
        "adult/adult.txt",
        "nsfw",
        312_650,
        "Adult content hosts. This category stays out of the combined list.",
        False,
        3,
    ),
)
CATALOGUE = {entry.name: entry for entry in LIBRARY}

ALEX_WHITELIST = """# Sites that must keep working
login.example.com
status.example.net
@@acme-payments.example
@@intranet.example.org
*.assets.example.org
*.cdn.example.net
/^metrics[0-9]+\\.example\\.com$/
"""
SAM_WHITELIST = """updates.example.com
@@acme-support.example
"""
JO_WHITELIST = """school.example.org
*.video.example.net
"""
DEFAULT_WHITELIST = """# Hosts the default lists never block
login.example.com
@@acme-payments.example
*.assets.example.org
"""

ALEX = Account(
    username="alex",
    name="Alex Example",
    github_id=1000001,
    is_admin=False,
    joined_days_ago=90,
    sources=(
        CATALOGUE["acme_ads_basic"].source(CACHED),
        CATALOGUE["acme_ads_extended"].source(DOWNLOADED, 3_204),
        CATALOGUE["acme_trackers"].source(STALE),
        CATALOGUE["acme_telemetry"].source(FAILED, None),
        CATALOGUE["sample_malware"].source(DOWNLOADED, 1_120),
        CATALOGUE["sample_phishing"].source(DOWNLOADED, 87),
        CATALOGUE["sample_suspicious"].source(DOWNLOADED, -412),
        CATALOGUE["sample_adult"].source(CACHED),
    ),
    whitelist=ALEX_WHITELIST,
)
SAM = Account(
    username="sam",
    name="Sam Example",
    github_id=1000002,
    is_admin=True,
    joined_days_ago=200,
    sources=(
        CATALOGUE["acme_everything"].source(DOWNLOADED, 2_310),
        CATALOGUE["acme_ads_basic"].source(CACHED),
        CATALOGUE["sample_malware"].source(DOWNLOADED, 1_120),
    ),
    whitelist=SAM_WHITELIST,
)
JO = Account(
    username="jo",
    name="Jo Example",
    github_id=1000003,
    is_admin=False,
    joined_days_ago=45,
    sources=(
        CATALOGUE["acme_everything"].source(DOWNLOADED, 2_310),
        CATALOGUE["acme_ads_extended"].source(DOWNLOADED, 3_204),
        CATALOGUE["acme_trackers"].source(CACHED),
        CATALOGUE["sample_suspicious"].source(DOWNLOADED, -412),
        CATALOGUE["sample_adult"].source(CACHED),
    ),
    whitelist=JO_WHITELIST,
)
ACCOUNTS = (ALEX, SAM, JO)
MEMBER_NAMES = (
    "avery",
    "blake",
    "casey",
    "dana",
    "eden",
    "finley",
    "gray",
    "harper",
    "indigo",
    "jules",
    "kai",
    "logan",
    "morgan",
    "noel",
    "oakley",
    "parker",
    "quinn",
    "riley",
    "sage",
    "taylor",
    "umber",
    "val",
    "wren",
    "xen",
    "yael",
    "zion",
    "ash",
    "bryn",
    "cleo",
    "drew",
)
MEMBER_FIRST_GITHUB_ID = 1000100
DISABLED_MEMBER = "casey"
BANNED_MEMBER = "dana"
SECOND_ADMIN = "robin"
DEFAULT_SOURCES = (
    CATALOGUE["acme_everything"].source(DOWNLOADED, 2_310),
    CATALOGUE["acme_ads_basic"].source(CACHED),
    CATALOGUE["acme_trackers"].source(DOWNLOADED, 640),
    CATALOGUE["sample_malware"].source(DOWNLOADED, 1_120),
    CATALOGUE["sample_phishing"].source(DOWNLOADED, 87),
    CATALOGUE["sample_adult"].source(CACHED),
)
ALEX_FIRST_CONFIG = ("acme_ads_extended", "sample_adult")


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def stamp(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds") + "Z"


def require_dev_environment() -> DevEnvironment:
    if os.environ.get("FLASK_ENV") != "development":
        raise Refusal("Refusing to run: FLASK_ENV must be set to development.")
    mongo_uri = os.environ.get("MONGO_URI") or DEFAULT_MONGO_URI
    if not mongo_uri.startswith("mongodb://"):
        raise Refusal("Refusing to run: MONGO_URI must be a mongodb:// URI.")
    try:
        parsed = parse_uri(mongo_uri)
    except PyMongoError as error:
        raise Refusal(f"Refusing to run: MONGO_URI is not valid ({error}).") from error
    hosts = [str(host) for host, _ in parsed["nodelist"]]
    remote = [host for host in hosts if host not in LOCAL_HOSTS]
    if remote or not hosts:
        raise Refusal(
            "Refusing to run: MONGO_URI must point at localhost, 127.0.0.1 or ::1, "
            f"not {', '.join(remote) or 'an empty host list'}."
        )
    if not parsed["database"]:
        raise Refusal("Refusing to run: MONGO_URI must name a database.")
    data_dir = Path(os.environ.get("DATA_DIR") or DEFAULT_DATA_DIR).resolve()
    os.environ["MONGO_URI"] = mongo_uri
    os.environ["DATA_DIR"] = str(data_dir)
    return DevEnvironment(mongo_uri, parsed["database"], data_dir)


def create_dev_app() -> "Flask":
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("app").setLevel(logging.WARNING)
    from app import create_app
    from app.extensions import scheduler

    app = create_app("development")
    scheduler.shutdown(wait=False)
    return app


def source_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()


def config_text(sources: Sequence[SeedSource]) -> str:
    return "".join(
        f"{source.url}|{source.name}|{source.category}\n" for source in sources
    )


def inputs_digest(blocklists: str, whitelist: str) -> str:
    return hashlib.sha256(f"{blocklists}\n--\n{whitelist}".encode()).hexdigest()


def healthy(sources: Sequence[SeedSource]) -> tuple[SeedSource, ...]:
    recovered = {FAILED: DOWNLOADED, STALE: CACHED}
    return tuple(
        replace(
            source,
            outcome=recovered.get(source.outcome, source.outcome),
            change=source.change or 0,
        )
        for source in sources
    )


def first_build(sources: Sequence[SeedSource]) -> tuple[SeedSource, ...]:
    return tuple(replace(source, outcome=DOWNLOADED, change=None) for source in sources)


def whitelist_matches(whitelist: str) -> list[dict[str, Any]]:
    matches = []
    for raw in whitelist.splitlines():
        pattern = raw.split("#", 1)[0].strip()
        if not pattern:
            continue
        weight = int(source_id(pattern)[:6], 16)
        if pattern.startswith("/"):
            kind, count, base = "regex", 2 + weight % 19, "example.com"
        elif pattern.startswith("@@"):
            kind, count, base = "subdomain", 3 + weight % 38, pattern[2:]
        elif "*" in pattern:
            kind, count, base = "wildcard", 10 + weight % 290, pattern.lstrip("*.")
        else:
            kind, count, base = "exact", 1, pattern
        if kind == "exact":
            samples = [base]
        elif kind == "regex":
            samples = [f"metrics{number}.{base}" for number in (1, 2, 3)]
        else:
            samples = [f"{label}.{base}" for label in ("a", "img", "static")]
        matches.append(
            {
                "pattern": pattern,
                "pattern_type": kind,
                "match_count": count,
                "samples": samples,
            }
        )
    return matches


def build_numbers(sources: Sequence[SeedSource], removed: int) -> BuildNumbers:
    usable = [source for source in sources if source.outcome != FAILED]
    before: dict[str, int] = {}
    for source in usable:
        category = source.category or UNCATEGORISED_LIST
        before[category] = before.get(category, 0) + source.domains * 97 // 100
    extracted = sum(before.values())
    if not extracted:
        return BuildNumbers({}, 0, 0, 0, 0)
    removed = min(removed, extracted // 100)
    shares = {name: removed * count // extracted for name, count in before.items()}
    largest = max(before, key=lambda name: before[name])
    shares[largest] += removed - sum(shares.values())
    categories = {name: before[name] - shares[name] for name in sorted(before)}
    in_combined = sum(
        count
        for name, count in categories.items()
        if name != CATEGORY_LEFT_OUT_OF_COMBINED_LIST
    )
    return BuildNumbers(
        categories=categories,
        combined=in_combined * 985 // 1000,
        extracted=extracted,
        removed=removed,
        downloaded=sum(source.domains for source in usable),
    )


def over_limit_text(actual_domains: int, max_domains: int, enforced: bool) -> str:
    over = (
        f"These lists have {actual_domains:,} domains across all categories, "
        f"which is over the limit of {max_domains:,}"
    )
    if enforced:
        return (
            f"{over}, so nothing was published and the previously published "
            "lists remain in place."
        )
    return f"{over}, and builds over the limit will fail once the limit is enforced."


def empty_result() -> dict[str, Any]:
    return {
        "sources_processed": 0,
        "sources_failed": 0,
        "sources_stale": 0,
        "total_domains": 0,
        "unique_domains": 0,
        "whitelisted_removed": 0,
        "output_files": [],
        "categories": {},
        "errors": [],
        "warnings": [],
        "error_code": None,
        "skip_reason": None,
        "generation_id": None,
        "limit": None,
    }


def failure_result(
    error_code: str, error: str, limit: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    return {
        **empty_result(),
        "errors": [error],
        "error_code": error_code,
        "limit": dict(limit) if limit is not None else None,
    }


def skipped_result(reason: str) -> dict[str, Any]:
    return {**empty_result(), "skip_reason": reason}


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


def pending_source(source: SeedSource) -> dict[str, Any]:
    return {
        "id": source_id(source.url),
        "name": source.name,
        "url": source.url,
        "category": source.category or None,
        "status": "pending",
        "cache_hit": None,
        "stale": False,
        "bytes_downloaded": 0,
        "bytes_total": None,
        "download_percent": None,
        "download_time_ms": None,
        "domain_count": None,
        "domain_change": None,
        "format_breakdown": None,
        "detected_formats": [],
        "error": None,
        "warnings": [],
        "started_at": None,
        "completed_at": None,
    }


class SimulatedBuild:
    def __init__(
        self,
        sources: Sequence[SeedSource],
        whitelist: str,
        clock: Callable[[], datetime],
    ) -> None:
        self.sources = list(sources)
        self.patterns = whitelist_matches(whitelist)
        self.numbers = build_numbers(
            self.sources, sum(pattern["match_count"] for pattern in self.patterns)
        )
        self._clock = clock
        started = self._now()
        self.progress: dict[str, Any] = {
            **initial_progress(),
            "current_step": "downloading",
            "stage": "downloading",
            "total_sources": len(self.sources),
            "sources": [pending_source(source) for source in self.sources],
            "stage_started_at": started,
            "stages": {
                "downloading": {"started_at": started, "completed_at": None},
                "whitelist": None,
                "generation": None,
            },
        }
        self._changed: set[str] = {"progress"}

    def _now(self) -> str:
        return stamp(self._clock())

    def _source(self, index: int) -> dict[str, Any]:
        self._changed.add(f"progress.sources.{index}")
        source: dict[str, Any] = self.progress["sources"][index]
        return source

    def _count_processed(self) -> None:
        self.progress["processed_sources"] += 1
        self._changed.add("progress.processed_sources")

    def _snapshot(self, stage: str, completed_at: str, data: Any) -> None:
        self.progress["stage_snapshots"][stage] = {
            "completed_at": completed_at,
            "data": copy.deepcopy(data),
        }
        self.progress["stages"][stage]["completed_at"] = completed_at
        self._changed.add("progress")

    def _enter(self, stage: str, started_at: str) -> None:
        self.progress["current_step"] = stage
        self.progress["stage"] = stage
        self.progress["stage_started_at"] = started_at
        self.progress["stages"][stage] = {
            "started_at": started_at,
            "completed_at": None,
        }

    def snapshot(self) -> dict[str, Any]:
        return copy.deepcopy(self.progress)

    def take_changes(self) -> dict[str, Any]:
        changed, self._changed = self._changed, set()
        if "progress" in changed:
            return {"progress": self.snapshot()}
        fields: dict[str, Any] = {}
        for path in sorted(changed):
            value: Any = self.progress
            for part in path.split(".")[1:]:
                value = value[int(part)] if part.isdigit() else value[part]
            fields[path] = copy.deepcopy(value)
        return fields

    def start_source(self, index: int) -> None:
        source = self._source(index)
        source["status"] = "downloading"
        source["started_at"] = self._now()

    def report_bytes(self, index: int, fraction: float) -> None:
        total = self.sources[index].domains * BYTES_PER_DOMAIN
        source = self._source(index)
        source["bytes_downloaded"] = int(total * fraction)
        source["bytes_total"] = total
        source["download_percent"] = round(fraction * 100, 1)

    def finish_download(self, index: int) -> None:
        plan = self.sources[index]
        source = self._source(index)
        source["cache_hit"] = plan.outcome in (CACHED, STALE)
        source["stale"] = plan.outcome == STALE
        source["download_time_ms"] = DOWNLOAD_TIME_MS[plan.outcome]
        source["warnings"] = [STALE_SOURCE_WARNING] if plan.outcome == STALE else []
        if plan.outcome == FAILED:
            source["status"] = "failed"
            source["error"] = FAILED_SOURCE_ERROR
            source["completed_at"] = self._now()
            self._count_processed()
            return
        source["status"] = "processing"
        if plan.outcome == DOWNLOADED:
            self.report_bytes(index, 1.0)
        self.progress["current_source"] = plan.name
        self._changed.add("progress.current_source")

    def finish_extraction(self, index: int) -> None:
        plan = self.sources[index]
        source = self._source(index)
        detected = FORMATS[index % len(FORMATS)]
        source["status"] = "completed"
        source["domain_count"] = plan.domains
        source["domain_change"] = plan.change
        source["format_breakdown"] = {
            name: plan.domains if name == detected else 0 for name in FORMATS
        }
        source["detected_formats"] = [detected]
        source["completed_at"] = self._now()
        self._count_processed()

    def enter_whitelist(self) -> None:
        now = self._now()
        self._snapshot(
            "downloading",
            now,
            {
                "sources": self.progress["sources"],
                "total_sources": self.progress["total_sources"],
                "processed_sources": self.progress["processed_sources"],
            },
        )
        self._enter("whitelist", now)
        self.progress["current_source"] = None
        self.progress["whitelist"] = {
            "domains_before": self.numbers.extracted,
            "domains_after": self.numbers.extracted,
            "domains_checked": 0,
            "total_removed": 0,
            "processing": True,
            "patterns_total": len(self.patterns),
            "patterns": [],
            "warnings": [],
        }

    def check_whitelist(self, fraction: float) -> None:
        removed = int(self.numbers.removed * fraction)
        whitelist = self.progress["whitelist"]
        whitelist["domains_checked"] = int(self.numbers.extracted * fraction)
        whitelist["total_removed"] = removed
        whitelist["domains_after"] = self.numbers.extracted - removed
        self._changed.add("progress.whitelist")

    def finish_whitelist(self) -> None:
        self.check_whitelist(1.0)
        self.progress["whitelist"]["processing"] = False
        self.progress["whitelist"]["patterns"] = copy.deepcopy(self.patterns)

    def enter_generation(self) -> None:
        now = self._now()
        self._snapshot("whitelist", now, self.progress["whitelist"])
        self._enter("generation", now)
        lists = self.numbers.lists
        self.progress["generation"] = {
            "files_total": len(lists) * len(FORMATS),
            "files_completed": 0,
            "current_format": None,
            "formats": [
                {
                    "format": name,
                    "status": "pending",
                    "domains_written": 0,
                    "total_domains": sum(lists.values()),
                    "percent": 0.0,
                    "file_size": None,
                    "gz_size": None,
                }
                for name in FORMATS
            ],
        }

    def write_format(self, index: int, fraction: float) -> None:
        generation = self.progress["generation"]
        entry = generation["formats"][index]
        entry["status"] = "generating"
        entry["domains_written"] = int(entry["total_domains"] * fraction)
        entry["percent"] = round(fraction * 100, 1)
        generation["current_format"] = entry["format"]
        self._changed.add("progress.generation")

    def finish_format(self, index: int, gz_size: int) -> None:
        generation = self.progress["generation"]
        entry = generation["formats"][index]
        entry["status"] = "completed"
        entry["domains_written"] = entry["total_domains"]
        entry["percent"] = 100.0
        entry["gz_size"] = gz_size
        generation["files_completed"] += generation["files_total"] // len(FORMATS)
        if generation["files_completed"] >= generation["files_total"]:
            generation["current_format"] = None
        self._changed.add("progress.generation")

    def complete(self) -> None:
        now = self._now()
        self._snapshot("generation", now, self.progress["generation"])
        self.progress["current_step"] = "completed"
        self.progress["stage"] = "completed"
        self.progress["stage_started_at"] = now

    def source_warnings(self) -> list[str]:
        warnings = []
        for source in self.progress["sources"]:
            if source["status"] == "failed":
                warnings.append(
                    f"Source {source['name']} could not be used: {source['error']}"
                )
            if source["stale"]:
                warnings.append(
                    f"Source {source['name']} is stale: its upstream check failed, "
                    "so the last verified copy was used"
                )
        return warnings

    def limit(self, max_domains: int | None) -> dict[str, Any]:
        return {"max_domains": max_domains, "actual_domains": self.numbers.measured}

    def is_over(self, max_domains: int | None) -> bool:
        return max_domains is not None and self.numbers.measured > max_domains

    def completed_result(
        self, manifest: Mapping[str, Any], max_domains: int | None
    ) -> dict[str, Any]:
        statuses = [source["status"] for source in self.progress["sources"]]
        warnings = self.source_warnings()
        if max_domains is not None and self.is_over(max_domains):
            warnings.append(
                over_limit_text(self.numbers.measured, max_domains, enforced=False)
            )
        return {
            **empty_result(),
            "sources_processed": statuses.count("completed"),
            "sources_failed": statuses.count("failed"),
            "sources_stale": sum(
                1 for source in self.progress["sources"] if source["stale"]
            ),
            "total_domains": self.numbers.downloaded,
            "unique_domains": self.numbers.combined,
            "whitelisted_removed": self.numbers.removed,
            "output_files": [
                {
                    "name": file["name"],
                    "format": file["format"],
                    "size_bytes": file["size_bytes"],
                    "domain_count": file["domain_count"],
                }
                for file in manifest["files"]
            ],
            "categories": dict(self.numbers.categories),
            "warnings": warnings,
            "generation_id": manifest["generation_id"],
            "limit": self.limit(max_domains),
        }


def download_ticks(build: SimulatedBuild) -> Iterator[None]:
    waiting = deque(range(len(build.sources)))
    active: dict[int, int] = {}
    while waiting or active:
        while waiting and len(active) < CONCURRENT_DOWNLOADS:
            index = waiting.popleft()
            build.start_source(index)
            active[index] = 0
        yield
        for index, step in list(active.items()):
            outcome = build.sources[index].outcome
            downloading = DOWNLOAD_STEPS[outcome]
            step += 1
            active[index] = step
            if step < downloading:
                if outcome == DOWNLOADED:
                    build.report_bytes(index, 0.35 * step)
            elif step == downloading:
                build.finish_download(index)
                if outcome == FAILED:
                    del active[index]
            else:
                build.finish_extraction(index)
                del active[index]
    yield


def whitelist_ticks(build: SimulatedBuild) -> Iterator[None]:
    build.enter_whitelist()
    yield
    build.check_whitelist(0.5)
    yield
    build.finish_whitelist()
    yield


def generation_ticks(
    build: SimulatedBuild, manifest: Mapping[str, Any]
) -> Iterator[None]:
    build.enter_generation()
    yield
    for index, name in enumerate(FORMATS):
        build.write_format(index, 0.55)
        yield
        build.finish_format(
            index,
            sum(
                file["size_bytes"]
                for file in manifest["files"]
                if file["format"] == name
            ),
        )
        yield


def sample_domains(list_name: str, lists: Mapping[str, int]) -> list[str]:
    if list_name != COMBINED_LIST:
        return [
            f"{list_name}-{number:03d}.blocked.example"
            for number in range(1, SAMPLE_DOMAINS_PER_LIST + 1)
        ]
    return sorted(
        domain
        for name in lists
        if name not in (COMBINED_LIST, CATEGORY_LEFT_OUT_OF_COMBINED_LIST)
        for domain in sample_domains(name, lists)
    )


def sample_list_text(list_name: str, format_name: str, lists: Mapping[str, int]) -> str:
    domains = sample_domains(list_name, lists)
    comment = "!" if format_name == "adblock" else "#"
    lines = [
        f"{comment} Development sample of the {list_name} list",
        f"{comment} Seeded metadata reports {lists[list_name]} domains;"
        f" this file holds {len(domains)}",
        "",
    ]
    for domain in domains:
        if format_name == "hosts":
            lines.append(f"0.0.0.0 {domain}")
        elif format_name == "adblock":
            lines.append(f"||{domain}^")
        else:
            lines.append(domain)
    return "\n".join(lines) + "\n"


def build_manifest(
    lists: Mapping[str, int],
    job: Mapping[str, Any],
    digest: str,
    created_at: datetime,
) -> tuple[dict[str, Any], dict[str, bytes]]:
    bodies: dict[str, bytes] = {}
    files = []
    for list_name in lists:
        for format_name in FORMATS:
            text = sample_list_text(list_name, format_name, lists).encode()
            stored = gzip.compress(text, compresslevel=1, mtime=0)
            name = f"{list_name}_{format_name}.txt.gz"
            bodies[name] = stored
            files.append(
                {
                    "name": name,
                    "list": list_name,
                    "format": format_name,
                    "domain_count": lists[list_name],
                    "size_bytes": len(stored),
                    "uncompressed_bytes": len(text),
                    "sha256": hashlib.sha256(stored).hexdigest(),
                }
            )
    manifest = {
        "version": MANIFEST_VERSION,
        "generation_id": str(uuid.uuid4()),
        "job_id": job["job_id"],
        "job_created_at": stamp(job["created_at"]),
        "attempt": job.get("attempt") or 1,
        "created_at": stamp(created_at),
        "inputs_digest": digest,
        "files": files,
    }
    return manifest, bodies


def store_generation(
    output_dir: Path, manifest: Mapping[str, Any], bodies: Mapping[str, bytes]
) -> Path:
    directory = output_dir / GENERATIONS_DIR / manifest["generation_id"]
    directory.mkdir(parents=True)
    for name, body in bodies.items():
        (directory / name).write_bytes(body)
    (directory / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n")
    return directory


def list_metadata(
    manifest: Mapping[str, Any], published_at: datetime
) -> list[dict[str, Any]]:
    lists: dict[str, dict[str, Any]] = {}
    for file in manifest["files"]:
        entry = lists.setdefault(
            file["list"],
            {
                "name": file["list"],
                "is_public": True,
                "formats": [],
                "domain_count": file["domain_count"],
                "last_updated": published_at,
            },
        )
        entry["formats"].append(file["format"])
    for entry in lists.values():
        entry["formats"].sort(key=FORMATS.index)
    return [lists[name] for name in sorted(lists)]


def publication_update(
    target: Target,
    manifest: Mapping[str, Any],
    job: Mapping[str, Any],
    unique_domains: int,
    published_at: datetime,
) -> dict[str, Any]:
    changes: dict[str, Any] = {
        "published_generation": manifest["generation_id"],
        "published": {
            "job_id": job["job_id"],
            "job_created_at": job["created_at"],
            "attempt": job.get("attempt") or 1,
            "inputs_digest": manifest["inputs_digest"],
            "published_at": published_at,
        },
        "lists": list_metadata(manifest, published_at),
    }
    total_size = sum(file["size_bytes"] for file in manifest["files"])
    if target.is_default:
        changes["total_domains"] = unique_domains
        changes["total_output_size_bytes"] = total_size
        changes["last_build_at"] = published_at
        return {"$set": changes, "$unset": {"config_fingerprint": ""}}
    changes["stats.total_domains"] = unique_domains
    changes["stats.total_output_size_bytes"] = total_size
    changes["stats.last_build_at"] = published_at
    changes["updated_at"] = published_at
    return {
        "$set": changes,
        "$unset": {"stats.config_hash": "", "stats.config_fingerprint": ""},
    }


def publish(
    database: Database[Any],
    target: Target,
    manifest: Mapping[str, Any],
    job: Mapping[str, Any],
    unique_domains: int,
    published_at: datetime,
) -> tuple[bool, str | None]:
    attempt = job.get("attempt") or 1
    if target.is_default:
        database[target.collection].update_one(
            target.filter,
            {"$setOnInsert": {"published_generation": None}},
            upsert=True,
        )
    before = database[target.collection].find_one_and_update(
        {
            **target.filter,
            "$or": [
                {"published": None},
                {"published.job_created_at": {"$lt": job["created_at"]}},
                {
                    "published.job_created_at": job["created_at"],
                    "published.attempt": {"$lt": attempt},
                },
            ],
        },
        publication_update(target, manifest, job, unique_domains, published_at),
        projection={"published_generation": 1},
    )
    if before is None:
        return False, None
    replaced = before.get("published_generation")
    return True, replaced if isinstance(replaced, str) else None


def queued_job(
    target: Target,
    job_type: str,
    priority: int,
    config_snapshot: Mapping[str, Any],
    quota_charged: bool,
    created_at: datetime,
) -> dict[str, Any]:
    return {
        "job_id": str(uuid.uuid4()),
        "target_id": target.target_id,
        "user_id": target.user_id,
        "username": target.username,
        "type": job_type,
        "status": STATUS_QUEUED,
        "priority": priority,
        "force_rebuild": False,
        "config_snapshot": dict(config_snapshot),
        "quota_charged": quota_charged,
        "progress": initial_progress(),
        "result": None,
        "started_at": None,
        "completed_at": None,
        "created_at": created_at,
        "worker_id": None,
        "claimed_at": None,
        "heartbeat_at": None,
        "rev": 0,
        "updated_at": created_at,
    }


def config_snapshot(
    sources: Sequence[SeedSource],
    whitelist: str,
    revision: int | None,
    max_domains: int | None,
    max_source_lists: int | None,
) -> dict[str, Any]:
    limits = (
        None
        if max_source_lists is None
        else {"max_domains": max_domains, "max_source_lists": max_source_lists}
    )
    return {
        "blocklists": config_text(sources),
        "whitelist": whitelist,
        "revision": revision,
        "limits": limits,
    }


def claim(job: dict[str, Any], worker_id: str, claimed_at: datetime) -> None:
    job.update(
        {
            "status": STATUS_PROCESSING,
            "worker_id": worker_id,
            "claimed_at": claimed_at,
            "heartbeat_at": claimed_at,
            "started_at": claimed_at,
            "attempt_started_at": claimed_at,
            "attempt": 1,
            "rev": 1,
            "updated_at": claimed_at,
        }
    )


def advance(
    job: dict[str, Any], ticks: Iterator[None], clock: Clock, pace: float
) -> None:
    for _ in ticks:
        job["rev"] += 1
        job["updated_at"] = job["heartbeat_at"] = clock.advance(pace)


def finish(
    job: dict[str, Any],
    status: str,
    result: Mapping[str, Any],
    progress: Mapping[str, Any],
    completed_at: datetime,
) -> None:
    job.update(
        {
            "status": status,
            "result": dict(result),
            "progress": dict(progress),
            "completed_at": completed_at,
            "updated_at": completed_at,
            "rev": job["rev"] + 1,
        }
    )


class Seeder:
    def __init__(self, app: "Flask", database: Database[Any]) -> None:
        self.app = app
        self.database = database
        self.now = utc_now()
        self.rng = random.Random(RANDOM_SEED)
        self.default_max_domains: int = app.config["DEFAULT_MAX_DOMAINS"]
        self.max_source_lists: int = app.config["DEFAULT_MAX_SOURCE_LISTS"]

    def ago(self, **interval: float) -> datetime:
        return self.now - timedelta(**interval)

    def user_target(self, user: "User") -> Target:
        return Target(
            user.id,
            ObjectId(user.id),
            user.username,
            Path(self.app.config["USERS_DIR"]) / user.username / "output",
        )

    def default_target(self) -> Target:
        return Target(
            DEFAULT_TARGET_ID,
            None,
            DEFAULT_TARGET_ID,
            Path(self.app.config["DEFAULT_DIR"]) / "output",
        )

    def run(self) -> list["User"]:
        users = {account.username: self.create_user(account) for account in ACCOUNTS}
        self.seed_library()
        self.seed_cache()
        self.seed_announcements()
        self.seed_default_lists()
        self.seed_alex(users["alex"])
        self.seed_regular_builds(users["sam"], SAM, None, 2)
        self.seed_jo(users["jo"])
        self.seed_featured()
        self.seed_analytics(users["alex"])
        self.seed_members()
        return [self.reloaded(user) for user in users.values()]

    def reloaded(self, user: "User") -> "User":
        from app.models.user import User

        current = User.get_by_id(user.id)
        if current is None:
            raise RuntimeError(f"Seeded user {user.username} disappeared")
        return current

    def create_user(self, account: Account) -> "User":
        from app.models.user import User

        user = User.find_or_create_from_github(
            github_id=account.github_id,
            username=account.username,
            email=account.email,
            avatar_url=None,
            name=account.name,
        )
        joined = self.ago(days=account.joined_days_ago)
        self.database.users.update_one(
            {"_id": ObjectId(user.id)},
            {
                "$set": {
                    "is_admin": account.is_admin,
                    "auth_version": 0,
                    "created_at": joined,
                    "stats.week_reset_at": joined,
                    "ip_log": [
                        {
                            "ip_hash": source_id(account.username)[:16],
                            "first_seen": joined,
                            "last_seen": self.ago(hours=3),
                            "access_count": 40 + account.joined_days_ago,
                        }
                    ],
                }
            },
        )
        return self.reloaded(user)

    def seed_members(self) -> None:
        names = (*MEMBER_NAMES, SECOND_ADMIN)
        for offset, username in enumerate(names):
            self.create_user(
                Account(
                    username=username,
                    name=f"{username.capitalize()} Example",
                    github_id=MEMBER_FIRST_GITHUB_ID + offset,
                    is_admin=username == SECOND_ADMIN,
                    joined_days_ago=3 + offset * 4,
                    sources=(),
                    whitelist="",
                )
            )
        self.database.users.update_one(
            {"username": DISABLED_MEMBER}, {"$set": {"is_enabled": False}}
        )
        self.database.users.update_one(
            {"username": BANNED_MEMBER},
            {
                "$set": {
                    "banned_until": self.now + timedelta(days=6),
                    "ban_reason": "Repeated automated sign-ups from one address.",
                }
            },
        )

    def save_config(
        self, user: "User", sources: Sequence[SeedSource], whitelist: str
    ) -> "User":
        user.save_configs(
            {"blocklists.conf": config_text(sources), "whitelist.txt": whitelist}
        )
        return self.reloaded(user)

    def seed_library(self) -> None:
        from app.models.blocklist_library import BlocklistLibrary

        for entry in LIBRARY:
            BlocklistLibrary.create(
                url=entry.url,
                name=entry.title,
                category=entry.category,
                description=entry.description,
                recommended=entry.recommended,
                aggressiveness=entry.aggressiveness,
                domain_count=entry.domains,
                added_by=SAM.username,
            )

    def seed_cache(self) -> None:
        checked = self.ago(hours=9)
        self.database.cache.insert_many(
            [
                {
                    "url_hash": source_id(entry.url),
                    "url": entry.url,
                    "final_url": entry.url,
                    "etag": f'"{source_id(entry.name)[:16]}"',
                    "content_hash": source_id(entry.path),
                    "last_checked_at": checked,
                    "last_downloaded_at": checked,
                    "stats": {
                        "size_bytes": entry.domains * BYTES_PER_DOMAIN,
                        "domain_count": entry.domains,
                        "download_count": 12,
                        "last_download_at": checked,
                        "last_accessed_at": checked,
                    },
                    "updated_at": checked,
                }
                for entry in LIBRARY
            ]
        )

    def seed_announcements(self) -> None:
        from app.models.announcement import Announcement

        Announcement.create(
            title="Scheduled maintenance",
            message=(
                "Acme Hosting is moving the list servers this weekend. Builds may "
                "queue for longer than usual."
            ),
            type="info",
            created_by=SAM.username,
        )
        Announcement.create(
            title="A source has moved",
            message=(
                "Acme Telemetry has a new address. Update your configuration before "
                "the old address stops working."
            ),
            type="warning",
            expires_at=self.now + timedelta(days=5),
            created_by=SAM.username,
        )
        Announcement.create(
            title="Domain limits will be enforced",
            message=(
                "Builds over the domain limit will start to fail soon. Check your "
                "usage on the dashboard."
            ),
            type="critical",
            created_by=SAM.username,
        )
        Announcement.create(
            title="Welcome to the new library",
            message="The source library now shows how strict each list is.",
            type="info",
            created_by=SAM.username,
        ).update(is_active=False)

    def seed_featured(self) -> None:
        from app.models.featured_list import FeaturedList

        FeaturedList.add(
            ALEX.username,
            COMBINED_LIST,
            "A balanced everyday list kept by Alex.",
            SAM.username,
        )

    def completed_build(
        self,
        target: Target,
        sources: Sequence[SeedSource],
        whitelist: str,
        job_type: str,
        priority: int,
        snapshot: Mapping[str, Any],
        created_at: datetime,
        is_current: bool,
    ) -> dict[str, Any]:
        clock = Clock(created_at)
        job = queued_job(target, job_type, priority, snapshot, False, created_at)
        claim(job, SEED_WORKER_ID, clock.advance(2))
        build = SimulatedBuild(sources, whitelist, clock)
        advance(job, download_ticks(build), clock, 4.2)
        advance(job, whitelist_ticks(build), clock, 0.9)
        manifest, bodies = build_manifest(
            build.numbers.lists,
            job,
            inputs_digest(snapshot["blocklists"], snapshot["whitelist"]),
            clock(),
        )
        advance(job, generation_ticks(build, manifest), clock, 1.6)
        build.complete()
        limits = snapshot["limits"]
        max_domains = limits["max_domains"] if limits else None
        finish(
            job,
            STATUS_COMPLETED,
            build.completed_result(manifest, max_domains),
            build.snapshot(),
            clock.advance(0.4),
        )
        self.database.jobs.insert_one(job)
        if is_current:
            store_generation(target.output_dir, manifest, bodies)
            published, _ = publish(
                self.database,
                target,
                manifest,
                job,
                build.numbers.combined,
                job["completed_at"],
            )
            if not published:
                raise RuntimeError(f"Could not publish for {target.username}")
        return job

    def seed_default_lists(self) -> None:
        from app.models.system_config import SystemConfig

        SystemConfig.update_default_config(
            config_text(DEFAULT_SOURCES), DEFAULT_WHITELIST, SAM.username
        )
        self.completed_build(
            self.default_target(),
            DEFAULT_SOURCES,
            DEFAULT_WHITELIST,
            TYPE_SCHEDULED,
            PRIORITY_HIGH,
            config_snapshot(DEFAULT_SOURCES, DEFAULT_WHITELIST, None, None, None),
            self.ago(hours=10),
            is_current=True,
        )

    def seed_regular_builds(
        self,
        user: "User",
        account: Account,
        max_domains: int | None,
        minutes_after: int,
    ) -> tuple["User", dict[str, Any]]:
        user = self.save_config(user, account.sources, account.whitelist)
        target = self.user_target(user)
        snapshot = config_snapshot(
            account.sources,
            account.whitelist,
            user.config_revision,
            max_domains,
            self.max_source_lists,
        )
        self.completed_build(
            target,
            first_build(account.sources),
            account.whitelist,
            TYPE_SCHEDULED,
            PRIORITY_LOW,
            snapshot,
            self.ago(days=7, hours=9, minutes=-minutes_after),
            is_current=False,
        )
        latest = self.completed_build(
            target,
            account.sources,
            account.whitelist,
            TYPE_SCHEDULED,
            PRIORITY_LOW,
            snapshot,
            self.ago(hours=9, minutes=-minutes_after),
            is_current=True,
        )
        return self.reloaded(user), latest

    def seed_jo(self, user: "User") -> None:
        from app.models.limit_request import LimitRequest
        from app.services import limit_review

        user, latest = self.seed_regular_builds(user, JO, self.default_max_domains, 4)
        measured: int = latest["result"]["limit"]["actual_domains"]
        limit_review.flag_over_limit(
            self.database.users,
            ObjectId(user.id),
            measured,
            self.default_max_domains,
            limit_review.METHOD_BUILD,
            self.ago(days=7, hours=8, minutes=50),
            enforcing=False,
        )
        request = LimitRequest.create(
            self.reloaded(user),
            requested_tier=10_000_000,
            reason=(
                "Our household uses the adult content and suspicious hosts lists "
                "together, which takes us just over the standard limit."
            ),
            intended_use="family",
        )
        self.database.limit_requests.update_one(
            {"_id": ObjectId(request.id)},
            {"$set": {"created_at": self.ago(days=2, hours=4)}},
        )

    def seed_alex(self, user: "User") -> None:
        from app.models.limit_request import LimitRequest
        from app.services import limit_review
        from app.utils.time import week_start

        earlier_sources = tuple(
            source
            for source in healthy(ALEX.sources)
            if source.name not in ALEX_FIRST_CONFIG
        )
        user = self.save_config(user, earlier_sources, ALEX.whitelist)
        target = self.user_target(user)
        earlier_snapshot = config_snapshot(
            earlier_sources,
            ALEX.whitelist,
            user.config_revision,
            self.default_max_domains,
            self.max_source_lists,
        )
        self.completed_build(
            target,
            first_build(earlier_sources),
            ALEX.whitelist,
            TYPE_SCHEDULED,
            PRIORITY_LOW,
            earlier_snapshot,
            self.ago(days=7, hours=9),
            is_current=False,
        )
        self.skipped_build(target, earlier_sources, earlier_snapshot, self.ago(days=6))

        user = self.save_config(user, ALEX.sources, ALEX.whitelist)
        over_limit = self.failed_build(
            target,
            healthy(ALEX.sources),
            config_snapshot(
                ALEX.sources,
                ALEX.whitelist,
                user.config_revision,
                self.default_max_domains,
                self.max_source_lists,
            ),
            self.ago(days=5),
        )
        measured: int = over_limit["result"]["limit"]["actual_domains"]
        limit_review.flag_over_limit(
            self.database.users,
            ObjectId(user.id),
            measured,
            self.default_max_domains,
            limit_review.METHOD_BUILD,
            over_limit["completed_at"],
            enforcing=True,
        )
        request = LimitRequest.create(
            self.reloaded(user),
            requested_tier=10_000_000,
            reason=(
                "I run these lists for my home network and a small office, and the "
                "extended advertising list takes me over the standard limit."
            ),
            intended_use="personal",
        )
        request.approve(
            SAM.username, response="Approved. Thanks for explaining how you use it."
        )
        requested_at = self.ago(days=4, hours=22)
        approved_at = self.ago(days=4)
        self.database.limit_requests.update_one(
            {"_id": ObjectId(request.id)},
            {
                "$set": {
                    "created_at": requested_at,
                    "reviewed_at": approved_at,
                    "current_usage": measured,
                }
            },
        )
        user = self.reloaded(user)
        raised_limit = user.limits["max_domains"]
        self.completed_build(
            target,
            ALEX.sources,
            ALEX.whitelist,
            TYPE_SCHEDULED,
            PRIORITY_LOW,
            config_snapshot(
                ALEX.sources,
                ALEX.whitelist,
                user.config_revision,
                raised_limit,
                self.max_source_lists,
            ),
            self.ago(hours=9),
            is_current=True,
        )
        self.running_build(target, user, raised_limit, self.ago(seconds=45))

        notifications = []
        for notification in self.reloaded(user).notifications:
            if notification["type"] == limit_review.NOTIFICATION_TYPE:
                notification = {**notification, "read": True}
            else:
                notification = {**notification, "created_at": approved_at}
            notifications.append(notification)
        self.database.users.update_one(
            {"_id": ObjectId(user.id)},
            {
                "$set": {
                    "notifications": notifications,
                    "limit_review.resolved_at": approved_at,
                    "stats.manual_updates_this_week": 1,
                    "stats.week_reset_at": week_start(self.now),
                }
            },
        )

    def skipped_build(
        self,
        target: Target,
        sources: Sequence[SeedSource],
        snapshot: Mapping[str, Any],
        created_at: datetime,
    ) -> None:
        clock = Clock(created_at)
        job = queued_job(target, TYPE_MANUAL, PRIORITY_NORMAL, snapshot, True, clock())
        claim(job, SEED_WORKER_ID, clock.advance(1))
        build = SimulatedBuild(sources, snapshot["whitelist"], clock)
        advance(job, download_ticks(build), clock, 1.1)
        finish(
            job,
            STATUS_SKIPPED,
            skipped_result(UNCHANGED_SKIP_REASON),
            initial_progress(),
            clock.advance(0.3),
        )
        job["quota_refunded"] = True
        self.database.jobs.insert_one(job)

    def failed_build(
        self,
        target: Target,
        sources: Sequence[SeedSource],
        snapshot: Mapping[str, Any],
        created_at: datetime,
    ) -> dict[str, Any]:
        clock = Clock(created_at)
        job = queued_job(target, TYPE_MANUAL, PRIORITY_NORMAL, snapshot, True, clock())
        claim(job, SEED_WORKER_ID, clock.advance(1))
        build = SimulatedBuild(sources, snapshot["whitelist"], clock)
        advance(job, download_ticks(build), clock, 4.2)
        advance(job, whitelist_ticks(build), clock, 0.9)
        max_domains: int = snapshot["limits"]["max_domains"]
        finish(
            job,
            STATUS_FAILED,
            failure_result(
                DOMAIN_LIMIT_EXCEEDED_CODE,
                over_limit_text(build.numbers.measured, max_domains, enforced=True),
                build.limit(max_domains),
            ),
            build.snapshot(),
            clock.advance(0.3),
        )
        job["read"] = False
        self.database.jobs.insert_one(job)
        return job

    def running_build(
        self, target: Target, user: "User", max_domains: int, created_at: datetime
    ) -> None:
        clock = Clock(created_at)
        snapshot = config_snapshot(
            ALEX.sources,
            ALEX.whitelist,
            user.config_revision,
            max_domains,
            self.max_source_lists,
        )
        job = queued_job(target, TYPE_MANUAL, PRIORITY_NORMAL, snapshot, True, clock())
        claim(job, SEED_WORKER_ID, clock.advance(3))
        build = SimulatedBuild(ALEX.sources, ALEX.whitelist, clock)
        ticks = download_ticks(build)
        for _ in range(MID_DOWNLOAD_TICKS):
            next(ticks)
            job["rev"] += 1
            job["updated_at"] = clock.advance(4.2)
        job["progress"] = build.snapshot()
        job["heartbeat_at"] = self.now + timedelta(days=365)
        self.database.jobs.insert_one(job)

    def seed_analytics(self, alex: "User") -> None:
        from app.models.analytics import Analytics
        from app.models.system_config import SystemConfig

        default_lists = self.database.system_config.find_one(
            {"_id": SystemConfig.BUILD_DOC_ID}, {"lists": 1}
        )
        scopes: list[tuple[str, str | None, list[str]]] = [
            (
                Analytics.TYPE_USER,
                alex.username,
                [entry["name"] for entry in self.reloaded(alex).lists],
            ),
            (
                Analytics.TYPE_DEFAULT,
                None,
                [entry["name"] for entry in (default_lists or {}).get("lists", [])],
            ),
        ]
        days = [
            Analytics.today() - timedelta(days=offset)
            for offset in range(ANALYTICS_DAYS)
        ]
        buckets = []
        visitors = []
        for list_type, username, names in scopes:
            regulars = [f"{self.rng.getrandbits(64):016x}" for _ in range(80)]
            for position, name in enumerate(names):
                popularity = 220 if name == COMBINED_LIST else 60 - position * 6
                for day in days:
                    bucket, seen = self.analytics_day(
                        list_type, username, name, day, max(popularity, 12), regulars
                    )
                    buckets.append(bucket)
                    visitors.extend(seen)
        self.database[Analytics.COLLECTION].insert_many(buckets)
        self.database[Analytics.VISITORS_COLLECTION].insert_many(visitors)

    def spread(self, total: int, weights: Mapping[str, int]) -> dict[str, int]:
        counts = {name: 0 for name in weights}
        names = list(weights)
        for name in self.rng.choices(names, list(weights.values()), k=total):
            counts[name] += 1
        return {name: count for name, count in counts.items() if count}

    def analytics_day(
        self,
        list_type: str,
        username: str | None,
        list_name: str,
        day: datetime,
        popularity: int,
        regulars: Sequence[str],
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        from app.models.analytics import Analytics

        weekend = 0.7 if day.weekday() >= 5 else 1.0
        requests = max(3, int(popularity * weekend * self.rng.uniform(0.7, 1.3)))
        cities = {
            Analytics.city_key(country, city) or "": weight
            for country, city, weight in (
                ("GB", "London", 6),
                ("GB", "Leeds", 2),
                ("US", "Springfield", 4),
                ("DE", "Berlin", 3),
                ("NL", "Utrecht", 2),
            )
        }
        referrers = {
            Analytics.referrer_key(f"https://{host}/") or "": weight
            for host, weight in (
                ("docs.example.org", 5),
                ("forum.example.com", 3),
                ("wiki.example.net", 1),
            )
        }
        located = self.spread(requests * 6 // 10, cities)
        referred = self.spread(requests // 4, referrers)
        bucket_id = Analytics.bucket_id(list_type, username, list_name, day)
        identity = {
            "list_type": list_type,
            "username": username,
            "list_name": list_name,
            "date": day,
        }
        bucket = {
            "_id": bucket_id,
            "schema_version": Analytics.SCHEMA_VERSION,
            **identity,
            "requests": requests,
            "bandwidth_bytes": requests * self.rng.randint(1800, 5200),
            "formats": self.spread(requests, {"hosts": 6, "plain": 2, "adblock": 3}),
            "hours": self.spread(
                requests,
                {f"h{hour:02d}": 6 if 2 <= hour <= 5 else 2 for hour in range(24)},
            ),
            "countries": self.spread(
                requests, {"GB": 8, "US": 5, "DE": 3, "NL": 2, "FR": 1, "ZZ": 1}
            ),
            "cities": located,
            "cities_keys": sorted(located),
            "referrers": referred,
            "referrers_keys": sorted(referred),
        }
        seen = self.rng.sample(regulars, min(len(regulars), max(2, requests // 5)))
        return bucket, [
            {"_id": f"{bucket_id}:{visitor}", **identity, "visitor": visitor}
            for visitor in seen
        ]


def reset(environment: DevEnvironment) -> None:
    data_dir = environment.data_dir
    marker = data_dir / DATA_DIR_MARKER
    if data_dir.exists() and any(data_dir.iterdir()) and not marker.exists():
        raise Refusal(
            f"Refusing to clear {data_dir}: it holds files this script did not "
            "create. Point DATA_DIR at an empty or missing directory."
        )
    client: MongoClient[dict[str, Any]]
    with MongoClient(environment.mongo_uri, serverSelectionTimeoutMS=5000) as client:
        client.drop_database(environment.database_name)
    for name in SEEDED_DIRECTORIES:
        if (data_dir / name).exists():
            shutil.rmtree(data_dir / name)
    data_dir.mkdir(parents=True, exist_ok=True)
    marker.write_text("Created by backend/scripts/dev_seed.py\n")


def session_cookie(app: "Flask", user: "User") -> tuple[str, str]:
    from flask.sessions import SecureCookieSessionInterface

    interface = app.session_interface
    if not isinstance(interface, SecureCookieSessionInterface):
        raise RuntimeError("The app does not sign its sessions into a cookie")
    serializer = interface.get_signing_serializer(app)
    if serializer is None:
        raise RuntimeError("The app has no session secret")
    value = serializer.dumps(
        {"_permanent": True, "user_id": user.id, "auth_version": user.auth_version}
    )
    return str(app.config["SESSION_COOKIE_NAME"]), str(value)


def cookie_usernames() -> list[str]:
    return [*(account.username for account in ACCOUNTS), SECOND_ADMIN]


def seeded_users() -> list["User"]:
    from app.models.user import User

    usernames = cookie_usernames()
    users = [User.get_by_username(username) for username in usernames]
    missing = [username for username, user in zip(usernames, users) if user is None]
    if missing:
        raise Refusal(
            f"No seeded account for {', '.join(missing)}. Run the seed without "
            "--cookies-only first."
        )
    return [user for user in users if user is not None]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Seed the local development database and data directory."
    )
    parser.add_argument(
        "--cookies-only",
        action="store_true",
        help="print fresh cookies for the seeded accounts and change nothing",
    )
    args = parser.parse_args()
    try:
        environment = require_dev_environment()
        if not args.cookies_only:
            reset(environment)
        app = create_dev_app()
        with app.app_context():
            from app.extensions import mongo

            if not args.cookies_only:
                Seeder(app, mongo.db).run()
            users = seeded_users()
            cookies = [(user.username, *session_cookie(app, user)) for user in users]
    except Refusal as refusal:
        print(refusal, file=sys.stderr)
        return 1
    print(f"Database: {environment.mongo_uri}", file=sys.stderr)
    print(f"Data directory: {environment.data_dir}", file=sys.stderr)
    for username, name, value in cookies:
        print(f"{username}\t{name}={value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
