from unittest.mock import Mock

import pytest
from flask import Flask

import app.socketio as realtime
from app.models.user import User


@pytest.mark.parametrize(
    "change", ["expiry", "session_version", "disabled", "admin_removed"]
)
def test_access_is_checked_before_protected_event(
    monkeypatch: pytest.MonkeyPatch, change: str
) -> None:
    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        SECRET_KEY="example-socket-key",
        FRONTEND_URL="https://example.com",
    )
    account = Mock(spec=User)
    account.id = "000000000000000000000001"
    account.is_enabled = True
    account.is_banned = False
    account.is_admin = True
    account.auth_version = 0
    monkeypatch.setattr(User, "get_by_id", Mock(return_value=account))
    realtime.init_socketio(app)
    http = app.test_client()
    with http.session_transaction() as session:
        session["user_id"] = account.id
    client = realtime.socketio.test_client(app, flask_test_client=http)
    assert client.is_connected()
    client.emit("subscribe:jobs", {"all": True})
    client.get_received()
    sid = realtime.socketio.server.manager.sid_from_eio_sid(client.eio_sid, "/")
    assert sid is not None
    if change == "expiry":
        realtime._connections[sid].expires_at = 0
    elif change == "session_version":
        account.auth_version = 1
    elif change == "disabled":
        account.is_enabled = False
    else:
        account.is_admin = False
    realtime._emit("job:progress", {"job_id": "example-private-job"}, "jobs:all")
    assert not client.is_connected()
