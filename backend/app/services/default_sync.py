import hashlib
import json
import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import requests
from flask import current_app

from app.extensions import mongo
from app.models.system_config import SystemConfig
from app.utils.safe_http import FetchedBody, source_body
from app.utils.time import utc_iso
from app.utils.validators import (
    MAX_CONFIG_SOURCES,
    WhitelistValidationUnavailable,
    parse_config_lines,
    validate_blocklist_config,
    validate_whitelist,
)

logger = logging.getLogger(__name__)

API_ROOT = "https://api.github.com"
RAW_ROOT = "https://raw.githubusercontent.com"
USER_AGENT = "blocklist-default-sync"
PUBLISHER_LOGIN = "github-actions[bot]"
PUBLISHED_PATH = "lists"
PUBLISHED_BRANCH = "main"
COMMITS_PER_CHECK = 10
BLOCKLISTS_FILE = "blocklists.conf"
WHITELIST_FILE = "whitelist.txt"
MAX_FILE_BYTES = 1024 * 1024
REQUEST_TIMEOUT_SECONDS = 15
SYNC_ACTOR = "default-sync"
REPORTED_ERRORS = 3
REPO_PATTERN = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
SHA_PATTERN = re.compile(r"[0-9a-f]{40}")

STATUS_UPDATED = "updated"
STATUS_UNCHANGED = "unchanged"
STATUS_FAILED = "failed"


class SyncFailure(Exception):
    pass


class SourceCountHalved(SyncFailure):
    pass


@dataclass(frozen=True)
class PublishCommit:
    sha: str
    date: datetime


@dataclass(frozen=True)
class SyncResult:
    status: str
    changed: bool = False
    commit_changed: bool = False
    commit_sha: str | None = None
    source_count: int | None = None
    error: str | None = None
    can_force: bool = False

    @property
    def build_needed(self) -> bool:
        return self.changed or self.commit_changed

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def sync_enabled() -> bool:
    return bool(current_app.config["DEFAULT_SYNC_ENABLED"])


def stored_document() -> dict[str, Any]:
    document = mongo.db[SystemConfig.COLLECTION].find_one({"_id": SystemConfig.DOC_ID})
    return document if isinstance(document, dict) else {}


def stored_source(document: dict[str, Any] | None = None) -> dict[str, Any]:
    source = (stored_document() if document is None else document).get("source")
    return source if isinstance(source, dict) else {}


def sync_status() -> dict[str, Any]:
    document = stored_document()
    source = stored_source(document)
    return {
        "sync_enabled": sync_enabled(),
        "repo": current_app.config["DEFAULT_SYNC_REPO"],
        "revision": document.get("revision", 0),
        "source": (
            {
                "repo": source.get("repo"),
                "commit_sha": source.get("commit_sha"),
                "commit_date": utc_iso(source.get("commit_date")),
                "blocklists_sha256": source.get("blocklists_sha256"),
                "whitelist_sha256": source.get("whitelist_sha256"),
                "synced_at": utc_iso(source.get("synced_at")),
                "last_checked_at": utc_iso(source.get("last_checked_at")),
                "last_error": source.get("last_error"),
            }
            if source
            else None
        ),
    }


def rewrite_whitelist(upstream: str) -> str:
    return "".join(
        _with_subdomains(line) for line in upstream.splitlines(keepends=True)
    )


def _with_subdomains(line: str) -> str:
    entry = line.split("#", 1)[0].strip()
    if not entry or entry.startswith(("/", "@@")) or "*" in entry:
        return line
    start = len(line) - len(line.lstrip())
    return f"{line[:start]}@@{line[start:]}"


def pin_repository_sources(blocklists: str) -> str:
    if not sync_enabled():
        return blocklists
    source = stored_source()
    repo = source.get("repo")
    sha = source.get("commit_sha")
    if not isinstance(repo, str) or not REPO_PATTERN.fullmatch(repo):
        return blocklists
    if not isinstance(sha, str) or not SHA_PATTERN.fullmatch(sha):
        return blocklists
    unpinned = re.compile(
        rf"^(\s*{re.escape(RAW_ROOT)}/{re.escape(repo)}/)"
        rf"(?:refs/heads/)?{re.escape(PUBLISHED_BRANCH)}/",
        re.IGNORECASE | re.MULTILINE,
    )
    return unpinned.sub(lambda match: f"{match.group(1)}{sha}/", blocklists)


def sync_default_config(force: bool = False, refetch: bool = False) -> SyncResult:
    now = datetime.utcnow()
    try:
        result = _sync(force, refetch or force, now)
    except SyncFailure as failure:
        message = str(failure)
        logger.warning("Default list sync failed: %s", message)
        _record_failure(message, now)
        return SyncResult(
            STATUS_FAILED,
            error=message,
            can_force=isinstance(failure, SourceCountHalved),
        )
    logger.info(
        "Default list sync %s at commit %s", result.status, result.commit_sha or "-"
    )
    return result


def _sync(force: bool, refetch: bool, now: datetime) -> SyncResult:
    repo = current_app.config["DEFAULT_SYNC_REPO"]
    if not isinstance(repo, str) or not REPO_PATTERN.fullmatch(repo):
        raise SyncFailure("DEFAULT_SYNC_REPO must look like owner/name")
    document = stored_document()
    source = stored_source(document)
    previous = source if source.get("repo") == repo else {}
    etag = None if refetch else previous.get("etag")

    commit, new_etag = _find_publish_commit(repo, etag)
    if commit is None:
        _record_check(now, {})
        return SyncResult(STATUS_UNCHANGED, commit_sha=previous.get("commit_sha"))

    checked = {
        "source.repo": repo,
        "source.commit_sha": commit.sha,
        "source.commit_date": commit.date,
        "source.etag": new_etag,
    }
    commit_changed = previous.get("commit_sha") != commit.sha
    if not commit_changed and not refetch:
        _record_check(now, checked)
        return SyncResult(STATUS_UNCHANGED, commit_sha=commit.sha)

    upstream_blocklists = _fetch_repository_file(repo, commit.sha, BLOCKLISTS_FILE)
    upstream_whitelist = _fetch_repository_file(repo, commit.sha, WHITELIST_FILE)
    whitelist = rewrite_whitelist(upstream_whitelist)
    source_count = _checked_source_count(upstream_blocklists, document, force)
    _check_whitelist(whitelist)

    hashes = {
        "blocklists_sha256": _sha256(upstream_blocklists),
        "whitelist_sha256": _sha256(upstream_whitelist),
    }
    unchanged = (
        all(previous.get(name) == digest for name, digest in hashes.items())
        and document.get("blocklists") == upstream_blocklists
        and document.get("whitelist") == whitelist
    )
    if unchanged:
        _record_check(now, checked)
        return SyncResult(
            STATUS_UNCHANGED,
            commit_changed=commit_changed,
            commit_sha=commit.sha,
            source_count=source_count,
        )

    mongo.db[SystemConfig.COLLECTION].update_one(
        {"_id": SystemConfig.DOC_ID},
        {
            "$set": {
                "blocklists": upstream_blocklists,
                "whitelist": whitelist,
                "updated_at": now,
                "updated_by": SYNC_ACTOR,
                **checked,
                **{f"source.{name}": digest for name, digest in hashes.items()},
                "source.synced_at": now,
                "source.last_checked_at": now,
                "source.last_error": None,
            },
            "$inc": {"revision": 1},
        },
        upsert=True,
    )
    return SyncResult(
        STATUS_UPDATED,
        changed=True,
        commit_changed=commit_changed,
        commit_sha=commit.sha,
        source_count=source_count,
    )


def _record_check(now: datetime, checked: dict[str, Any]) -> None:
    mongo.db[SystemConfig.COLLECTION].update_one(
        {"_id": SystemConfig.DOC_ID},
        {
            "$set": {
                **checked,
                "source.last_checked_at": now,
                "source.last_error": None,
            }
        },
        upsert=True,
    )


def _record_failure(message: str, now: datetime) -> None:
    mongo.db[SystemConfig.COLLECTION].update_one(
        {"_id": SystemConfig.DOC_ID},
        {"$set": {"source.last_error": message, "source.last_checked_at": now}},
        upsert=True,
    )


def _find_publish_commit(
    repo: str, etag: str | None
) -> tuple[PublishCommit | None, str | None]:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/vnd.github+json",
    }
    if isinstance(etag, str) and etag:
        headers["If-None-Match"] = etag
    token = current_app.config.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = (
        f"{API_ROOT}/repos/{repo}/commits"
        f"?path={PUBLISHED_PATH}&sha={PUBLISHED_BRANCH}&per_page={COMMITS_PER_CHECK}"
    )
    response = _fetch(url, headers, "the GitHub commit list", follow_redirects=False)
    if response.status == 304:
        return None, etag
    if response.status != 200:
        raise SyncFailure(f"GitHub commit list returned HTTP {response.status}")
    try:
        commits = json.loads(response.body)
    except ValueError:
        raise SyncFailure("GitHub commit list is not JSON") from None
    if not isinstance(commits, list):
        raise SyncFailure("GitHub commit list has an unexpected shape")
    prefix = current_app.config["DEFAULT_SYNC_COMMIT_PREFIX"]
    for listed in commits:
        commit = _publish_commit(listed, prefix)
        if commit is not None:
            return commit, response.headers.get("etag")
    raise SyncFailure(
        f"None of the newest {COMMITS_PER_CHECK} commits under {PUBLISHED_PATH}/ "
        "is a published build"
    )


def _publish_commit(listed: Any, prefix: str) -> PublishCommit | None:
    if not isinstance(listed, dict):
        return None
    author = listed.get("author")
    details = listed.get("commit")
    sha = listed.get("sha")
    if not isinstance(author, dict) or author.get("login") != PUBLISHER_LOGIN:
        return None
    if not isinstance(details, dict) or not isinstance(sha, str):
        return None
    message = details.get("message")
    if not isinstance(message, str) or not message.startswith(prefix):
        return None
    if not SHA_PATTERN.fullmatch(sha):
        return None
    committer = details.get("committer")
    written = committer.get("date") if isinstance(committer, dict) else None
    if not isinstance(written, str):
        return None
    try:
        date = datetime.fromisoformat(written.replace("Z", "+00:00"))
    except ValueError:
        return None
    if date.tzinfo is not None:
        date = date.astimezone(timezone.utc).replace(tzinfo=None)
    return PublishCommit(sha, date)


def _fetch_repository_file(repo: str, sha: str, name: str) -> str:
    response = _fetch(
        f"{RAW_ROOT}/{repo}/{sha}/{name}", {"User-Agent": USER_AGENT}, name
    )
    if response.status != 200:
        raise SyncFailure(f"{name} returned HTTP {response.status}")
    try:
        return response.body.decode("utf-8")
    except UnicodeDecodeError:
        raise SyncFailure(f"{name} is not UTF-8 text") from None


def _fetch(
    url: str, headers: dict[str, str], subject: str, follow_redirects: bool = True
) -> FetchedBody:
    try:
        return source_body(
            url,
            MAX_FILE_BYTES,
            REQUEST_TIMEOUT_SECONDS,
            headers,
            follow_redirects,
        )
    except requests.exceptions.RequestException as error:
        raise SyncFailure(
            f"Could not fetch {subject} ({type(error).__name__})"
        ) from None


def _checked_source_count(
    blocklists: str, document: dict[str, Any], force: bool
) -> int:
    errors = validate_blocklist_config(blocklists, MAX_CONFIG_SOURCES)
    if errors:
        raise SyncFailure(f"{BLOCKLISTS_FILE} failed validation: {_summary(errors)}")
    source_count = len(parse_config_lines(blocklists))
    if source_count == 0:
        raise SyncFailure(f"{BLOCKLISTS_FILE} has no sources")
    stored = document.get("blocklists")
    stored_count = len(parse_config_lines(stored)) if isinstance(stored, str) else 0
    if source_count * 2 < stored_count and not force:
        raise SourceCountHalved(
            f"{BLOCKLISTS_FILE} has {source_count} sources, less than half of the "
            f"{stored_count} stored now. Run the sync with force to accept it"
        )
    return source_count


def _check_whitelist(whitelist: str) -> None:
    try:
        errors = validate_whitelist(whitelist)
    except WhitelistValidationUnavailable:
        raise SyncFailure(f"{WHITELIST_FILE} could not be checked") from None
    if errors:
        raise SyncFailure(f"{WHITELIST_FILE} failed validation: {_summary(errors)}")


def _summary(errors: list[str]) -> str:
    shown = "; ".join(errors[:REPORTED_ERRORS])
    hidden = len(errors) - REPORTED_ERRORS
    return f"{shown}; and {hidden} more" if hidden > 0 else shown


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
