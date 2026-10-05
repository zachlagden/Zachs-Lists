from unittest.mock import Mock

import pytest
from flask import Flask
from flask_socketio import SocketIOTestClient

from app.models.user import User
from app.socketio import init_socketio, socketio


@pytest.fixture
def socket_app(monkeypatch: pytest.MonkeyPatch) -> tuple[Flask, Mock]:
    application = Flask(__name__)
    application.config.update(
        TESTING=True,
        SECRET_KEY="example-test-session-key",
        FRONTEND_URL="https://example.com",
    )
    account = Mock(spec=User)
    account.id = "000000000000000000000001"
    account.is_enabled = True
    account.is_banned = False
    account.is_admin = False
    monkeypatch.setattr(User, "get_by_id", Mock(return_value=account))
    init_socketio(application)
    return application, account


def signed_in(
    app: Flask, user_id: str = "000000000000000000000001"
) -> SocketIOTestClient:
    flask_client = app.test_client()
    with flask_client.session_transaction() as session:
        session["user_id"] = user_id
    return socketio.test_client(app, flask_test_client=flask_client)


def test_anonymous_socket_cannot_connect(socket_app: tuple[Flask, Mock]) -> None:
    app, _ = socket_app
    client = socketio.test_client(app)
    assert not client.is_connected()


def test_own_jobs_and_validation_are_private(socket_app: tuple[Flask, Mock]) -> None:
    app, account = socket_app
    client = signed_in(app)
    try:
        assert client.is_connected()
        client.get_received()
        client.emit("subscribe:jobs", {"user_id": account.id})
        client.emit("subscribe:validation", {"user_id": account.id})
        socketio.emit(
            "job:progress", {"job_id": "example-job"}, to=f"jobs:{account.id}"
        )
        socketio.emit(
            "config:validation_progress", {"current": 1}, to=f"validation:{account.id}"
        )
        assert {event["name"] for event in client.get_received()} == {
            "job:progress",
            "config:validation_progress",
        }
        client.emit("subscribe:jobs", {"user_id": "someone-else"})
        client.emit("subscribe:validation", {"user_id": "someone-else"})
        client.emit("subscribe:jobs", {"all": True})
        client.emit("subscribe:stats", None)
        socketio.emit("job:progress", {"job_id": "private"}, to="jobs:someone-else")
        socketio.emit("job:progress", {"job_id": "all"}, to="jobs:all")
        socketio.emit("stats:updated", {}, to="stats:admin")
        socketio.emit("config:validation_progress", {}, to="validation:someone-else")
        assert client.get_received() == []
    finally:
        client.disconnect()


@pytest.mark.parametrize(
    "payload",
    [
        None,
        "other",
        [],
        {},
        {"all": 1},
        {"user_id": []},
        {"all": True, "user_id": "example"},
    ],
)
def test_invalid_subscription_payload_is_denied(
    socket_app: tuple[Flask, Mock], payload: object
) -> None:
    app, _ = socket_app
    client = signed_in(app)
    try:
        client.get_received()
        client.emit("subscribe:jobs", payload)
        socketio.emit("job:progress", {}, to="jobs:all")
        assert client.get_received() == []
    finally:
        client.disconnect()


def test_admin_can_subscribe_but_regular_user_cannot(
    socket_app: tuple[Flask, Mock],
) -> None:
    app, account = socket_app
    account.is_admin = True
    client = signed_in(app)
    try:
        client.get_received()
        client.emit("subscribe:jobs", {"all": True})
        client.emit("subscribe:stats", None)
        socketio.emit("job:progress", {"job_id": "all"}, to="jobs:all")
        socketio.emit("stats:updated", {}, to="stats:admin")
        assert {event["name"] for event in client.get_received()} == {
            "job:progress",
            "stats:updated",
        }
        account.is_admin = False
        client.emit("unsubscribe:jobs", {"all": True})
        assert client.is_connected()
    finally:
        client.disconnect()


def test_disabled_or_banned_user_cannot_connect(socket_app: tuple[Flask, Mock]) -> None:
    app, account = socket_app
    account.is_enabled = False
    assert not signed_in(app).is_connected()
    account.is_enabled = True
    account.is_banned = True
    assert not signed_in(app).is_connected()


def test_access_change_disconnects_existing_client(
    socket_app: tuple[Flask, Mock],
) -> None:
    from app.socketio import disconnect_user

    app, account = socket_app
    client = signed_in(app)
    assert client.is_connected()
    disconnect_user(account.id)
    assert not client.is_connected()
