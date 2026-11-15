from unittest.mock import Mock

import pytest
from flask import Flask

from app.extensions import limiter
from app.models.analytics import Analytics
from app.services import download_recorder
from app.utils.client_ip import get_client_ip
from app.utils.rate_limits import rate_limit_key


@pytest.mark.parametrize(
    "path",
    ["/lists/all_domains.txt", "/u/sam/all_domains.txt", "/api/example"],
)
def test_global_limits_are_independent_per_visitor(
    app: Flask, user: Mock, path: str
) -> None:
    client = app.test_client()
    headers = {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "173.245.48.5"}
    peer = {"REMOTE_ADDR": "10.0.0.2"}

    for _ in range(100):
        assert (
            client.get(path, headers=headers, environ_overrides=peer).status_code == 200
        )
    assert client.get(path, headers=headers, environ_overrides=peer).status_code == 429

    headers["CF-Connecting-IP"] = "203.0.113.20"
    assert client.get(path, headers=headers, environ_overrides=peer).status_code == 200
    assert limiter._key_func is rate_limit_key


def test_changing_spoofed_headers_does_not_reset_the_limit(app: Flask) -> None:
    client = app.test_client()
    peer = {"REMOTE_ADDR": "10.0.0.2"}
    headers = {"CF-Connecting-IP": "203.0.113.20", "X-Forwarded-For": "198.51.100.10"}

    for _ in range(100):
        assert (
            client.get(
                "/api/example", headers=headers, environ_overrides=peer
            ).status_code
            == 200
        )
    headers["CF-Connecting-IP"] = "203.0.113.21"
    headers["X-Forwarded-For"] = "173.245.48.5, 198.51.100.10"
    assert (
        client.get("/api/example", headers=headers, environ_overrides=peer).status_code
        == 429
    )


@pytest.mark.parametrize(
    ("upstream", "expected"),
    [("173.245.48.5", "198.51.100.10"), ("203.0.113.20", "203.0.113.20")],
)
def test_user_ip_log_uses_the_trusted_resolver(
    app: Flask, user: Mock, upstream: str, expected: str
) -> None:
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user.id
    response = client.get(
        "/api/auth/me",
        headers={"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": upstream},
        environ_overrides={"REMOTE_ADDR": "10.0.0.2"},
    )
    assert response.status_code == 200
    user.log_ip_access.assert_called_once_with(expected)


@pytest.mark.parametrize(
    ("upstream", "expected"),
    [("173.245.48.5", "198.51.100.10"), ("203.0.113.20", "203.0.113.20")],
)
def test_download_analytics_uses_the_same_resolver(
    app: Flask, monkeypatch: pytest.MonkeyPatch, upstream: str, expected: str
) -> None:
    record = Mock()
    lookup = Mock(return_value=(None, None))
    monkeypatch.setattr(Analytics, "record_download", record)
    monkeypatch.setattr(download_recorder.geoip, "locate", lookup)
    with app.test_request_context(
        headers={"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": upstream},
        environ_base={"REMOTE_ADDR": "10.0.0.2"},
    ):
        download_recorder.record_download("default", "all_domains", "", "hosts", 12)
        expected_hash = download_recorder.visitor_hash(expected)
    assert download_recorder.get_client_ip is get_client_ip
    assert record.call_args.kwargs["visitor_hash"] == expected_hash
    assert expected not in str(record.call_args)
    lookup.assert_called_once_with("", expected)
