import socket
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import mongomock
import pytest
from flask import Flask
from flask.testing import FlaskClient

from app.blueprints import lists
from app.blueprints.admin import admin_bp
from app.blueprints.auth import auth_bp
from app.blueprints.user import user_bp
from app.config import TestingConfig
from app.db_indexes import ensure_indexes
from app.extensions import limiter, mongo
from app.models.analytics import Analytics
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services import download_recorder, published_lists, site_stats
from app.socketio import init_socketio
from app.utils import client_ip, validators
from app.utils.api_input import register_input_checks
from app.utils.rate_limits import register_rate_limit_responses


@pytest.fixture
def proxy_dns(monkeypatch: pytest.MonkeyPatch) -> Iterator[Mock]:
    client_ip._proxy_addresses.cache_clear()
    lookup = Mock(
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.2", 0))]
    )
    monkeypatch.setattr(client_ip.socket, "getaddrinfo", lookup)
    yield lookup
    client_ip._proxy_addresses.cache_clear()


@pytest.fixture
def app(
    proxy_dns: Mock, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[Flask]:
    application = Flask(__name__)
    application.config.from_object(TestingConfig)
    application.config.update(
        SECRET_KEY="test-session-key",
        TRUSTED_PROXY_HOSTS=("proxy.example.test",),
        DEFAULT_DIR=str(tmp_path),
    )
    limiter.init_app(application)
    application.register_blueprint(lists.lists_public_bp)
    application.register_blueprint(auth_bp, url_prefix="/api/auth")

    @application.get("/api/example")
    def example_api() -> dict[str, str]:
        return {"status": "ok"}

    output = tmp_path / "output"
    output.mkdir()
    (output / "all_domains_hosts.txt").write_text("example.com\n")
    monkeypatch.setattr(
        SystemConfig,
        "get_default_publication",
        Mock(
            return_value={
                "generation_id": None,
                "published_at": None,
                "total_domains": None,
            }
        ),
    )
    monkeypatch.setattr(Analytics, "record_download", Mock())
    published_lists.clear_caches()
    download_recorder.failures.reset()
    download_recorder.database_pause.reset()
    site_stats.clear_caches()
    with application.app_context():
        limiter.reset()
    yield application
    with application.app_context():
        limiter.reset()


@pytest.fixture
def user(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Mock:
    account = Mock(spec=User)
    account.id = "000000000000000000000001"
    account.username = "sam"
    account.is_enabled = True
    account.auth_version = 0
    account.is_banned = False
    account.to_dict.return_value = {"id": account.id, "username": account.username}
    account.get_list.return_value = {"domain_count": 1}
    account.published_generation = None
    account.get_output_dir.return_value = str(tmp_path / "output")
    monkeypatch.setattr(User, "get_by_id", Mock(return_value=account))
    monkeypatch.setattr(User, "get_by_username", Mock(return_value=account))
    return account


VALID_SOURCES = "https://example.com/hosts.txt|Example|tracking"
ROOT_GITHUB_ID = 9000


@dataclass
class Api:
    app: Flask
    db: Any
    whitelist_check: Mock

    def account(self, github_id: int, name: str, **fields: Any) -> User:
        created = User.find_or_create_from_github(github_id, name)
        if fields:
            self.db.users.update_one({"username": name}, {"$set": fields})
        return self.reload(created)

    def reload(self, account: User) -> User:
        stored = User.get_by_id(account.id)
        assert stored is not None
        return stored

    def client(self, account: User | None = None) -> FlaskClient:
        client = self.app.test_client()
        if account is not None:
            with client.session_transaction() as session:
                session["user_id"] = account.id
                session["auth_version"] = account.auth_version
        return client


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Api]:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    application = Flask(__name__)
    application.config.from_object(TestingConfig)
    application.config.update(
        SECRET_KEY="example-session-key",
        ROOT_GITHUB_ID=ROOT_GITHUB_ID,
        DATA_DIR=str(tmp_path),
        USERS_DIR=str(tmp_path / "users"),
        DEFAULT_DIR=str(tmp_path / "default"),
    )
    whitelist_check = Mock(
        return_value={"valid": True, "errors": [], "error_counts": {}}
    )
    monkeypatch.setattr(validators, "run_whitelist_validator", whitelist_check)
    register_input_checks(application)
    init_socketio(application)
    limiter.init_app(application)
    register_rate_limit_responses(application, limiter)
    application.register_blueprint(auth_bp, url_prefix="/api/auth")
    application.register_blueprint(user_bp, url_prefix="/api/user")
    application.register_blueprint(admin_bp, url_prefix="/api/admin")
    application.register_blueprint(lists.lists_public_bp)
    application.register_blueprint(lists.lists_api_bp, url_prefix="/api")
    with application.app_context():
        limiter.reset()
        ensure_indexes(db)
        yield Api(application, db, whitelist_check)
        limiter.reset()
