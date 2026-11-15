import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
import requests
from apscheduler.schedulers.background import BackgroundScheduler
from flask.testing import FlaskClient

from app.config import TestingConfig
from app.models.job import Job
from app.models.system_config import SystemConfig
from app.models.user import User
from app.scheduled_tasks.tasks import register_scheduled_tasks
from app.services import default_refresh, default_sync, default_template
from app.services.build_admission import DEFAULT_TARGET, admit_build
from app.utils import safe_http
from app.utils.safe_http import BodyTooLarge, FetchedBody
from app.utils.validators import WhitelistValidationUnavailable
from conftest import Api

RECORDED = Path(__file__).parent / "fixtures/default_sync"
REPO = "zachlagden/Pi-hole-Optimized-Blocklists"
COMMITS_URL = (
    f"https://api.github.com/repos/{REPO}/commits?path=lists&sha=main&per_page=10"
)
RAW = f"https://raw.githubusercontent.com/{REPO}"
PUBLISHED_SHA = "1ea7e1669a20b88fdf767cf6f8c626f590c129cb"
EARLIER_SHA = "96bf49b462614302afb5edb7855df3b700078224"
ETAG = 'W/"recorded-etag"'
TOKEN = "example-token-0123456789"
HAND_WRITTEN_COMMIT = {
    "sha": "a" * 40,
    "commit": {
        "message": "Weekly blocklist update by hand",
        "committer": {"date": "2026-11-09T10:00:00Z"},
    },
    "author": {"login": "alex-example"},
}
TUESDAY = datetime(2026, 11, 10, 9, 15)
SUNDAY_BEFORE_REBUILD = datetime(2026, 11, 15, 4, 15)
SUNDAY_AFTER_REBUILD = datetime(2026, 11, 15, 8, 15)


def recorded(name: str) -> str:
    return (RECORDED / name).read_text()


def recorded_commits() -> list[dict[str, Any]]:
    commits: list[dict[str, Any]] = json.loads(recorded("commits.json"))
    return commits


@dataclass
class Call:
    url: str
    headers: dict[str, str]
    follow_redirects: bool


@dataclass
class FakeGitHub:
    commits: Any = field(default_factory=recorded_commits)
    commits_status: int = 200
    etag: str = ETAG
    files: dict[str, str] = field(
        default_factory=lambda: {
            "blocklists.conf": recorded("blocklists.conf"),
            "whitelist.txt": recorded("whitelist.txt"),
        }
    )
    failure: requests.exceptions.RequestException | None = None
    calls: list[Call] = field(default_factory=list)

    def __call__(
        self,
        url: str,
        max_bytes: int,
        timeout: int = 15,
        headers: dict[str, str] | None = None,
        follow_redirects: bool = True,
    ) -> FetchedBody:
        assert max_bytes == 1024 * 1024
        self.calls.append(Call(url, dict(headers or {}), follow_redirects))
        if self.failure is not None:
            raise self.failure
        if url == COMMITS_URL:
            if self.commits_status != 200:
                return FetchedBody(self.commits_status, {}, b"")
            sent = (headers or {}).get("If-None-Match")
            if sent is not None and sent == self.etag:
                return FetchedBody(304, {"etag": self.etag}, b"")
            return FetchedBody(
                200, {"etag": self.etag}, json.dumps(self.commits).encode()
            )
        if url.startswith(f"{RAW}/"):
            sha, _, name = url.removeprefix(f"{RAW}/").partition("/")
            assert len(sha) == 40
            if name in self.files:
                return FetchedBody(200, {}, self.files[name].encode())
        return FetchedBody(404, {}, b"")

    def urls(self) -> list[str]:
        return [call.url for call in self.calls]


@pytest.fixture
def github(api: Api, monkeypatch: pytest.MonkeyPatch) -> FakeGitHub:
    fake = FakeGitHub()
    monkeypatch.setattr(default_sync, "source_body", fake)
    api.app.config.update(DEFAULT_SYNC_ENABLED=True, GITHUB_TOKEN=None)
    return fake


@pytest.fixture
def admin_client(api: Api) -> FlaskClient:
    return api.client(api.account(3001, "robin", is_admin=True))


def stored(api: Api) -> dict[str, Any]:
    document: dict[str, Any] = api.db.system_config.find_one({"_id": "default_config"})
    return document


def test_sync_stores_the_files_of_the_newest_published_build(
    api: Api, github: FakeGitHub
) -> None:
    github.commits = [HAND_WRITTEN_COMMIT, *recorded_commits()]

    result = default_sync.sync_default_config()

    assert result.status == "updated" and result.changed and result.commit_changed
    assert result.commit_sha == PUBLISHED_SHA
    assert result.source_count == 41
    assert github.urls() == [
        COMMITS_URL,
        f"{RAW}/{PUBLISHED_SHA}/blocklists.conf",
        f"{RAW}/{PUBLISHED_SHA}/whitelist.txt",
    ]
    document = stored(api)
    assert document["blocklists"] == recorded("blocklists.conf")
    assert document["whitelist"] == default_sync.rewrite_whitelist(
        recorded("whitelist.txt")
    )
    assert "@@clients.google.com\n" in document["whitelist"]
    assert document["revision"] == 1
    assert document["updated_by"] == "default-sync"
    source = document["source"]
    assert source["repo"] == REPO
    assert source["commit_sha"] == PUBLISHED_SHA
    assert source["commit_date"] == datetime(2026, 11, 8, 4, 54, 31)
    assert source["etag"] == ETAG
    assert source["last_error"] is None
    assert source["synced_at"] == source["last_checked_at"]
    assert len(source["blocklists_sha256"]) == len(source["whitelist_sha256"]) == 64
    api.whitelist_check.assert_called_once()


def test_commit_listing_requires_the_bot_author_and_the_message_prefix(
    api: Api, github: FakeGitHub
) -> None:
    bot_without_prefix = {
        **recorded_commits()[0],
        "sha": "b" * 40,
        "commit": {
            "message": "feat(blocklist): add a domain",
            "committer": {"date": "2026-11-09T11:00:00Z"},
        },
    }
    github.commits = [bot_without_prefix, HAND_WRITTEN_COMMIT, recorded_commits()[1]]

    assert default_sync.sync_default_config().commit_sha == EARLIER_SHA

    api.app.config["DEFAULT_SYNC_COMMIT_PREFIX"] = "feat(blocklist)"
    assert default_sync.sync_default_config(refetch=True).commit_sha == "b" * 40


def test_a_304_answer_changes_nothing_but_the_check_time(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    before = stored(api)
    github.calls.clear()
    github.files["blocklists.conf"] = "https://example.com/changed.txt|changed"

    result = default_sync.sync_default_config()

    assert result.status == "unchanged" and not result.build_needed
    assert [call.headers.get("If-None-Match") for call in github.calls] == [ETAG]
    after = stored(api)
    assert after["source"].pop("last_checked_at") >= before["source"].pop(
        "last_checked_at"
    )
    assert after == before


def test_no_published_build_in_the_listing_records_an_error(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    before = stored(api)
    github.etag = 'W/"later"'
    github.commits = [HAND_WRITTEN_COMMIT] * 10

    result = default_sync.sync_default_config()

    assert result.status == "failed" and not result.build_needed
    assert not result.can_force
    after = stored(api)
    assert "published build" in after["source"]["last_error"]
    assert after["source"]["etag"] == ETAG
    assert after["source"]["commit_sha"] == PUBLISHED_SHA
    assert (after["blocklists"], after["whitelist"], after["revision"]) == (
        before["blocklists"],
        before["whitelist"],
        1,
    )


@pytest.mark.parametrize(
    ("commits", "status"),
    [({"message": "Not Found"}, 200), ([], 403), ([], 301), ("text", 200)],
)
def test_an_unusable_commit_listing_fails_the_sync(
    api: Api, github: FakeGitHub, commits: Any, status: int
) -> None:
    github.commits = commits
    github.commits_status = status

    assert default_sync.sync_default_config().status == "failed"
    assert github.urls() == [COMMITS_URL]
    assert "blocklists" not in stored(api)


def test_whitelist_rewrite_gives_bare_entries_their_subdomains() -> None:
    upstream = (
        "# Example whitelist\n"
        "\n"
        "example.com\n"
        "Mixed.Example.ORG\n"
        "trailing.example.net  \t\n"
        "  indented.example.net\n"
        "inline.example.net # a note\n"
        "*.wild.example.com\n"
        "cdn*.partial.example.com\n"
        "/^api\\.example\\.com$/\n"
        "@@kept.example.com\n"
        "   # indented comment\n"
        "last.example.com"
    )
    assert default_sync.rewrite_whitelist(upstream) == (
        "# Example whitelist\n"
        "\n"
        "@@example.com\n"
        "@@Mixed.Example.ORG\n"
        "@@trailing.example.net  \t\n"
        "  @@indented.example.net\n"
        "@@inline.example.net # a note\n"
        "*.wild.example.com\n"
        "cdn*.partial.example.com\n"
        "/^api\\.example\\.com$/\n"
        "@@kept.example.com\n"
        "   # indented comment\n"
        "@@last.example.com"
    )
    assert default_sync.rewrite_whitelist("a.example\r\nb.example\r\n") == (
        "@@a.example\r\n@@b.example\r\n"
    )
    assert default_sync.rewrite_whitelist("") == ""


def test_recorded_whitelist_keeps_its_comments_and_order(api: Api) -> None:
    upstream = recorded("whitelist.txt")
    rewritten = default_sync.rewrite_whitelist(upstream)
    assert [line.removeprefix("@@") for line in rewritten.splitlines()] == (
        upstream.splitlines()
    )
    kinds = [line[:2] for line in rewritten.splitlines() if line and line[0] not in "#"]
    assert kinds.count("@@") == 10
    assert kinds.count("*.") == 3
    assert sum(kind.startswith("/") for kind in kinds) == 4


@pytest.mark.parametrize(
    "broken",
    [
        "https://example.com/one.txt|one|tracking|ABP",
        "http://127.0.0.1/private|one|tracking",
        "# only a comment\n",
    ],
)
def test_invalid_blocklists_keep_the_stored_config(
    api: Api, github: FakeGitHub, broken: str
) -> None:
    default_sync.sync_default_config()
    before = stored(api)
    github.etag = 'W/"later"'
    github.commits = recorded_commits()[1:]
    github.files["blocklists.conf"] = broken

    result = default_sync.sync_default_config(force=True)

    assert result.status == "failed"
    after = stored(api)
    assert "blocklists.conf" in after["source"].pop("last_error")
    assert before["source"].pop("last_error") is None
    after["source"].pop("last_checked_at")
    before["source"].pop("last_checked_at")
    assert after == before


def test_invalid_or_uncheckable_whitelist_keeps_the_stored_config(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    before = stored(api)
    github.commits = recorded_commits()[1:]
    github.files["whitelist.txt"] = "not a domain\n"
    api.whitelist_check.return_value = {
        "valid": False,
        "errors": [{"line": 1, "message": "Not a valid domain", "code": "x"}],
        "error_counts": {"x": 1},
    }

    github.etag = 'W/"second"'
    assert default_sync.sync_default_config().status == "failed"
    assert "Line 1: Not a valid domain" in stored(api)["source"]["last_error"]

    api.whitelist_check.side_effect = WhitelistValidationUnavailable("down")
    assert default_sync.sync_default_config().status == "failed"
    after = stored(api)
    assert after["source"]["last_error"] == "whitelist.txt could not be checked"
    assert after["source"]["commit_sha"] == PUBLISHED_SHA
    assert (after["whitelist"], after["revision"]) == (before["whitelist"], 1)


def test_non_utf8_file_or_network_failure_fails_the_sync(
    api: Api, github: FakeGitHub, monkeypatch: pytest.MonkeyPatch
) -> None:
    github.failure = BodyTooLarge("too large")
    result = default_sync.sync_default_config()
    assert result.error == "Could not fetch the GitHub commit list (BodyTooLarge)"

    undecodable = Mock(return_value=FetchedBody(200, {}, b"\xff\xfe"))
    monkeypatch.setattr(default_sync, "source_body", undecodable)
    with pytest.raises(default_sync.SyncFailure, match="not UTF-8"):
        default_sync._fetch_repository_file(REPO, PUBLISHED_SHA, "whitelist.txt")


def test_sync_refuses_to_halve_the_sources_unless_forced(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    github.etag = 'W/"later"'
    github.commits = recorded_commits()[1:]
    twenty = "\n".join(
        f"https://example.com/{n}.txt|list_{n}|tracking" for n in range(20)
    )
    github.files["blocklists.conf"] = twenty

    refused = default_sync.sync_default_config()
    assert refused.status == "failed" and refused.can_force
    assert "20 sources, less than half of the 41" in (refused.error or "")
    assert stored(api)["blocklists"] == recorded("blocklists.conf")

    forced = default_sync.sync_default_config(force=True)
    assert forced.status == "updated" and forced.source_count == 20
    assert stored(api)["blocklists"] == twenty
    assert stored(api)["revision"] == 2

    github.files["blocklists.conf"] = "\n".join(twenty.splitlines()[:10])
    github.commits = recorded_commits()[2:]
    github.etag = 'W/"latest"'
    assert default_sync.sync_default_config().status == "updated"


def test_a_new_build_with_the_same_files_moves_the_commit_only(
    api: Api, github: FakeGitHub
) -> None:
    github.commits = recorded_commits()[1:]
    default_sync.sync_default_config()
    before = stored(api)
    github.commits = recorded_commits()
    github.etag = 'W/"later"'

    result = default_sync.sync_default_config()

    assert result.status == "unchanged"
    assert not result.changed and result.commit_changed and result.build_needed
    after = stored(api)
    assert after["revision"] == before["revision"] == 1
    assert after["source"]["commit_sha"] == PUBLISHED_SHA
    assert after["source"]["commit_date"] == datetime(2026, 11, 8, 4, 54, 31)
    assert after["source"]["etag"] == 'W/"later"'
    assert after["source"]["synced_at"] == before["source"]["synced_at"]
    assert after["updated_at"] == before["updated_at"]


def test_a_changed_listing_with_the_same_build_fetches_no_files(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    github.calls.clear()
    github.commits = [HAND_WRITTEN_COMMIT, *recorded_commits()]
    github.etag = 'W/"later"'

    result = default_sync.sync_default_config()

    assert result.status == "unchanged" and not result.build_needed
    assert github.urls() == [COMMITS_URL]
    assert stored(api)["source"]["etag"] == 'W/"later"'


def test_a_refetch_restores_a_config_edited_by_hand(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    api.db.system_config.update_one(
        {"_id": "default_config"}, {"$set": {"whitelist": "edited.example.com\n"}}
    )
    assert default_sync.sync_default_config().status == "unchanged"
    github.calls.clear()

    result = default_sync.sync_default_config(refetch=True)

    assert result.status == "updated" and not result.commit_changed
    assert "If-None-Match" not in github.calls[0].headers
    assert stored(api)["whitelist"].startswith("# Zach's Lists - Default Whitelist")
    assert stored(api)["revision"] == 2


def test_default_build_pins_the_repository_files_and_the_stored_text_stays_unpinned(
    api: Api, github: FakeGitHub
) -> None:
    github.files["blocklists.conf"] = (
        "# https://raw.githubusercontent.com/zachlagden/Pi-hole-Optimized-Blocklists/main/custom/note.txt\n"
        f"{RAW}/main/custom/malicious.txt|custom_malicious|malicious|abp\n"
        f"{RAW}/refs/heads/main/custom/nsfw.txt|custom_nsfw|nsfw|abp\n"
        f"{RAW}/develop/custom/tracking.txt|custom_tracking|tracking|abp\n"
        "https://raw.githubusercontent.com/alex-example/Other-Lists/main/hosts.txt|other|tracking\n"
        "https://raw.githubusercontent.com/zachlagden/Pi-hole-Optimized-Blocklists-Fork/main/a.txt|fork|tracking\n"
        f"https://example.com/mirror?source={RAW}/main/custom/x.txt|mirror|tracking\n"
    )
    default_sync.sync_default_config()

    job = admit_build(DEFAULT_TARGET, Job.TYPE_SCHEDULED, None)

    snapshot = api.db.jobs.find_one({"job_id": job.job_id})["config_snapshot"]
    assert snapshot["blocklists"].splitlines() == [
        "# https://raw.githubusercontent.com/zachlagden/Pi-hole-Optimized-Blocklists/main/custom/note.txt",
        f"{RAW}/{PUBLISHED_SHA}/custom/malicious.txt|custom_malicious|malicious|abp",
        f"{RAW}/{PUBLISHED_SHA}/custom/nsfw.txt|custom_nsfw|nsfw|abp",
        f"{RAW}/develop/custom/tracking.txt|custom_tracking|tracking|abp",
        "https://raw.githubusercontent.com/alex-example/Other-Lists/main/hosts.txt|other|tracking",
        "https://raw.githubusercontent.com/zachlagden/Pi-hole-Optimized-Blocklists-Fork/main/a.txt|fork|tracking",
        f"https://example.com/mirror?source={RAW}/main/custom/x.txt|mirror|tracking",
    ]
    assert snapshot["whitelist"] == stored(api)["whitelist"]
    assert stored(api)["blocklists"] == github.files["blocklists.conf"]
    assert PUBLISHED_SHA not in SystemConfig.get_default_config()["blocklists"]


def test_pinning_needs_sync_switched_on_and_a_stored_commit(
    api: Api, github: FakeGitHub
) -> None:
    unpinned = f"{RAW}/main/custom/malicious.txt|custom_malicious|malicious|abp"
    assert default_sync.pin_repository_sources(unpinned) == unpinned
    default_sync.sync_default_config()
    assert PUBLISHED_SHA in default_sync.pin_repository_sources(unpinned)
    api.app.config["DEFAULT_SYNC_ENABLED"] = False
    assert default_sync.pin_repository_sources(unpinned) == unpinned


def test_token_goes_to_the_api_host_only_and_is_never_logged_or_stored(
    api: Api, github: FakeGitHub, caplog: pytest.LogCaptureFixture
) -> None:
    api.app.config["GITHUB_TOKEN"] = TOKEN
    caplog.set_level(logging.DEBUG)

    default_sync.sync_default_config()
    github.failure = requests.exceptions.ConnectionError(f"refused with {TOKEN}")
    assert default_sync.sync_default_config(force=True).status == "failed"

    by_host = {call.url.split("/")[2]: call for call in github.calls[:3]}
    assert by_host["api.github.com"].headers["Authorization"] == f"Bearer {TOKEN}"
    assert by_host["api.github.com"].follow_redirects is False
    assert "Authorization" not in by_host["raw.githubusercontent.com"].headers
    assert all(
        "Authorization" not in call.headers
        for call in github.calls
        if not call.url.startswith("https://api.github.com/")
    )
    assert all(
        call.headers["User-Agent"] == "blocklist-default-sync" for call in github.calls
    )
    assert TOKEN not in caplog.text
    assert TOKEN not in json.dumps(stored(api), default=str)


def test_requests_carry_no_token_when_none_is_configured(
    api: Api, github: FakeGitHub
) -> None:
    default_sync.sync_default_config()
    assert all("Authorization" not in call.headers for call in github.calls)


def test_admin_config_is_read_only_while_sync_is_on(
    api: Api, github: FakeGitHub, admin_client: FlaskClient
) -> None:
    default_sync.sync_default_config()

    shown = admin_client.get("/api/admin/default/config").get_json()
    assert shown["sync_enabled"] is True
    assert shown["config"] == recorded("blocklists.conf")
    assert shown["source"]["commit_sha"] == PUBLISHED_SHA
    assert shown["source"]["commit_date"] == "2026-11-08T04:54:31.000Z"
    assert shown["source"]["last_error"] is None
    assert "etag" not in shown["source"]

    refused = admin_client.put(
        "/api/admin/default/config",
        json={"config": "https://example.com/hosts.txt|example|tracking"},
    )
    assert refused.status_code == 409
    assert refused.get_json()["code"] == "default_config_managed"
    assert stored(api)["blocklists"] == recorded("blocklists.conf")


def test_admin_config_is_editable_while_sync_is_off(
    api: Api, admin_client: FlaskClient
) -> None:
    shown = admin_client.get("/api/admin/default/config").get_json()
    assert shown == {
        "config": "",
        "whitelist": "",
        "sync_enabled": False,
        "source": None,
    }
    saved = admin_client.put(
        "/api/admin/default/config",
        json={"config": "https://example.com/hosts.txt|example|tracking|abp"},
    )
    assert saved.status_code == 200
    invalid = admin_client.put(
        "/api/admin/default/config",
        json={"config": "https://example.com/hosts.txt|example|tracking|extra"},
    )
    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "invalid_config"
    assert admin_client.post("/api/admin/default/sync").status_code == 409


def test_admin_sync_status_and_run_now(
    api: Api, github: FakeGitHub, admin_client: FlaskClient
) -> None:
    empty = admin_client.get("/api/admin/default/sync").get_json()
    assert empty == {
        "sync_enabled": True,
        "repo": REPO,
        "revision": 0,
        "source": None,
    }

    ran = admin_client.post("/api/admin/default/sync", json={})
    assert ran.status_code == 200
    body = ran.get_json()
    assert body["sync"]["status"] == "updated" and body["sync"]["changed"] is True
    assert body["sync"]["source_count"] == 41
    assert body["revision"] == 1
    assert body["source"]["commit_sha"] == PUBLISHED_SHA
    job = api.db.jobs.find_one({"job_id": body["job_id"]})
    assert (job["target_id"], job["type"]) == (DEFAULT_TARGET, Job.TYPE_ADMIN)

    again = admin_client.post("/api/admin/default/sync", json={"force": False})
    assert again.get_json()["sync"]["status"] == "unchanged"
    assert again.get_json()["job_id"] is None
    assert "If-None-Match" not in github.calls[-3].headers

    assert admin_client.get("/api/admin/default/sync").get_json()["revision"] == 1
    malformed = admin_client.post("/api/admin/default/sync", json={"force": "yes"})
    assert malformed.status_code == 400 and malformed.get_json()["field"] == "force"


def test_admin_run_now_reports_an_active_build_and_passes_force_on(
    api: Api, github: FakeGitHub, admin_client: FlaskClient
) -> None:
    first = admin_client.post("/api/admin/default/sync").get_json()
    github.commits = recorded_commits()[1:]
    github.files["blocklists.conf"] = "https://example.com/one.txt|one|tracking"

    refused = admin_client.post("/api/admin/default/sync").get_json()
    assert refused["sync"]["status"] == "failed"
    assert refused["sync"]["can_force"] is True
    assert "less than half" in refused["source"]["last_error"]

    forced = admin_client.post("/api/admin/default/sync", json={"force": True})
    body = forced.get_json()
    assert body["sync"]["status"] == "updated"
    assert (body["job_id"], body["build_refusal"]) == (None, "build_active")
    assert api.db.jobs.count_documents({}) == 1
    assert api.db.jobs.find_one()["job_id"] == first["job_id"]


def test_sync_routes_need_an_admin_and_run_now_has_its_own_limit(
    api: Api, github: FakeGitHub, admin_client: FlaskClient
) -> None:
    visitor = api.client(api.account(3002, "sam"))
    assert visitor.get("/api/admin/default/sync").status_code == 403
    assert visitor.post("/api/admin/default/sync").status_code == 403
    assert api.client().post("/api/admin/default/sync").status_code == 401
    assert github.calls == []

    statuses = [
        admin_client.post("/api/admin/default/sync").status_code for _ in range(7)
    ]
    assert statuses == [200] * 6 + [429]


def test_schedule_registers_the_sync_check_and_the_later_rebuild_times(
    api: Api,
) -> None:
    scheduler = BackgroundScheduler(timezone="UTC")
    register_scheduled_tasks(api.app, scheduler)
    triggers = {job.id: str(job.trigger) for job in scheduler.get_jobs()}
    assert triggers["hourly_default_sync"] == "cron[minute='15']"
    assert triggers["weekly_default_rebuild"] == (
        "cron[day_of_week='sun', hour='6', minute='30']"
    )
    assert triggers["weekly_user_rebuild"] == (
        "cron[day_of_week='sun', hour='7', minute='30']"
    )
    assert str(scheduler.timezone) == "UTC"


def test_hourly_check_builds_a_changed_config_on_a_weekday(
    api: Api, github: FakeGitHub
) -> None:
    changed = default_refresh.hourly_check(TUESDAY)
    assert changed is not None and changed.job_id is not None
    job = api.db.jobs.find_one({"job_id": changed.job_id})
    assert (job["target_id"], job["type"]) == (DEFAULT_TARGET, Job.TYPE_SCHEDULED)

    unchanged = default_refresh.hourly_check(TUESDAY)
    assert unchanged is not None and unchanged.job_id is None
    assert unchanged.build_refusal is None
    assert api.db.jobs.count_documents({}) == 1


def test_hourly_check_tolerates_a_build_that_is_already_active(
    api: Api, github: FakeGitHub
) -> None:
    admit_build(DEFAULT_TARGET, Job.TYPE_ADMIN, None)
    result = default_refresh.hourly_check(TUESDAY)
    assert result is not None
    assert (result.job_id, result.build_refusal) == (None, "build_active")
    assert stored(api)["revision"] == 1


def test_hourly_check_on_sunday_leaves_the_build_to_the_weekly_rebuild(
    api: Api, github: FakeGitHub
) -> None:
    early = default_refresh.hourly_check(SUNDAY_BEFORE_REBUILD)
    assert early is not None and early.sync is not None and early.sync.changed
    assert api.db.jobs.count_documents({}) == 0

    github.commits = recorded_commits()[1:]
    github.etag = 'W/"later"'
    late = default_refresh.hourly_check(SUNDAY_AFTER_REBUILD)
    assert late is not None and late.job_id is not None


def test_weekly_rebuild_syncs_first_and_always_requests_the_build(
    api: Api, github: FakeGitHub
) -> None:
    first = default_refresh.weekly_rebuild()
    assert first.sync is not None and first.sync.status == "updated"
    snapshot = api.db.jobs.find_one({"job_id": first.job_id})["config_snapshot"]
    assert f"{RAW}/{PUBLISHED_SHA}/custom/nsfw.txt" in snapshot["blocklists"]

    api.db.jobs.update_many({}, {"$set": {"status": Job.STATUS_COMPLETED}})
    second = default_refresh.weekly_rebuild()
    assert second.sync is not None and second.sync.status == "unchanged"
    assert second.job_id is not None and second.job_id != first.job_id

    api.db.jobs.update_many({}, {"$set": {"status": Job.STATUS_COMPLETED}})
    github.failure = requests.exceptions.Timeout("slow")
    third = default_refresh.weekly_rebuild()
    assert third.sync is not None and third.sync.status == "failed"
    assert third.job_id is not None


def test_nothing_is_fetched_while_sync_is_off(
    api: Api, github: FakeGitHub, admin_client: FlaskClient
) -> None:
    api.app.config["DEFAULT_SYNC_ENABLED"] = False
    SystemConfig.update_default_config(
        f"{RAW}/main/custom/nsfw.txt|custom_nsfw|nsfw|abp", "", "robin"
    )

    assert default_refresh.hourly_check(TUESDAY) is None
    weekly = default_refresh.weekly_rebuild()
    assert weekly.sync is None and weekly.job_id is not None
    assert admin_client.post("/api/admin/default/sync").status_code == 409

    assert github.calls == []
    snapshot = api.db.jobs.find_one({"job_id": weekly.job_id})["config_snapshot"]
    assert "/main/custom/nsfw.txt" in snapshot["blocklists"]
    assert "source" not in stored(api)


def test_synced_template_fits_the_default_limit_and_a_lower_override_refuses_it(
    api: Api, github: FakeGitHub
) -> None:
    assert TestingConfig.DEFAULT_MAX_SOURCE_LISTS == 50
    default_sync.sync_default_config()
    sam = api.account(3002, "sam")
    alex = api.account(3003, "alex", limits={"max_source_lists": 40})
    assert sam.limits["max_source_lists"] == 50
    assert alex.limits["max_source_lists"] == 40

    copied = default_template.copy_default_template(sam, overwrite=False)

    assert copied == {"blocklists_conf": True, "whitelist_txt": True}
    saved = api.reload(sam).get_config("blocklists.conf") or ""
    assert saved == recorded("blocklists.conf")
    assert f"{RAW}/main/custom/nsfw.txt|custom_nsfw|nsfw|abp" in saved
    with pytest.raises(default_template.TemplateRefusal) as refusal:
        default_template.copy_default_template(alex, overwrite=False)
    assert refusal.value.code == "template_exceeds_limit"
    assert refusal.value.details == {"source_count": 41, "max_source_lists": 40}
    assert not api.reload(alex).get_config("blocklists.conf")


class StreamedResponse:
    status_code = 200
    headers = {"ETag": "abc", "Content-Type": "text/plain"}

    def __init__(self, chunks: list[bytes]) -> None:
        self.chunks = chunks

    def iter_content(self, size: int) -> list[bytes]:
        return self.chunks

    def __enter__(self) -> "StreamedResponse":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


def test_source_body_stops_at_the_size_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    served = StreamedResponse([b"a" * 600, b"b" * 400])
    monkeypatch.setattr(safe_http, "source_response", Mock(return_value=served))

    fetched = safe_http.source_body("https://example.com/list.txt", 1000)
    assert fetched == FetchedBody(
        200, {"etag": "abc", "content-type": "text/plain"}, b"a" * 600 + b"b" * 400
    )

    served.chunks = [b"a" * 600, b"b" * 401]
    with pytest.raises(BodyTooLarge):
        safe_http.source_body("https://example.com/list.txt", 1000)


def test_source_response_returns_a_redirect_when_told_not_to_follow() -> None:
    redirect = Mock(status_code=302, headers={"Location": "https://example.org/"})
    session = Mock()
    session.request.return_value = redirect

    response = safe_http.source_response(
        session, "GET", "https://example.com/a", follow_redirects=False
    )

    assert response is redirect
    session.request.assert_called_once()


def test_user_limit_default_is_fifty(api: Api) -> None:
    assert User.default_limits()["max_source_lists"] == 50
