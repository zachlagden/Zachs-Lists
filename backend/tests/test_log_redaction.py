import logging

import pytest

from app.utils.log_redaction import RedactingFilter, RedactingFormatter, redact


def test_log_messages_remove_credentials_and_callback_queries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = "example-session-secret-marker"
    monkeypatch.setenv("SECRET_KEY", marker)
    message = f"GET /api/auth/callback?code=example-code&state=example-state HTTP/1.1 {marker} mongodb://sam:example-password@db/default"
    result = redact(message)
    assert marker not in result
    assert "example-code" not in result
    assert "example-password" not in result
    assert "/api/auth/callback HTTP/1.1" in result


def test_record_and_exception_text_are_redacted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    marker = "example-session-secret-marker"
    monkeypatch.setenv("SECRET_KEY", marker)
    try:
        raise ValueError(marker)
    except ValueError:
        import sys

        record = logging.LogRecord(
            "example", logging.ERROR, "example.py", 1, "%s", (marker,), sys.exc_info()
        )
    assert RedactingFilter().filter(record)
    assert marker not in record.getMessage()
    assert marker not in RedactingFormatter().format(record)
