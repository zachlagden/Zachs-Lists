import time
from collections.abc import Callable
from typing import Any

import requests

from app.utils.safe_http import source_headers, source_response, source_session

MAX_SOURCE_SIZE_BYTES = 100 * 1024 * 1024


class HTTPClient:
    def __init__(self, timeout: int = 30):
        self.timeout = timeout
        self.session = source_session()

    def download(
        self,
        url: str,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> tuple[bytes | None, str | None, str | None, bool]:
        return self.download_with_progress(url, etag=etag, last_modified=last_modified)

    def download_with_progress(
        self,
        url: str,
        progress_callback: Callable[[int, int | None], None] | None = None,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> tuple[bytes | None, str | None, str | None, bool]:
        headers = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        with source_response(
            self.session, "GET", url, self.timeout, headers
        ) as response:
            if response.status_code == 304:
                return None, etag, last_modified, False
            if not response.ok:
                raise requests.exceptions.HTTPError(
                    f"Source returned HTTP {response.status_code}"
                )
            length = response.headers.get("Content-Length")
            total = int(length) if length and length.isdigit() else None
            if total is not None and total > MAX_SOURCE_SIZE_BYTES:
                raise requests.exceptions.RequestException(
                    "Source exceeds the size limit"
                )
            content = bytearray()
            deadline = time.monotonic() + self.timeout
            for chunk in response.iter_content(8192):
                if time.monotonic() > deadline:
                    raise requests.exceptions.Timeout("Source download timed out")
                if len(content) + len(chunk) > MAX_SOURCE_SIZE_BYTES:
                    raise requests.exceptions.RequestException(
                        "Source exceeds the size limit"
                    )
                content.extend(chunk)
                if progress_callback:
                    progress_callback(len(content), total)
            return (
                bytes(content),
                response.headers.get("ETag"),
                response.headers.get("Last-Modified"),
                True,
            )

    def head(self, url: str) -> dict[str, str]:
        status, headers = source_headers(url, self.timeout)
        if status >= 400:
            raise requests.exceptions.HTTPError(f"Source returned HTTP {status}")
        return headers

    def close(self) -> None:
        self.session.close()

    def __enter__(self) -> "HTTPClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()
