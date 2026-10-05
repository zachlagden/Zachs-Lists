import socket
from unittest.mock import Mock

import pytest
import requests

from app.utils import safe_http
from app.utils import validators


@pytest.mark.parametrize(
    "value",
    [
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://example.com@127.0.0.1/",
        "http://169.254.169.254/",
        "http://mongo:27017/",
        "http://2130706433/",
        "https://example.local/",
        "ftp://example.com/file",
        "https://user:secret@example.com/",
        "https://example.com/#fragment",
        "http://[::ffff:127.0.0.1]/",
        "http://example.com:0/",
    ],
)
def test_unsafe_urls_are_rejected(value: str) -> None:
    assert not validators.validate_url(value)


@pytest.mark.parametrize(
    "value",
    [
        "10.0.0.1",
        "100.64.0.1",
        "198.18.0.1",
        "127.0.0.1",
        "::ffff:127.0.0.1",
        "64:ff9b::7f00:1",
        "2002:7f00:1::",
        "2001:db8::1",
        "fc00::1",
        "ff02::1",
    ],
)
def test_nonpublic_address_space_is_rejected(value: str) -> None:
    assert not safe_http.is_public_address(value)


def test_mixed_dns_result_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        safe_http.socket,
        "getaddrinfo",
        Mock(
            return_value=[
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 80)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80)),
            ]
        ),
    )
    with pytest.raises(safe_http.UnsafeSource):
        safe_http.resolve_source("http://example.com/hosts.txt")


def test_pool_pins_address_and_preserves_tls_hostname(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dns = Mock(
        return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
    )
    monkeypatch.setattr(safe_http.socket, "getaddrinfo", dns)
    adapter = safe_http.SafeSourceAdapter()
    request = requests.Request("GET", "https://example.com/hosts.txt").prepare()
    pool = Mock()
    monkeypatch.setattr(adapter.poolmanager, "connection_from_host", pool)
    adapter.get_connection_with_tls_context(request, True)
    options = pool.call_args.kwargs
    assert options["host"] == "8.8.8.8"
    assert options["pool_kwargs"]["server_hostname"] == "example.com"
    assert options["pool_kwargs"]["assert_hostname"] == "example.com"
    adapter.add_headers(request)
    assert request.headers["Host"] == "example.com"
    assert dns.call_count == 1


def test_redirect_to_internal_host_is_rejected_before_second_request() -> None:
    response = Mock(status_code=302, headers={"Location": "http://127.0.0.1/private"})
    session = Mock(spec=requests.Session)
    session.cookies = Mock()
    session.request.return_value = response
    with pytest.raises(safe_http.UnsafeSource):
        safe_http.source_response(session, "GET", "https://example.com/hosts.txt")
    assert session.request.call_count == 1
    response.close.assert_called_once()


def test_head_falls_back_without_reading_body(monkeypatch: pytest.MonkeyPatch) -> None:
    head = Mock(status_code=405, headers={})
    get = Mock(status_code=200, headers={"Content-Type": "text/plain"})
    head.__enter__ = Mock(return_value=head)
    head.__exit__ = Mock(return_value=False)
    get.__enter__ = Mock(return_value=get)
    get.__exit__ = Mock(return_value=False)
    session = Mock()
    session.__enter__ = Mock(return_value=session)
    session.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(safe_http, "source_session", Mock(return_value=session))
    fetch = Mock(side_effect=[head, get])
    monkeypatch.setattr(safe_http, "source_response", fetch)
    assert safe_http.source_headers("https://example.com/hosts.txt")[0] == 200
    assert fetch.call_args_list[1].args[1] == "GET"


@pytest.mark.parametrize(
    "config",
    [
        "http://127.0.0.1/source",
        "https://example.com/list|Name|advertising|extra",
        "https://example.com/list||advertising",
        "not-a-source",
    ],
)
def test_every_config_line_is_validated(
    config: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    fetch = Mock()
    monkeypatch.setattr(validators, "source_headers", fetch)
    result = validators.validate_config_urls(config, 40)
    assert result.has_errors
    fetch.assert_not_called()


def test_optional_fields_are_validated_and_source_limit_precedes_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = "https://example.com/one\nhttps://example.com/two|Second\nhttps://example.com/three|Third|tracking"
    fetch = Mock(return_value=(200, {"Content-Type": "text/plain"}))
    monkeypatch.setattr(validators, "source_headers", fetch)
    assert validators.validate_config_urls(config, 2).has_errors
    fetch.assert_not_called()
    result = validators.validate_config_urls(config, 3)
    assert not result.has_errors
    assert result.validated_count == 3
    assert fetch.call_count == 3
