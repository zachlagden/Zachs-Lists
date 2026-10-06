from pathlib import Path

import mongomock
import pytest
from flask import Flask

from app.config import TestingConfig
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
