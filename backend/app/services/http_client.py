"""
HTTP client with retry logic and conditional request support.

Adapted from pihole_downloader.py
"""

import logging
from typing import Optional, Tuple, Callable

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

# Default configuration
DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = 0.5
RETRY_STATUS_CODES = [429, 500, 502, 503, 504]


class HTTPClient:
    """HTTP client with retry logic and ETag/Last-Modified support."""

    def __init__(self, timeout: int = DEFAULT_TIMEOUT):
        """
        Initialize HTTP client.

        Args:
            timeout: Request timeout in seconds
        """
        self.timeout = timeout
        self.session = self._create_session()

    def _create_session(self) -> requests.Session:
        """Create a session with retry logic."""
        session = requests.Session()
        retry = Retry(
            total=MAX_RETRIES,
            backoff_factor=RETRY_BACKOFF,
            status_forcelist=RETRY_STATUS_CODES,
            allowed_methods=["GET"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def download(
        self,
        url: str,
        etag: Optional[str] = None,
        last_modified: Optional[str] = None,
    ) -> Tuple[Optional[bytes], Optional[str], Optional[str], bool]:
        """
        Download content with conditional request support.

        Args:
            url: URL to download
            etag: Previous ETag for conditional request
            last_modified: Previous Last-Modified for conditional request

        Returns:
            Tuple of (content, new_etag, new_last_modified, was_modified)
            If not modified, content will be None and was_modified will be False
        """
        headers = {"User-Agent": "Pi-hole Blocklist Service/1.0 (lists.zachlagden.uk)"}

        # Add conditional headers if available
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        try:
            response = self.session.get(url, headers=headers, timeout=self.timeout)

            # 304 Not Modified
            if response.status_code == 304:
                logger.debug(f"Not modified: {url}")
                return None, etag, last_modified, False

            response.raise_for_status()

            # Get new cache headers
            new_etag = response.headers.get("ETag")
            new_last_modified = response.headers.get("Last-Modified")

            logger.debug(f"Downloaded {url}: {len(response.content)} bytes")

            return response.content, new_etag, new_last_modified, True

        except requests.exceptions.Timeout:
            logger.error(f"Timeout downloading {url}")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading {url}: {e}")
            raise

    def download_with_progress(
        self,
        url: str,
        progress_callback: Callable[[int, Optional[int]], None] = None,
        etag: Optional[str] = None,
        last_modified: Optional[str] = None,
    ) -> Tuple[Optional[bytes], Optional[str], Optional[str], bool]:
        """
        Download content with streaming progress updates.

        Args:
            url: URL to download
            progress_callback: Callback function(bytes_downloaded, bytes_total)
                               bytes_total may be None if Content-Length unknown
            etag: Previous ETag for conditional request
            last_modified: Previous Last-Modified for conditional request

        Returns:
            Tuple of (content, new_etag, new_last_modified, was_modified)
            If not modified, content will be None and was_modified will be False
        """
        headers = {"User-Agent": "Pi-hole Blocklist Service/1.0 (lists.zachlagden.uk)"}

        # Add conditional headers if available
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified

        try:
            # Stream the response for progress tracking
            response = self.session.get(
                url, headers=headers, timeout=self.timeout, stream=True
            )

            # 304 Not Modified
            if response.status_code == 304:
                logger.debug(f"Not modified: {url}")
                return None, etag, last_modified, False

            response.raise_for_status()

            # Get content length if available
            content_length = response.headers.get("Content-Length")
            total_bytes = int(content_length) if content_length else None

            # Stream download with progress updates
            chunks = []
            bytes_downloaded = 0
            chunk_size = 8192  # 8KB chunks

            for chunk in response.iter_content(chunk_size=chunk_size):
                if chunk:
                    chunks.append(chunk)
                    bytes_downloaded += len(chunk)

                    if progress_callback:
                        progress_callback(bytes_downloaded, total_bytes)

            content = b"".join(chunks)

            # Get new cache headers
            new_etag = response.headers.get("ETag")
            new_last_modified = response.headers.get("Last-Modified")

            logger.debug(f"Downloaded {url}: {len(content)} bytes")

            return content, new_etag, new_last_modified, True

        except requests.exceptions.Timeout:
            logger.error(f"Timeout downloading {url}")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Error downloading {url}: {e}")
            raise

    def head(self, url: str) -> dict:
        """
        Perform HEAD request to get headers only.

        Args:
            url: URL to check

        Returns:
            Dictionary of response headers
        """
        headers = {"User-Agent": "Pi-hole Blocklist Service/1.0 (lists.zachlagden.uk)"}

        try:
            response = self.session.head(url, headers=headers, timeout=self.timeout)
            response.raise_for_status()
            return dict(response.headers)
        except requests.exceptions.RequestException as e:
            logger.error(f"HEAD request failed for {url}: {e}")
            raise

    def close(self) -> None:
        """Close the session."""
        self.session.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
