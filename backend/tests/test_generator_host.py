"""Hostname stamped on generated list files."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.allowlist import BLOCKLIST_GENERATOR_HOST as ALLOWLIST_HOST
from app.generator_host import (
    BLOCKLIST_GENERATOR_HOST,
    generator_host_from_env,
    host_from_public_url,
    resolve_generator_host,
)

SCRIPT = Path(__file__).resolve().parents[1] / "app" / "generator_host.py"
FALLBACK_FILE = SCRIPT.with_name("blocklist_generator_host.txt")
GENERATOR_RS = (
    Path(__file__).resolve().parents[2] / "rust-worker" / "src" / "generator.rs"
)

# Keep these in step with rust-worker/src/generator_host.rs.
HOST_CASES = [
    (None, BLOCKLIST_GENERATOR_HOST),
    ("", BLOCKLIST_GENERATOR_HOST),
    ("   ", BLOCKLIST_GENERATOR_HOST),
    ("https://lists.example.test", "lists.example.test"),
    ("https://lists.example.test:8443/app", "lists.example.test:8443"),
    ("http://localhost:5173", "localhost:5173"),
    ("https://lists.example.test:443", "lists.example.test"),
    ("http://lists.example.test:80/x", "lists.example.test"),
    ("http://lists.example.test:443", "lists.example.test"),
    ("https://lists.example.test:80", "lists.example.test"),
    ("https://Lists.Example.TEST/path", "lists.example.test"),
    (
        "https://user:secret@lists.example.test:8443/x",
        "lists.example.test:8443",
    ),
    ("http://[::1]/", "::1"),
    ("http://[::1]:8080/", "::1:8080"),
    ("not a url", BLOCKLIST_GENERATOR_HOST),
    ("lists.example.test", BLOCKLIST_GENERATOR_HOST),
]


def test_fallback_constant_has_one_source() -> None:
    assert FALLBACK_FILE.read_text(encoding="utf-8").strip() == "lists.zachlagden.uk"
    assert BLOCKLIST_GENERATOR_HOST == "lists.zachlagden.uk"
    assert ALLOWLIST_HOST is BLOCKLIST_GENERATOR_HOST
    assert "lists.zachlagden.uk" not in GENERATOR_RS.read_text(encoding="utf-8")


@pytest.mark.parametrize(("public_url", "expected"), HOST_CASES)
def test_host_from_public_url(public_url: str | None, expected: str) -> None:
    assert host_from_public_url(public_url) == expected


def test_resolve_prefers_an_explicit_host() -> None:
    assert (
        resolve_generator_host(" files.example.test ", "https://other.example.test")
        == "files.example.test"
    )
    assert (
        resolve_generator_host("  ", "https://lists.example.test:8443/app")
        == "lists.example.test:8443"
    )
    assert resolve_generator_host(None, None) == BLOCKLIST_GENERATOR_HOST


def test_cli_prints_the_host_the_entrypoint_exports() -> None:
    derived = _run_cli({"FRONTEND_URL": "https://lists.example.test/app"})
    overridden = _run_cli(
        {
            "FRONTEND_URL": "https://lists.example.test/app",
            "BLOCKLIST_GENERATOR_HOST": "files.example.test",
        }
    )
    fallback = _run_cli({})

    assert derived == "lists.example.test"
    assert overridden == "files.example.test"
    assert fallback == BLOCKLIST_GENERATOR_HOST


def test_generator_host_from_env_reads_the_process_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BLOCKLIST_GENERATOR_HOST", raising=False)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    assert generator_host_from_env() == "localhost:5173"

    monkeypatch.setenv("BLOCKLIST_GENERATOR_HOST", "files.example.test")
    assert generator_host_from_env() == "files.example.test"


def _run_cli(env: dict[str, str]) -> str:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT)],
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": os.environ.get("PATH", ""), **env},
    )
    assert completed.stderr == ""
    return completed.stdout
