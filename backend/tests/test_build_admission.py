import importlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from flask.testing import FlaskClient
from pymongo.errors import DuplicateKeyError, OperationFailure

from app.blueprints.admin import admin_bp
from app.blueprints.auth import auth_bp
from app.blueprints.user import user_bp
from app.config import TestingConfig
from app.db_indexes import ensure_indexes, prepare_active_job_targets
from app.extensions import mongo
from app.models.job import Job
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services import build_admission, job_feed
from app.services.build_admission import (
    DEFAULT_TARGET,
    AdmissionError,
    admit_build,
    queue_scheduled_user_builds,
    refund_quota_if_due,
)
from app.services.job_poller import JobStatusPoller
from app.utils.job_document import initial_progress, revision_bump
from app.utils.time import next_week_start, utc_iso, week_start

realtime: Any = importlib.import_module("app.socketio")
VALID_CONFIG = "https://example.com/hosts.txt|example|tracking"
INVALID_CONFIG = "http://127.0.0.1/private"
WEEKLY_LIMIT = TestingConfig.DEFAULT_MANUAL_UPDATES_PER_WEEK
FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures"


@dataclass
class Site:
    app: Flask
    db: Any
    emitted: list[tuple[str, dict[str, Any], str]]
    sam: User
    alex: User
    admin: User

    def client(self, user: User) -> FlaskClient:
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user.id
        return client

    def stored_user(self, user: User) -> dict[str, Any]:
        return self.db.users.find_one({"_id": ObjectId(user.id)})

    def used(self, user: User) -> int:
        return self.stored_user(user)["stats"]["manual_updates_this_week"]

    def set_stats(self, user: User, **stats: Any) -> None:
        self.db.users.update_one(
            {"_id": ObjectId(user.id)},
            {"$set": {f"stats.{key}": value for key, value in stats.items()}},
        )

    def finish(self, job: Job, status: str, error_code: str | None = None) -> None:
        result: dict[str, Any] = {"errors": []}
        if error_code:
            result["error_code"] = error_code
        self.db.jobs.update_one(
            {"job_id": job.job_id},
            {
                "$set": {
                    "status": status,
                    "result": result,
                    "completed_at": datetime.utcnow() - timedelta(hours=1),
                }
            },
        )


@pytest.fixture
def site(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Any:
    app = Flask(__name__)
    app.config.from_object(TestingConfig)
    app.config.update(SECRET_KEY="example-build-key", USERS_DIR=str(tmp_path / "users"))
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    ensure_indexes(db)
    realtime.init_socketio(app)
    emitted: list[tuple[str, dict[str, Any], str]] = []
    monkeypatch.setattr(
        realtime,
        "_emit",
        lambda event, data, room: emitted.append((event, data, room)),
    )
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(user_bp, url_prefix="/api/user")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        accounts = [
            User.find_or_create_from_github(github_id, name)
            for github_id, name in [(2001, "sam"), (2002, "alex"), (2003, "robin")]
        ]
        db.users.update_many(
            {"username": {"$in": ["sam", "alex"]}},
            {
                "$set": {
                    "config.blocklists": VALID_CONFIG,
                    "config.whitelist": "allowed.example.com",
                    "config.revision": 4,
                }
            },
        )
        db.users.update_one({"username": "robin"}, {"$set": {"is_admin": True}})
        sam, alex, admin = [User.get_by_id(account.id) for account in accounts]
        assert sam and alex and admin
        yield Site(app, db, emitted, sam, alex, admin)


def refusal(target: User | str, job_type: str, requested_by: User | None) -> Any:
    with pytest.raises(AdmissionError) as raised:
        admit_build(target, job_type, requested_by)
    return raised.value


def test_admitted_job_carries_target_snapshot_and_current_progress_shape(
    site: Site,
) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    stored = site.db.jobs.find_one({"job_id": job.job_id})
    assert stored["target_id"] == site.sam.id
    assert stored["user_id"] == ObjectId(site.sam.id)
    assert stored["status"] == "queued"
    assert stored["quota_charged"] is True
    assert stored["config_snapshot"] == {
        "blocklists": VALID_CONFIG,
        "whitelist": "allowed.example.com",
        "revision": 4,
        "limits": {
            "max_domains": TestingConfig.DEFAULT_MAX_DOMAINS,
            "max_source_lists": TestingConfig.DEFAULT_MAX_SOURCE_LISTS,
        },
    }
    assert stored["progress"] == {
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
    for key in ("result", "started_at", "completed_at", "worker_id", "claimed_at"):
        assert stored[key] is None
    assert stored["heartbeat_at"] is None


def test_second_admission_is_refused_with_the_active_job_and_one_charge(
    site: Site,
) -> None:
    first = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("build_active", 409)
    assert refused.details["job_id"] == first.job_id
    assert site.db.jobs.count_documents({}) == 1
    assert site.used(site.sam) == 1


def test_unique_index_refuses_a_racing_insert_and_refunds_the_charge(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    racing = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)
    find_active = Job.get_active_for_target
    lookups: list[str] = []

    def miss_the_first_lookup(target_id: str) -> Job | None:
        lookups.append(target_id)
        return None if len(lookups) == 1 else find_active(target_id)

    monkeypatch.setattr(Job, "get_active_for_target", miss_the_first_lookup)

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("build_active", 409)
    assert refused.details["job_id"] == racing.job_id
    assert refused.details["remaining_updates"] == WEEKLY_LIMIT
    assert len(lookups) == 2
    assert site.db.jobs.count_documents({}) == 1
    assert site.used(site.sam) == 0


def test_injected_duplicate_key_error_refunds_and_reports_the_active_job(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    site.db.jobs.insert_one(
        {"job_id": "other-job", "target_id": site.sam.id, "status": "processing"}
    )
    monkeypatch.setattr(
        Job, "get_active_for_target", Mock(side_effect=[None, Job({"job_id": "x"})])
    )
    monkeypatch.setattr(
        site.db.jobs, "insert_one", Mock(side_effect=DuplicateKeyError("E11000"))
    )

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert refused.code == "build_active"
    assert refused.details["job_id"] == "x"
    assert site.used(site.sam) == 0


def test_duplicate_key_error_without_an_active_job_is_not_hidden(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        site.db.jobs, "insert_one", Mock(side_effect=DuplicateKeyError("E11000"))
    )

    with pytest.raises(DuplicateKeyError):
        admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    assert site.used(site.sam) == 0


def test_different_targets_build_at_the_same_time(site: Site) -> None:
    admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    admit_build(site.alex, Job.TYPE_MANUAL, site.alex)
    admit_build(DEFAULT_TARGET, Job.TYPE_SCHEDULED, None)

    assert site.db.jobs.count_documents({"status": "queued"}) == 3


def test_target_can_build_again_after_its_job_ends(site: Site) -> None:
    first = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)
    site.finish(first, Job.STATUS_COMPLETED)

    second = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)

    assert second.job_id != first.job_id


def test_priorities_order_default_then_requested_then_scheduled(site: Site) -> None:
    scheduled = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    manual = admit_build(site.alex, Job.TYPE_MANUAL, site.alex)
    default = admit_build(DEFAULT_TARGET, Job.TYPE_SCHEDULED, None)
    site.finish(scheduled, Job.STATUS_COMPLETED)
    admin_requested = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)

    assert default.priority < manual.priority < scheduled.priority
    assert admin_requested.priority == manual.priority
    claim_order = [job.job_id for job in Job.get_active()]
    assert claim_order == [default.job_id, manual.job_id, admin_requested.job_id]


def test_default_build_snapshots_the_stored_default_config(site: Site) -> None:
    SystemConfig.update_default_blocklists(VALID_CONFIG, "robin")
    SystemConfig.update_default_whitelist("allowed.example.com", "robin")

    job = admit_build(DEFAULT_TARGET, Job.TYPE_ADMIN, site.admin, force_rebuild=True)

    stored = site.db.jobs.find_one({"job_id": job.job_id})
    assert stored["target_id"] == "__default__"
    assert stored["username"] == "__default__"
    assert stored["user_id"] is None
    assert stored["force_rebuild"] is True
    assert stored["quota_charged"] is False
    assert stored["config_snapshot"] == {
        "blocklists": VALID_CONFIG,
        "whitelist": "allowed.example.com",
        "revision": None,
        "limits": None,
    }


def test_second_default_build_is_refused(site: Site) -> None:
    first = admit_build(DEFAULT_TARGET, Job.TYPE_SCHEDULED, None)

    refused = refusal(DEFAULT_TARGET, Job.TYPE_ADMIN, site.admin)

    assert (refused.code, refused.status) == ("build_active", 409)
    assert refused.details == {"job_id": first.job_id}


def test_invalid_default_config_is_refused(site: Site) -> None:
    SystemConfig.update_default_blocklists(INVALID_CONFIG, "robin")

    refused = refusal(DEFAULT_TARGET, Job.TYPE_SCHEDULED, None)

    assert (refused.code, refused.status) == ("invalid_config", 400)
    assert site.db.jobs.count_documents({}) == 0


def test_quota_is_charged_under_the_limit_and_refused_at_it(site: Site) -> None:
    for expected_used in range(1, WEEKLY_LIMIT + 1):
        job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
        assert site.used(site.sam) == expected_used
        site.finish(job, Job.STATUS_COMPLETED)

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("weekly_limit", 429)
    assert refused.details == {
        "remaining": 0,
        "remaining_updates": 0,
        "resets_at": utc_iso(next_week_start(datetime.utcnow())),
    }
    assert site.used(site.sam) == WEEKLY_LIMIT
    assert site.db.jobs.count_documents({"status": "queued"}) == 0


def test_counter_from_an_earlier_week_resets_on_the_next_charge(site: Site) -> None:
    last_week = week_start(datetime.utcnow()) - timedelta(days=3)
    site.set_stats(
        site.sam, manual_updates_this_week=WEEKLY_LIMIT, week_reset_at=last_week
    )
    stale = User.get_by_id(site.sam.id)
    assert stale is not None
    assert stale.get_remaining_manual_updates() == WEEKLY_LIMIT
    assert stale.stats["manual_updates_this_week"] == 0

    admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    stats = site.stored_user(site.sam)["stats"]
    assert stats["manual_updates_this_week"] == 1
    assert stats["week_reset_at"] == week_start(datetime.utcnow())


def test_counter_with_no_stored_week_counts_as_an_earlier_week(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)},
        {
            "$set": {"stats.manual_updates_this_week": WEEKLY_LIMIT},
            "$unset": {"stats.week_reset_at": ""},
        },
    )
    unweeked = User.get_by_id(site.sam.id)
    assert unweeked is not None
    assert unweeked.get_remaining_manual_updates() == WEEKLY_LIMIT

    admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    stats = site.stored_user(site.sam)["stats"]
    assert stats["manual_updates_this_week"] == 1
    assert stats["week_reset_at"] == week_start(datetime.utcnow())


def test_user_with_no_stats_is_charged(site: Site) -> None:
    site.db.users.update_one({"_id": ObjectId(site.sam.id)}, {"$unset": {"stats": ""}})

    admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    assert site.used(site.sam) == 1


def test_counter_in_the_current_week_keeps_counting(site: Site) -> None:
    site.set_stats(
        site.sam,
        manual_updates_this_week=WEEKLY_LIMIT,
        week_reset_at=week_start(datetime.utcnow()) + timedelta(seconds=1),
    )
    current = User.get_by_id(site.sam.id)
    assert current is not None
    assert current.get_remaining_manual_updates() == 0

    assert refusal(site.sam, Job.TYPE_MANUAL, site.sam).code == "weekly_limit"


def test_admin_manual_build_is_not_charged_or_limited(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.admin.id)}, {"$set": {"config.blocklists": VALID_CONFIG}}
    )
    site.set_stats(
        site.admin,
        manual_updates_this_week=WEEKLY_LIMIT,
        week_reset_at=week_start(datetime.utcnow()),
    )

    job = admit_build(site.admin, Job.TYPE_MANUAL, site.admin)

    assert site.db.jobs.find_one({"job_id": job.job_id})["quota_charged"] is False
    assert site.used(site.admin) == WEEKLY_LIMIT


def test_admin_and_scheduled_builds_do_not_charge_the_user(site: Site) -> None:
    first = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)
    site.finish(first, Job.STATUS_COMPLETED)
    admit_build(site.sam, Job.TYPE_SCHEDULED, None)

    assert site.used(site.sam) == 0
    assert site.db.jobs.count_documents({"quota_charged": True}) == 0


def test_cooldown_refuses_without_charging(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {"$set": {"status": "completed", "completed_at": datetime.utcnow()}},
    )

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("cooldown", 429)
    assert 0 < refused.details["cooldown_remaining"] <= 300
    assert refused.details["remaining_updates"] == WEEKLY_LIMIT - 1
    assert site.used(site.sam) == 1


def test_skipped_build_is_refunded_and_still_starts_the_cooldown(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {"$set": {"status": Job.STATUS_SKIPPED, "completed_at": datetime.utcnow()}},
    )
    assert refund_quota_if_due(job.job_id) is True

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("cooldown", 429)
    assert 0 < refused.details["cooldown_remaining"] <= 300
    assert refused.details["remaining_updates"] == WEEKLY_LIMIT
    assert site.used(site.sam) == 0
    assert site.db.jobs.count_documents({}) == 1


def test_cooldown_counts_from_the_latest_completed_or_skipped_build(
    site: Site,
) -> None:
    user_id = ObjectId(site.sam.id)
    now = datetime.utcnow()
    for status, minutes_ago in [
        (Job.STATUS_COMPLETED, 4),
        (Job.STATUS_SKIPPED, 1),
        (Job.STATUS_FAILED, 0),
    ]:
        site.db.jobs.insert_one(
            {
                "job_id": f"ended-{status}",
                "target_id": f"ended-{status}",
                "user_id": user_id,
                "type": Job.TYPE_MANUAL,
                "status": status,
                "completed_at": now - timedelta(minutes=minutes_ago),
            }
        )

    assert 230 < Job.get_cooldown_remaining(user_id, cooldown_minutes=5) <= 240


@pytest.mark.parametrize("job_type", [Job.TYPE_SCHEDULED, Job.TYPE_ADMIN])
def test_failed_and_other_kinds_of_build_start_no_cooldown(
    site: Site, job_type: str
) -> None:
    failed = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.db.jobs.update_one(
        {"job_id": failed.job_id},
        {"$set": {"status": Job.STATUS_FAILED, "completed_at": datetime.utcnow()}},
    )
    other = admit_build(site.sam, job_type, site.admin)
    site.db.jobs.update_one(
        {"job_id": other.job_id},
        {"$set": {"status": Job.STATUS_SKIPPED, "completed_at": datetime.utcnow()}},
    )

    assert Job.get_cooldown_remaining(ObjectId(site.sam.id)) == 0
    admit_build(site.sam, Job.TYPE_MANUAL, site.sam)


def test_invalid_config_is_refused_with_errors_and_no_charge(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": INVALID_CONFIG}}
    )

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("invalid_config", 400)
    assert refused.details["errors"] == ["Line 1: Invalid or unsafe source URL"]
    assert site.used(site.sam) == 0
    assert site.db.jobs.count_documents({}) == 0


def test_missing_config_is_refused(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": "  \n"}}
    )

    refused = refusal(site.sam, Job.TYPE_MANUAL, site.sam)

    assert (refused.code, refused.status) == ("no_config", 400)
    assert site.used(site.sam) == 0


def test_unknown_job_type_and_target_are_rejected(site: Site) -> None:
    with pytest.raises(ValueError):
        admit_build(site.sam, "urgent", site.sam)
    with pytest.raises(ValueError):
        admit_build("someone", Job.TYPE_ADMIN, site.admin)


@pytest.mark.parametrize(
    ("status", "error_code"),
    [
        (Job.STATUS_SKIPPED, None),
        (Job.STATUS_FAILED, "worker_abandoned"),
        (Job.STATUS_FAILED, "internal"),
        (Job.STATUS_FAILED, "superseded"),
    ],
)
def test_refund_is_applied_once(site: Site, status: str, error_code: str) -> None:
    earlier = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(earlier, Job.STATUS_COMPLETED)
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, status, error_code)

    assert refund_quota_if_due(job.job_id) is True
    assert refund_quota_if_due(job.job_id) is False

    assert site.used(site.sam) == 1
    assert site.db.jobs.find_one({"job_id": job.job_id})["quota_refunded"] is True


@pytest.mark.parametrize(
    ("status", "error_code"),
    [
        (Job.STATUS_FAILED, None),
        (Job.STATUS_FAILED, "source_unreachable"),
        (Job.STATUS_COMPLETED, None),
        (Job.STATUS_PROCESSING, None),
    ],
)
def test_other_outcomes_keep_the_charge(
    site: Site, status: str, error_code: str
) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, status, error_code)

    assert refund_quota_if_due(job.job_id) is False

    assert site.used(site.sam) == 1
    assert "quota_refunded" not in site.db.jobs.find_one({"job_id": job.job_id})


def test_uncharged_build_is_never_refunded(site: Site) -> None:
    site.set_stats(
        site.sam,
        manual_updates_this_week=2,
        week_reset_at=week_start(datetime.utcnow()),
    )
    job = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)
    site.finish(job, Job.STATUS_SKIPPED)

    assert refund_quota_if_due(job.job_id) is False
    assert site.used(site.sam) == 2


def test_refund_is_dropped_once_the_week_has_rolled_over(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, Job.STATUS_SKIPPED)
    site.set_stats(
        site.sam,
        manual_updates_this_week=2,
        week_reset_at=next_week_start(datetime.utcnow()),
    )

    assert refund_quota_if_due(job.job_id) is False

    assert site.used(site.sam) == 2
    assert site.db.jobs.find_one({"job_id": job.job_id})["quota_refunded"] is True


def test_refund_never_takes_the_counter_below_zero(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, Job.STATUS_SKIPPED)
    site.set_stats(site.sam, manual_updates_this_week=0)

    assert refund_quota_if_due(job.job_id) is False
    assert site.used(site.sam) == 0


def test_poller_refunds_a_skipped_build_and_reports_it_once(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(job_feed, "database_time", datetime.utcnow)
    poller = JobStatusPoller()
    poller.poll_once()
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    poller.poll_once()
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {"status": Job.STATUS_SKIPPED, "result": {"errors": []}},
            **revision_bump(),
        },
    )

    poller.poll_once()
    poller.poll_once()

    assert site.used(site.sam) == 0
    completed = [event for event in site.emitted if event[0] == "job:completed"]
    assert len(completed) == 2
    assert {room for _, _, room in completed} == {"jobs:all", f"jobs:{site.sam.id}"}


def test_abandoned_job_is_marked_for_refund(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": "processing",
                "heartbeat_at": datetime.utcnow() - timedelta(hours=1),
                "stale_attempts": Job.MAX_STALE_ATTEMPTS,
            }
        },
    )

    assert Job.reset_stale() == (0, 1)

    stored = site.db.jobs.find_one({"job_id": job.job_id})
    assert stored["status"] == "failed"
    assert stored["result"]["error_code"] == "worker_abandoned"
    assert refund_quota_if_due(job.job_id) is True
    assert site.used(site.sam) == 0


def test_requeued_stale_job_still_blocks_a_second_build(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_ADMIN, site.admin)
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": "processing",
                "heartbeat_at": datetime.utcnow() - timedelta(hours=1),
            }
        },
    )

    assert Job.reset_stale() == (1, 0)

    assert refusal(site.sam, Job.TYPE_SCHEDULED, None).details["job_id"] == job.job_id


def test_no_client_payload_carries_the_config_snapshot(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(job_feed, "database_time", datetime.utcnow)
    poller = JobStatusPoller()
    poller.poll_once()
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    stored = Job.get_by_id(job.job_id)
    assert stored is not None
    poller.poll_once()
    for path in (f"/api/user/jobs/{job.job_id}", "/api/user/jobs"):
        body = site.client(site.sam).get(path).get_data(as_text=True)
        assert job.job_id in body
        assert "queue_info" in body
        assert "config_snapshot" not in body
    for path in (f"/api/admin/jobs/{job.job_id}", "/api/admin/jobs"):
        body = site.client(site.admin).get(path).get_data(as_text=True)
        assert job.job_id in body
        assert "queue_info" in body
        assert "config_snapshot" not in body
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {"status": Job.STATUS_COMPLETED, "result": {"errors": []}},
            **revision_bump(),
        },
    )
    poller.poll_once()

    assert stored.to_dict()["target_id"] == site.sam.id
    assert "config_snapshot" not in stored.to_dict()
    events = {event for event, _, _ in site.emitted}
    assert {"job:created", "job:progress", "job:completed"} <= events
    for _, payload, _ in site.emitted:
        assert VALID_CONFIG not in repr(payload)
        assert "config_snapshot" not in repr(payload)


def test_target_id_is_derived_for_jobs_stored_before_the_field_existed() -> None:
    user_id = ObjectId("000000000000000000000001")
    assert Job({"user_id": user_id, "username": "sam"}).to_dict()["target_id"] == str(
        user_id
    )
    assert Job({"user_id": None, "username": "__default__"}).target_id == "__default__"
    assert Job({"user_id": None, "username": "sam"}).target_id is None


def test_build_route_keeps_the_keys_the_dashboard_reads(site: Site) -> None:
    client = site.client(site.sam)

    started = client.post("/api/user/build")

    assert started.status_code == 200
    body = started.get_json()
    assert set(body) == {"job_id", "status", "remaining_updates"}
    assert body["status"] == "queued"
    assert body["remaining_updates"] == WEEKLY_LIMIT - 1
    lists = client.get("/api/user/lists").get_json()
    assert lists["remaining_updates"] == WEEKLY_LIMIT - 1
    assert lists["stats"]["manual_updates_this_week"] == 1

    active = client.post("/api/user/build")

    assert active.status_code == 409
    assert active.get_json() == {
        "error": "A build is already in progress",
        "code": "build_active",
        "job_id": body["job_id"],
        "remaining_updates": WEEKLY_LIMIT - 1,
    }


def test_build_route_reports_cooldown_and_weekly_limit(site: Site) -> None:
    client = site.client(site.sam)
    job_id = client.post("/api/user/build").get_json()["job_id"]
    site.db.jobs.update_one(
        {"job_id": job_id},
        {"$set": {"status": "completed", "completed_at": datetime.utcnow()}},
    )

    cooling = client.post("/api/user/build")

    assert cooling.status_code == 429
    assert set(cooling.get_json()) == {
        "error",
        "code",
        "cooldown_remaining",
        "remaining_updates",
    }
    assert cooling.get_json()["error"].startswith("Please wait ")

    site.db.jobs.delete_many({})
    site.set_stats(site.sam, manual_updates_this_week=WEEKLY_LIMIT)
    limited = client.post("/api/user/build")

    assert limited.status_code == 429
    assert limited.get_json() == {
        "error": "Weekly manual update limit reached",
        "code": "weekly_limit",
        "remaining": 0,
        "remaining_updates": 0,
        "resets_at": utc_iso(next_week_start(datetime.utcnow())),
    }
    assert client.get("/api/user/lists").get_json()["remaining_updates"] == 0


def test_build_route_reports_missing_and_invalid_config(site: Site) -> None:
    client = site.client(site.sam)
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": INVALID_CONFIG}}
    )

    invalid = client.post("/api/user/build")

    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "invalid_config"
    assert invalid.get_json()["errors"] == ["Line 1: Invalid or unsafe source URL"]

    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$unset": {"config.blocklists": ""}}
    )
    missing = client.post("/api/user/build")

    assert missing.status_code == 400
    assert missing.get_json() == {
        "error": "No blocklist configuration found",
        "code": "no_config",
    }


def test_admin_rebuild_during_an_active_job_is_refused(site: Site) -> None:
    active = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    client = site.client(site.admin)

    refused = client.post(f"/api/admin/rebuild/{site.sam.id}")

    assert refused.status_code == 409
    assert refused.get_json()["code"] == "build_active"
    assert refused.get_json()["job_id"] == active.job_id
    assert site.db.jobs.count_documents({}) == 1


def test_admin_rebuild_routes_keep_their_success_keys(site: Site) -> None:
    client = site.client(site.admin)

    user_rebuild = client.post(f"/api/admin/rebuild/{site.sam.id}")
    default_rebuild = client.post("/api/admin/rebuild/default")
    second_default = client.post("/api/admin/rebuild/default")

    assert user_rebuild.status_code == 200
    assert set(user_rebuild.get_json()) == {"job_id", "status"}
    assert default_rebuild.status_code == 200
    assert set(default_rebuild.get_json()) == {"job_id", "status"}
    assert second_default.status_code == 409
    assert second_default.get_json()["job_id"] == default_rebuild.get_json()["job_id"]
    stored = site.db.jobs.find_one({"job_id": user_rebuild.get_json()["job_id"]})
    assert stored["type"] == "admin"
    assert stored["force_rebuild"] is True
    assert stored["priority"] == Job.PRIORITY_NORMAL
    assert site.used(site.sam) == 0


def test_scheduled_rebuild_skips_active_recent_and_unconfigured_users(
    site: Site,
) -> None:
    active = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)

    assert queue_scheduled_user_builds() == (1, 1)

    scheduled = site.db.jobs.find_one({"type": "scheduled"})
    assert scheduled["target_id"] == site.alex.id
    assert scheduled["priority"] == Job.PRIORITY_LOW

    site.db.jobs.delete_one({"job_id": scheduled["job_id"]})
    site.db.jobs.update_one(
        {"job_id": active.job_id},
        {"$set": {"status": "completed", "completed_at": datetime.utcnow()}},
    )

    assert queue_scheduled_user_builds() == (1, 1)
    assert site.db.jobs.count_documents({"target_id": site.sam.id}) == 1


def weekly_skip_notices(site: Site, user: User) -> list[dict[str, Any]]:
    return [
        notice
        for notice in site.stored_user(user).get("notifications", [])
        if notice["type"] == build_admission.WEEKLY_REBUILD_SKIPPED_TYPE
    ]


def test_scheduled_rebuild_refused_for_an_invalid_config_notifies_the_user_once(
    site: Site, caplog: pytest.LogCaptureFixture
) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": INVALID_CONFIG}}
    )

    with caplog.at_level("WARNING", logger="app.services.build_admission"):
        assert queue_scheduled_user_builds() == (1, 1)
        site.db.jobs.delete_many({})
        assert queue_scheduled_user_builds() == (1, 1)

    notices = weekly_skip_notices(site, site.sam)
    assert len(notices) == 1
    assert notices[0]["title"] == "Your weekly rebuild was skipped"
    assert notices[0]["message"] == (
        "The weekly rebuild of your lists was skipped because your saved "
        "configuration is not valid. "
        'The first problem is "Line 1: Invalid or unsafe source URL". '
        "Your current lists stay published until you fix and save the configuration."
    )
    assert notices[0]["read"] is False
    assert notices[0]["data"] == {"error_count": 1}
    assert weekly_skip_notices(site, site.alex) == []
    assert site.db.jobs.count_documents({"target_id": site.sam.id}) == 0
    warnings = [
        record.getMessage()
        for record in caplog.records
        if record.levelname == "WARNING"
    ]
    assert (
        warnings
        == [
            f"Weekly rebuild refused for user {site.sam.id}: "
            "configuration validation errors: 1"
        ]
        * 2
    )
    assert INVALID_CONFIG not in caplog.text
    shown = site.client(site.sam).get("/api/user/notifications").get_json()
    assert [notice["id"] for notice in shown["notifications"]] == [notices[0]["id"]]


def test_scheduled_rebuild_notifies_again_once_the_earlier_notice_is_read(
    site: Site,
) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": INVALID_CONFIG}}
    )
    queue_scheduled_user_builds()
    site.db.jobs.delete_many({})
    first = weekly_skip_notices(site, site.sam)[0]
    stored = User.get_by_id(site.sam.id)
    assert stored is not None
    assert stored.mark_notification_read(first["id"])

    queue_scheduled_user_builds()

    notices = weekly_skip_notices(site, site.sam)
    assert [notice["read"] for notice in notices] == [False, True]


def test_weekly_skip_notice_keeps_the_notification_cap(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)},
        {
            "$set": {
                "config.blocklists": INVALID_CONFIG,
                "notifications": [
                    {"id": str(index), "type": "example", "read": False}
                    for index in range(User.MAX_NOTIFICATIONS)
                ],
            }
        },
    )

    queue_scheduled_user_builds()

    stored = site.stored_user(site.sam)["notifications"]
    assert len(stored) == User.MAX_NOTIFICATIONS
    assert stored[0]["type"] == build_admission.WEEKLY_REBUILD_SKIPPED_TYPE


def test_scheduled_rebuild_without_a_config_sends_no_notice(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"config.blocklists": ""}}
    )

    assert queue_scheduled_user_builds() == (1, 0)

    assert weekly_skip_notices(site, site.sam) == []


def test_scheduled_rebuild_continues_after_one_user_fails(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    admit = build_admission.admit_build

    def failing_for_sam(target: Any, job_type: str, requested_by: Any) -> Job:
        if target.username == "sam":
            raise RuntimeError("database write failed")
        return admit(target, job_type, requested_by)

    monkeypatch.setattr(build_admission, "admit_build", failing_for_sam)

    assert queue_scheduled_user_builds() == (1, 0)


def test_preparation_backfills_targets_and_cancels_duplicates() -> None:
    db: Any = mongomock.MongoClient().default
    sam = ObjectId("000000000000000000000001")
    alex = ObjectId("000000000000000000000002")
    older = datetime(2026, 1, 1)
    newer = datetime(2026, 1, 2)
    db.jobs.insert_many(
        [
            {"job_id": "sam-queued", "user_id": sam, "status": "queued"},
            {"job_id": "sam-processing", "user_id": sam, "status": "processing"},
            {"job_id": "alex-old", "user_id": alex, "status": "queued"},
            {"job_id": "alex-new", "user_id": alex, "status": "queued"},
            {"job_id": "default-a", "user_id": None, "username": "__default__"},
            {"job_id": "default-b", "user_id": None, "username": "__default__"},
            {"job_id": "sam-done", "user_id": sam, "status": "completed"},
            {"job_id": "stray", "user_id": None, "username": "sam", "status": "queued"},
        ]
    )
    db.jobs.update_one({"job_id": "sam-queued"}, {"$set": {"created_at": older}})
    db.jobs.update_one({"job_id": "sam-processing"}, {"$set": {"created_at": newer}})
    db.jobs.update_one({"job_id": "alex-old"}, {"$set": {"created_at": older}})
    db.jobs.update_one({"job_id": "alex-new"}, {"$set": {"created_at": newer}})
    db.jobs.update_one(
        {"job_id": "default-a"}, {"$set": {"status": "queued", "created_at": newer}}
    )
    db.jobs.update_one(
        {"job_id": "default-b"}, {"$set": {"status": "queued", "created_at": older}}
    )

    prepare_active_job_targets(db)
    prepare_active_job_targets(db)

    jobs = {job["job_id"]: job for job in db.jobs.find()}
    assert jobs["sam-processing"]["status"] == "processing"
    assert jobs["alex-old"]["status"] == "queued"
    assert jobs["default-b"]["status"] == "queued"
    assert jobs["sam-processing"]["target_id"] == str(sam)
    assert jobs["alex-old"]["target_id"] == str(alex)
    assert jobs["default-b"]["target_id"] == "__default__"
    assert jobs["stray"]["status"] == "queued"
    assert jobs["stray"]["target_id"] == f"orphan:{jobs['stray']['_id']}"
    assert "target_id" not in jobs["sam-done"]
    for cancelled in ("sam-queued", "alex-new", "default-a"):
        assert jobs[cancelled]["status"] == "failed"
        assert jobs[cancelled]["result"]["error_code"] == "superseded"
        assert "another build" in jobs[cancelled]["result"]["errors"][0]
        assert jobs[cancelled]["completed_at"] is not None
    active_targets = [
        job["target_id"]
        for job in jobs.values()
        if job.get("status") in ("queued", "processing")
    ]
    assert len(active_targets) == len(set(active_targets)) == 4


def test_startup_prepares_jobs_before_creating_the_index(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    sam = ObjectId("000000000000000000000001")
    db.jobs.insert_many(
        [
            {"job_id": "sam-active", "user_id": sam, "status": "processing"},
            {"job_id": "default-active", "username": "__default__", "status": "queued"},
        ]
    )

    ensure_indexes(db)
    ensure_indexes(db)

    assert "one_active_job_per_target" in db.jobs.index_information()
    assert db.jobs.find_one({"job_id": "sam-active"})["target_id"] == str(sam)
    with pytest.raises(DuplicateKeyError):
        db.jobs.insert_one(
            {"job_id": "sam-again", "target_id": str(sam), "status": "queued"}
        )
    db.jobs.insert_one(
        {"job_id": "sam-ended", "target_id": str(sam), "status": "completed"}
    )


def test_failed_preparation_is_logged_and_startup_continues(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    monkeypatch.setattr(
        db.jobs, "find", Mock(side_effect=OperationFailure("not authorised"))
    )

    ensure_indexes(db)

    assert "Could not prepare jobs" in caplog.text
    assert "one_active_job_per_target" in db.jobs.index_information()
    assert "user_id_1" in db.validation_tokens.index_information()


def test_preparation_changes_nothing_when_targets_are_already_unique() -> None:
    db: Any = mongomock.MongoClient().default
    db.jobs.insert_one(
        {"job_id": "only", "target_id": "__default__", "status": "queued"}
    )
    before = db.jobs.find_one({"job_id": "only"})

    prepare_active_job_targets(db)

    assert db.jobs.find_one({"job_id": "only"}) == before


def test_week_starts_on_sunday_midnight_utc() -> None:
    sunday = datetime(2026, 11, 8)
    assert week_start(datetime(2026, 11, 8)) == sunday
    assert week_start(datetime(2026, 11, 14, 23, 59, 59)) == sunday
    assert week_start(datetime(2026, 11, 15)) == datetime(2026, 11, 15)
    assert next_week_start(datetime(2026, 11, 14, 20, 29)) == datetime(2026, 11, 15)


def shared_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


def claim_as_stale(site: Site, job: Job, **fields: Any) -> dict[str, Any]:
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": "processing",
                "worker_id": "worker-a",
                "claimed_at": datetime.utcnow() - timedelta(hours=1),
                "heartbeat_at": datetime.utcnow() - timedelta(hours=1),
                "started_at": datetime(2026, 1, 2, 3, 4, 5),
                "updated_at": datetime(2026, 1, 2, 3, 4, 5),
                "attempt": 1,
                "rev": 7,
                "progress": {"stage": "downloading", "sources": [{"id": "a"}]},
                **fields,
            }
        },
    )
    return site.db.jobs.find_one({"job_id": job.job_id})


def test_admission_and_stale_requeue_write_the_shared_initial_progress(
    site: Site,
) -> None:
    expected = shared_fixture("job-initial-progress.json")
    assert initial_progress() == expected

    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    admitted = site.db.jobs.find_one({"job_id": job.job_id})
    assert admitted["progress"] == expected
    assert admitted["rev"] == 0
    assert admitted["updated_at"] == admitted["created_at"]

    claim_as_stale(site, job)
    assert Job.reset_stale() == (1, 0)

    assert site.db.jobs.find_one({"job_id": job.job_id})["progress"] == expected


def test_stale_requeue_clears_the_lease_and_bumps_the_revision(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    claimed = claim_as_stale(site, job)

    assert Job.reset_stale() == (1, 0)

    stored = site.db.jobs.find_one({"job_id": job.job_id})
    assert stored["status"] == "queued"
    for key in ("worker_id", "claimed_at", "heartbeat_at"):
        assert stored[key] is None
    assert stored["started_at"] == claimed["started_at"]
    assert stored["attempt"] == 1
    assert stored["stale_attempts"] == 1
    assert stored["rev"] == 8
    assert stored["updated_at"] > claimed["updated_at"]


def test_abandoning_a_job_bumps_the_revision(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    claimed = claim_as_stale(site, job, stale_attempts=Job.MAX_STALE_ATTEMPTS)

    assert Job.reset_stale() == (0, 1)

    stored = site.db.jobs.find_one({"job_id": job.job_id})
    assert stored["status"] == "failed"
    assert stored["rev"] == 8
    assert stored["updated_at"] > claimed["updated_at"]


def test_refund_flag_and_read_flag_bump_the_revision(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, Job.STATUS_FAILED, "internal")
    before = site.db.jobs.find_one({"job_id": job.job_id})

    assert refund_quota_if_due(job.job_id) is True
    refunded = site.db.jobs.find_one({"job_id": job.job_id})
    assert refunded["rev"] == before["rev"] + 1
    assert refunded["updated_at"] > before["updated_at"]

    Job.mark_failures_read(ObjectId(site.sam.id))
    read = site.db.jobs.find_one({"job_id": job.job_id})
    assert read["read"] is True
    assert read["rev"] == before["rev"] + 2

    Job.mark_failures_read(ObjectId(site.sam.id))
    assert site.db.jobs.find_one({"job_id": job.job_id}) == read


def test_duplicate_cancellation_bumps_the_revision() -> None:
    db: Any = mongomock.MongoClient().default
    sam = ObjectId("000000000000000000000001")
    stamped = datetime(2026, 1, 1)
    db.jobs.insert_many(
        [
            {
                "job_id": name,
                "user_id": sam,
                "status": "queued",
                "created_at": created,
                "rev": 3,
                "updated_at": stamped,
            }
            for name, created in [
                ("kept", stamped),
                ("cancelled", datetime(2026, 1, 2)),
            ]
        ]
    )

    prepare_active_job_targets(db)

    jobs = {job["job_id"]: job for job in db.jobs.find()}
    assert jobs["cancelled"]["status"] == "failed"
    assert jobs["cancelled"]["rev"] == 5
    assert jobs["cancelled"]["updated_at"] > stamped
    assert jobs["kept"]["status"] == "queued"
    assert jobs["kept"]["rev"] == 4


def test_refund_codes_agree_with_the_codes_each_side_writes() -> None:
    codes = shared_fixture("job-error-codes.json")
    known = {**codes["worker"], **codes["backend"]}
    refundable = {code for code, rule in known.items() if rule["refunds_quota"]}

    assert set(build_admission.REFUNDABLE_ERROR_CODES) == refundable
    assert set(codes["backend"]) == {Job.ERROR_WORKER_ABANDONED, Job.ERROR_SUPERSEDED}
    assert not set(codes["worker"]) & set(codes["backend"])


@pytest.mark.parametrize(
    ("error_code", "refunded"),
    [
        (code, rule["refunds_quota"])
        for code, rule in json.loads((FIXTURES / "job-error-codes.json").read_text())[
            "worker"
        ].items()
    ],
)
def test_worker_failure_codes_refund_only_when_the_fixture_says_so(
    site: Site, error_code: str, refunded: bool
) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.finish(job, Job.STATUS_FAILED, error_code)

    assert refund_quota_if_due(job.job_id) is refunded
    assert site.used(site.sam) == (0 if refunded else 1)


def test_null_error_code_on_a_completed_job_is_not_refunded(site: Site) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": Job.STATUS_COMPLETED,
                "result": {"errors": [], "error_code": None},
            }
        },
    )

    assert refund_quota_if_due(job.job_id) is False
    assert site.used(site.sam) == 1
