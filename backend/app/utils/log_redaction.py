import logging
import os
import re
from typing import Any

URL_PATTERN = re.compile(
    r"\b(?:https?|mongodb(?:\+srv)?):\/\/[^\s\"'<>]+", re.IGNORECASE
)
QUERY_PATTERN = re.compile(
    r"(\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+[^\s\"?]+)\?[^\s\"]+"
)


def redact(value: str) -> str:
    result = URL_PATTERN.sub("[url redacted]", value)
    result = QUERY_PATTERN.sub(r"\1", result)
    for name, secret in os.environ.items():
        if len(secret) >= 8 and (
            name.endswith(("SECRET", "TOKEN", "PASSWORD", "KEY")) or name == "MONGO_URI"
        ):
            result = result.replace(secret, "[secret redacted]")
    return result


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage())
        record.args = ()
        if record.exc_text:
            record.exc_text = redact(record.exc_text)
        return True


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))

    def formatException(self, ei: Any) -> str:
        return redact(super().formatException(ei))


def install_redaction() -> None:
    for name in (
        "",
        "app",
        "gunicorn.error",
        "gunicorn.access",
        "geventwebsocket.handler",
    ):
        logger = logging.getLogger(name)
        logger.addFilter(RedactingFilter())
        for handler in logger.handlers:
            handler.addFilter(RedactingFilter())
            pattern = handler.formatter._fmt if handler.formatter else "%(message)s"
            handler.setFormatter(RedactingFormatter(pattern))
