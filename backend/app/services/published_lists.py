import gzip
import json
import logging
import os
import re
from collections import OrderedDict
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
from typing import Any
from uuid import UUID

from flask import Response, request, send_file
from werkzeug.datastructures import Accept
from werkzeug.http import parse_accept_header

from app.utils.time import utc_iso

logger = logging.getLogger(__name__)

FORMATS = ("hosts", "plain", "adblock")
DEFAULT_FORMAT = "hosts"
GENERATIONS_DIR = "generations"
MANIFEST_NAME = "manifest.json"
MANIFEST_VERSION = 1
MAX_MANIFEST_BYTES = 1024 * 1024
MANIFEST_CACHE_SIZE = 256
REPORTED_FAILURES_SIZE = 256
STREAM_CHUNK_BYTES = 64 * 1024
LIST_MIMETYPE = "text/plain"
IDENTITY_ETAG_SUFFIX = "-identity"
GZIP_CODINGS = ("gzip", "x-gzip")
SENT_STATUS_CODES = (200, 206)

_LIST_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}")
_SHA256 = re.compile(r"[0-9a-f]{64}")


class PublicationUnavailable(Exception):
    pass


@dataclass(frozen=True)
class ManifestFile:
    name: str
    list_name: str
    format: str
    domain_count: int
    size_bytes: int
    uncompressed_bytes: int
    sha256: str


@dataclass(frozen=True)
class Manifest:
    generation_id: str
    created_at: datetime
    files: Mapping[tuple[str, str], ManifestFile]


@dataclass(frozen=True)
class ListFile:
    path: str
    gzipped: bool
    etag: str
    last_modified: datetime
    stored_bytes: int
    plain_bytes: int | None
    domain_count: int | None


_cache_lock = Lock()
_manifests: OrderedDict[str, Manifest] = OrderedDict()
_reported_failures: OrderedDict[str, None] = OrderedDict()


def clear_caches() -> None:
    with _cache_lock:
        _manifests.clear()
        _reported_failures.clear()


def _unavailable(key: str, reason: str) -> PublicationUnavailable:
    with _cache_lock:
        first_report = key not in _reported_failures
        _reported_failures[key] = None
        while len(_reported_failures) > REPORTED_FAILURES_SIZE:
            _reported_failures.popitem(last=False)
    if first_report:
        logger.error("Published lists are unavailable for %s: %s", key, reason)
    return PublicationUnavailable(reason)


def is_generation_id(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _count(value: Any, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field} is not a count")
    return value


def _manifest_file(entry: Any) -> ManifestFile:
    if not isinstance(entry, dict):
        raise ValueError("a file entry is not an object")
    list_name = entry.get("list")
    format_type = entry.get("format")
    sha256 = entry.get("sha256")
    if not isinstance(list_name, str) or not _LIST_NAME.fullmatch(list_name):
        raise ValueError("a file entry has an unusable list name")
    if format_type not in FORMATS:
        raise ValueError("a file entry has an unknown format")
    if entry.get("name") != f"{list_name}_{format_type}.txt.gz":
        raise ValueError("a file name does not match its list and format")
    if not isinstance(sha256, str) or not _SHA256.fullmatch(sha256):
        raise ValueError("a file entry has an unusable sha256")
    return ManifestFile(
        name=entry["name"],
        list_name=list_name,
        format=format_type,
        domain_count=_count(entry.get("domain_count"), "domain_count"),
        size_bytes=_count(entry.get("size_bytes"), "size_bytes"),
        uncompressed_bytes=_count(
            entry.get("uncompressed_bytes"), "uncompressed_bytes"
        ),
        sha256=sha256,
    )


def _parse_manifest(raw: bytes, generation_id: str) -> Manifest:
    document = json.loads(raw)
    if not isinstance(document, dict):
        raise ValueError("the manifest is not an object")
    if document.get("version") != MANIFEST_VERSION:
        raise ValueError("the manifest version is not supported")
    if document.get("generation_id") != generation_id:
        raise ValueError("the manifest belongs to another generation")
    created_at = document.get("created_at")
    entries = document.get("files")
    if not isinstance(created_at, str):
        raise ValueError("the manifest has no creation time")
    if not isinstance(entries, list) or not entries:
        raise ValueError("the manifest lists no files")
    created = datetime.fromisoformat(created_at)
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    files: dict[tuple[str, str], ManifestFile] = {}
    for entry in entries:
        file = _manifest_file(entry)
        key = (file.list_name, file.format)
        if key in files:
            raise ValueError("the manifest lists a file twice")
        files[key] = file
    return Manifest(generation_id=generation_id, created_at=created, files=files)


def generation_dir(output_dir: str, generation_id: str) -> str:
    return os.path.join(output_dir, GENERATIONS_DIR, generation_id)


def load_manifest(output_dir: str, generation_id: object) -> Manifest:
    if not isinstance(generation_id, str) or not is_generation_id(generation_id):
        raise _unavailable(output_dir, "the published generation id is not valid")
    path = os.path.join(generation_dir(output_dir, generation_id), MANIFEST_NAME)
    with _cache_lock:
        cached = _manifests.get(path)
        if cached is not None:
            _manifests.move_to_end(path)
            return cached
    try:
        if os.path.getsize(path) > MAX_MANIFEST_BYTES:
            raise ValueError("the manifest is too large")
        with open(path, "rb") as stream:
            manifest = _parse_manifest(stream.read(), generation_id)
    except (OSError, ValueError) as error:
        raise _unavailable(generation_id, str(error)) from error
    with _cache_lock:
        _manifests[path] = manifest
        while len(_manifests) > MANIFEST_CACHE_SIZE:
            _manifests.popitem(last=False)
    return manifest


def _published_file(
    output_dir: str, manifest: Manifest, list_name: str, format_type: str
) -> ListFile | None:
    entry = manifest.files.get((list_name, format_type))
    if entry is None:
        return None
    path = os.path.join(generation_dir(output_dir, manifest.generation_id), entry.name)
    try:
        stored_bytes = os.path.getsize(path)
    except OSError as error:
        raise _unavailable(manifest.generation_id, f"{entry.name}: {error}") from error
    if stored_bytes != entry.size_bytes:
        raise _unavailable(
            manifest.generation_id,
            f"{entry.name} is {stored_bytes} bytes, not {entry.size_bytes}",
        )
    return ListFile(
        path=path,
        gzipped=True,
        etag=entry.sha256,
        last_modified=manifest.created_at,
        stored_bytes=entry.size_bytes,
        plain_bytes=entry.uncompressed_bytes,
        domain_count=entry.domain_count,
    )


def _legacy_file(path: str) -> ListFile | None:
    try:
        status = os.stat(path)
    except FileNotFoundError:
        return None
    if not os.path.isfile(path):
        return None
    gzipped = path.endswith(".gz")
    return ListFile(
        path=path,
        gzipped=gzipped,
        etag=f"legacy-{status.st_mtime_ns:x}-{status.st_size:x}",
        last_modified=datetime.fromtimestamp(int(status.st_mtime), tz=timezone.utc),
        stored_bytes=status.st_size,
        plain_bytes=None if gzipped else status.st_size,
        domain_count=None,
    )


def _resolve_legacy(
    output_dir: str, list_name: str, format_type: str, unsuffixed: bool
) -> ListFile | None:
    stems = [f"{list_name}_{format_type}.txt"]
    if unsuffixed:
        stems.append(f"{list_name}.txt")
    for stem in stems:
        for filename in (f"{stem}.gz", stem):
            found = _legacy_file(os.path.join(output_dir, filename))
            if found is not None:
                return found
    return None


def resolve(
    output_dir: str,
    generation_id: object,
    list_name: str,
    format_type: str,
    legacy_unsuffixed: bool = False,
) -> ListFile | None:
    if not _LIST_NAME.fullmatch(list_name) or format_type not in FORMATS:
        return None
    if generation_id is None:
        return _resolve_legacy(output_dir, list_name, format_type, legacy_unsuffixed)
    manifest = load_manifest(output_dir, generation_id)
    return _published_file(output_dir, manifest, list_name, format_type)


def requested_format(value: str | None) -> str:
    return value if value in FORMATS else DEFAULT_FORMAT


def accepts_gzip(accept_encoding: str | None) -> bool:
    if not accept_encoding:
        return False
    named: float | None = None
    wildcard: float | None = None
    for coding, quality in parse_accept_header(accept_encoding, Accept):
        coding = coding.strip().lower()
        if coding in GZIP_CODINGS:
            named = quality if named is None else max(named, quality)
        elif coding == "*":
            wildcard = quality
    if named is not None:
        return named > 0
    return wildcard is not None and wildcard > 0


def _decompressed_chunks(path: str) -> Iterator[bytes]:
    with gzip.open(path, "rb") as stream:
        while True:
            chunk = stream.read(STREAM_CHUNK_BYTES)
            if not chunk:
                return
            yield chunk


def _gzip_plain_size(path: str) -> int | None:
    try:
        with open(path, "rb") as stream:
            stream.seek(-4, os.SEEK_END)
            return int.from_bytes(stream.read(4), "little")
    except OSError as error:
        logger.warning("Could not read the stored size of %s: %s", path, error)
        return None


def _stored_response(file: ListFile) -> Response:
    return send_file(
        file.path,
        mimetype=LIST_MIMETYPE,
        as_attachment=False,
        conditional=True,
        etag=file.etag,
        last_modified=file.last_modified,
    )


def _decompressed_response(file: ListFile) -> Response:
    response = Response(_decompressed_chunks(file.path), mimetype=LIST_MIMETYPE)
    response.direct_passthrough = True
    response.set_etag(f"{file.etag}{IDENTITY_ETAG_SUFFIX}")
    response.last_modified = file.last_modified
    response.headers["Accept-Ranges"] = "none"
    if file.plain_bytes is not None:
        response.content_length = file.plain_bytes
    response.make_conditional(request.environ, accept_ranges=False)
    return response


def respond(file: ListFile) -> Response:
    if not file.gzipped:
        response = _stored_response(file)
    elif accepts_gzip(request.headers.get("Accept-Encoding")):
        response = _stored_response(file)
        response.headers["Content-Encoding"] = "gzip"
    else:
        response = _decompressed_response(file)
    response.headers["Vary"] = "Accept-Encoding"
    return response


def sent_bytes(response: Response, file: ListFile) -> int | None:
    if request.method != "GET" or response.status_code not in SENT_STATUS_CODES:
        return None
    if response.content_length is not None:
        return response.content_length
    if file.gzipped and response.headers.get("Content-Encoding") != "gzip":
        return _gzip_plain_size(file.path) or 0
    return file.stored_bytes


def published_summaries(
    output_dir: str, generation_id: object, published_at: datetime | None
) -> list[dict[str, Any]]:
    manifest = load_manifest(output_dir, generation_id)
    updated = utc_iso(manifest.created_at)
    lists: dict[str, dict[str, Any]] = {}
    for file in manifest.files.values():
        summary = lists.setdefault(
            file.list_name,
            {
                "name": file.list_name,
                "formats": [],
                "size_bytes": 0,
                "domain_count": file.domain_count,
                "last_updated": updated,
                "published_at": utc_iso(published_at) or updated,
                "generation_id": manifest.generation_id,
            },
        )
        summary["formats"].append(file.format)
        summary["size_bytes"] = max(summary["size_bytes"], file.uncompressed_bytes)
    for summary in lists.values():
        summary["formats"].sort(key=FORMATS.index)
    return sorted(lists.values(), key=lambda summary: summary["name"])


def _legacy_name_and_format(filename: str) -> tuple[str, str] | None:
    for suffix in (".txt.gz", ".txt"):
        if filename.endswith(suffix):
            stem = filename[: -len(suffix)]
            name, separator, format_type = stem.rpartition("_")
            if separator and format_type in FORMATS:
                return name, format_type
            return stem, DEFAULT_FORMAT
    return None


def legacy_summaries(
    output_dir: str, combined_domain_count: int | None
) -> list[dict[str, Any]]:
    try:
        entries = sorted(os.scandir(output_dir), key=lambda entry: entry.name)
    except FileNotFoundError:
        return []
    lists: dict[str, dict[str, Any]] = {}
    for entry in entries:
        parsed = _legacy_name_and_format(entry.name)
        if parsed is None or not entry.is_file():
            continue
        name, format_type = parsed
        if not _LIST_NAME.fullmatch(name):
            continue
        status = entry.stat()
        summary = lists.setdefault(
            name,
            {
                "name": name,
                "formats": [],
                "size_bytes": 0,
                "domain_count": (
                    combined_domain_count if name == "all_domains" else None
                ),
                "last_updated": utc_iso(
                    datetime.fromtimestamp(status.st_mtime, tz=timezone.utc)
                ),
                "published_at": None,
                "generation_id": None,
            },
        )
        if format_type not in summary["formats"]:
            summary["formats"].append(format_type)
        summary["size_bytes"] = max(summary["size_bytes"], status.st_size)
    return list(lists.values())


def summaries(
    output_dir: str,
    generation_id: object,
    published_at: datetime | None,
    legacy_combined_domain_count: int | None,
) -> list[dict[str, Any]]:
    if generation_id is None:
        return legacy_summaries(output_dir, legacy_combined_domain_count)
    return published_summaries(output_dir, generation_id, published_at)
