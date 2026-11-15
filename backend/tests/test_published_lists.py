import builtins
import gzip
import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask.testing import FlaskClient

from app.blueprints import lists
from app.models.analytics import Analytics
from app.models.user import User
from app.services import published_lists
from conftest import Api

CREATED_AT = datetime(2026, 3, 4, 5, 6, 7, tzinfo=timezone.utc)
PUBLISHED_AT = datetime(2026, 3, 4, 5, 6, 9)
GZIP = {"Accept-Encoding": "gzip, deflate"}


class Generation:
    def __init__(self, output_dir: Path, lists: dict[str, list[str]]) -> None:
        self.id = str(uuid4())
        self.directory = output_dir / "generations" / self.id
        self.directory.mkdir(parents=True)
        self.text: dict[tuple[str, str], bytes] = {}
        self.stored: dict[tuple[str, str], bytes] = {}
        self.files: list[dict[str, Any]] = []
        for name, domains in lists.items():
            for format_type in published_lists.FORMATS:
                text = "".join(
                    f"{format_type} {domain}\n" for domain in domains
                ).encode()
                stored = gzip.compress(text, mtime=0)
                filename = f"{name}_{format_type}.txt.gz"
                (self.directory / filename).write_bytes(stored)
                self.text[(name, format_type)] = text
                self.stored[(name, format_type)] = stored
                self.files.append(
                    {
                        "name": filename,
                        "list": name,
                        "format": format_type,
                        "domain_count": len(domains),
                        "size_bytes": len(stored),
                        "uncompressed_bytes": len(text),
                        "sha256": hashlib.sha256(stored).hexdigest(),
                    }
                )
        self.write_manifest(self.manifest())

    def manifest(self) -> dict[str, Any]:
        return {
            "version": 1,
            "generation_id": self.id,
            "job_id": "example-job",
            "job_created_at": "2026-03-04T05:06:00Z",
            "attempt": 1,
            "created_at": "2026-03-04T05:06:07Z",
            "inputs_digest": "a" * 64,
            "files": self.files,
        }

    def write_manifest(self, manifest: Any) -> None:
        (self.directory / "manifest.json").write_text(json.dumps(manifest))

    def sha256(self, name: str, format_type: str = "hosts") -> str:
        return hashlib.sha256(self.stored[(name, format_type)]).hexdigest()


@pytest.fixture(autouse=True)
def fresh_manifest_cache() -> None:
    published_lists.clear_caches()


@pytest.fixture
def recorded(monkeypatch: pytest.MonkeyPatch) -> Mock:
    record = Mock()
    monkeypatch.setattr(lists, "record_download", record)
    return record


@pytest.fixture
def default_output(api: Api) -> Path:
    output = Path(api.app.config["DEFAULT_DIR"]) / "output"
    output.mkdir(parents=True)
    return output


def publish_default(api: Api, generation: Generation) -> None:
    api.db.system_config.update_one(
        {"_id": "default_build"},
        {
            "$set": {
                "published_generation": generation.id,
                "published": {"published_at": PUBLISHED_AT},
                "total_domains": 2,
            }
        },
        upsert=True,
    )


@pytest.fixture
def default_generation(api: Api, default_output: Path) -> Generation:
    generation = Generation(
        default_output,
        {"all_domains": ["ads.example.com", "tracker.example.com"], "nsfw": ["a.test"]},
    )
    publish_default(api, generation)
    return generation


@pytest.fixture
def sam(api: Api) -> User:
    return api.account(5001, "sam")


@pytest.fixture
def sam_generation(api: Api, sam: User) -> Generation:
    generation = Generation(
        Path(sam.get_output_dir()), {"all_domains": ["ads.example.com"]}
    )
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "published_generation": generation.id,
                "published": {"published_at": PUBLISHED_AT},
                "lists": [{"name": "all_domains", "domain_count": 1}],
            }
        },
    )
    return generation


def client_of(api: Api) -> FlaskClient:
    return api.app.test_client()


def test_default_list_is_served_from_the_published_generation(
    api: Api, default_generation: Generation, default_output: Path
) -> None:
    (default_output / "all_domains_hosts.txt.gz").write_bytes(b"legacy")

    response = client_of(api).get("/lists/all_domains.txt", headers=GZIP)

    assert response.status_code == 200
    assert response.data == default_generation.stored[("all_domains", "hosts")]
    assert response.headers["Content-Encoding"] == "gzip"
    assert response.headers["ETag"] == f'"{default_generation.sha256("all_domains")}"'
    assert response.headers["Last-Modified"] == format_datetime(CREATED_AT, usegmt=True)
    assert response.headers["Cache-Control"] == "public, max-age=3600"
    assert response.headers["Vary"] == "Accept-Encoding"
    assert response.headers["X-List-Type"] == "default"
    assert response.headers["X-List-Name"] == "all_domains"
    assert response.headers["X-Format"] == "hosts"
    assert response.headers["Content-Type"] == "text/plain; charset=utf-8"

    adblock = client_of(api).get("/lists/nsfw.txt?format=adblock", headers=GZIP)
    assert adblock.data == default_generation.stored[("nsfw", "adblock")]
    assert adblock.headers["X-Format"] == "adblock"
    unknown_format = client_of(api).get("/lists/nsfw.txt?format=rpz", headers=GZIP)
    assert unknown_format.data == default_generation.stored[("nsfw", "hosts")]


def test_legacy_flat_files_are_served_until_the_first_generation_is_published(
    api: Api, default_output: Path
) -> None:
    stored = gzip.compress(b"0.0.0.0 legacy.example.com\n", mtime=0)
    (default_output / "all_domains_hosts.txt.gz").write_bytes(stored)
    (default_output / "old.txt").write_bytes(b"plain.example.com\n")
    client = client_of(api)

    compressed = client.get("/lists/all_domains.txt", headers=GZIP)
    assert compressed.status_code == 200
    assert compressed.data == stored
    assert compressed.headers["Content-Encoding"] == "gzip"
    assert compressed.headers["ETag"].startswith('"legacy-')
    plain = client.get("/lists/all_domains.txt")
    assert plain.data == b"0.0.0.0 legacy.example.com\n"
    assert "Content-Encoding" not in plain.headers
    unsuffixed = client.get("/lists/old.txt", headers=GZIP)
    assert unsuffixed.data == b"plain.example.com\n"
    assert "Content-Encoding" not in unsuffixed.headers
    not_modified = client.get(
        "/lists/all_domains.txt",
        headers={**GZIP, "If-None-Match": compressed.headers["ETag"]},
    )
    assert not_modified.status_code == 304

    generation = Generation(default_output, {"tracking": ["tracker.example.com"]})
    publish_default(api, generation)

    assert client.get("/lists/all_domains.txt", headers=GZIP).status_code == 404
    assert client.get("/lists/old.txt").status_code == 404
    assert client.get("/lists/tracking.txt").status_code == 200


def test_matching_validators_get_a_304_without_a_body(
    api: Api, default_generation: Generation
) -> None:
    client = client_of(api)
    etag = f'"{default_generation.sha256("all_domains")}"'

    by_etag = client.get(
        "/lists/all_domains.txt", headers={**GZIP, "If-None-Match": etag}
    )
    by_date = client.get(
        "/lists/all_domains.txt",
        headers={
            **GZIP,
            "If-Modified-Since": format_datetime(CREATED_AT, usegmt=True),
        },
    )
    stale = client.get(
        "/lists/all_domains.txt", headers={**GZIP, "If-None-Match": '"other"'}
    )

    for not_modified in (by_etag, by_date):
        assert not_modified.status_code == 304
        assert not_modified.data == b""
        assert not_modified.headers["ETag"] == etag
        assert not_modified.headers["Cache-Control"] == "public, max-age=3600"
    assert stale.status_code == 200


def test_identity_representation_has_its_own_etag_and_conditional_response(
    api: Api, default_generation: Generation
) -> None:
    client = client_of(api)
    plain = client.get("/lists/all_domains.txt")
    identity_etag = plain.headers["ETag"]

    assert identity_etag == f'"{default_generation.sha256("all_domains")}-identity"'
    assert (
        client.get(
            "/lists/all_domains.txt", headers={"If-None-Match": identity_etag}
        ).status_code
        == 304
    )
    assert (
        client.get(
            "/lists/all_domains.txt", headers={**GZIP, "If-None-Match": identity_etag}
        ).status_code
        == 200
    )


def test_head_returns_the_headers_of_get_without_a_body(
    api: Api, default_generation: Generation
) -> None:
    client = client_of(api)

    compressed = client.head("/lists/all_domains.txt", headers=GZIP)
    plain = client.head("/lists/all_domains.txt")

    stored = default_generation.stored[("all_domains", "hosts")]
    assert compressed.status_code == 200
    assert compressed.data == b""
    assert compressed.headers["Content-Length"] == str(len(stored))
    assert compressed.headers["Content-Encoding"] == "gzip"
    assert compressed.headers["ETag"] == f'"{default_generation.sha256("all_domains")}"'
    assert plain.status_code == 200
    assert plain.data == b""
    assert plain.headers["Content-Length"] == str(
        len(default_generation.text[("all_domains", "hosts")])
    )


def test_range_is_served_from_the_stored_representation(
    api: Api, default_generation: Generation
) -> None:
    client = client_of(api)
    stored = default_generation.stored[("all_domains", "hosts")]

    partial = client.get(
        "/lists/all_domains.txt", headers={**GZIP, "Range": "bytes=2-9"}
    )
    beyond = client.get(
        "/lists/all_domains.txt",
        headers={**GZIP, "Range": f"bytes={len(stored) + 5}-"},
    )
    identity = client.get("/lists/all_domains.txt", headers={"Range": "bytes=2-9"})

    assert partial.status_code == 206
    assert partial.data == stored[2:10]
    assert partial.headers["Content-Range"] == f"bytes 2-9/{len(stored)}"
    assert partial.headers["Content-Encoding"] == "gzip"
    assert partial.headers["Accept-Ranges"] == "bytes"
    assert beyond.status_code == 416
    assert identity.status_code == 200
    assert identity.headers["Accept-Ranges"] == "none"
    assert identity.data == default_generation.text[("all_domains", "hosts")]


@pytest.mark.parametrize(
    ("accept_encoding", "gzip_expected"),
    [
        ("gzip", True),
        ("gzip, deflate, br", True),
        ("GZIP;q=0.5", True),
        ("x-gzip", True),
        ("*", True),
        ("deflate, *;q=0.1", True),
        ("gzip;q=0", False),
        ("gzip;q=0, *;q=1", False),
        ("identity", False),
        ("deflate, br", False),
        ("*;q=0", False),
        ("", False),
        (None, False),
    ],
)
def test_gzip_is_sent_only_when_the_client_accepts_it(
    api: Api,
    default_generation: Generation,
    accept_encoding: str | None,
    gzip_expected: bool,
) -> None:
    headers = {} if accept_encoding is None else {"Accept-Encoding": accept_encoding}

    assert published_lists.accepts_gzip(accept_encoding) is gzip_expected
    response = client_of(api).get("/lists/all_domains.txt", headers=headers)

    assert response.status_code == 200
    assert response.headers["Vary"] == "Accept-Encoding"
    if gzip_expected:
        assert response.headers["Content-Encoding"] == "gzip"
        assert response.data == default_generation.stored[("all_domains", "hosts")]
    else:
        assert "Content-Encoding" not in response.headers
        assert response.data == default_generation.text[("all_domains", "hosts")]
        assert response.headers["Content-Length"] == str(len(response.data))


def test_decompression_is_streamed_in_bounded_chunks(
    api: Api, default_generation: Generation, monkeypatch: pytest.MonkeyPatch
) -> None:
    chunks = [b"a" * published_lists.STREAM_CHUNK_BYTES, b"b" * 10]
    read_sizes: list[int] = []
    opened: list[str] = []

    class BoundedStream:
        def __init__(self) -> None:
            self.remaining = list(chunks)
            self.closed = False

        def __enter__(self) -> "BoundedStream":
            return self

        def __exit__(self, *exc: object) -> None:
            self.closed = True

        def read(self, size: int = -1) -> bytes:
            if size <= 0 or size > published_lists.STREAM_CHUNK_BYTES:
                raise AssertionError(f"unbounded read of {size} bytes")
            read_sizes.append(size)
            return self.remaining.pop(0) if self.remaining else b""

    stream = BoundedStream()

    def open_stream(path: str, mode: str) -> BoundedStream:
        opened.append(path)
        assert mode == "rb"
        return stream

    monkeypatch.setattr(published_lists.gzip, "open", open_stream)
    client = client_of(api)

    head = client.head("/lists/all_domains.txt")
    assert opened == []
    response = client.get("/lists/all_domains.txt", buffered=False)
    assert response.is_streamed
    body = list(response.response)

    assert head.status_code == 200
    assert body == chunks
    assert read_sizes == [published_lists.STREAM_CHUNK_BYTES] * 3
    assert stream.closed
    assert opened == [
        str(default_generation.directory / "all_domains_hosts.txt.gz"),
    ]


def test_name_that_is_not_a_manifest_entry_is_not_found(
    api: Api, default_generation: Generation
) -> None:
    (default_generation.directory / "extra_hosts.txt.gz").write_bytes(
        gzip.compress(b"extra.example.com\n")
    )
    client = client_of(api)

    for path in (
        "/lists/extra.txt",
        "/lists/manifest.txt",
        "/lists/missing.txt",
        "/lists/all-domains.txt",
        "/lists/..%2Fmanifest.txt",
    ):
        response = client.get(path, headers=GZIP)
        assert response.status_code == 404, path
    output_dir = str(default_generation.directory.parent.parent)
    for name, format_type in (
        ("../manifest", "hosts"),
        ("all_domains", "../hosts"),
        ("all_domains", "json"),
        ("", "hosts"),
    ):
        assert (
            published_lists.resolve(
                output_dir, default_generation.id, name, format_type
            )
            is None
        )


def test_user_list_is_served_from_the_users_generation(
    api: Api, sam: User, sam_generation: Generation
) -> None:
    client = client_of(api)

    response = client.get("/u/sam/all_domains.txt?format=plain", headers=GZIP)

    assert response.status_code == 200
    assert response.data == sam_generation.stored[("all_domains", "plain")]
    assert (
        response.headers["ETag"] == f'"{sam_generation.sha256("all_domains", "plain")}"'
    )
    assert response.headers["X-List-Type"] == "user"
    assert response.headers["X-Username"] == "sam"
    assert response.headers["X-Domain-Count"] == "1"
    assert client.get("/u/sam/missing.txt").status_code == 404
    api.db.users.update_one(
        {"username": "sam"},
        {"$push": {"lists": {"name": "tracking", "domain_count": 4}}},
    )
    assert client.get("/u/sam/tracking.txt").status_code == 404


def test_disabled_and_banned_users_lists_are_not_served(
    api: Api, sam: User, sam_generation: Generation
) -> None:
    client = client_of(api)
    path = "/u/sam/all_domains.txt"
    assert client.get(path).status_code == 200

    api.reload(sam).set_enabled(False)
    assert client.get(path).status_code == 404
    assert client.head(path).status_code == 404
    api.reload(sam).set_enabled(True)
    assert client.get(path).status_code == 200

    api.reload(sam).ban(datetime.utcnow() + timedelta(days=1), "example")
    assert client.get(path).status_code == 404
    api.reload(sam).ban(datetime.utcnow() - timedelta(days=1), "example")
    assert client.get(path).status_code == 200


def test_downloads_are_recorded_with_the_bytes_sent(
    api: Api, default_generation: Generation, recorded: Mock
) -> None:
    client = client_of(api)
    stored = default_generation.stored[("all_domains", "hosts")]
    text = default_generation.text[("all_domains", "hosts")]

    client.get("/lists/all_domains.txt", headers=GZIP)
    client.get("/lists/all_domains.txt")
    client.get("/lists/all_domains.txt", headers={**GZIP, "Range": "bytes=0-4"})

    assert [call.kwargs["size_bytes"] for call in recorded.call_args_list] == [
        len(stored),
        len(text),
        5,
    ]
    assert recorded.call_args_list[0].kwargs == {
        "list_type": Analytics.TYPE_DEFAULT,
        "list_name": "all_domains",
        "username": None,
        "format_type": "hosts",
        "size_bytes": len(stored),
    }


def test_304_head_416_and_missing_lists_are_not_recorded_as_downloads(
    api: Api, default_generation: Generation, recorded: Mock
) -> None:
    client = client_of(api)
    etag = f'"{default_generation.sha256("all_domains")}"'

    assert (
        client.get(
            "/lists/all_domains.txt", headers={**GZIP, "If-None-Match": etag}
        ).status_code
        == 304
    )
    assert client.head("/lists/all_domains.txt", headers=GZIP).status_code == 200
    assert client.head("/lists/all_domains.txt").status_code == 200
    assert (
        client.get(
            "/lists/all_domains.txt", headers={**GZIP, "Range": "bytes=999999-"}
        ).status_code
        == 416
    )
    assert client.get("/lists/missing.txt").status_code == 404

    recorded.assert_not_called()


def test_user_download_is_recorded_for_the_user(
    api: Api, sam: User, sam_generation: Generation, recorded: Mock
) -> None:
    client_of(api).get("/u/sam/all_domains.txt", headers=GZIP)

    recorded.assert_called_once_with(
        list_type=Analytics.TYPE_USER,
        list_name="all_domains",
        username="sam",
        format_type="hosts",
        size_bytes=len(sam_generation.stored[("all_domains", "hosts")]),
    )


def refuse_to_open_list_files(monkeypatch: pytest.MonkeyPatch) -> None:
    real_open = builtins.open

    def guarded_open(file: Any, *args: Any, **kwargs: Any) -> Any:
        if str(file).endswith((".txt.gz", ".txt")):
            raise AssertionError(f"list file {file} was opened")
        return real_open(file, *args, **kwargs)

    def refuse_gzip(file: Any, *args: Any, **kwargs: Any) -> Any:
        raise AssertionError(f"list file {file} was opened")

    monkeypatch.setattr(builtins, "open", guarded_open)
    monkeypatch.setattr(gzip, "open", refuse_gzip)


def test_api_lists_reads_the_manifest_and_never_opens_a_list_file(
    api: Api, default_generation: Generation, monkeypatch: pytest.MonkeyPatch
) -> None:
    refuse_to_open_list_files(monkeypatch)

    response = client_of(api).get("/api/lists")

    assert response.status_code == 200
    assert response.get_json() == [
        {
            "name": "all_domains",
            "formats": ["hosts", "plain", "adblock"],
            "size_bytes": max(
                len(default_generation.text[("all_domains", format_type)])
                for format_type in published_lists.FORMATS
            ),
            "domain_count": 2,
            "last_updated": "2026-03-04T05:06:07.000Z",
            "published_at": "2026-03-04T05:06:09.000Z",
            "generation_id": default_generation.id,
        },
        {
            "name": "nsfw",
            "formats": ["hosts", "plain", "adblock"],
            "size_bytes": max(
                len(default_generation.text[("nsfw", format_type)])
                for format_type in published_lists.FORMATS
            ),
            "domain_count": 1,
            "last_updated": "2026-03-04T05:06:07.000Z",
            "published_at": "2026-03-04T05:06:09.000Z",
            "generation_id": default_generation.id,
        },
    ]


def test_api_lists_describes_legacy_files_without_opening_them(
    api: Api, default_output: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored = gzip.compress(b"0.0.0.0 legacy.example.com\n")
    for filename in (
        "all_domains_hosts.txt.gz",
        "all_domains_plain.txt.gz",
        "tracking_hosts.txt.gz",
    ):
        (default_output / filename).write_bytes(stored)
    (default_output / "notes.md").write_text("ignored")
    api.db.system_config.insert_one({"_id": "default_build", "total_domains": 7})
    refuse_to_open_list_files(monkeypatch)

    listed = client_of(api).get("/api/lists").get_json()

    assert [entry["name"] for entry in listed] == ["all_domains", "tracking"]
    assert listed[0]["formats"] == ["hosts", "plain"]
    assert listed[0]["domain_count"] == 7
    assert listed[0]["size_bytes"] == len(stored)
    assert listed[0]["last_updated"].endswith("Z")
    assert listed[0]["generation_id"] is None
    assert listed[1]["domain_count"] is None
    assert set(listed[0]) == {
        "name",
        "formats",
        "size_bytes",
        "domain_count",
        "last_updated",
        "published_at",
        "generation_id",
    }


def test_api_lists_is_empty_before_anything_is_built(api: Api) -> None:
    assert client_of(api).get("/api/lists").get_json() == []


def test_user_lists_api_reports_the_published_generation(
    api: Api, sam: User, sam_generation: Generation, monkeypatch: pytest.MonkeyPatch
) -> None:
    refuse_to_open_list_files(monkeypatch)

    payload = api.client(sam).get("/api/user/lists").get_json()

    assert payload["lists"] == [{"name": "all_domains", "domain_count": 1}]
    assert payload["generation_id"] == sam_generation.id
    assert payload["published_at"] == "2026-03-04T05:06:09.000Z"
    assert {"stats", "limits", "remaining_updates"} <= set(payload)


def test_list_dates_are_sent_as_utc_timestamps(api: Api, sam: User) -> None:
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "lists": [
                    {
                        "name": "all_domains",
                        "domain_count": 1,
                        "last_updated": datetime(2026, 1, 2, 3, 4, 5),
                    },
                    {"name": "tracking", "domain_count": 1},
                ]
            }
        },
    )
    expected = [
        {
            "name": "all_domains",
            "domain_count": 1,
            "last_updated": "2026-01-02T03:04:05.000Z",
        },
        {"name": "tracking", "domain_count": 1},
    ]
    client = api.client(sam)

    assert client.get("/api/user/lists").get_json()["lists"] == expected
    assert client.get("/api/auth/me").get_json()["lists"] == expected


def test_user_lists_api_has_null_publication_fields_before_the_first_build(
    api: Api, sam: User
) -> None:
    payload = api.client(sam).get("/api/user/lists").get_json()

    assert payload["generation_id"] is None
    assert payload["published_at"] is None


def unavailable_statuses(api: Api) -> list[int]:
    client = client_of(api)
    responses = [
        client.get("/lists/all_domains.txt", headers=GZIP),
        client.get("/lists/all_domains.txt"),
        client.get("/api/lists"),
    ]
    for response in responses:
        assert response.get_json() == {
            "error": "Lists are temporarily unavailable",
            "code": "publication_unavailable",
        }
        assert response.headers["Retry-After"] == "60"
    return [response.status_code for response in responses]


@pytest.mark.parametrize(
    "tamper",
    [
        lambda generation: (generation.directory / "manifest.json").unlink(),
        lambda generation: generation.write_manifest("not an object"),
        lambda generation: (generation.directory / "manifest.json").write_text("{"),
        lambda generation: generation.write_manifest(
            {**generation.manifest(), "generation_id": str(uuid4())}
        ),
        lambda generation: generation.write_manifest(
            {**generation.manifest(), "version": 2}
        ),
        lambda generation: generation.write_manifest(
            {
                **generation.manifest(),
                "files": [
                    {**generation.files[0], "name": "../../../secret.txt.gz"},
                    *generation.files[1:],
                ],
            }
        ),
        lambda generation: generation.write_manifest(
            {
                **generation.manifest(),
                "files": [{**generation.files[0], "sha256": "short"}],
            }
        ),
        lambda generation: generation.write_manifest(
            {
                **generation.manifest(),
                "files": [{**generation.files[0], "size_bytes": -1}],
            }
        ),
        lambda generation: generation.write_manifest(
            {**generation.manifest(), "files": [generation.files[0]] * 2}
        ),
        lambda generation: (generation.directory / "manifest.json").write_text(
            " " * (published_lists.MAX_MANIFEST_BYTES + 1)
        ),
    ],
)
def test_tampered_or_missing_manifest_is_a_503_and_is_logged_once(
    api: Api,
    default_generation: Generation,
    recorded: Mock,
    caplog: pytest.LogCaptureFixture,
    tamper: Any,
) -> None:
    tamper(default_generation)

    with caplog.at_level(logging.ERROR, logger=published_lists.logger.name):
        assert unavailable_statuses(api) == [503, 503, 503]
        assert unavailable_statuses(api) == [503, 503, 503]

    assert len(caplog.records) == 1
    assert default_generation.id in caplog.records[0].getMessage()
    recorded.assert_not_called()


def test_list_file_that_does_not_match_its_manifest_is_a_503(
    api: Api, default_generation: Generation, caplog: pytest.LogCaptureFixture
) -> None:
    client = client_of(api)
    (default_generation.directory / "all_domains_hosts.txt.gz").write_bytes(b"cut")
    (default_generation.directory / "nsfw_hosts.txt.gz").unlink()

    with caplog.at_level(logging.ERROR, logger=published_lists.logger.name):
        assert client.get("/lists/all_domains.txt", headers=GZIP).status_code == 503
        assert client.get("/lists/nsfw.txt").status_code == 503

    assert len(caplog.records) == 1
    assert client.get("/lists/all_domains.txt?format=plain").status_code == 200


def test_generation_id_that_is_not_a_uuid_is_a_503(
    api: Api, default_output: Path, caplog: pytest.LogCaptureFixture
) -> None:
    api.db.system_config.insert_one(
        {"_id": "default_build", "published_generation": "../../users/sam/output"}
    )

    with caplog.at_level(logging.ERROR, logger=published_lists.logger.name):
        assert client_of(api).get("/lists/all_domains.txt").status_code == 503
        assert client_of(api).get("/api/lists").status_code == 503

    assert len(caplog.records) == 1


def test_parsed_manifests_are_cached_and_the_cache_is_bounded(
    api: Api, default_output: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(published_lists, "MANIFEST_CACHE_SIZE", 2)
    generations = [
        Generation(default_output, {"all_domains": [f"d{index}.example.com"]})
        for index in range(3)
    ]
    output_dir = str(default_output)

    first = published_lists.load_manifest(output_dir, generations[0].id)
    (generations[0].directory / "manifest.json").unlink()
    assert published_lists.load_manifest(output_dir, generations[0].id) is first

    published_lists.load_manifest(output_dir, generations[1].id)
    published_lists.load_manifest(output_dir, generations[2].id)

    assert len(published_lists._manifests) == 2
    with pytest.raises(published_lists.PublicationUnavailable):
        published_lists.load_manifest(output_dir, generations[0].id)


def test_deleting_a_user_removes_every_generation(
    api: Api, sam: User, sam_generation: Generation
) -> None:
    user_dir = Path(sam.get_user_dir())
    Generation(Path(sam.get_output_dir()), {"all_domains": ["older.example.com"]})
    assert len(os.listdir(user_dir / "output" / "generations")) == 2

    api.reload(sam).delete_with_data()

    assert not user_dir.exists()
    assert client_of(api).get("/u/sam/all_domains.txt").status_code == 404


def test_public_stats_reads_the_total_the_worker_publishes(
    api: Api, default_generation: Generation
) -> None:
    from app.models.system_config import SystemConfig

    assert SystemConfig.get_default_build_total_domains() == 2
    assert SystemConfig.get_default_publication() == {
        "generation_id": default_generation.id,
        "published_at": PUBLISHED_AT,
        "total_domains": 2,
    }
