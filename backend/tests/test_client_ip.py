import socket
from unittest.mock import Mock

import pytest
from flask import Flask

from app.utils import client_ip


@pytest.mark.parametrize(
    ("peer", "headers", "expected"),
    [
        ("198.51.100.10", {}, "198.51.100.10"),
        (
            "198.51.100.10",
            {"CF-Connecting-IP": "203.0.113.20", "X-Forwarded-For": "173.245.48.5"},
            "198.51.100.10",
        ),
        (
            "10.0.0.3",
            {"CF-Connecting-IP": "203.0.113.20", "X-Forwarded-For": "173.245.48.5"},
            "10.0.0.3",
        ),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "173.245.48.5"},
            "198.51.100.10",
        ),
        (
            "10.0.0.2",
            {
                "CF-Connecting-IP": "198.51.100.10",
                "X-Forwarded-For": "203.0.113.20, 198.51.100.10, 173.245.48.5",
            },
            "198.51.100.10",
        ),
        (
            "10.0.0.2",
            {
                "CF-Connecting-IP": "203.0.113.20",
                "X-Forwarded-For": "173.245.48.5, 198.51.100.10",
                "X-Real-IP": "203.0.113.20",
            },
            "198.51.100.10",
        ),
        (
            "10.0.0.2",
            {"X-Forwarded-For": "198.51.100.10"},
            "198.51.100.10",
        ),
        ("10.0.0.2", {}, "10.0.0.2"),
        ("10.0.0.2", {"CF-Connecting-IP": "198.51.100.10"}, "10.0.0.2"),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "not-an-ip"},
            "10.0.0.2",
        ),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "173.245.48.5,"},
            "10.0.0.2",
        ),
        ("10.0.0.2", {"X-Forwarded-For": "173.245.48.5"}, "173.245.48.5"),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "invalid", "X-Forwarded-For": "173.245.48.5"},
            "173.245.48.5",
        ),
        (
            "10.0.0.2",
            {
                "CF-Connecting-IP": "198.51.100.10, 203.0.113.20",
                "X-Forwarded-For": "173.245.48.5",
            },
            "173.245.48.5",
        ),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "2001:db8::1", "X-Forwarded-For": "2606:4700::1"},
            "2001:db8::1",
        ),
        (
            "10.0.0.2",
            {
                "CF-Connecting-IP": " ::ffff:198.51.100.10 ",
                "X-Forwarded-For": " ::ffff:173.245.48.5 ",
            },
            "198.51.100.10",
        ),
        (
            "::ffff:10.0.0.2",
            {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "173.245.48.5"},
            "198.51.100.10",
        ),
        (
            "10.0.0.2",
            {"CF-Connecting-IP": "2001:db8::1%eth0", "X-Forwarded-For": "173.245.48.5"},
            "173.245.48.5",
        ),
        ("2001:0db8:0:0:0:0:0:1", {}, "2001:db8::1"),
        ("invalid", {"CF-Connecting-IP": "198.51.100.10"}, "unknown"),
        (None, {"CF-Connecting-IP": "198.51.100.10"}, "unknown"),
    ],
)
def test_client_ip(
    app: Flask, peer: str | None, headers: dict[str, str], expected: str
) -> None:
    with app.test_request_context(headers=headers, environ_base={"REMOTE_ADDR": peer}):
        assert client_ip.get_client_ip() == expected


def test_forwarded_headers_require_configured_proxy(app: Flask) -> None:
    app.config["TRUSTED_PROXY_HOSTS"] = ()
    with app.test_request_context(
        headers={
            "CF-Connecting-IP": "198.51.100.10",
            "X-Forwarded-For": "173.245.48.5",
        },
        environ_base={"REMOTE_ADDR": "10.0.0.2"},
    ):
        assert client_ip.get_client_ip() == "10.0.0.2"


def test_proxy_dns_failure_ignores_headers(
    app: Flask, proxy_dns: Mock, caplog: pytest.LogCaptureFixture
) -> None:
    proxy_dns.side_effect = socket.gaierror("DNS unavailable")
    with app.test_request_context(
        headers={
            "CF-Connecting-IP": "198.51.100.10",
            "X-Forwarded-For": "173.245.48.5",
        },
        environ_base={"REMOTE_ADDR": "10.0.0.2"},
    ):
        assert client_ip.get_client_ip() == "10.0.0.2"
        assert client_ip.get_client_ip() == "10.0.0.2"
    assert proxy_dns.call_count == 1
    assert "Could not resolve trusted proxy proxy.example.test" in caplog.text


def test_proxy_dns_refreshes_after_address_change(
    app: Flask, proxy_dns: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(client_ip.time, "monotonic", Mock(return_value=59))
    headers = {"CF-Connecting-IP": "198.51.100.10", "X-Forwarded-For": "173.245.48.5"}
    with app.test_request_context(
        headers=headers, environ_base={"REMOTE_ADDR": "10.0.0.2"}
    ):
        assert client_ip.get_client_ip() == "198.51.100.10"
        assert client_ip.get_client_ip() == "198.51.100.10"
    assert proxy_dns.call_count == 1

    proxy_dns.return_value = [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.4", 0))
    ]
    monkeypatch.setattr(client_ip.time, "monotonic", Mock(return_value=60))
    with app.test_request_context(
        headers=headers, environ_base={"REMOTE_ADDR": "10.0.0.4"}
    ):
        assert client_ip.get_client_ip() == "198.51.100.10"
    with app.test_request_context(
        headers=headers, environ_base={"REMOTE_ADDR": "10.0.0.2"}
    ):
        assert client_ip.get_client_ip() == "10.0.0.2"
    assert proxy_dns.call_count == 2
