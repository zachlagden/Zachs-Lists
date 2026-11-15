from datetime import datetime, timedelta
from typing import Any

import pytest

from conftest import Api

SESSION_ROUTE = "/api/auth/session"
GUARDED_ROUTE = "/api/auth/me"

STATES: list[tuple[str, dict[str, Any], int, str | None]] = [
    ("valid", {}, 200, None),
    ("stale", {"auth_version": 7}, 401, "Session expired; sign in again"),
    ("disabled", {"is_enabled": False}, 403, "Account disabled"),
    (
        "banned",
        {
            "is_banned": True,
            "banned_until": datetime.utcnow() + timedelta(days=7),
            "ban_reason": "Example reason",
        },
        403,
        "Account banned",
    ),
]


@pytest.mark.parametrize(("state", "fields", "status", "error"), STATES)
def test_both_session_paths_agree(
    api: Api, state: str, fields: dict[str, Any], status: int, error: str | None
) -> None:
    account = api.account(4100, "alex")
    session_client = api.client(account)
    guarded_client = api.client(account)
    if fields:
        api.db.users.update_one({"username": "alex"}, {"$set": fields})

    session_answer = session_client.get(SESSION_ROUTE)
    guarded_answer = guarded_client.get(GUARDED_ROUTE)

    assert session_answer.status_code == 200
    assert guarded_answer.status_code == status
    signed_in = status == 200
    assert (session_answer.get_json()["user"] is not None) is signed_in
    if signed_in:
        assert (
            session_answer.get_json()["user"]["id"] == guarded_answer.get_json()["id"]
        )
    else:
        assert guarded_answer.get_json()["error"] == error
    for client in (session_client, guarded_client):
        with client.session_transaction() as kept:
            assert ("user_id" in kept) is signed_in, state


def test_both_session_paths_agree_for_a_missing_user(api: Api) -> None:
    account = api.account(4101, "sam")
    session_client = api.client(account)
    guarded_client = api.client(account)
    api.db.users.delete_one({"username": "sam"})

    assert session_client.get(SESSION_ROUTE).get_json() == {"user": None}
    guarded_answer = guarded_client.get(GUARDED_ROUTE)
    assert guarded_answer.status_code == 401
    assert guarded_answer.get_json() == {"error": "User not found"}
    for client in (session_client, guarded_client):
        with client.session_transaction() as kept:
            assert "user_id" not in kept


def test_both_session_paths_agree_when_signed_out(api: Api) -> None:
    assert api.client().get(SESSION_ROUTE).get_json() == {"user": None}
    guarded_answer = api.client().get(GUARDED_ROUTE)
    assert guarded_answer.status_code == 401
    assert guarded_answer.get_json() == {"error": "Authentication required"}


def test_a_ban_refusal_carries_its_reason_and_end(api: Api) -> None:
    account = api.account(4102, "jo")
    client = api.client(account)
    until = datetime(2126, 1, 1)
    api.db.users.update_one(
        {"username": "jo"},
        {"$set": {"is_banned": True, "banned_until": until, "ban_reason": "Example"}},
    )

    answer = client.get(GUARDED_ROUTE).get_json()

    assert answer["error"] == "Account banned"
    assert answer["reason"] == "Example"
    assert answer["until"].startswith("2126-01-01")
