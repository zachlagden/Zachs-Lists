import socket
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import Mock

import pytest
from flask import Flask, Response

from app.blueprints import lists
from app.blueprints.auth import auth_bp
from app.config import TestingConfig
from app.extensions import limiter
from app.models.analytics import Analytics
from app.models.user import User
from app.utils import client_ip


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

    monkeypatch.setattr(lists, "list_file_exists", Mock(return_value=True))
    monkeypatch.setattr(lists, "get_list_file_size", Mock(return_value=12))
    monkeypatch.setattr(
        lists, "serve_list_file", Mock(side_effect=lambda _: Response("example.com\n"))
    )
    monkeypatch.setattr(Analytics, "record_request", Mock())
    monkeypatch.setattr(lists, "get_geo_data", Mock(return_value=(None, None)))
    with application.app_context():
        limiter.reset()
    yield application
    with application.app_context():
        limiter.reset()


@pytest.fixture
def user(monkeypatch: pytest.MonkeyPatch) -> Mock:
    account = Mock(spec=User)
    account.id = "000000000000000000000001"
    account.username = "sam"
    account.is_enabled = True
    account.is_banned = False
    account.to_dict.return_value = {"id": account.id, "username": account.username}
    account.get_list.return_value = {"domain_count": 1}
    account.get_output_path.return_value = "/example/all_domains_hosts.txt"
    monkeypatch.setattr(User, "get_by_id", Mock(return_value=account))
    monkeypatch.setattr(User, "get_by_username", Mock(return_value=account))
    return account
