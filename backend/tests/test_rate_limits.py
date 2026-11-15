import runpy
from pathlib import Path
from typing import Any

import pytest
from flask import Flask, session
from flask_limiter import Limiter
from limits import parse

from app.config import Config, TestingConfig
from app import extensions
from app.extensions import limiter
from app.models.user import User
from app.utils.rate_limits import rate_limit_key, register_rate_limit_responses
from conftest import Api

CONFIG_FILE = Path(extensions.__file__).with_name("config.py")
ROUTE_LIMITS = [
    ("GET", "/api/auth/me", "RATELIMIT_AUTH_ME"),
    ("GET", "/api/auth/session", "RATELIMIT_AUTH_ME"),
    ("GET", "/api/user/jobs", "RATELIMIT_JOBS"),
    ("GET", "/api/user/jobs/example", "RATELIMIT_JOBS"),
    ("POST", "/api/user/jobs/mark-read", "RATELIMIT_JOBS"),
    ("POST", "/api/user/config/url-metadata", "RATELIMIT_URL_METADATA"),
    ("GET", "/api/admin/jobs", "RATELIMIT_JOBS"),
    ("GET", "/api/admin/jobs/example", "RATELIMIT_JOBS"),
    ("GET", "/api/admin/users/example/jobs", "RATELIMIT_JOBS"),
    ("GET", "/api/admin/stats", "RATELIMIT_ADMIN_STATS"),
]


def loaded_config(monkeypatch: pytest.MonkeyPatch, **environment: str) -> Any:
    for name in ("RATELIMIT_STORAGE_URL", "REDIS_URL", "RATELIMIT_DEFAULT"):
        monkeypatch.delenv(name, raising=False)
    for name, value in environment.items():
        monkeypatch.setenv(name, value)
    return runpy.run_path(str(CONFIG_FILE))["Config"]


def test_limiter_storage_and_default_come_from_the_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plain = loaded_config(monkeypatch)
    assert plain.RATELIMIT_STORAGE_URI == "memory://"
    assert plain.RATELIMIT_DEFAULT == "100 per hour"

    redis = loaded_config(monkeypatch, REDIS_URL="redis://cache.example.test:6379/0")
    assert redis.RATELIMIT_STORAGE_URI == "redis://cache.example.test:6379/0"

    explicit = loaded_config(
        monkeypatch,
        REDIS_URL="redis://cache.example.test:6379/0",
        RATELIMIT_STORAGE_URL="redis://limits.example.test:6379/1",
        RATELIMIT_DEFAULT="250 per hour",
    )
    assert explicit.RATELIMIT_STORAGE_URI == "redis://limits.example.test:6379/1"
    assert explicit.RATELIMIT_DEFAULT == "250 per hour"


def test_shared_limiter_has_no_hard_coded_storage_or_default() -> None:
    assert limiter._storage_uri is None
    assert limiter._key_func is rate_limit_key
    assert not hasattr(Config, "RATELIMIT_STORAGE_URL")


def test_a_limiter_built_like_the_shared_one_reads_its_default_from_config() -> None:
    application = Flask(__name__)
    application.config.from_object(TestingConfig)
    application.config.update(
        SECRET_KEY="example-session-key",
        RATELIMIT_DEFAULT="2 per hour",
        RATELIMIT_STORAGE_URI="memory://",
    )
    configured = Limiter(key_func=rate_limit_key)
    configured.init_app(application)
    register_rate_limit_responses(application, configured)

    @application.get("/api/example")
    def example() -> dict[str, str]:
        return {"status": "ok"}

    client = application.test_client()
    assert client.get("/api/example").status_code == 200
    assert client.get("/api/example").status_code == 200
    limited = client.get("/api/example")

    assert limited.status_code == 429
    assert limited.is_json
    body = limited.get_json()
    assert body["code"] == "rate_limited"
    assert body["error"]
    retry_after = int(limited.headers["Retry-After"])
    assert 1 <= retry_after <= 3600
    assert body["retry_after"] == retry_after


@pytest.mark.parametrize("config_key", sorted({key for _, _, key in ROUTE_LIMITS}))
def test_route_limits_are_more_generous_than_the_default(config_key: str) -> None:
    def per_hour(text: str) -> float:
        limit = parse(text)
        return limit.amount * 3600 / limit.get_expiry()

    assert per_hour(getattr(Config, config_key)) > per_hour("100 per hour") * 10


@pytest.mark.parametrize(("method", "path", "config_key"), ROUTE_LIMITS)
def test_busy_routes_have_their_own_limit(
    api: Api, method: str, path: str, config_key: str
) -> None:
    api.app.config[config_key] = "2 per hour"
    client = api.client(api.account(6001, "robin", is_admin=True))

    statuses = [client.open(path, method=method, json={}).status_code for _ in range(3)]

    assert statuses[2] == 429
    assert 429 not in statuses[:2]
    assert client.get("/api/user/lists").status_code == 200


def test_other_routes_keep_the_default_limit(api: Api) -> None:
    client = api.client(api.account(6002, "sam"))
    statuses = {client.get("/api/user/lists").status_code for _ in range(100)}
    assert statuses == {200}
    limited = client.get("/api/user/lists")
    assert limited.status_code == 429
    assert limited.get_json()["code"] == "rate_limited"
    assert int(limited.headers["Retry-After"]) >= 1


def test_signed_in_api_requests_are_limited_per_user_not_per_address(api: Api) -> None:
    api.app.config["RATELIMIT_AUTH_ME"] = "3 per hour"
    sam = api.client(api.account(6003, "sam"))
    alex = api.client(api.account(6004, "alex"))
    home = {"REMOTE_ADDR": "198.51.100.10"}
    office = {"REMOTE_ADDR": "203.0.113.20"}

    def me(client: Any, address: dict[str, str]) -> int:
        return client.get("/api/auth/me", environ_overrides=address).status_code

    assert [me(sam, home) for _ in range(3)] == [200, 200, 200]
    assert me(sam, home) == 429
    assert me(sam, office) == 429
    assert me(alex, home) == 200


def test_anonymous_api_requests_are_limited_per_address(api: Api) -> None:
    api.app.config["RATELIMIT_AUTH_ME"] = "3 per hour"
    home = {"REMOTE_ADDR": "198.51.100.10"}
    office = {"REMOTE_ADDR": "203.0.113.20"}

    def me(address: dict[str, str]) -> int:
        return api.client().get("/api/auth/me", environ_overrides=address).status_code

    assert [me(home) for _ in range(3)] == [401, 401, 401]
    assert me(home) == 429
    assert me(office) == 401


def test_rate_limit_key_ignores_the_session_outside_the_api(api: Api) -> None:
    account: User = api.account(6005, "sam")
    address = {"REMOTE_ADDR": "198.51.100.10"}
    with api.app.test_request_context("/api/user/lists", environ_base=address):
        assert rate_limit_key() == "ip:198.51.100.10"
        session["user_id"] = account.id
        assert rate_limit_key() == f"user:{account.id}"
    with api.app.test_request_context("/u/sam/all_domains.txt", environ_base=address):
        session["user_id"] = account.id
        assert rate_limit_key() == "ip:198.51.100.10"
