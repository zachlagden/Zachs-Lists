import json
import logging
import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import requests
from flask import current_app
from gevent.pool import Pool

from app.utils.safe_http import UnsafeSource, parse_source_url, source_headers

MAX_SOURCE_SIZE_BYTES = 100 * 1024 * 1024
MAX_CONFIG_SOURCES = 1000
VALID_CATEGORIES = frozenset(
    {"comprehensive", "malicious", "advertising", "tracking", "suspicious", "nsfw"}
)
ABP_FLAG = "abp"
WHITELIST_VALIDATOR_SUBCOMMAND = "validate-whitelist"
WHITELIST_VALIDATOR_TIMEOUT_SECONDS = 5


logger = logging.getLogger(__name__)


class ValidationSeverity(Enum):
    ERROR = "error"
    WARNING = "warning"


@dataclass
class ValidationIssue:
    severity: ValidationSeverity
    message: str
    line: int | None = None
    url: str | None = None


@dataclass
class ValidationResult:
    issues: list[ValidationIssue] = field(default_factory=list)
    validated_count: int = 0

    @property
    def errors(self) -> list[ValidationIssue]:
        return [
            issue for issue in self.issues if issue.severity == ValidationSeverity.ERROR
        ]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [
            issue
            for issue in self.issues
            if issue.severity == ValidationSeverity.WARNING
        ]

    @property
    def has_errors(self) -> bool:
        return bool(self.errors)

    @property
    def has_warnings(self) -> bool:
        return bool(self.warnings)

    def to_dict(self) -> dict[str, Any]:
        def detail(issue: ValidationIssue) -> dict[str, Any]:
            return {"message": issue.message, "line": issue.line, "url": issue.url}

        return {
            "issues": [
                {"severity": issue.severity.value, **detail(issue)}
                for issue in self.issues
            ],
            "errors": [detail(issue) for issue in self.errors],
            "warnings": [detail(issue) for issue in self.warnings],
            "validated_count": self.validated_count,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "has_errors": self.has_errors,
            "has_warnings": self.has_warnings,
        }


@dataclass
class ParsedConfigLine:
    line_num: int
    url: str
    name: str
    category: str
    raw: str
    error: str | None = None
    abp: bool = False


def normalize_domain(domain: str) -> str:
    return domain.lower().rstrip(".")


def validate_url(url: str) -> bool:
    try:
        parse_source_url(url)
    except UnsafeSource:
        return False
    return True


def parse_config_lines(config: str) -> list[ParsedConfigLine]:
    lines = []
    for number, raw in enumerate(config.splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = [part.strip() for part in stripped.split("|")]
        url = parts[0]
        try:
            hostname = urlparse(url).hostname or "source"
        except ValueError:
            hostname = "source"
        name = parts[1] if len(parts) > 1 else re.sub(r"[^A-Za-z0-9_-]", "_", hostname)
        category = parts[2] if len(parts) > 2 else ""
        abp = len(parts) == 4 and parts[3] == ABP_FLAG
        error = None
        if len(parts) > 4 or any(not part for part in parts):
            error = (
                "Expected URL, URL|name, URL|name|category or URL|name|category|abp "
                "with nonempty fields"
            )
        elif len(parts) == 4 and not abp:
            error = "The fourth field can only be abp"
        lines.append(ParsedConfigLine(number, url, name, category, raw, error, abp))
    return lines


def validate_config_syntax(config: str, max_sources: int) -> ValidationResult:
    result = ValidationResult()
    lines = parse_config_lines(config)
    limit = min(max_sources, MAX_CONFIG_SOURCES)
    if len(lines) > limit:
        result.issues.append(
            ValidationIssue(
                ValidationSeverity.ERROR,
                f"Too many sources ({len(lines)}). Maximum allowed: {limit}",
            )
        )
    names = set()
    for line in lines:
        error = line.error
        if error is None and not validate_url(line.url):
            error = "Invalid or unsafe source URL"
        if error is None and (
            len(line.name) > 100 or not re.fullmatch(r"[A-Za-z0-9_-]+", line.name)
        ):
            error = "Source name must use 1-100 ASCII letters, numbers, dashes or underscores"
        explicit_name = "|" in line.raw
        if error is None and explicit_name and line.name.lower() in names:
            error = "Duplicate source name"
        if error is None and line.category and line.category not in VALID_CATEGORIES:
            error = "Invalid source category"
        if explicit_name:
            names.add(line.name.lower())
        if error:
            result.issues.append(
                ValidationIssue(ValidationSeverity.ERROR, error, line.line_num)
            )
    return result


def validate_blocklist_config(config: str, max_sources: int) -> list[str]:
    return [
        f"Line {issue.line}: {issue.message}" if issue.line else issue.message
        for issue in validate_config_syntax(config, max_sources).errors
    ]


def validate_config_urls(
    config: str,
    max_sources: int,
    emit_progress: Callable[[dict[str, Any]], Any] | None = None,
) -> ValidationResult:
    result = validate_config_syntax(config, max_sources)
    if result.has_errors:
        return result
    lines = parse_config_lines(config)
    completed = 0

    def check(line: ParsedConfigLine) -> ValidationIssue | None:
        nonlocal completed
        try:
            status, headers = source_headers(line.url)
            headers = {key.lower(): value for key, value in headers.items()}
            if status >= 400:
                return ValidationIssue(
                    ValidationSeverity.ERROR,
                    f"Source returned HTTP {status}",
                    line.line_num,
                )
            size = headers.get("content-length", "")
            if size.isdigit() and int(size) > MAX_SOURCE_SIZE_BYTES:
                return ValidationIssue(
                    ValidationSeverity.ERROR,
                    "Source exceeds the 100 MB size limit",
                    line.line_num,
                )
            content_type = headers.get("content-type", "").lower()
            if (
                content_type
                and "text" not in content_type
                and "octet-stream" not in content_type
            ):
                return ValidationIssue(
                    ValidationSeverity.WARNING,
                    "Unexpected source content type",
                    line.line_num,
                )
            return None
        except UnsafeSource:
            return ValidationIssue(
                ValidationSeverity.ERROR,
                "Source URL or redirect is unsafe",
                line.line_num,
            )
        except requests.exceptions.Timeout:
            return ValidationIssue(
                ValidationSeverity.WARNING, "Source validation timed out", line.line_num
            )
        except requests.exceptions.RequestException:
            return ValidationIssue(
                ValidationSeverity.WARNING,
                "Could not reach source during validation",
                line.line_num,
            )
        finally:
            completed += 1
            if emit_progress:
                emit_progress(
                    {
                        "current": completed,
                        "total": len(lines),
                        "url": "",
                        "status": "validating",
                    }
                )

    result.issues.extend(
        issue for issue in Pool(10).map(check, lines) if issue is not None
    )
    result.validated_count = len(lines)
    if emit_progress:
        emit_progress(
            {
                "current": len(lines),
                "total": len(lines),
                "url": "",
                "status": "complete",
            }
        )
    return result


class WhitelistValidationUnavailable(Exception):
    pass


def _whitelist_report(completed: subprocess.CompletedProcess[bytes]) -> dict[str, Any]:
    if completed.returncode not in (0, 1):
        raise WhitelistValidationUnavailable(
            f"validator exited with code {completed.returncode}"
        )
    try:
        report = json.loads(completed.stdout)
    except ValueError as error:
        raise WhitelistValidationUnavailable("validator output is not JSON") from error
    if not isinstance(report, dict) or not isinstance(report.get("valid"), bool):
        raise WhitelistValidationUnavailable("validator output has no verdict")
    errors = report.get("errors")
    error_counts = report.get("error_counts")
    well_formed = (
        isinstance(errors, list)
        and isinstance(error_counts, dict)
        and all(
            isinstance(count, int) and not isinstance(count, bool)
            for count in error_counts.values()
        )
        and all(
            isinstance(error, dict)
            and isinstance(error.get("message"), str)
            and isinstance(error.get("code"), str)
            and (error.get("line") is None or type(error.get("line")) is int)
            for error in errors
        )
    )
    if not well_formed:
        raise WhitelistValidationUnavailable("validator output has malformed errors")
    valid = report["valid"]
    if valid != (completed.returncode == 0) or valid == bool(errors):
        raise WhitelistValidationUnavailable("validator verdict contradicts itself")
    return report


def run_whitelist_validator(whitelist: bytes, worker_bin: str) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [worker_bin, WHITELIST_VALIDATOR_SUBCOMMAND],
            input=whitelist,
            capture_output=True,
            timeout=WHITELIST_VALIDATOR_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as error:
        raise WhitelistValidationUnavailable("validator timed out") from error
    except OSError as error:
        raise WhitelistValidationUnavailable("validator could not be run") from error
    return _whitelist_report(completed)


def whitelist_error_messages(report: dict[str, Any]) -> list[str]:
    messages = [
        (
            f"Line {error['line']}: {error['message']}"
            if error["line"] is not None
            else error["message"]
        )
        for error in report["errors"]
    ]
    unlisted = sum(report["error_counts"].values()) - len(messages)
    if unlisted > 0:
        messages.append(f"{unlisted} more lines have problems")
    return messages


def validate_whitelist(whitelist: str, worker_bin: str | None = None) -> list[str]:
    try:
        encoded = whitelist.encode("utf-8")
    except UnicodeEncodeError:
        return ["Whitelist must be valid UTF-8 text"]
    try:
        report = run_whitelist_validator(
            encoded, worker_bin or current_app.config["WORKER_BIN"]
        )
    except WhitelistValidationUnavailable:
        logger.exception("Whitelist validator is unavailable")
        raise
    return whitelist_error_messages(report)
