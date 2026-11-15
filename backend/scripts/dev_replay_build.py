"""
Replay a build into a job document the way the Rust worker writes it, so the
live build views can be exercised without a worker or real downloads.

Usage:
  FLASK_ENV=development PYTHONPATH=backend \
    uv run --no-project python backend/scripts/dev_replay_build.py --create
  FLASK_ENV=development PYTHONPATH=backend \
    uv run --no-project python backend/scripts/dev_replay_build.py \
    --username sam --create --step-seconds 0.5 --outcome failed

  FLASK_ENV=development PYTHONPATH=backend \
    uv run --no-project python backend/scripts/dev_replay_build.py \
    --create --outcome failed --error-code domain_limit_exceeded --sources 36

--error-code ends a failed build with that code, at the point in the build where
the worker or the server would raise it. --sources pads the build with made-up
sources so that a long source table can be exercised. --queue-seconds leaves the
build queued for that long before the replay claims it.

Without --create the account must already have a queued build, for example one
started with the Build button. A build left processing by the seed or by an
interrupted replay is put back in the queue and replayed from the start.
"""

import argparse
import shutil
import sys
import time
import uuid
from collections.abc import Iterator, Mapping
from itertools import islice
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pymongo import ReturnDocument
from pymongo.database import Database

from dev_seed import (
    ALL_SOURCES_FAILED_CODE,
    ALL_SOURCES_FAILED_MESSAGE,
    CACHED,
    DEV_WORKER_PREFIX,
    DOMAIN_LIMIT_EXCEEDED_CODE,
    DOWNLOADED,
    FAILED,
    GENERATIONS_DIR,
    PRIORITY_NORMAL,
    STALE,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PROCESSING,
    STATUS_QUEUED,
    STATUS_SKIPPED,
    SUPERSEDED_SKIP_REASON,
    TYPE_MANUAL,
    UNCHANGED_SKIP_REASON,
    Refusal,
    SeedSource,
    SimulatedBuild,
    Target,
    build_manifest,
    create_dev_app,
    download_ticks,
    failure_result,
    generation_ticks,
    initial_progress,
    inputs_digest,
    over_limit_text,
    publish,
    queued_job,
    require_dev_environment,
    skipped_result,
    source_id,
    store_generation,
    utc_now,
    whitelist_ticks,
)

if TYPE_CHECKING:
    from flask import Flask

OUTCOMES = (STATUS_COMPLETED, STATUS_FAILED, STATUS_SKIPPED)
INTERNAL_ERROR_MESSAGE = (
    "The build failed because of an internal error. Please try again."
)
REJECTED_BEFORE_DOWNLOAD = {
    "invalid_config": (
        "Blocklist configuration is invalid: line 3 is not a valid source line"
    ),
    "no_sources": "No valid sources in config",
    "superseded": (
        "Cancelled because another build for the same lists was already active"
    ),
}
STOPPED_MID_DOWNLOAD = {
    "internal": INTERNAL_ERROR_MESSAGE,
    "worker_abandoned": (
        "Abandoned after 3 attempts that each died before completing "
        "(worker crashed or ran out of memory)"
    ),
}
NO_DOMAINS_CODE = "no_domains"
NO_DOMAINS_MESSAGE = "No domains extracted"
ERROR_CODES = (
    ALL_SOURCES_FAILED_CODE,
    DOMAIN_LIMIT_EXCEEDED_CODE,
    NO_DOMAINS_CODE,
    *REJECTED_BEFORE_DOWNLOAD,
    *STOPPED_MID_DOWNLOAD,
)
MID_DOWNLOAD_TICKS = 5
PADDING_CATEGORIES = ("advertising", "tracking", "malicious", "suspicious")
PRETEND_LIMIT_SHARE = 0.8
ACTIVE_STATUSES = (STATUS_QUEUED, STATUS_PROCESSING)
DEFAULT_STEP_SECONDS = 1.0


class LeaseLost(Exception):
    pass


def requeue_fields() -> dict[str, Any]:
    return {
        "status": STATUS_QUEUED,
        "worker_id": None,
        "claimed_at": None,
        "heartbeat_at": None,
        "progress": initial_progress(),
    }


def revision_bump(fields: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "$set": dict(fields),
        "$inc": {"rev": 1},
        "$currentDate": {"updated_at": True},
    }


def padding_sources(existing: int, wanted: int) -> list[SeedSource]:
    padding = []
    for number in range(existing + 1, wanted + 1):
        if number % 11 == 5:
            outcome = STALE
        elif number % 7 == 3:
            outcome = CACHED
        else:
            outcome = DOWNLOADED
        padding.append(
            SeedSource(
                f"acme_extra_{number:02d}",
                f"https://lists.example.org/extra/{number:02d}.txt",
                PADDING_CATEGORIES[number % len(PADDING_CATEGORIES)],
                20_000 + (number * 7_919) % 180_000,
                outcome,
                (number * 37) % 500 - 120 if outcome == DOWNLOADED else 0,
            )
        )
    return padding


def source_outcomes(count: int, outcome: str, error_code: str | None) -> list[str]:
    all_fail = error_code in (None, ALL_SOURCES_FAILED_CODE)
    if outcome == STATUS_FAILED and all_fail:
        return [FAILED] * count
    if outcome == STATUS_SKIPPED:
        return [CACHED] * count
    outcomes = [DOWNLOADED] * count
    if count >= 2:
        outcomes[0] = CACHED
    if count >= 4:
        outcomes[2] = STALE
        outcomes[3] = FAILED
    elif count == 3:
        outcomes[1] = STALE
        outcomes[2] = FAILED
    elif count == 2:
        outcomes[1] = STALE
    return outcomes


class Replay:
    def __init__(
        self,
        app: "Flask",
        database: Database[Any],
        username: str,
        outcome: str,
        step_seconds: float,
        error_code: str | None = None,
        source_count: int = 0,
        queue_seconds: float = 0.0,
    ) -> None:
        self.app = app
        self.database = database
        self.jobs = database.jobs
        self.username = username
        self.outcome = outcome
        self.step_seconds = step_seconds
        self.error_code = error_code if outcome == STATUS_FAILED else None
        self.source_count = source_count
        self.queue_seconds = queue_seconds
        self.worker_id = f"{DEV_WORKER_PREFIX}replay-{uuid.uuid4()}"
        account = database.users.find_one({"username": username}, {"_id": 1})
        if account is None:
            raise Refusal(f"No account named {username}. Run the seed script first.")
        self.target = Target(
            str(account["_id"]),
            account["_id"],
            username,
            Path(app.config["USERS_DIR"]) / username / "output",
        )

    def run(self, create: bool) -> int:
        job = self.take_job(create)
        print(f"Replaying build {job['job_id']} for {self.username}")
        self.pause()
        time.sleep(self.queue_seconds)
        claimed = self.claim(job)
        try:
            status = self.replay(claimed)
        except LeaseLost:
            print("Stopped: the job is no longer held by this replay", file=sys.stderr)
            return 1
        except KeyboardInterrupt:
            self.release(claimed)
            print("Interrupted: the build is back in the queue", file=sys.stderr)
            return 130
        except BaseException:
            self.release(claimed)
            raise
        finally:
            self.database.workers.delete_one({"worker_id": self.worker_id})
        final = self.jobs.find_one({"_id": claimed["_id"]}, {"rev": 1, "status": 1})
        revision = final["rev"] if final else None
        print(f"Build {job['job_id']} ended {status} at revision {revision}")
        return 0

    def pause(self) -> None:
        time.sleep(self.step_seconds)

    def take_job(self, create: bool) -> dict[str, Any]:
        active = self.jobs.find_one(
            {"target_id": self.target.target_id, "status": {"$in": ACTIVE_STATUSES}}
        )
        if active is None:
            if not create:
                raise Refusal(
                    f"{self.username} has no queued build. Start one with the Build "
                    "button, or pass --create."
                )
            return self.create_job()
        if active["status"] == STATUS_QUEUED:
            return dict(active)
        holder = str(active.get("worker_id") or "")
        if not holder.startswith(DEV_WORKER_PREFIX):
            raise Refusal(
                f"Build {active['job_id']} is being processed by worker {holder}. "
                "Stop the worker, or wait for the build to finish."
            )
        requeued = self.jobs.find_one_and_update(
            {"_id": active["_id"], "worker_id": holder, "status": STATUS_PROCESSING},
            revision_bump(requeue_fields()),
            return_document=ReturnDocument.AFTER,
        )
        if requeued is None:
            raise Refusal(f"Build {active['job_id']} changed while it was taken over.")
        print(f"Put build {active['job_id']} back in the queue to replay it")
        return dict(requeued)

    def create_job(self) -> dict[str, Any]:
        from app.models.user import User

        user = User.get_by_username(self.username)
        if user is None:
            raise Refusal(f"No account named {self.username}.")
        blocklists = user.get_config("blocklists.conf")
        if not blocklists or not blocklists.strip():
            raise Refusal(f"{self.username} has no blocklist configuration to build.")
        limits = user.limits
        snapshot = {
            "blocklists": blocklists,
            "whitelist": user.get_config("whitelist.txt") or "",
            "revision": user.config_revision,
            "limits": {
                "max_domains": None if user.is_admin else limits["max_domains"],
                "max_source_lists": limits["max_source_lists"],
            },
        }
        job = queued_job(
            self.target, TYPE_MANUAL, PRIORITY_NORMAL, snapshot, False, utc_now()
        )
        job["_id"] = self.jobs.insert_one(job).inserted_id
        return job

    def claim(self, job: Mapping[str, Any]) -> dict[str, Any]:
        claimed = self.jobs.find_one_and_update(
            {"_id": job["_id"], "status": STATUS_QUEUED, "worker_id": None},
            [
                {
                    "$set": {
                        "status": STATUS_PROCESSING,
                        "worker_id": self.worker_id,
                        "claimed_at": "$$NOW",
                        "heartbeat_at": "$$NOW",
                        "started_at": {"$ifNull": ["$started_at", "$$NOW"]},
                        "attempt_started_at": "$$NOW",
                        "attempt": {
                            "$cond": [
                                {"$isNumber": "$attempt"},
                                {"$add": ["$attempt", 1]},
                                1,
                            ]
                        },
                        "rev": {
                            "$cond": [
                                {"$isNumber": "$rev"},
                                {"$add": ["$rev", 1]},
                                1,
                            ]
                        },
                        "updated_at": "$$NOW",
                    }
                }
            ],
            return_document=ReturnDocument.AFTER,
        )
        if claimed is None:
            raise Refusal(
                f"Build {job['job_id']} was claimed by another worker before the "
                "replay could take it."
            )
        return dict(claimed)

    def held(self, job: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "_id": job["_id"],
            "worker_id": self.worker_id,
            "status": STATUS_PROCESSING,
        }

    def write(self, job: Mapping[str, Any], fields: Mapping[str, Any]) -> None:
        if not fields:
            return
        written = self.jobs.update_one(self.held(job), revision_bump(fields))
        if written.matched_count == 0:
            raise LeaseLost()

    def heartbeat(self, job: Mapping[str, Any]) -> None:
        now = utc_now()
        self.database.workers.update_one(
            {"worker_id": self.worker_id},
            {
                "$set": {"last_seen_at": now, "current_job_id": job["job_id"]},
                "$setOnInsert": {"started_at": now},
            },
            upsert=True,
        )
        beat = self.jobs.update_one(self.held(job), {"$set": {"heartbeat_at": now}})
        if beat.matched_count == 0:
            raise LeaseLost()

    def release(self, job: Mapping[str, Any]) -> None:
        self.jobs.update_one(self.held(job), revision_bump(requeue_fields()))

    def step(
        self, job: Mapping[str, Any], build: SimulatedBuild, ticks: Iterator[None]
    ) -> None:
        for _ in ticks:
            self.heartbeat(job)
            self.write(job, build.take_changes())
            self.pause()

    def sources(self, blocklists: str) -> list[SeedSource]:
        from app.utils.validators import parse_config_lines

        lines = [line for line in parse_config_lines(blocklists) if line.error is None]
        outcomes = source_outcomes(len(lines), self.outcome, self.error_code)
        sources = []
        for line, outcome in zip(lines, outcomes):
            digest = source_id(line.url)
            cached = self.database.cache.find_one(
                {"url_hash": digest}, {"stats.domain_count": 1}
            )
            known = ((cached or {}).get("stats") or {}).get("domain_count")
            domains = (
                known
                if isinstance(known, int) and known > 0
                else 40_000 + int(digest[:8], 16) % 900_000
            )
            change = int(digest[8:12], 16) % 900 - 200 if outcome == DOWNLOADED else 0
            sources.append(
                SeedSource(line.name, line.url, line.category, domains, outcome, change)
            )
        sources.extend(padding_sources(len(sources), self.source_count))
        return sources

    def end(
        self,
        job: Mapping[str, Any],
        status: str,
        result: Mapping[str, Any],
        progress: Mapping[str, Any],
    ) -> str:
        self.write(
            job,
            {
                "status": status,
                "completed_at": utc_now(),
                "result": dict(result),
                "progress": dict(progress),
            },
        )
        return status

    def replay(self, job: Mapping[str, Any]) -> str:
        snapshot = job.get("config_snapshot") or {}
        blocklists = str(snapshot.get("blocklists") or "")
        whitelist = str(snapshot.get("whitelist") or "")
        limit = (snapshot.get("limits") or {}).get("max_domains")
        max_domains: int | None = limit if isinstance(limit, int) else None
        if self.error_code in REJECTED_BEFORE_DOWNLOAD:
            return self.end(
                job,
                STATUS_FAILED,
                failure_result(
                    self.error_code, REJECTED_BEFORE_DOWNLOAD[self.error_code]
                ),
                initial_progress(),
            )
        build = SimulatedBuild(self.sources(blocklists), whitelist, utc_now)

        if self.error_code in STOPPED_MID_DOWNLOAD:
            self.step(job, build, islice(download_ticks(build), MID_DOWNLOAD_TICKS))
            return self.end(
                job,
                STATUS_FAILED,
                failure_result(self.error_code, STOPPED_MID_DOWNLOAD[self.error_code]),
                build.snapshot(),
            )
        self.step(job, build, download_ticks(build))
        if self.error_code == NO_DOMAINS_CODE:
            return self.end(
                job,
                STATUS_FAILED,
                failure_result(NO_DOMAINS_CODE, NO_DOMAINS_MESSAGE),
                build.snapshot(),
            )
        if not build.numbers.lists:
            return self.end(
                job,
                STATUS_FAILED,
                failure_result(ALL_SOURCES_FAILED_CODE, ALL_SOURCES_FAILED_MESSAGE),
                build.snapshot(),
            )
        if self.outcome == STATUS_SKIPPED:
            return self.end(
                job,
                STATUS_SKIPPED,
                skipped_result(UNCHANGED_SKIP_REASON),
                initial_progress(),
            )

        self.step(job, build, whitelist_ticks(build))
        enforced = bool(self.app.config["ENFORCE_DOMAIN_LIMIT"])
        if self.error_code == DOMAIN_LIMIT_EXCEEDED_CODE:
            enforced = True
            if not build.is_over(max_domains):
                max_domains = int(build.numbers.measured * PRETEND_LIMIT_SHARE)
        if max_domains is not None and build.is_over(max_domains) and enforced:
            return self.end(
                job,
                STATUS_FAILED,
                failure_result(
                    DOMAIN_LIMIT_EXCEEDED_CODE,
                    over_limit_text(build.numbers.measured, max_domains, enforced=True),
                    build.limit(max_domains),
                ),
                build.snapshot(),
            )

        manifest, bodies = build_manifest(
            build.numbers.lists, job, inputs_digest(blocklists, whitelist), utc_now()
        )
        directory = store_generation(self.target.output_dir, manifest, bodies)
        self.step(job, build, generation_ticks(build, manifest))
        published, replaced = publish(
            self.database,
            self.target,
            manifest,
            job,
            build.numbers.combined,
            utc_now(),
        )
        if not published:
            shutil.rmtree(directory)
            return self.end(
                job,
                STATUS_SKIPPED,
                skipped_result(SUPERSEDED_SKIP_REASON),
                initial_progress(),
            )
        build.complete()
        status = self.end(
            job,
            STATUS_COMPLETED,
            build.completed_result(manifest, max_domains),
            build.snapshot(),
        )
        self.tidy(keep={manifest["generation_id"], replaced})
        return status

    def tidy(self, keep: set[str | None]) -> None:
        for directory in (self.target.output_dir / GENERATIONS_DIR).iterdir():
            if directory.is_dir() and directory.name not in keep:
                shutil.rmtree(directory)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replay a build into a job document for local development."
    )
    parser.add_argument("--username", default="alex")
    parser.add_argument(
        "--create",
        action="store_true",
        help="queue a manual build when the account has none waiting",
    )
    parser.add_argument("--step-seconds", type=float, default=DEFAULT_STEP_SECONDS)
    parser.add_argument("--outcome", choices=OUTCOMES, default=STATUS_COMPLETED)
    parser.add_argument(
        "--error-code",
        choices=ERROR_CODES,
        help="with --outcome failed, the error code the build ends with",
    )
    parser.add_argument(
        "--sources",
        type=int,
        default=0,
        help="pad the build with made-up sources up to this many",
    )
    parser.add_argument(
        "--queue-seconds",
        type=float,
        default=0.0,
        help="leave the build queued for this long before claiming it",
    )
    args = parser.parse_args()
    try:
        require_dev_environment()
        app = create_dev_app()
        with app.app_context():
            from app.extensions import mongo

            replay = Replay(
                app,
                mongo.db,
                args.username,
                args.outcome,
                max(args.step_seconds, 0.0),
                args.error_code,
                args.sources,
                max(args.queue_seconds, 0.0),
            )
            return replay.run(args.create)
    except Refusal as refusal:
        print(refusal, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
