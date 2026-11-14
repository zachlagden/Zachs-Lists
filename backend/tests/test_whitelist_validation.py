import json
import logging
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from flask import Flask

from app.blueprints import user as user_blueprint
from app.config import Config
from app.utils import validators
from app.utils.validators import (
    WhitelistValidationUnavailable,
    validate_whitelist,
    whitelist_error_messages,
)

WORKER_BIN = "/example/blocklist-worker"
CASES: list[dict[str, Any]] = json.loads(
    (
        Path(__file__).resolve().parents[2] / "tests/fixtures/whitelist-cases.json"
    ).read_text()
)


def completed(
    report: Any, returncode: int | None = None
) -> subprocess.CompletedProcess[bytes]:
    if returncode is None:
        returncode = 0 if report["valid"] else 1
    return subprocess.CompletedProcess(
        [WORKER_BIN], returncode, json.dumps(report).encode(), b""
    )


def validator_returning(
    monkeypatch: pytest.MonkeyPatch, result: subprocess.CompletedProcess[bytes]
) -> Mock:
    run = Mock(return_value=result)
    monkeypatch.setattr(validators.subprocess, "run", run)
    return run


def validator_raising(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    monkeypatch.setattr(validators.subprocess, "run", Mock(side_effect=error))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_shared_cases_map_to_line_numbered_messages(
    case: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    run = validator_returning(monkeypatch, completed(case["expected"]))

    messages = validate_whitelist(case["input"], WORKER_BIN)

    run.assert_called_once_with(
        [WORKER_BIN, "validate-whitelist"],
        input=case["input"].encode("utf-8"),
        capture_output=True,
        timeout=5,
    )
    assert messages == [
        f"Line {error['line']}: {error['message']}"
        for error in case["expected"]["errors"]
    ]
    assert (messages == []) == case["expected"]["valid"]


def test_shared_cases_cover_the_agreed_syntax() -> None:
    by_name = {case["name"]: case["expected"] for case in CASES}
    assert by_name["subdomain_entry_matches_the_domain_and_every_subdomain"]["valid"]
    assert by_name["uppercase_wildcard_matches_lowercase_domains"]["valid"]
    assert by_name["comments_blank_lines_and_crlf"]["valid"]
    rejected = by_name["lookahead_and_backreference_rejected_with_line_numbers"]
    assert [(error["line"], error["code"]) for error in rejected["errors"]] == [
        (2, "unsupported_regex"),
        (3, "unsupported_regex"),
        (4, "unsupported_regex"),
    ]
    mixed = by_name["one_bad_line_among_good_ones"]
    assert [error["line"] for error in mixed["errors"]] == [3]
    assert sum(mixed["patterns"].values()) == 4
    assert by_name["over_long_line"]["error_counts"] == {"line_too_long": 2}


def test_whole_input_errors_have_no_line_prefix_and_capped_errors_are_counted() -> None:
    report = {
        "valid": False,
        "errors": [
            {"line": None, "content": "", "code": "input_too_large", "message": "Big"},
            {"line": 4, "content": "x", "code": "invalid_domain", "message": "Bad"},
        ],
        "error_counts": {"input_too_large": 1, "invalid_domain": 8},
    }
    assert whitelist_error_messages(report) == [
        "Big",
        "Line 4: Bad",
        "7 more lines have problems",
    ]


def test_text_that_is_not_utf8_is_rejected_without_running_the_validator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run = validator_returning(monkeypatch, completed({"valid": True}))
    assert validate_whitelist("example.com\ud800", WORKER_BIN) == [
        "Whitelist must be valid UTF-8 text"
    ]
    run.assert_not_called()


VALID_REPORT = {"valid": True, "errors": [], "error_counts": {}}
INVALID_REPORT = {
    "valid": False,
    "errors": [{"line": 1, "content": "x", "code": "invalid_domain", "message": "Bad"}],
    "error_counts": {"invalid_domain": 1},
}


@pytest.mark.parametrize(
    "failure",
    [
        FileNotFoundError(WORKER_BIN),
        PermissionError(WORKER_BIN),
        subprocess.TimeoutExpired([WORKER_BIN], 5),
    ],
    ids=["missing_binary", "binary_not_executable", "timeout"],
)
def test_a_validator_that_cannot_run_is_unavailable(
    failure: Exception,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    validator_raising(monkeypatch, failure)
    with caplog.at_level(logging.ERROR, logger=validators.logger.name):
        with pytest.raises(WhitelistValidationUnavailable):
            validate_whitelist("example.com", WORKER_BIN)
    assert [record.levelno for record in caplog.records] == [logging.ERROR]
    assert caplog.records[0].exc_info is not None


@pytest.mark.parametrize(
    "result",
    [
        completed(VALID_REPORT, returncode=2),
        completed(VALID_REPORT, returncode=-9),
        subprocess.CompletedProcess([WORKER_BIN], 0, b"", b""),
        subprocess.CompletedProcess([WORKER_BIN], 0, b"not json", b""),
        subprocess.CompletedProcess([WORKER_BIN], 0, b"\xff\xfe", b""),
        completed([], returncode=0),
        completed({"errors": [], "error_counts": {}}, returncode=0),
        completed({"valid": "yes", "errors": [], "error_counts": {}}, returncode=0),
        completed({"valid": True, "error_counts": {}}, returncode=0),
        completed({"valid": True, "errors": []}, returncode=0),
        completed(VALID_REPORT, returncode=1),
        completed(INVALID_REPORT, returncode=0),
        completed({"valid": False, "errors": [], "error_counts": {}}, returncode=1),
        completed({**INVALID_REPORT, "valid": True}, returncode=0),
        completed({**INVALID_REPORT, "errors": ["Bad"]}, returncode=1),
        completed(
            {
                **INVALID_REPORT,
                "errors": [{"line": "1", "code": "x", "message": "Bad"}],
            },
            returncode=1,
        ),
        completed(
            {**INVALID_REPORT, "errors": [{"line": 1, "code": "x"}]}, returncode=1
        ),
        completed({**INVALID_REPORT, "error_counts": {"x": "1"}}, returncode=1),
    ],
    ids=[
        "exit_2",
        "killed",
        "empty_output",
        "garbage_output",
        "undecodable_output",
        "not_an_object",
        "no_verdict",
        "verdict_not_boolean",
        "no_errors_field",
        "no_error_counts_field",
        "valid_with_exit_1",
        "invalid_with_exit_0",
        "invalid_without_errors",
        "valid_with_errors",
        "error_not_an_object",
        "line_not_a_number",
        "error_without_message",
        "count_not_a_number",
    ],
)
def test_validator_output_that_cannot_be_trusted_is_unavailable(
    result: subprocess.CompletedProcess[bytes],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    validator_returning(monkeypatch, result)
    with caplog.at_level(logging.ERROR, logger=validators.logger.name):
        with pytest.raises(WhitelistValidationUnavailable):
            validate_whitelist("private.example", WORKER_BIN)
    assert len(caplog.records) == 1
    assert "private.example" not in caplog.text


def test_worker_bin_defaults_to_the_path_the_image_and_entrypoint_use() -> None:
    root = Path(__file__).resolve().parents[2]
    assert Config.WORKER_BIN == "/app/rust-worker"
    assert (
        "WORKER_BIN=${WORKER_BIN:-/app/rust-worker}"
        in (root / "docker/entrypoint.sh").read_text()
    )
    dockerfile = (root / "Dockerfile").read_text()
    assert "WORKDIR /app\n" in dockerfile
    assert "target/release/blocklist-worker ./rust-worker\n" in dockerfile


@pytest.fixture
def whitelist_client(app: Flask, user: Mock) -> Any:
    app.config["WORKER_BIN"] = WORKER_BIN
    user.limits = {"max_config_size_mb": 10}
    app.register_blueprint(user_blueprint.user_bp, url_prefix="/api/user")
    client = app.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user.id
        session["auth_version"] = user.auth_version
    return client


def test_save_uses_the_configured_binary_and_stores_a_valid_whitelist(
    whitelist_client: Any, user: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = validator_returning(monkeypatch, completed(VALID_REPORT))
    response = whitelist_client.put(
        "/api/user/whitelist", json={"whitelist": "@@example.com"}
    )
    assert response.status_code == 200
    assert run.call_args.args[0] == [WORKER_BIN, "validate-whitelist"]
    user.save_config.assert_called_once_with("whitelist.txt", "@@example.com")


def test_save_returns_line_numbered_details_for_an_invalid_whitelist(
    whitelist_client: Any, user: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    validator_returning(monkeypatch, completed(INVALID_REPORT))
    response = whitelist_client.put("/api/user/whitelist", json={"whitelist": "x"})
    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Invalid whitelist",
        "details": ["Line 1: Bad"],
    }
    user.save_config.assert_not_called()


def test_save_is_refused_when_the_validator_is_unavailable(
    whitelist_client: Any, user: Mock, monkeypatch: pytest.MonkeyPatch
) -> None:
    validator_raising(monkeypatch, FileNotFoundError(WORKER_BIN))
    response = whitelist_client.put(
        "/api/user/whitelist", json={"whitelist": "example.com"}
    )
    assert response.status_code == 503
    assert response.get_json() == {
        "error": "The whitelist could not be checked, so it was not saved. Try again shortly."
    }
    user.save_config.assert_not_called()
