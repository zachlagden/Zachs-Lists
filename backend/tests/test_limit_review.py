import copy
import gzip
import importlib
import importlib.util
import json
import os
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import logging

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from flask.testing import FlaskClient

from app.blueprints.admin import admin_bp
from app.blueprints.auth import auth_bp
from app.blueprints.user import user_bp
from app.config import TestingConfig
from app.db_indexes import ensure_indexes
from app.extensions import mongo
from app.models.job import Job
from app.models.limit_request import LimitRequest
from app.models.user import User
from app.services import job_feed, limit_review
from app.services.build_admission import admit_build, refund_quota_if_due
from app.services.job_poller import JobStatusPoller
from app.utils.job_document import failure_result, revision_bump

realtime: Any = importlib.import_module("app.socketio")
script_path = Path(__file__).resolve().parents[1] / "scripts/audit_domain_limits.py"
spec = importlib.util.spec_from_file_location("audit_domain_limits", script_path)
assert spec is not None and spec.loader is not None
audit: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

LIMIT = TestingConfig.DEFAULT_MAX_DOMAINS
ROOT_GITHUB_ID = 2004
VALID_CONFIG = "https://example.com/hosts.txt|example|tracking"
FIXTURES = Path(__file__).resolve().parents[2] / "tests/fixtures"


def shared_fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_text())


@dataclass
class Site:
    app: Flask
    db: Any
    sam: User
    alex: User
    admin: User
    root: User

    def client(self, user: User) -> FlaskClient:
        client = self.app.test_client()
        with client.session_transaction() as session:
            session["user_id"] = user.id
        return client

    def stored(self, user: User) -> dict[str, Any]:
        return self.db.users.find_one({"_id": ObjectId(user.id)})

    def review(self, user: User) -> dict[str, Any] | None:
        return self.stored(user).get("limit_review")

    def status(self, user: User) -> str | None:
        return (self.review(user) or {}).get("status")

    def notices(self, user: User) -> list[dict[str, Any]]:
        return [
            notice
            for notice in self.stored(user).get("notifications", [])
            if notice["type"] == limit_review.NOTIFICATION_TYPE
        ]

    def publish(self, user: User, combined: int, **categories: int) -> None:
        lists = [
            {"name": name, "domain_count": count} for name, count in categories.items()
        ]
        lists.append({"name": "all_domains", "domain_count": combined})
        self.db.users.update_one(
            {"_id": ObjectId(user.id)},
            {"$set": {"lists": lists, "stats.total_domains": combined}},
        )

    def completed_job(
        self, user: User, result: dict[str, Any], hours_ago: int = 1
    ) -> None:
        self.db.jobs.insert_one(
            {
                "job_id": str(ObjectId()),
                "target_id": user.id,
                "user_id": ObjectId(user.id),
                "status": Job.STATUS_COMPLETED,
                "result": result,
                "completed_at": datetime.utcnow() - timedelta(hours=hours_ago),
            }
        )

    def flag(
        self, user: User, actual: int, limit: int = LIMIT, enforcing: bool = False
    ) -> None:
        limit_review.flag_over_limit(
            self.db.users,
            ObjectId(user.id),
            actual,
            limit,
            limit_review.METHOD_EXACT,
            datetime.utcnow(),
            enforcing,
        )

    def audit(self, apply: bool, users_dir: Path | None = None) -> dict[str, Any]:
        return audit.run(self.db, apply, LIMIT, ROOT_GITHUB_ID, users_dir)


@pytest.fixture
def site(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Site]:
    app = Flask(__name__)
    app.config.from_object(TestingConfig)
    app.config.update(
        SECRET_KEY="example-limit-key",
        USERS_DIR=str(tmp_path / "users"),
        DATA_DIR=str(tmp_path),
        ROOT_GITHUB_ID=ROOT_GITHUB_ID,
    )
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    ensure_indexes(db)
    realtime.init_socketio(app)
    monkeypatch.setattr(realtime, "_emit", lambda event, data, room: None)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(user_bp, url_prefix="/api/user")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    with app.app_context():
        accounts = [
            User.find_or_create_from_github(github_id, name)
            for github_id, name in [
                (2001, "sam"),
                (2002, "alex"),
                (2003, "robin"),
                (ROOT_GITHUB_ID, "morgan"),
            ]
        ]
        db.users.update_many(
            {},
            {
                "$set": {
                    "email": "private@example.com",
                    "config.blocklists": VALID_CONFIG,
                    "config.whitelist": "",
                }
            },
        )
        db.users.update_one({"username": "robin"}, {"$set": {"is_admin": True}})
        sam, alex, admin, root = [User.get_by_id(account.id) for account in accounts]
        assert sam and alex and admin and root
        yield Site(app, db, sam, alex, admin, root)


def write_plain(directory: Path, category: str, domains: list[str]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    with gzip.open(directory / f"{category}_plain.txt.gz", "wt") as output:
        output.write("# Blocklist generated by lists.zachlagden.uk\n")
        output.write(f"# Total domains: {len(domains)}\n\n")
        output.write("".join(f"{domain}\n" for domain in domains))


def test_job_result_without_the_left_out_category_gives_an_exact_count() -> None:
    usage = limit_review.usage_from_job_result(
        {"unique_domains": 900, "categories": {"tracking": 600, "advertising": 500}}
    )

    assert usage == limit_review.Usage(900, 900, limit_review.SOURCE_JOB_RESULT)
    assert usage is not None and usage.is_exact


def test_job_result_with_nsfw_gives_an_upper_bound_and_a_floor() -> None:
    usage = limit_review.usage_from_job_result(
        {"unique_domains": 900, "categories": {"tracking": 900, "nsfw": 250}}
    )

    assert usage == limit_review.Usage(1150, 900, limit_review.SOURCE_JOB_RESULT)
    assert usage is not None and not usage.is_exact


@pytest.mark.parametrize(
    "result",
    [
        None,
        {"unique_domains": 900},
        {"unique_domains": 900, "categories": {}},
        {"unique_domains": "900", "categories": {"tracking": 900}},
        {"unique_domains": 900, "categories": {"nsfw": -1}},
    ],
)
def test_job_result_without_usable_counts_gives_no_usage(result: Any) -> None:
    assert limit_review.usage_from_job_result(result) is None


def test_stored_usage_prefers_the_latest_completed_job(site: Site) -> None:
    site.publish(site.sam, 100, tracking=100)
    site.completed_job(
        site.sam, {"unique_domains": 300, "categories": {"tracking": 300}}, hours_ago=5
    )
    site.completed_job(
        site.sam,
        {"unique_domains": 500, "categories": {"tracking": 500, "nsfw": 40}},
        hours_ago=1,
    )

    assert limit_review.current_usage(site.sam) == limit_review.Usage(
        540, 500, limit_review.SOURCE_JOB_RESULT
    )


def test_stored_usage_falls_back_to_list_metadata(site: Site) -> None:
    site.publish(site.sam, 700, tracking=700, nsfw=30)
    site.completed_job(site.sam, {"unique_domains": 500})
    refreshed = User.get_by_id(site.sam.id)
    assert refreshed is not None

    assert limit_review.current_usage(refreshed) == limit_review.Usage(
        730, 700, limit_review.SOURCE_LIST_METADATA
    )


def test_stored_usage_is_absent_without_a_job_or_a_combined_list(site: Site) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)},
        {"$set": {"lists": [{"name": "tracking", "domain_count": 5}]}},
    )
    refreshed = User.get_by_id(site.sam.id)
    assert refreshed is not None

    assert limit_review.current_usage(refreshed) is None


def test_effective_limit_follows_overrides_and_exempts_admins_and_root(
    site: Site,
) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.alex.id)}, {"$set": {"limits": {"max_domains": 10}}}
    )

    limits = {
        user.username: limit_review.effective_max_domains(
            site.stored(user), LIMIT, ROOT_GITHUB_ID
        )
        for user in (site.sam, site.alex, site.admin, site.root)
    }

    assert limits == {"sam": LIMIT, "alex": 10, "robin": None, "morgan": None}


def test_audit_dry_run_reports_and_writes_nothing(site: Site) -> None:
    site.publish(site.sam, LIMIT + 5, tracking=LIMIT + 5)
    site.publish(site.alex, LIMIT - 5, tracking=LIMIT - 5)
    before = list(site.db.users.find())

    report = site.audit(apply=False)

    assert list(site.db.users.find()) == before
    assert report["applied"] is False
    assert report["method"] == "stored"
    assert report["over_limit"] == [
        {
            "user_id": site.sam.id,
            "username": "sam",
            "max_domains": LIMIT,
            "actual_domains": LIMIT + 5,
            "over_by": 5,
            "method": "stored",
            "upper_bound": False,
            "has_open_review": False,
        }
    ]
    assert report["totals"]["users_with_lists"] == 2
    assert report["totals"]["over_limit"] == 1
    assert report["totals"]["reviews_opened"] == 0


def test_audit_apply_sets_reviews_and_clears_them_once_within_the_limit(
    site: Site,
) -> None:
    site.publish(site.sam, LIMIT + 5, tracking=LIMIT + 5)
    site.publish(site.alex, LIMIT + 9, tracking=LIMIT + 9)

    first = site.audit(apply=True)

    assert first["totals"]["reviews_opened"] == 2
    assert first["totals"]["notifications_sent"] == 2
    opened = site.review(site.sam)
    assert opened is not None
    assert opened["status"] == "open"
    assert (opened["actual_domains"], opened["max_domains"]) == (LIMIT + 5, LIMIT)
    assert opened["method"] == "stored"
    assert opened["resolved_at"] is None and opened["resolved_by"] is None
    assert isinstance(opened["detected_at"], datetime)
    assert isinstance(opened["notified_at"], datetime)

    detected_at = (site.review(site.alex) or {})["detected_at"]
    site.publish(site.sam, LIMIT - 1, tracking=LIMIT - 1)
    site.publish(site.alex, LIMIT + 20, tracking=LIMIT + 20)
    second = site.audit(apply=True)

    assert second["totals"]["reviews_resolved"] == 1
    assert second["totals"]["reviews_refreshed"] == 1
    assert second["totals"]["notifications_sent"] == 0
    cleared = site.review(site.sam)
    assert cleared is not None
    assert (cleared["status"], cleared["resolved_by"]) == ("resolved", "audit")
    assert isinstance(cleared["resolved_at"], datetime)
    refreshed = site.review(site.alex)
    assert refreshed is not None
    assert refreshed["actual_domains"] == LIMIT + 20
    assert refreshed["detected_at"] == detected_at
    assert len(site.notices(site.alex)) == 1


def test_audit_never_flags_admins_or_root(site: Site) -> None:
    site.publish(site.admin, LIMIT * 3, tracking=LIMIT * 3)
    site.publish(site.root, LIMIT * 3, tracking=LIMIT * 3)

    report = site.audit(apply=True)

    assert report["over_limit"] == []
    assert report["totals"]["exempt"] == 2
    assert site.review(site.admin) is None and site.review(site.root) is None
    assert site.notices(site.admin) == [] and site.notices(site.root) == []


def test_stored_audit_leaves_an_uncertain_account_for_exact_measurement(
    site: Site,
) -> None:
    site.publish(site.sam, LIMIT - 10, tracking=LIMIT - 10, nsfw=50)
    site.publish(site.alex, LIMIT + 1, tracking=LIMIT + 1, nsfw=50)

    report = site.audit(apply=True)

    assert [account["username"] for account in report["over_limit"]] == ["alex"]
    assert report["over_limit"][0]["upper_bound"] is True
    assert [
        (account["username"], account["actual_domains"], account["at_least"])
        for account in report["needs_exact_measurement"]
    ] == [("sam", LIMIT + 40, LIMIT - 10)]
    assert site.review(site.sam) is None
    assert "about" in site.notices(site.alex)[0]["message"]


def test_stored_audit_keeps_a_measurement_taken_from_files_or_a_build(
    site: Site,
) -> None:
    site.flag(site.sam, LIMIT + 7)
    site.publish(site.sam, LIMIT + 1, tracking=LIMIT + 1, nsfw=50)

    site.audit(apply=True)

    kept = site.review(site.sam)
    assert kept is not None
    assert (kept["actual_domains"], kept["method"]) == (LIMIT + 7, "exact")


def test_exact_audit_reads_both_layouts_and_counts_each_domain_once(
    site: Site, tmp_path: Path
) -> None:
    users_dir = tmp_path / "users"
    flat = users_dir / "sam" / "output"
    write_plain(flat, "tracking", ["shared.example", "one.example"])
    write_plain(flat, "nsfw", ["Shared.Example", "adult.example"])
    write_plain(flat, "all_domains", ["shared.example", "one.example", "x.example"])
    generation = users_dir / "alex" / "output" / "generations" / "gen-7"
    write_plain(generation, "advertising", ["a.example", "b.example", "c.example"])
    write_plain(generation, "nsfw", ["c.example", "d.example"])
    (generation / "manifest.json").write_text("{}")
    write_plain(users_dir / "alex" / "output", "advertising", ["stale.example"])
    site.publish(site.sam, 2, tracking=2, nsfw=2)
    site.publish(site.alex, 3, advertising=3, nsfw=2)
    site.db.users.update_one(
        {"_id": ObjectId(site.alex.id)}, {"$set": {"published_generation": "gen-7"}}
    )
    site.db.users.update_many(
        {"username": {"$in": ["sam", "alex"]}}, {"$set": {"limits.max_domains": 2}}
    )

    report = audit.run(site.db, True, LIMIT, ROOT_GITHUB_ID, users_dir)

    assert report["method"] == "exact"
    assert {
        account["username"]: (account["actual_domains"], account["over_by"])
        for account in report["over_limit"]
    } == {"sam": (3, 1), "alex": (4, 2)}
    assert all(account["method"] == "exact" for account in report["over_limit"])
    measured = site.review(site.alex)
    assert measured is not None
    assert (measured["actual_domains"], measured["method"]) == (4, "exact")
    assert "about" not in site.notices(site.alex)[0]["message"]


def test_published_output_dir_picks_the_layout_and_refuses_unsafe_names(
    tmp_path: Path,
) -> None:
    generation = tmp_path / "sam" / "output" / "generations" / "gen-1"
    generation.mkdir(parents=True)

    assert (
        audit.published_output_dir(tmp_path, "sam", None) == tmp_path / "sam" / "output"
    )
    with pytest.raises(audit.MeasurementError, match="no manifest"):
        audit.published_output_dir(tmp_path, "sam", "gen-1")
    (generation / "manifest.json").write_text("{}")
    assert audit.published_output_dir(tmp_path, "sam", "gen-1") == generation
    for username, generation_id in [("../sam", None), ("sam", "../gen-1")]:
        with pytest.raises(audit.MeasurementError, match="not a safe"):
            audit.published_output_dir(tmp_path, username, generation_id)
    assert audit.published_generation({"published_generation": {"id": "g"}}) == "g"
    assert audit.published_generation({"published_generation": ""}) is None


def test_exact_audit_reports_unreadable_output_without_flagging(
    site: Site, tmp_path: Path
) -> None:
    users_dir = tmp_path / "users"
    broken = users_dir / "alex" / "output"
    broken.mkdir(parents=True)
    (broken / "tracking_plain.txt.gz").write_bytes(b"not gzip")
    site.publish(site.sam, LIMIT + 5, tracking=LIMIT + 5)
    site.publish(site.alex, LIMIT + 5, tracking=LIMIT + 5)

    report = audit.run(site.db, True, LIMIT, ROOT_GITHUB_ID, users_dir)

    assert report["over_limit"] == []
    assert sorted(failure["reason"] for failure in report["failures"]) == [
        "a category file could not be read",
        "output directory is missing",
    ]
    assert report["totals"]["not_measured"] == 2
    assert site.review(site.sam) is None and site.review(site.alex) is None


def test_audit_output_holds_no_list_content_or_contact_details(
    site: Site, tmp_path: Path
) -> None:
    users_dir = tmp_path / "users"
    write_plain(users_dir / "sam" / "output", "tracking", ["secret-one.example"])
    write_plain(users_dir / "sam" / "output", "nsfw", ["secret-two.example"])
    site.publish(site.sam, 1, tracking=1, nsfw=1)
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)},
        {
            "$set": {
                "limits.max_domains": 1,
                "ip_log": [{"ip_hash": "hashed-address", "access_count": 1}],
            }
        },
    )

    printed = json.dumps(audit.run(site.db, False, LIMIT, ROOT_GITHUB_ID, users_dir))

    assert '"username": "sam"' in printed
    for private in ("secret-", "private@example.com", "hashed-address", VALID_CONFIG):
        assert private not in printed


def test_notification_is_sent_once_for_each_open_review(site: Site) -> None:
    site.flag(site.sam, LIMIT + 5)
    site.flag(site.sam, LIMIT + 6)
    site.flag(site.sam, LIMIT + 7)

    notices = site.notices(site.sam)
    assert len(notices) == 1
    assert notices[0]["title"] == limit_review.NOTIFICATION_TITLE
    assert notices[0]["message"] == (
        f"Your lists contain {LIMIT + 5:,} domains across all categories. "
        f"Your limit is {LIMIT:,}. "
        "Builds over the limit will start to fail once the limit is enforced. "
        "Your current lists stay published. "
        "To get back within the limit, remove some sources, "
        "or request a higher limit from your dashboard."
    )
    assert notices[0]["read"] is False

    limit_review.resolve_by_admin(ObjectId(site.sam.id), "robin", "Reviewed")
    site.flag(site.sam, LIMIT + 8)

    assert len(site.notices(site.sam)) == 2


def test_notification_says_builds_fail_when_the_limit_is_enforced(site: Site) -> None:
    site.flag(site.sam, LIMIT + 5, enforcing=True)

    assert site.notices(site.sam)[0]["message"] == (
        f"Your lists contain {LIMIT + 5:,} domains across all categories. "
        f"Your limit is {LIMIT:,}. "
        "Builds over the limit fail, and your current lists stay published. "
        "To get back within the limit, remove some sources, "
        "or request a higher limit from your dashboard."
    )


@pytest.mark.parametrize(
    ("enforcing", "consequence"),
    [
        (False, "will start to fail once the limit is enforced"),
        (True, "Builds over the limit fail, and"),
    ],
)
def test_build_result_notification_follows_the_enforcement_setting(
    site: Site, enforcing: bool, consequence: str
) -> None:
    site.app.config["ENFORCE_DOMAIN_LIMIT"] = enforcing
    result = {"limit": {"max_domains": LIMIT, "actual_domains": LIMIT + 5}}

    limit_review.record_job_result(finished(site, site.sam, Job.STATUS_FAILED, result))

    assert consequence in site.notices(site.sam)[0]["message"]


@pytest.mark.parametrize("enforcing", [False, True])
def test_audit_notification_follows_the_enforcement_setting(
    site: Site, enforcing: bool
) -> None:
    site.publish(site.sam, LIMIT + 5)

    audit.run(site.db, True, LIMIT, ROOT_GITHUB_ID, enforcing=enforcing)

    message = site.notices(site.sam)[0]["message"]
    assert ("Builds over the limit fail, and" in message) is enforcing


@pytest.mark.parametrize("enforcing", [False, True])
def test_dashboard_payload_says_whether_the_limit_is_enforced(
    site: Site, enforcing: bool
) -> None:
    site.app.config["ENFORCE_DOMAIN_LIMIT"] = enforcing

    lists = site.client(site.sam).get("/api/user/lists").get_json()

    assert lists["enforce_domain_limit"] is enforcing


def test_an_open_review_that_missed_its_notification_is_notified_on_refresh(
    site: Site,
) -> None:
    User.open_limit_review(
        ObjectId(site.sam.id), LIMIT + 5, LIMIT, "exact", datetime.utcnow()
    )
    assert site.notices(site.sam) == []

    site.flag(site.sam, LIMIT + 6)
    site.flag(site.sam, LIMIT + 6)

    assert len(site.notices(site.sam)) == 1


def test_review_notification_keeps_the_notification_cap(site: Site) -> None:
    for number in range(User.MAX_NOTIFICATIONS):
        site.sam.add_notification("example", f"Notice {number}", "Text")

    site.flag(site.sam, LIMIT + 5)

    stored = site.stored(site.sam)["notifications"]
    assert len(stored) == User.MAX_NOTIFICATIONS
    assert stored[0]["type"] == limit_review.NOTIFICATION_TYPE


def end_job(
    site: Site, job: Job, status: str, actual: int, **result: Any
) -> dict[str, Any]:
    body = {
        "errors": [],
        "limit": {"max_domains": LIMIT, "actual_domains": actual},
        **result,
    }
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": status,
                "result": body,
                "completed_at": datetime.utcnow(),
            },
            **revision_bump(),
        },
    )
    return body


def test_poller_opens_refreshes_and_resolves_a_review_from_job_results(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(job_feed, "database_time", datetime.utcnow)
    poller = JobStatusPoller()
    poller.poll_once()

    observed = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    poller.poll_once()
    end_job(
        site,
        observed,
        Job.STATUS_COMPLETED,
        LIMIT + 5,
        warnings=["domain_limit_exceeded"],
    )
    poller.poll_once()

    opened = site.review(site.sam)
    assert opened is not None
    assert (opened["status"], opened["method"]) == ("open", "build")
    assert (opened["actual_domains"], opened["max_domains"]) == (LIMIT + 5, LIMIT)
    assert len(site.notices(site.sam)) == 1

    enforced = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    poller.poll_once()
    end_job(
        site,
        enforced,
        Job.STATUS_FAILED,
        LIMIT + 9,
        error_code="domain_limit_exceeded",
    )
    poller.poll_once()
    poller.poll_once()

    refreshed = site.review(site.sam)
    assert refreshed is not None
    assert (refreshed["status"], refreshed["actual_domains"]) == ("open", LIMIT + 9)
    assert refreshed["detected_at"] == opened["detected_at"]
    assert len(site.notices(site.sam)) == 1

    within = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    poller.poll_once()
    end_job(site, within, Job.STATUS_COMPLETED, LIMIT - 1)
    poller.poll_once()

    resolved = site.review(site.sam)
    assert resolved is not None
    assert (resolved["status"], resolved["resolved_by"]) == ("resolved", "build")
    assert resolved["resolved_reason"] == limit_review.REASON_WITHIN_LIMIT


def worker_result(actual: int, **changes: Any) -> dict[str, Any]:
    result: dict[str, Any] = copy.deepcopy(
        shared_fixture("job-progress.json")["completed"]["result"]
    )
    result["limit"] = {"max_domains": LIMIT, "actual_domains": actual}
    result.update(changes)
    return result


def end_job_as_the_worker(
    site: Site, job: Job, status: str, result: dict[str, Any]
) -> None:
    site.db.jobs.update_one(
        {"job_id": job.job_id},
        {
            "$set": {
                "status": status,
                "result": result,
                "completed_at": datetime.utcnow(),
            },
            **revision_bump(),
        },
    )


def test_poller_follows_a_review_through_results_shaped_like_the_worker_writes(
    site: Site, monkeypatch: pytest.MonkeyPatch
) -> None:
    messages = shared_fixture("domain-limit.json")["over_limit"]
    monkeypatch.setattr(job_feed, "database_time", datetime.utcnow)
    poller = JobStatusPoller()
    poller.poll_once()

    observed = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    assert observed.to_dict()["result"] is None
    poller.poll_once()
    completed_over = worker_result(LIMIT + 5)
    completed_over["warnings"].append(messages["warning"])
    end_job_as_the_worker(site, observed, Job.STATUS_COMPLETED, completed_over)
    poller.poll_once()

    opened = site.review(site.sam)
    assert opened is not None
    assert (opened["status"], opened["method"]) == ("open", "build")
    assert (opened["actual_domains"], opened["max_domains"]) == (LIMIT + 5, LIMIT)

    enforced = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    poller.poll_once()
    failed_over = {
        **failure_result(limit_review.LIMIT_EXCEEDED_CODE, messages["error"]),
        "limit": {"max_domains": LIMIT, "actual_domains": LIMIT + 9},
    }
    end_job_as_the_worker(site, enforced, Job.STATUS_FAILED, failed_over)
    poller.poll_once()

    refreshed = site.review(site.sam)
    assert refreshed is not None
    assert (refreshed["status"], refreshed["actual_domains"]) == ("open", LIMIT + 9)
    assert len(site.notices(site.sam)) == 1
    stored = Job.get_by_id(enforced.job_id)
    assert stored is not None and stored.to_dict()["result"] == failed_over

    within = admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    poller.poll_once()
    end_job_as_the_worker(site, within, Job.STATUS_COMPLETED, worker_result(LIMIT - 1))
    poller.poll_once()

    resolved = site.review(site.sam)
    assert resolved is not None
    assert (resolved["status"], resolved["resolved_by"]) == ("resolved", "build")


@pytest.mark.parametrize("status", [Job.STATUS_COMPLETED, Job.STATUS_FAILED])
def test_measurement_without_a_limit_changes_nothing_and_is_not_reported(
    site: Site, caplog: pytest.LogCaptureFixture, status: str
) -> None:
    site.flag(site.sam, LIMIT + 5)
    result = {"limit": {"max_domains": None, "actual_domains": LIMIT * 9}}

    with caplog.at_level(logging.WARNING, logger=limit_review.logger.name):
        change = limit_review.record_job_result(
            finished(site, site.sam, status, result)
        )

    assert change == limit_review.ReviewChange()
    assert site.status(site.sam) == "open"
    assert caplog.records == []


def test_admission_snapshots_no_domain_limit_for_admins_and_root(site: Site) -> None:
    snapshots = {
        user.username: site.db.jobs.find_one(
            {"job_id": admit_build(user, Job.TYPE_SCHEDULED, None).job_id}
        )["config_snapshot"]["limits"]
        for user in (site.sam, site.admin, site.root)
    }

    assert snapshots["sam"]["max_domains"] == LIMIT
    assert snapshots["robin"]["max_domains"] is None
    assert snapshots["morgan"]["max_domains"] is None
    assert snapshots["sam"]["max_source_lists"] == site.sam.limits["max_source_lists"]
    assert (
        snapshots["robin"]["max_source_lists"] == site.admin.limits["max_source_lists"]
    )
    assert (
        snapshots["morgan"]["max_source_lists"] == site.root.limits["max_source_lists"]
    )


def finished(site: Site, user: User, status: str, result: Any) -> Job:
    return Job(
        {
            "job_id": "job-1",
            "user_id": ObjectId(user.id),
            "status": status,
            "result": result,
        }
    )


def test_failed_build_within_the_limit_does_not_resolve_a_review(site: Site) -> None:
    site.flag(site.sam, LIMIT + 5)
    result = {"limit": {"max_domains": LIMIT, "actual_domains": 0}}

    change = limit_review.record_job_result(
        finished(site, site.sam, Job.STATUS_FAILED, result)
    )

    assert change == limit_review.ReviewChange()
    assert site.status(site.sam) == "open"


@pytest.mark.parametrize(
    "result",
    [
        None,
        {"errors": []},
        {"limit": "over"},
        {"limit": {"max_domains": LIMIT}},
        {"limit": {"max_domains": LIMIT, "actual_domains": "many"}},
        {"limit": {"max_domains": True, "actual_domains": LIMIT * 2}},
    ],
)
def test_job_without_a_readable_limit_measurement_changes_nothing(
    site: Site, result: Any
) -> None:
    change = limit_review.record_job_result(
        finished(site, site.sam, Job.STATUS_COMPLETED, result)
    )

    assert change == limit_review.ReviewChange()
    assert site.review(site.sam) is None


def test_build_measured_against_an_older_limit_uses_the_raised_limit(
    site: Site,
) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"limits.max_domains": LIMIT * 2}}
    )
    result = {"limit": {"max_domains": LIMIT, "actual_domains": LIMIT + 5}}

    change = limit_review.record_job_result(
        finished(site, site.sam, Job.STATUS_COMPLETED, result)
    )

    assert change == limit_review.ReviewChange()
    assert site.review(site.sam) is None


@pytest.mark.parametrize("stored_limit", ["100", None, 12.5, True])
def test_job_result_is_recorded_when_the_stored_limit_is_not_an_integer(
    site: Site, stored_limit: Any
) -> None:
    site.db.users.update_one(
        {"_id": ObjectId(site.sam.id)}, {"$set": {"limits.max_domains": stored_limit}}
    )
    result = {"limit": {"max_domains": LIMIT, "actual_domains": LIMIT + 5}}

    change = limit_review.record_job_result(
        finished(site, site.sam, Job.STATUS_COMPLETED, result)
    )

    assert change.opened is True
    review = site.review(site.sam)
    assert review is not None
    assert (review["actual_domains"], review["max_domains"]) == (LIMIT + 5, LIMIT)


def test_job_results_never_flag_admins_or_root(site: Site) -> None:
    result = {"limit": {"max_domains": LIMIT, "actual_domains": LIMIT * 2}}

    for user in (site.admin, site.root):
        limit_review.record_job_result(
            finished(site, user, Job.STATUS_COMPLETED, result)
        )

    assert site.review(site.admin) is None and site.review(site.root) is None


@pytest.mark.parametrize("error_code", ["domain_limit_exceeded", "not_a_known_code"])
def test_build_failed_over_the_limit_keeps_its_quota_charge(
    site: Site, error_code: str
) -> None:
    job = admit_build(site.sam, Job.TYPE_MANUAL, site.sam)
    end_job(site, job, Job.STATUS_FAILED, LIMIT + 5, error_code=error_code)

    assert refund_quota_if_due(job.job_id) is False
    stored = site.stored(site.sam)
    assert stored["stats"]["manual_updates_this_week"] == 1


def test_admin_lists_open_reviews_with_request_state(site: Site) -> None:
    site.flag(site.sam, LIMIT + LIMIT // 4)
    site.flag(site.alex, LIMIT * 2)
    User.open_limit_review(
        ObjectId(site.root.id), LIMIT * 9, LIMIT, "exact", datetime.utcnow()
    )
    limit_review.resolve_by_admin(ObjectId(site.root.id), "robin", "Root account")
    LimitRequest.create(site.sam, 10_000_000, "Family filtering", "family")

    response = site.client(site.admin).get("/api/admin/limit-reviews")

    assert response.status_code == 200
    body = response.get_json()
    assert (body["page"], body["per_page"], body["total"], body["pages"]) == (
        1,
        25,
        2,
        1,
    )
    assert [review["username"] for review in body["reviews"]] == ["alex", "sam"]
    sam = body["reviews"][1]
    assert sam == {
        "user_id": site.sam.id,
        "username": "sam",
        "max_domains": LIMIT,
        "actual_domains": LIMIT + LIMIT // 4,
        "percent_over": 25.0,
        "method": "exact",
        "detected_at": sam["detected_at"],
        "notified": True,
        "has_pending_request": True,
    }
    assert sam["detected_at"].endswith("Z")
    assert body["reviews"][0]["has_pending_request"] is False
    assert body["reviews"][0]["percent_over"] == 100.0


def test_admin_review_list_clamps_pagination(site: Site) -> None:
    site.flag(site.sam, LIMIT + 5)
    site.flag(site.alex, LIMIT + 9)
    client = site.client(site.admin)

    oversized = client.get("/api/admin/limit-reviews?page=0&per_page=5000").get_json()
    second = client.get("/api/admin/limit-reviews?page=2&per_page=1").get_json()
    beyond = client.get("/api/admin/limit-reviews?page=999999999&per_page=-3")

    assert (oversized["page"], oversized["per_page"]) == (1, 100)
    assert len(oversized["reviews"]) == 2
    assert (second["page"], second["pages"]) == (2, 2)
    assert [review["username"] for review in second["reviews"]] == ["sam"]
    assert beyond.status_code == 200
    assert (beyond.get_json()["page"], beyond.get_json()["per_page"]) == (100_000, 1)
    assert beyond.get_json()["reviews"] == []


def test_review_routes_refuse_users_who_are_not_admins(site: Site) -> None:
    client = site.client(site.sam)

    assert client.get("/api/admin/limit-reviews").status_code == 403
    assert (
        client.post(
            f"/api/admin/limit-reviews/{site.sam.id}/resolve", json={"reason": "Mine"}
        ).status_code
        == 403
    )
    assert site.app.test_client().get("/api/admin/limit-reviews").status_code == 401


def test_admin_resolves_a_review_with_a_reason(site: Site) -> None:
    site.flag(site.sam, LIMIT + 5)
    client = site.client(site.admin)
    url = f"/api/admin/limit-reviews/{site.sam.id}/resolve"

    for body in ({}, {"reason": "  "}, {"reason": 5}, {"reason": "x" * 201}):
        refused = client.post(url, json=body)
        assert refused.status_code == 400
        assert refused.get_json()["field"] == "reason"
    assert site.status(site.sam) == "open"

    accepted = client.post(url, json={"reason": "Agreed a grace period"})

    assert accepted.status_code == 200
    resolved = site.review(site.sam)
    assert resolved is not None
    assert resolved["status"] == "resolved"
    assert resolved["resolved_by"] == "robin"
    assert resolved["resolved_reason"] == "Agreed a grace period"
    assert isinstance(resolved["resolved_at"], datetime)
    assert client.post(url, json={"reason": "Again"}).status_code == 404
    assert (
        client.post(
            "/api/admin/limit-reviews/not-an-id/resolve", json={"reason": "Bad id"}
        ).status_code
        == 400
    )


def test_raising_the_limit_resolves_a_review_only_when_it_covers_the_count(
    site: Site,
) -> None:
    site.flag(site.sam, 6_000_000)
    client = site.client(site.admin)
    url = f"/api/admin/users/{site.sam.id}"

    short = client.put(url, json={"limits": {"max_domains": 5_000_000}})

    assert short.status_code == 200
    assert short.get_json()["limit_review"]["status"] == "open"
    assert short.get_json()["limit_review"]["max_domains"] == 5_000_000

    covered = client.put(url, json={"limits": {"max_domains": 6_000_000}})

    review = covered.get_json()["limit_review"]
    assert (review["status"], review["resolved_by"]) == ("resolved", "robin")
    assert review["resolved_reason"] == limit_review.REASON_LIMIT_RAISED


def test_approving_a_limit_request_resolves_a_covered_review(site: Site) -> None:
    site.flag(site.sam, 6_000_000)
    site.flag(site.alex, 16_000_000)
    client = site.client(site.admin)
    for user in (site.sam, site.alex):
        request = LimitRequest.create(user, 10_000_000, "Family filtering", "family")
        approved = client.post(f"/api/admin/limit-requests/{request.id}/approve")
        assert approved.status_code == 200

    covered = site.review(site.sam)
    assert covered is not None
    assert (covered["status"], covered["resolved_by"]) == ("resolved", "robin")
    still_over = site.review(site.alex)
    assert still_over is not None
    assert (still_over["status"], still_over["max_domains"]) == ("open", 10_000_000)


def test_user_and_admin_payloads_carry_the_review(site: Site) -> None:
    assert site.client(site.alex).get("/api/auth/me").get_json()["limit_review"] is None
    site.flag(site.sam, LIMIT + 5)

    own = site.client(site.sam).get("/api/auth/me").get_json()["limit_review"]
    detail = site.client(site.admin).get(f"/api/admin/users/{site.sam.id}").get_json()

    assert own == detail["limit_review"]
    assert own == {
        "actual_domains": LIMIT + 5,
        "max_domains": LIMIT,
        "method": "exact",
        "detected_at": own["detected_at"],
        "notified_at": own["notified_at"],
        "status": "open",
        "resolved_at": None,
        "resolved_by": None,
        "resolved_reason": None,
    }
    assert own["detected_at"].endswith("Z") and own["notified_at"].endswith("Z")


def test_admin_stats_count_the_queued_builds(site: Site) -> None:
    admit_build(site.sam, Job.TYPE_SCHEDULED, None)
    admit_build(site.alex, Job.TYPE_SCHEDULED, None)
    site.db.jobs.update_one(
        {"target_id": site.alex.id}, {"$set": {"status": Job.STATUS_PROCESSING}}
    )

    jobs = site.client(site.admin).get("/api/admin/stats").get_json()["jobs"]

    assert (jobs["queued"], jobs["processing"]) == (1, 1)


@pytest.mark.parametrize("enforcing", [False, True])
def test_admin_stats_say_whether_the_limit_is_enforced(
    site: Site, enforcing: bool
) -> None:
    site.app.config["ENFORCE_DOMAIN_LIMIT"] = enforcing

    stats = site.client(site.admin).get("/api/admin/stats").get_json()

    assert stats["limits"] == {"enforce_domain_limit": enforcing}


@pytest.mark.parametrize(
    ("value", "enforcing"),
    [
        (None, False),
        *[
            (value, enforcing)
            for enforcing, values in (
                (
                    True,
                    shared_fixture("domain-limit.json")["enforcement_setting"]["on"],
                ),
                (
                    False,
                    shared_fixture("domain-limit.json")["enforcement_setting"]["off"],
                ),
            )
            for value in values
        ],
    ],
)
def test_enforcement_is_off_unless_the_environment_turns_it_on(
    value: str | None, enforcing: bool
) -> None:
    environment = {
        name: setting
        for name, setting in os.environ.items()
        if name != "ENFORCE_DOMAIN_LIMIT"
    }
    if value is not None:
        environment["ENFORCE_DOMAIN_LIMIT"] = value

    printed = subprocess.run(
        [
            sys.executable,
            "-c",
            "from app.config import Config; print(Config.ENFORCE_DOMAIN_LIMIT)",
        ],
        env=environment,
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=True,
    )

    assert printed.stdout.strip() == str(enforcing)
