import importlib.util
import json
from pathlib import Path
from typing import Any

import mongomock

from app.utils.validators import WhitelistValidationUnavailable

path = Path(__file__).resolve().parents[1] / "scripts/audit_whitelists.py"
spec = importlib.util.spec_from_file_location("whitelist_audit", path)
assert spec is not None and spec.loader is not None
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

VALID = {"valid": True, "errors": [], "error_counts": {}}


def report(error_counts: dict[str, int]) -> dict[str, Any]:
    return {
        "valid": False,
        "errors": [
            {"line": 1, "content": "secret.example", "code": code, "message": "Bad"}
            for code in error_counts
        ],
        "error_counts": error_counts,
    }


def test_reports_bad_line_counts_by_account_without_whitelist_content() -> None:
    database: Any = mongomock.MongoClient().default
    database.users.insert_many(
        [
            {"_id": "user-valid", "config": {"whitelist": "good.example"}},
            {"_id": "user-invalid", "config": {"whitelist": "secret.example bad"}},
            {"_id": "user-broken", "config": {"whitelist": "unreadable.example"}},
            {"_id": "user-empty", "config": {"whitelist": ""}},
            {"_id": "user-without-config"},
            {"_id": "user-odd", "config": {"whitelist": ["secret.example"]}},
        ]
    )
    database.system_config.insert_one(
        {"_id": "default_config", "whitelist": "secret.example default"}
    )
    before = {
        "users": list(database.users.find()),
        "system_config": list(database.system_config.find()),
    }
    seen: list[bytes] = []

    def validate(whitelist: bytes) -> dict[str, Any]:
        seen.append(whitelist)
        if whitelist == b"good.example":
            return VALID
        if whitelist == b"unreadable.example":
            raise WhitelistValidationUnavailable("validator timed out")
        if whitelist == b"secret.example default":
            return report({"invalid_domain": 1})
        return report({"unsupported_regex": 2, "invalid_domain": 3})

    summary = audit.run(database, validate)

    assert summary == {
        "whitelists_checked": 5,
        "whitelists_with_problems": 2,
        "whitelists_not_validated": 2,
        "bad_lines": {"invalid_domain": 4, "unsupported_regex": 2},
        "accounts": [
            {
                "user_id": "user-invalid",
                "bad_lines": {"invalid_domain": 3, "unsupported_regex": 2},
            },
            {"user_id": "__default__", "bad_lines": {"invalid_domain": 1}},
        ],
        "failures": [
            {"user_id": "user-broken", "reason": "validator timed out"},
            {"user_id": "user-odd", "reason": "whitelist is not text"},
        ],
    }
    assert sorted(seen) == [
        b"good.example",
        b"secret.example bad",
        b"secret.example default",
        b"unreadable.example",
    ]
    assert "secret" not in json.dumps(summary)
    assert "unreadable" not in json.dumps(summary)
    assert before == {
        "users": list(database.users.find()),
        "system_config": list(database.system_config.find()),
    }


def test_an_empty_database_has_nothing_to_report() -> None:
    database: Any = mongomock.MongoClient().default
    summary = audit.run(database, lambda whitelist: VALID)
    assert summary["whitelists_checked"] == 0
    assert summary["accounts"] == []
    assert summary["failures"] == []
