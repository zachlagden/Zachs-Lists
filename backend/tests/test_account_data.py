import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse

import pytest
from bson import ObjectId

from app.blueprints import auth, lists
from app.models.analytics import Analytics
from app.models.job import Job
from app.models.user import User
from app.scheduled_tasks.tasks import delete_finished_jobs_before
from app.services import download_recorder
from app.services.download_recorder import access_log_hash
from conftest import Api

ADDRESS = "198.51.100.10"


@pytest.fixture
def sam(api: Api) -> User:
    return api.account(5001, "sam")


def ip_log(api: Api, name: str = "sam") -> list[dict[str, Any]]:
    return api.db.users.find_one({"username": name}).get("ip_log", [])


def test_ip_log_uses_its_own_keyed_hash(api: Api, sam: User) -> None:
    sam.log_ip_access(ADDRESS)
    sam.log_ip_access(ADDRESS)
    sam.log_ip_access("203.0.113.20")

    entries = ip_log(api)
    assert [(entry["ip_hash"], entry["access_count"]) for entry in entries] == [
        (access_log_hash(ADDRESS), 2),
        (access_log_hash("203.0.113.20"), 1),
    ]
    unkeyed = hashlib.sha256(ADDRESS.encode()).hexdigest()[:16]
    assert unkeyed not in {entry["ip_hash"] for entry in entries}
    assert ADDRESS not in str(entries)
    assert entries[0]["first_seen"] <= entries[0]["last_seen"]


def test_ip_log_writes_are_conditional_updates_without_a_read(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    users = api.db.users
    monkeypatch.setattr(users, "find_one", Mock(side_effect=AssertionError("read")))
    monkeypatch.setattr(users, "find", Mock(side_effect=AssertionError("read")))
    update_one = Mock(wraps=users.update_one)
    monkeypatch.setattr(users, "update_one", update_one)

    sam.log_ip_access(ADDRESS)
    assert update_one.call_count == 2
    sam.log_ip_access(ADDRESS)
    assert update_one.call_count == 3
    for call in update_one.call_args_list:
        assert "ip_log.ip_hash" in call.args[0]


def test_a_lost_race_to_add_an_address_counts_the_visit_instead(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    users = api.db.users
    real_update = users.update_one
    calls = 0

    def update_after_a_concurrent_add(*args: Any, **kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        result = real_update(*args, **kwargs)
        if calls == 1:
            User({"_id": ObjectId(sam.id)}).log_ip_access(ADDRESS)
        return result

    monkeypatch.setattr(users, "update_one", update_after_a_concurrent_add)
    sam.log_ip_access(ADDRESS)

    entries = ip_log(api)
    assert len(entries) == 1
    assert entries[0]["access_count"] == 2


def test_ip_log_keeps_the_fifty_most_recently_added_addresses(
    api: Api, sam: User
) -> None:
    old = datetime.utcnow() - timedelta(days=30)
    legacy = [
        {
            "ip_hash": hashlib.sha256(f"legacy-{number}".encode()).hexdigest()[:16],
            "first_seen": old + timedelta(minutes=number),
            "last_seen": old + timedelta(minutes=number),
            "access_count": 4,
        }
        for number in range(70)
    ]
    api.db.users.update_one({"username": "sam"}, {"$set": {"ip_log": legacy}})

    sam.log_ip_access(ADDRESS)

    entries = ip_log(api)
    assert len(entries) == User.MAX_IP_LOG_ENTRIES == 50
    assert entries[-1]["ip_hash"] == access_log_hash(ADDRESS)
    assert [entry["ip_hash"] for entry in entries[:-1]] == [
        entry["ip_hash"] for entry in legacy[21:]
    ]

    for number in range(60):
        sam.log_ip_access(f"203.0.113.{number}")
    entries = ip_log(api)
    assert len(entries) == 50
    assert {entry["ip_hash"] for entry in entries} == {
        access_log_hash(f"203.0.113.{number}") for number in range(10, 60)
    }


def test_readers_accept_old_and_new_ip_log_entries(api: Api, sam: User) -> None:
    seen = datetime(2026, 1, 2, 3, 4, 5)
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "ip_log": [
                    {
                        "ip_hash": "0123456789abcdef",
                        "first_seen": seen,
                        "last_seen": seen,
                        "access_count": 7,
                    },
                    {"ip_hash": "fedcba9876543210"},
                    "damaged",
                ]
            }
        },
    )
    api.reload(sam).log_ip_access(ADDRESS)
    admin = api.account(5002, "robin", is_admin=True)

    response = api.client(admin).get(f"/api/admin/users/{sam.id}/ips")

    assert response.status_code == 200
    body = response.get_json()
    assert body["ip_count"] == 3
    assert body["ip_log"][0] == {
        "ip_hash": "0123456789abcdef",
        "first_seen": "2026-01-02T03:04:05.000Z",
        "last_seen": "2026-01-02T03:04:05.000Z",
        "access_count": 7,
    }
    assert body["ip_log"][1] == {
        "ip_hash": "fedcba9876543210",
        "first_seen": None,
        "last_seen": None,
        "access_count": 0,
    }
    assert body["ip_log"][2]["ip_hash"] == access_log_hash(ADDRESS)
    detail = api.client(admin).get(f"/api/admin/users/{sam.id}").get_json()
    assert detail["ip_log"] == body["ip_log"]


def test_signed_in_profile_request_records_the_address(api: Api, sam: User) -> None:
    client = api.client(sam)
    for _ in range(2):
        response = client.get(
            "/api/auth/me", environ_overrides={"REMOTE_ADDR": ADDRESS}
        )
        assert response.status_code == 200
    assert [(entry["ip_hash"], entry["access_count"]) for entry in ip_log(api)] == [
        (access_log_hash(ADDRESS), 2)
    ]


def test_session_check_answers_200_for_a_signed_out_visitor(api: Api) -> None:
    response = api.client().get("/api/auth/session")

    assert response.status_code == 200
    assert response.get_json() == {"user": None}


def test_session_check_returns_the_account_and_records_the_address(
    api: Api, sam: User
) -> None:
    response = api.client(sam).get(
        "/api/auth/session", environ_overrides={"REMOTE_ADDR": ADDRESS}
    )

    assert response.status_code == 200
    assert response.get_json()["user"]["username"] == "sam"
    assert [entry["ip_hash"] for entry in ip_log(api)] == [access_log_hash(ADDRESS)]


def test_session_check_ends_a_session_that_may_no_longer_be_used(
    api: Api, sam: User
) -> None:
    revoked = api.client(sam)
    api.reload(sam).revoke_sessions()
    disabled = api.client(api.reload(sam))
    api.reload(sam).set_enabled(False)

    for client in (revoked, disabled):
        assert client.get("/api/auth/session").get_json() == {"user": None}
        with client.session_transaction() as stored:
            assert "user_id" not in stored

    api.reload(sam).set_enabled(True)
    banned = api.client(api.reload(sam))
    api.reload(sam).ban(datetime.utcnow() + timedelta(days=1), "example")
    assert banned.get("/api/auth/session").get_json() == {"user": None}


def test_notifications_keep_the_newest_hundred(api: Api, sam: User) -> None:
    for number in range(105):
        sam.add_notification("example", f"Title {number}", "Text")

    notifications = api.reload(sam).notifications
    assert len(notifications) == User.MAX_NOTIFICATIONS == 100
    assert notifications[0]["title"] == "Title 104"
    assert notifications[-1]["title"] == "Title 5"


def seed_account_data(api: Api, account: User) -> None:
    owner = ObjectId(account.id)
    name = account.username
    day = Analytics.today()
    api.db.jobs.insert_many(
        [
            {
                "job_id": f"{name}-done",
                "user_id": owner,
                "status": "completed",
                "target_id": name,
            },
            {
                "job_id": f"{name}-queued",
                "user_id": owner,
                "status": "queued",
                "target_id": name,
            },
        ]
    )
    api.db.limit_requests.insert_many(
        [
            {"user_id": owner, "status": "pending"},
            {"user_id": owner, "status": "denied"},
        ]
    )
    api.db.featured_lists.insert_one({"username": name, "list_name": "all_domains"})
    api.db.validation_tokens.insert_one({"_id": f"token-{name}", "user_id": owner})
    scope = {"list_type": "user", "username": name, "list_name": "all_domains"}
    api.db[Analytics.COLLECTION].insert_one({**scope, "date": day})
    api.db[Analytics.VISITORS_COLLECTION].insert_one(
        {**scope, "date": day, "visitor": "0123456789abcdef"}
    )
    output = Path(account.get_output_dir())
    output.mkdir(parents=True)
    (output / "all_domains_hosts.txt.gz").write_bytes(b"example")


def test_deleting_a_user_removes_everything_that_identifies_them(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    alex = api.account(5003, "alex")
    admin = api.account(5004, "robin", is_admin=True)
    seed_account_data(api, sam)
    seed_account_data(api, alex)
    api.db.jobs.insert_one({"job_id": "default-done", "user_id": None})
    default_scope = {"list_type": "default", "username": None, "list_name": "sam"}
    api.db[Analytics.COLLECTION].insert_one(
        {**default_scope, "date": Analytics.today()}
    )
    disconnected = Mock()
    monkeypatch.setattr("app.socketio.disconnect_user", disconnected)

    response = api.client(admin).delete(f"/api/admin/users/{sam.id}")

    assert response.status_code == 200
    owner = ObjectId(sam.id)
    assert api.db.users.find_one({"_id": owner}) is None
    by_id = {"user_id": owner}
    by_name = {"username": "sam"}
    assert api.db.jobs.count_documents(by_id) == 0
    assert api.db.limit_requests.count_documents(by_id) == 0
    assert api.db.validation_tokens.count_documents(by_id) == 0
    assert api.db.featured_lists.count_documents(by_name) == 0
    assert api.db[Analytics.COLLECTION].count_documents(by_name) == 0
    assert api.db[Analytics.VISITORS_COLLECTION].count_documents(by_name) == 0
    assert not Path(sam.get_user_dir()).exists()
    disconnected.assert_called_once_with(sam.id)

    kept = {"user_id": ObjectId(alex.id)}
    assert api.db.jobs.count_documents(kept) == 2
    assert api.db.limit_requests.count_documents(kept) == 2
    assert api.db.validation_tokens.count_documents(kept) == 1
    assert api.db.featured_lists.count_documents({"username": "alex"}) == 1
    assert api.db[Analytics.COLLECTION].count_documents({"username": "alex"}) == 1
    assert api.db[Analytics.VISITORS_COLLECTION].count_documents({}) == 1
    assert api.db.jobs.count_documents({"job_id": "default-done"}) == 1
    assert api.db[Analytics.COLLECTION].count_documents(default_scope) == 1
    assert Path(alex.get_output_dir()).exists()


def test_a_deleted_user_session_stops_working(api: Api, sam: User) -> None:
    client = api.client(sam)
    assert client.get("/api/user/lists").status_code == 200
    api.reload(sam).delete_with_data()
    assert client.get("/api/user/lists").status_code == 401


def test_banned_users_lists_are_not_served(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    api.db.users.update_one(
        {"username": "sam"},
        {"$set": {"lists": [{"name": "all_domains", "domain_count": 1}]}},
    )
    output = Path(api.reload(sam).get_output_dir())
    output.mkdir(parents=True, exist_ok=True)
    (output / "all_domains_hosts.txt").write_text("example.com\n")
    monkeypatch.setattr(download_recorder, "record_download", Mock())
    monkeypatch.setattr(lists, "record_download", Mock())
    client = api.client()
    path = "/u/sam/all_domains.txt"

    assert client.get(path).status_code == 200

    api.reload(sam).set_enabled(False)
    disabled = client.get(path)
    api.reload(sam).set_enabled(True)
    assert client.get(path).status_code == 200

    api.reload(sam).ban(datetime.utcnow() + timedelta(days=1), "example")
    banned = client.get(path)
    assert (banned.status_code, banned.get_data()) == (
        disabled.status_code,
        disabled.get_data(),
    )
    assert banned.status_code == 404

    api.db.users.update_one(
        {"username": "sam"},
        {"$set": {"banned_until": datetime.utcnow() - timedelta(minutes=1)}},
    )
    assert client.get(path).status_code == 200


def test_job_cleanup_keeps_active_jobs_whatever_their_age(api: Api) -> None:
    now = datetime.utcnow()
    old = now - timedelta(days=45)
    recent = now - timedelta(days=5)
    api.db.jobs.insert_many(
        [
            {
                "job_id": f"old-{status}",
                "target_id": f"old-{status}",
                "status": status,
                "created_at": old,
            }
            for status in ("queued", "processing", "completed", "failed", "skipped")
        ]
        + [
            {
                "job_id": f"recent-{status}",
                "target_id": f"recent-{status}",
                "status": status,
                "created_at": recent,
            }
            for status in ("queued", "completed", "failed")
        ]
    )

    deleted = delete_finished_jobs_before(now - timedelta(days=30))

    assert deleted == 3
    assert sorted(job["job_id"] for job in api.db.jobs.find()) == [
        "old-processing",
        "old-queued",
        "recent-completed",
        "recent-failed",
        "recent-queued",
    ]
    assert {Job.STATUS_QUEUED, Job.STATUS_PROCESSING} == set(Job.ACTIVE_STATUSES)


def github_reply(payload: Any) -> Mock:
    reply = Mock()
    reply.json.return_value = payload
    reply.raise_for_status.return_value = None
    return reply


def sign_in_through_github(
    api: Api, monkeypatch: pytest.MonkeyPatch, github_id: int, login: str
) -> tuple[str, dict[str, list[str]], Any]:
    monkeypatch.setattr(
        auth.requests, "post", Mock(return_value=github_reply({"access_token": "t"}))
    )
    monkeypatch.setattr(
        auth.requests,
        "get",
        Mock(
            return_value=github_reply(
                {"id": github_id, "login": login, "email": f"{login}@example.com"}
            )
        ),
    )
    client = api.client()
    with client.session_transaction() as session:
        session["oauth_state"] = "example-state"
    response = client.get("/api/auth/callback?code=example&state=example-state")
    assert response.status_code == 302
    target = urlparse(response.headers["Location"])
    return target.path, parse_qs(target.query), client


def test_callback_signs_in_an_account_in_good_standing(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    path, query, client = sign_in_through_github(api, monkeypatch, 5001, "sam")
    assert (path, query) == ("/dashboard", {})
    assert client.get("/api/auth/me").status_code == 200


def test_callback_explains_a_disabled_account(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    sam.set_enabled(False)
    path, query, client = sign_in_through_github(api, monkeypatch, 5001, "sam")
    assert (path, query) == ("/login", {"error": ["account_disabled"]})
    assert client.get("/api/auth/me").status_code == 401


def test_callback_explains_a_timed_ban_with_its_end(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    until = datetime.utcnow().replace(microsecond=0) + timedelta(days=7)
    sam.ban(until, "example")

    path, query, client = sign_in_through_github(api, monkeypatch, 5001, "sam")

    assert path == "/login"
    assert query == {
        "error": ["account_banned"],
        "until": [until.isoformat(timespec="milliseconds") + "Z"],
    }
    assert client.get("/api/auth/me").status_code == 401


def test_callback_explains_a_permanent_ban_without_an_end(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    admin = api.account(5005, "robin", is_admin=True)
    banned = api.client(admin).post(
        f"/api/admin/users/{sam.id}/ban", json={"duration": "permanent"}
    )
    assert banned.status_code == 200

    path, query, _ = sign_in_through_github(api, monkeypatch, 5001, "sam")

    assert (path, query) == ("/login", {"error": ["account_banned"]})


def test_callback_lets_an_expired_ban_sign_in(
    api: Api, sam: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    sam.ban(datetime.utcnow() - timedelta(minutes=1), "example")
    path, _, _ = sign_in_through_github(api, monkeypatch, 5001, "sam")
    assert path == "/dashboard"


def test_ip_log_hash_differs_from_the_analytics_visitor_hash(api: Api) -> None:
    from app.services.download_recorder import visitor_hash

    assert access_log_hash(ADDRESS) != visitor_hash(ADDRESS)
