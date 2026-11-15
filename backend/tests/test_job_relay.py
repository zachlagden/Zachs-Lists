import importlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from unittest.mock import Mock

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from flask.testing import FlaskClient
from flask_socketio import SocketIOTestClient
from pymongo.errors import ConnectionFailure

from app.blueprints.admin import admin_bp
from app.blueprints.auth import auth_bp
from app.blueprints.user import user_bp
from app.config import TestingConfig
from app.db_indexes import ensure_indexes
from app.extensions import mongo
from app.models.job import Job
from app.models.user import User
from app.services import build_admission, job_feed, limit_review
from app.services.job_poller import MAX_SIDE_EFFECT_ATTEMPTS, JobStatusPoller
from app.utils.job_document import initial_progress, revision_bump

realtime: Any = importlib.import_module("app.socketio")
PRIVATE_CONFIG = "https://example.com/private-hosts.txt|private|tracking"
Emitted = list[tuple[str, dict[str, Any], str]]


@dataclass
class Relay:
    app: Flask
    db: Any
    emitted: Emitted
    poller: JobStatusPoller
    sam: User
    alex: User
    admin: User

    def http(self, user: User) -> FlaskClient:
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user.id
        return client

    def socket(self, user: User) -> SocketIOTestClient:
        return realtime.socketio.test_client(
            self.app, flask_test_client=self.http(user)
        )

    def add_job(self, user: User, **fields: Any) -> str:
        now = datetime.utcnow()
        document: dict[str, Any] = {
            "job_id": str(uuid.uuid4()),
            "target_id": user.id,
            "user_id": ObjectId(user.id),
            "username": user.username,
            "type": Job.TYPE_MANUAL,
            "status": Job.STATUS_QUEUED,
            "priority": Job.PRIORITY_NORMAL,
            "config_snapshot": {"blocklists": PRIVATE_CONFIG, "whitelist": ""},
            "progress": initial_progress(),
            "result": None,
            "created_at": now,
            "rev": 0,
            "updated_at": now,
        }
        document.update(fields)
        self.db.jobs.insert_one(document)
        return document["job_id"]

    def worker_write(self, job_id: str, **fields: Any) -> None:
        self.db.jobs.update_one({"job_id": job_id}, {"$set": fields, **revision_bump()})

    def events(self, room: str = "jobs:all") -> list[tuple[str, dict[str, Any]]]:
        return [
            (event, payload)
            for event, payload, target in self.emitted
            if target == room and event.startswith("job:")
        ]

    def names(self, room: str = "jobs:all") -> list[str]:
        return [event for event, _ in self.events(room)]


@pytest.fixture
def relay(monkeypatch: pytest.MonkeyPatch) -> Any:
    app = Flask(__name__)
    app.config.from_object(TestingConfig)
    app.config.update(SECRET_KEY="example-relay-key")
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    monkeypatch.setattr(job_feed, "database_time", datetime.utcnow)
    ensure_indexes(db)
    realtime.init_socketio(app)
    emitted: Emitted = []
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
            for github_id, name in [(3001, "sam"), (3002, "alex"), (3003, "robin")]
        ]
        db.users.update_one({"username": "robin"}, {"$set": {"is_admin": True}})
        sam, alex, admin = [User.get_by_id(account.id) for account in accounts]
        assert sam and alex and admin
        poller = JobStatusPoller()
        poller.poll_once()
        yield Relay(app, db, emitted, poller, sam, alex, admin)


def test_job_first_seen_finished_is_created_then_completed_once(relay: Relay) -> None:
    job_id = relay.add_job(
        relay.sam, status=Job.STATUS_SKIPPED, result={"errors": []}, rev=3
    )

    for _ in range(3):
        relay.poller.poll_once()

    for room in ("jobs:all", f"jobs:{relay.sam.id}"):
        assert relay.names(room) == ["job:created", "job:completed"]
    assert all(payload["job_id"] == job_id for _, payload in relay.events())
    assert all(payload["rev"] == 3 for _, payload in relay.events())


def test_revision_is_relayed_once_across_overlapping_windows(relay: Relay) -> None:
    job_id = relay.add_job(relay.sam)
    for _ in range(3):
        relay.poller.poll_once()
    assert relay.names() == ["job:created", "job:progress"]

    relay.worker_write(job_id, status=Job.STATUS_PROCESSING)
    for _ in range(3):
        relay.poller.poll_once()

    assert relay.names() == ["job:created", "job:progress", "job:progress"]
    assert [payload["rev"] for _, payload in relay.events()] == [0, 0, 1]


def test_heartbeat_without_a_revision_emits_nothing(relay: Relay) -> None:
    job_id = relay.add_job(relay.sam, status=Job.STATUS_PROCESSING)
    relay.poller.poll_once()
    relay.emitted.clear()

    relay.db.jobs.update_one(
        {"job_id": job_id}, {"$set": {"heartbeat_at": datetime.utcnow()}}
    )

    assert relay.poller.poll_once() is False
    assert relay.emitted == []


def test_finished_job_changed_later_is_not_completed_again(relay: Relay) -> None:
    job_id = relay.add_job(relay.sam)
    relay.poller.poll_once()
    relay.worker_write(
        job_id, status=Job.STATUS_FAILED, result={"error_code": "no_sources"}
    )
    relay.poller.poll_once()
    relay.emitted.clear()

    Job.mark_failures_read(ObjectId(relay.sam.id))
    relay.poller.poll_once()

    assert relay.emitted == []


def test_job_that_was_active_before_startup_is_not_created_again(
    relay: Relay,
) -> None:
    job_id = relay.add_job(relay.sam, status=Job.STATUS_PROCESSING, rev=4)
    poller = JobStatusPoller()
    poller.poll_once()
    assert relay.emitted == []

    relay.worker_write(job_id, status=Job.STATUS_COMPLETED, result={"errors": []})
    poller.poll_once()

    assert relay.names() == ["job:completed"]


def test_queue_positions_follow_claims_and_completions(relay: Relay) -> None:
    earlier = datetime.utcnow() - timedelta(seconds=1)
    first = relay.add_job(relay.sam, created_at=earlier)
    second = relay.add_job(relay.alex)
    urgent = relay.add_job(relay.admin, priority=Job.PRIORITY_HIGH)
    relay.poller.poll_once()

    def positions() -> dict[str, tuple[int, int, int]]:
        return {
            payload["job_id"]: (
                payload["queue_info"]["position"],
                payload["queue_info"]["total_queued"],
                payload["queue_info"]["jobs_processing"],
            )
            for event, payload in relay.events()
            if event == "job:progress" and "queue_info" in payload
        }

    assert positions() == {urgent: (1, 3, 0), first: (2, 3, 0), second: (3, 3, 0)}

    relay.emitted.clear()
    relay.worker_write(urgent, status=Job.STATUS_PROCESSING)
    relay.poller.poll_once()
    assert positions() == {first: (1, 2, 1), second: (2, 2, 1)}

    relay.emitted.clear()
    relay.worker_write(urgent, status=Job.STATUS_COMPLETED, result={"errors": []})
    relay.poller.poll_once()
    assert positions() == {first: (1, 2, 0), second: (2, 2, 0)}
    assert relay.names().count("job:completed") == 1

    relay.emitted.clear()
    relay.poller.poll_once()
    assert relay.emitted == []


def test_progress_of_a_running_job_does_not_recompute_the_queue(
    relay: Relay, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = relay.add_job(relay.sam, status=Job.STATUS_PROCESSING)
    relay.poller.poll_once()
    queue = Mock(wraps=job_feed.queued_jobs_with_positions)
    monkeypatch.setattr(job_feed, "queued_jobs_with_positions", queue)

    relay.worker_write(job_id, progress={"stage": "downloading"})
    relay.poller.poll_once()

    queue.assert_not_called()
    assert relay.names()[-1] == "job:progress"


def test_workers_alive_counts_live_workers_not_busy_ones(relay: Relay) -> None:
    now = datetime.utcnow()
    relay.db.workers.insert_many(
        [
            {"worker_id": "one", "last_seen_at": now, "current_job_id": None},
            {"worker_id": "two", "last_seen_at": now, "current_job_id": None},
            {"worker_id": "gone", "last_seen_at": now - timedelta(hours=1)},
        ]
    )
    relay.add_job(relay.sam)

    relay.poller.poll_once()

    info = relay.events()[-1][1]["queue_info"]
    assert info == {
        "position": 1,
        "total_queued": 1,
        "workers_alive": 2,
        "active_workers": 2,
        "jobs_processing": 0,
    }


def test_subscription_acknowledgement_carries_active_jobs(relay: Relay) -> None:
    queued = relay.add_job(relay.sam)
    running = relay.add_job(relay.alex, status=Job.STATUS_PROCESSING)
    relay.add_job(relay.sam, status=Job.STATUS_COMPLETED, target_id="finished")

    own = relay.socket(relay.sam).emit(
        "subscribe:jobs", {"user_id": relay.sam.id}, callback=True
    )
    everything = relay.socket(relay.admin).emit(
        "subscribe:jobs", {"all": True}, callback=True
    )
    refused = relay.socket(relay.sam).emit(
        "subscribe:jobs", {"all": True}, callback=True
    )

    assert own["success"] is True
    assert [job["job_id"] for job in own["jobs"]] == [queued]
    assert own["jobs"][0]["queue_info"]["position"] == 1
    assert own["jobs"][0]["rev"] == 0
    assert datetime.fromisoformat(own["server_time"]).utcoffset() == timedelta(0)
    assert {job["job_id"] for job in everything["jobs"]} == {queued, running}
    assert refused == {"error": "Access denied"}
    for acknowledgement in (own, everything):
        assert "config_snapshot" not in repr(acknowledgement)
        assert PRIVATE_CONFIG not in repr(acknowledgement)


def test_no_payload_or_response_carries_the_config_snapshot(relay: Relay) -> None:
    job_id = relay.add_job(relay.sam)
    relay.poller.poll_once()
    queued_bodies = [
        relay.http(relay.sam).get(f"/api/user/jobs/{job_id}"),
        relay.http(relay.sam).get("/api/user/jobs"),
        relay.http(relay.admin).get(f"/api/admin/jobs/{job_id}"),
        relay.http(relay.admin).get("/api/admin/jobs"),
    ]
    relay.worker_write(job_id, status=Job.STATUS_PROCESSING)
    relay.poller.poll_once()
    relay.worker_write(job_id, status=Job.STATUS_COMPLETED, result={"errors": []})
    relay.poller.poll_once()

    assert relay.names() == [
        "job:created",
        "job:progress",
        "job:progress",
        "job:completed",
    ]
    for _, payload, _ in relay.emitted:
        assert "config_snapshot" not in repr(payload)
        assert PRIVATE_CONFIG not in repr(payload)
    for response in queued_bodies:
        body = response.get_data(as_text=True)
        assert response.status_code == 200
        assert job_id in body
        assert '"queue_info"' in body
        assert "config_snapshot" not in body
        assert PRIVATE_CONFIG not in body
    assert relay.http(relay.sam).get(f"/api/user/jobs/{job_id}").get_json()["rev"] == 2


def test_startup_sweep_refunds_a_missed_build_once(relay: Relay) -> None:
    relay.db.users.update_one(
        {"_id": ObjectId(relay.sam.id)},
        {
            "$set": {
                "stats.manual_updates_this_week": 2,
                "stats.week_reset_at": datetime.utcnow(),
            }
        },
    )
    created = datetime.utcnow() - timedelta(seconds=10)
    refundable = relay.add_job(
        relay.sam,
        status=Job.STATUS_FAILED,
        result={"error_code": "all_sources_failed"},
        quota_charged=True,
        created_at=created,
        updated_at=created,
    )
    relay.add_job(
        relay.sam,
        status=Job.STATUS_FAILED,
        result={"error_code": "invalid_config"},
        quota_charged=True,
        target_id="users-own-fault",
        created_at=created,
        updated_at=created,
    )

    def used() -> int:
        return relay.db.users.find_one({"_id": ObjectId(relay.sam.id)})["stats"][
            "manual_updates_this_week"
        ]

    for _ in range(2):
        restarted = JobStatusPoller()
        restarted.poll_once()
        restarted.poll_once()

    assert used() == 1
    assert relay.db.jobs.find_one({"job_id": refundable})["quota_refunded"] is True
    assert relay.emitted == []


ONE_FULL_RUN = ["job:created", "job:progress", "job:completed"]


def charged_job_ending_skipped(relay: Relay) -> str:
    relay.db.users.update_one(
        {"_id": ObjectId(relay.sam.id)},
        {
            "$set": {
                "stats.manual_updates_this_week": 1,
                "stats.week_reset_at": datetime.utcnow(),
            }
        },
    )
    job_id = relay.add_job(relay.sam, quota_charged=True)
    relay.poller.poll_once()
    relay.worker_write(job_id, status=Job.STATUS_SKIPPED, result={"errors": []})
    return job_id


def failing(times: int, calls: list[str]) -> Any:
    def side_effect(job: Any) -> None:
        calls.append(job if isinstance(job, str) else job.job_id)
        if len(calls) <= times:
            raise RuntimeError("side effect broke")

    return side_effect


def test_failing_limit_review_still_refunds_completes_and_is_retried(
    relay: Relay, monkeypatch: pytest.MonkeyPatch
) -> None:
    reviews: list[str] = []
    monkeypatch.setattr(limit_review, "record_job_result", failing(2, reviews))
    job_id = charged_job_ending_skipped(relay)

    relay.poller.poll_once()

    assert relay.names() == ONE_FULL_RUN
    assert relay.names(f"jobs:{relay.sam.id}") == ONE_FULL_RUN
    assert relay.db.jobs.find_one({"job_id": job_id})["quota_refunded"] is True
    assert relay.poller.has_active_jobs() is False
    assert relay.poller._relayed[job_id].status == Job.STATUS_SKIPPED

    for _ in range(4):
        relay.poller.poll_once()

    assert reviews == [job_id] * 3
    assert relay.poller._failed_side_effects == {}
    assert relay.names() == ONE_FULL_RUN


def test_failing_refund_does_not_stop_the_limit_review_or_the_event(
    relay: Relay, monkeypatch: pytest.MonkeyPatch
) -> None:
    refunds: list[str] = []
    reviews: list[str] = []
    refund = build_admission.refund_quota_if_due

    def refund_after_one_failure(job_id: str) -> bool:
        failing(1, refunds)(job_id)
        return refund(job_id)

    monkeypatch.setattr(
        build_admission, "refund_quota_if_due", refund_after_one_failure
    )
    monkeypatch.setattr(limit_review, "record_job_result", failing(0, reviews))
    job_id = charged_job_ending_skipped(relay)

    relay.poller.poll_once()

    assert reviews == [job_id]
    assert relay.names() == ONE_FULL_RUN
    assert "quota_refunded" not in relay.db.jobs.find_one({"job_id": job_id})

    relay.poller.poll_once()
    relay.poller.poll_once()

    assert refunds == [job_id] * 2
    assert reviews == [job_id]
    assert relay.db.jobs.find_one({"job_id": job_id})["quota_refunded"] is True
    assert relay.names() == ONE_FULL_RUN


def test_side_effect_that_keeps_failing_is_dropped_after_bounded_attempts(
    relay: Relay, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    reviews: list[str] = []
    monkeypatch.setattr(limit_review, "record_job_result", failing(100, reviews))
    job_id = charged_job_ending_skipped(relay)

    with caplog.at_level("ERROR", logger="app.services.job_poller"):
        for _ in range(MAX_SIDE_EFFECT_ATTEMPTS + 3):
            relay.poller.poll_once()

    assert reviews == [job_id] * MAX_SIDE_EFFECT_ATTEMPTS
    assert relay.poller._failed_side_effects == {}
    assert [
        record.getMessage()
        for record in caplog.records
        if record.message.startswith("Gave up")
    ] == [
        f"Gave up on the limit review of job {job_id} "
        f"after {MAX_SIDE_EFFECT_ATTEMPTS} attempts"
    ]
    assert relay.names() == ONE_FULL_RUN


def test_failing_emit_still_records_the_job_as_relayed(
    relay: Relay, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id = relay.add_job(relay.sam)
    relay.poller.poll_once()
    relay.worker_write(job_id, status=Job.STATUS_COMPLETED, result={"errors": []})
    monkeypatch.setattr(
        realtime, "emit_job_completed", Mock(side_effect=RuntimeError("socket broke"))
    )

    relay.poller.poll_once()

    assert relay.poller._relayed[job_id].rev == 1
    assert relay.poller.has_active_jobs() is False


def test_poll_loop_survives_failing_ticks(monkeypatch: pytest.MonkeyPatch) -> None:
    poller = JobStatusPoller()
    poller._app = Flask(__name__)
    waits: list[float] = []
    outcomes: list[Any] = [
        RuntimeError("broken tick"),
        ConnectionFailure("database away"),
        ConnectionFailure("database away"),
        True,
        False,
    ]

    def tick() -> bool:
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return bool(outcome)

    def wait(delay: float) -> bool:
        waits.append(delay)
        if not outcomes:
            poller._stop.set()
        return False

    monkeypatch.setattr(poller, "poll_once", tick)
    monkeypatch.setattr(poller._stop, "wait", wait)

    poller._poll_loop()

    assert waits == [2.0, 2.0, 4.0, 0.5, 2.0]


def test_banned_account_is_disconnected_within_the_cache_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = Flask(__name__)
    app.config.update(
        TESTING=True, SECRET_KEY="example-cache-key", FRONTEND_URL="https://example.com"
    )
    account = Mock(spec=User)
    account.id = "000000000000000000000001"
    account.is_enabled = True
    account.is_banned = False
    account.is_admin = False
    account.auth_version = 0
    lookup = Mock(return_value=account)
    monkeypatch.setattr(User, "get_by_id", lookup)
    monkeypatch.setattr(mongo, "db", mongomock.MongoClient().default)
    clock = Mock(return_value=1000.0)
    monkeypatch.setattr(realtime.time, "monotonic", clock)
    realtime.init_socketio(app)
    http = app.test_client()
    with http.session_transaction() as session:
        session["user_id"] = account.id
    client = realtime.socketio.test_client(app, flask_test_client=http)
    client.emit("subscribe:jobs", {"user_id": account.id})
    room = f"jobs:{account.id}"
    lookup.reset_mock()

    for _ in range(5):
        realtime._emit("job:progress", {"job_id": "example"}, room)
    assert lookup.call_count == 1
    assert client.is_connected()

    account.is_banned = True
    clock.return_value += realtime.ACCESS_CACHE_SECONDS
    realtime._emit("job:progress", {"job_id": "example"}, room)

    assert not client.is_connected()


def test_access_change_drops_the_cached_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    realtime._account_access["000000000000000000000001"] = realtime.AccountAccess(
        allowed=True, is_admin=True, auth_version=0, checked_at=0
    )
    monkeypatch.setattr(
        realtime.socketio.server.manager, "get_participants", lambda *_: []
    )

    realtime.disconnect_user("000000000000000000000001")

    assert realtime._account_access == {}
