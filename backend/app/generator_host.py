"""Hostname stamped on generated list files.

``BLOCKLIST_GENERATOR_HOST`` is the only copy of the fallback host. It is used
when ``FRONTEND_URL`` has no hostname, which keeps the public instance's
headers unchanged. ``docker/entrypoint.sh`` runs this module and exports the
result as ``BLOCKLIST_GENERATOR_HOST`` for the Rust worker. Set that variable
to override the derived host.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

_FALLBACK_FILE = Path(__file__).with_name("blocklist_generator_host.txt")
BLOCKLIST_GENERATOR_HOST = _FALLBACK_FILE.read_text(encoding="utf-8").strip()


def host_from_public_url(public_url: str | None) -> str:
    """Hostname for file headers, from the instance's public URL."""
    if not public_url or not public_url.strip():
        return BLOCKLIST_GENERATOR_HOST
    parsed = urlparse(public_url.strip())
    hostname = parsed.hostname
    if not hostname:
        return BLOCKLIST_GENERATOR_HOST
    if parsed.port and parsed.port not in (80, 443):
        return f"{hostname}:{parsed.port}"
    return hostname


def resolve_generator_host(explicit: str | None, public_url: str | None) -> str:
    """Prefer an explicit host, otherwise derive one from the public URL."""
    if explicit and explicit.strip():
        return explicit.strip()
    return host_from_public_url(public_url)


def generator_host_from_env() -> str:
    return resolve_generator_host(
        os.environ.get("BLOCKLIST_GENERATOR_HOST"),
        os.environ.get("FRONTEND_URL"),
    )


def main() -> None:
    sys.stdout.write(generator_host_from_env())


if __name__ == "__main__":
    main()
