from pathlib import Path
from unittest.mock import Mock
from typing import Any

import mongomock
import pytest
from flask import Flask

from app.config import TestingConfig
from app.blueprints.auth import auth_bp
from app.extensions import mongo
from app.models.user import User
from app.utils.runtime_config import validate_runtime_config


@pytest.fixture
def identity_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Flask:
    app = Flask(__name__)
    app.config.from_object(TestingConfig)
    app.config.update(
        ROOT_GITHUB_ID=1001, ROOT_USERNAME="sam", USERS_DIR=str(tmp_path / "users")
    )
    monkeypatch.setattr(mongo, "db", mongomock.MongoClient().default)
    return app


def test_root_is_provider_identity_not_reused_username(identity_app: Flask) -> None:
    with identity_app.app_context():
        root = User.find_or_create_from_github(1001, "sam")
        renamed = User.find_or_create_from_github(1001, "morgan")
        impostor = User.find_or_create_from_github(1002, "sam")
        assert root.is_root and renamed.is_root
        assert not impostor.is_root
        assert impostor.username != root.username


def test_rename_preserves_list_identifier_and_path(identity_app: Flask) -> None:
    with identity_app.app_context():
        original = User.find_or_create_from_github(1002, "alex")
        path = original.get_output_dir()
        renamed = User.find_or_create_from_github(1002, "taylor")
        assert renamed.username == "alex"
        assert renamed.github_username == "taylor"
        assert renamed.get_output_dir() == path
        lookup = User.get_by_username("alex")
        assert lookup is not None and lookup.github_id == 1002


def test_double_reserved_slug_still_allows_oauth_completion(
    identity_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    with identity_app.app_context():
        User.find_or_create_from_github(1001, "sam")
        User.find_or_create_from_github(1002, "sam-1003")
    identity_app.register_blueprint(auth_bp, url_prefix="/api/auth")
    token = Mock()
    token.json.return_value = {"access_token": "example-provider-token"}
    profile = Mock()
    profile.json.return_value = {"id": 1003, "login": "sam", "email": "sam@example.com"}
    monkeypatch.setattr("app.blueprints.auth.requests.post", Mock(return_value=token))
    monkeypatch.setattr("app.blueprints.auth.requests.get", Mock(return_value=profile))
    client = identity_app.test_client()
    with client.session_transaction() as session:
        session["oauth_state"] = "example-state"
    response = client.get("/api/auth/callback?state=example-state&code=example-code")
    assert response.status_code == 302 and response.headers["Location"].endswith(
        "/dashboard"
    )
    with identity_app.app_context():
        account = User.get_by_github_id(1003)
        assert account is not None and account.username not in {"sam", "sam-1003"}
        assert not account.is_root


def test_indexed_concurrent_login_rereads_existing_provider(
    identity_app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    with identity_app.app_context():
        mongo.db.users.create_index("github_id", unique=True)
        mongo.db.users.create_index("username", unique=True)
        collection = mongo.db.users
        insert = collection.insert_one
        raced = False

        def racing_insert(document: dict[str, Any]) -> Any:
            nonlocal raced
            if not raced:
                raced = True
                inserted = dict(document)
                insert(inserted)
            return insert(document)

        monkeypatch.setattr(collection, "insert_one", racing_insert)
        account = User.find_or_create_from_github(1002, "alex")
        assert account.github_id == 1002
        assert collection.count_documents({"github_id": 1002}) == 1


def test_oauth_token_is_not_persisted(identity_app: Flask) -> None:
    with identity_app.app_context():
        account = User.find_or_create_from_github(
            1002, "alex", access_token="example-oauth-token"
        )
        document = mongo.db.users.find_one({"github_id": account.github_id})
        assert document is not None and "access_token" not in document
        mongo.db.users.update_one(
            {"github_id": account.github_id},
            {"$set": {"access_token": "example-legacy-token"}},
        )
        User.find_or_create_from_github(1002, "alex")
        document = mongo.db.users.find_one({"github_id": account.github_id})
        assert document is not None and "access_token" not in document


@pytest.mark.parametrize(
    "field,value",
    [
        ("SECRET_KEY", None),
        ("SECRET_KEY", "short"),
        ("SECRET_KEY", "dev-secret-key-change-in-production"),
        ("ROOT_GITHUB_ID", None),
        ("ROOT_GITHUB_ID", True),
        ("GITHUB_CLIENT_SECRET", None),
    ],
)
def test_production_fails_without_required_security_settings(
    field: str, value: object
) -> None:
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY="example-session-key-32-characters-long",
        ROOT_GITHUB_ID=1001,
        GITHUB_CLIENT_ID="example-client",
        GITHUB_CLIENT_SECRET="example-oauth-secret",
    )
    app.config[field] = value
    with pytest.raises(ValueError):
        validate_runtime_config(app)


def test_testing_does_not_require_production_credentials(identity_app: Flask) -> None:
    validate_runtime_config(identity_app)
