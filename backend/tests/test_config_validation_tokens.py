from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import mongomock
import pytest
from flask import Flask
from flask.testing import FlaskClient

from app.blueprints.auth import auth_bp
from app.blueprints.user import user_bp
from app.config import TestingConfig
from app.extensions import mongo
from app.models.user import User
from app.socketio import init_socketio
from app.utils import validators
from app.utils.api_input import register_input_checks


@pytest.fixture
def config_clients(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> tuple[FlaskClient, FlaskClient]:
    app = Flask(__name__)
    app.config.from_object(TestingConfig)
    app.config.update(
        SECRET_KEY="example-config-key", USERS_DIR=str(tmp_path / "users")
    )
    monkeypatch.setattr(mongo, "db", mongomock.MongoClient().default)
    monkeypatch.setattr(
        validators,
        "source_headers",
        Mock(return_value=(200, {"Content-Type": "text/plain"})),
    )
    register_input_checks(app)
    init_socketio(app)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(user_bp, url_prefix="/api/user")
    clients = []
    with app.app_context():
        for github_id, name in [(1001, "sam"), (1002, "alex")]:
            user = User.find_or_create_from_github(github_id, name)
            client = app.test_client()
            with client.session_transaction() as session:
                session["user_id"] = user.id
            clients.append(client)
    return clients[0], clients[1]


def validate(client: FlaskClient, content: str) -> str:
    response = client.post("/api/user/config/validate", json={"config": content})
    assert response.status_code == 200
    token = response.get_json()["validation_token"]
    assert isinstance(token, str)
    return token


def save(client: FlaskClient, content: str, token: str) -> int:
    return client.put(
        "/api/user/config", json={"config": content, "validation_token": token}
    ).status_code


def test_token_is_opaque_owned_one_use_and_content_bound(
    config_clients: tuple[FlaskClient, FlaskClient],
) -> None:
    sam, alex = config_clients
    content = "https://example.com/source|Example|tracking"
    token = validate(sam, content)
    assert save(alex, content, token) == 400
    assert save(sam, content + "\n# edit", token) == 400
    assert save(sam, content, "wrong-token") == 400
    assert save(sam, content, token) == 200
    assert save(sam, content, token) == 400
    assert sam.get("/api/user/config").get_json()["revision"] == 1


def test_tabs_validate_independently_but_cannot_overwrite_newer_revision(
    config_clients: tuple[FlaskClient, FlaskClient],
) -> None:
    sam, _ = config_clients
    first = "https://example.com/first|First|tracking"
    second = "https://example.com/second|Second|tracking"
    first_token = validate(sam, first)
    second_token = validate(sam, second)
    assert first_token != second_token
    assert save(sam, first, first_token) == 200
    assert save(sam, second, second_token) == 409
    assert sam.get("/api/user/config").get_json()["config"] == first


def test_expired_token_cannot_save(
    config_clients: tuple[FlaskClient, FlaskClient],
) -> None:
    sam, _ = config_clients
    content = "https://example.com/source"
    token = validate(sam, content)
    mongo.db.validation_tokens.update_one(
        {"_id": token},
        {"$set": {"expires_at": datetime.utcnow() - timedelta(seconds=1)}},
    )
    assert save(sam, content, token) == 400


def test_bad_config_never_gets_a_save_token(
    config_clients: tuple[FlaskClient, FlaskClient],
) -> None:
    sam, _ = config_clients
    response = sam.post(
        "/api/user/config/validate", json={"config": "http://127.0.0.1/private"}
    )
    assert response.status_code == 200
    assert response.get_json()["has_errors"]
    assert response.get_json()["validation_token"] is None
    assert mongo.db.validation_tokens.count_documents({}) == 0
