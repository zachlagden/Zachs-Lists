"""
Validation utilities for domains, URLs, configs, and whitelists.

Adapted from pihole_downloader.py with additional validation for web context.
"""

import re
import functools
from typing import List, Optional
from urllib.parse import urlparse

# Constants
MAX_DOMAIN_LENGTH = 253

# Pre-compiled regex patterns (from pihole_downloader.py)
DOMAIN_PATTERN = re.compile(
    r"^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$"
)

# Additional patterns for parsing
ADBLOCK_PATTERN = re.compile(r"^\|\|(.+?)\^(?:\$.*)?$")
IP_DOMAIN_PATTERN = re.compile(r"^\s*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s+(\S+)$")
COMMENT_PATTERN = re.compile(r"(#|!).*$")

# Private IP ranges
PRIVATE_IP_PATTERNS = [
    re.compile(r"^10\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^172\.(1[6-9]|2[0-9]|3[01])\."),
    re.compile(r"^127\."),
    re.compile(r"^0\."),
]


@functools.lru_cache(maxsize=10000)
def validate_domain(domain: str) -> bool:
    """
    Validate a domain name.

    Args:
        domain: Domain name to validate

    Returns:
        True if valid, False otherwise
    """
    if not domain:
        return False

    # Skip localhost and local domains
    if domain == "localhost" or domain.endswith(".local"):
        return False

    # Check length
    if len(domain) > MAX_DOMAIN_LENGTH:
        return False

    # Handle wildcard domains
    check_domain = domain[2:] if domain.startswith("*.") else domain

    return bool(DOMAIN_PATTERN.match(check_domain))


def normalize_domain(domain: str) -> str:
    """
    Normalize domain to lowercase without trailing dot.

    Args:
        domain: Domain to normalize

    Returns:
        Normalized domain
    """
    return domain.lower().rstrip(".")


def validate_url(url: str) -> bool:
    """
    Validate URL for safety.

    Args:
        url: URL to validate

    Returns:
        True if safe, False otherwise
    """
    try:
        parsed = urlparse(url)

        # Must be http or https
        if parsed.scheme not in ("http", "https"):
            return False

        # Must have valid netloc
        if not parsed.netloc:
            return False

        # Extract host (without port)
        host = parsed.netloc.split(":")[0].lower()

        # No localhost
        if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
            return False

        # No private IPs
        for pattern in PRIVATE_IP_PATTERNS:
            if pattern.match(host):
                return False

        # No local domains
        if host.endswith(".local") or host.endswith(".localhost"):
            return False

        return True

    except Exception:
        return False


def validate_blocklist_config(config: str, max_sources: int) -> List[str]:
    """
    Validate blocklists.conf content.

    Args:
        config: Configuration file content
        max_sources: Maximum number of sources allowed

    Returns:
        List of error messages (empty if valid)
    """
    errors = []
    sources = []
    seen_names = set()

    for line_num, line in enumerate(config.splitlines(), 1):
        line = line.strip()

        # Skip empty lines and comments
        if not line or line.startswith("#"):
            continue

        # Parse line
        parts = line.split("|")
        if len(parts) != 3:
            errors.append(
                f"Line {line_num}: Invalid format. Expected: url|name|category"
            )
            continue

        url, name, category = [p.strip() for p in parts]

        # Validate URL
        if not validate_url(url):
            errors.append(f"Line {line_num}: Invalid or unsafe URL: {url}")
            continue

        # Validate name (alphanumeric, dashes, underscores only)
        if not re.match(r"^[\w\-]+$", name):
            errors.append(
                f"Line {line_num}: Invalid name '{name}'. Use only alphanumeric characters, dashes, and underscores."
            )
            continue

        # Check for duplicate names
        if name.lower() in seen_names:
            errors.append(f"Line {line_num}: Duplicate name '{name}'")
            continue
        seen_names.add(name.lower())

        # Validate category
        if not re.match(r"^[\w\-]+$", category):
            errors.append(
                f"Line {line_num}: Invalid category '{category}'. Use only alphanumeric characters, dashes, and underscores."
            )
            continue

        sources.append((url, name, category))

    # Check source count
    if len(sources) > max_sources:
        errors.append(
            f"Too many sources ({len(sources)}). Maximum allowed: {max_sources}"
        )

    return errors


def validate_whitelist(whitelist: str) -> List[str]:
    """
    Validate whitelist.txt content.

    Args:
        whitelist: Whitelist file content

    Returns:
        List of error messages (empty if valid)
    """
    errors = []

    for line_num, line in enumerate(whitelist.splitlines(), 1):
        # Remove inline comments
        if "#" in line:
            line = line[: line.index("#")]
        line = line.strip()

        # Skip empty lines
        if not line:
            continue

        # Regex pattern (enclosed in /.../)
        if line.startswith("/") and line.endswith("/"):
            pattern = line[1:-1]
            try:
                re.compile(pattern)
            except re.error as e:
                errors.append(f"Line {line_num}: Invalid regex pattern: {e}")
            continue

        # Wildcard pattern
        if "*" in line:
            # Basic validation - wildcards should be reasonable
            if line.count("*") > 5:
                errors.append(f"Line {line_num}: Too many wildcards in pattern")
            # Check for valid characters
            if not re.match(r"^[\w\-.*]+$", line):
                errors.append(
                    f"Line {line_num}: Invalid characters in wildcard pattern"
                )
            continue

        # Exact domain
        if not validate_domain(line):
            errors.append(f"Line {line_num}: Invalid domain: {line}")

    return errors


def extract_domain_from_line(line: str) -> Optional[str]:
    """
    Extract domain from various blocklist formats.

    Supports:
    - Hosts file format: 0.0.0.0 domain.com
    - AdBlock format: ||domain.com^
    - Plain domain format: domain.com

    Args:
        line: Line from blocklist file

    Returns:
        Extracted domain or None
    """
    line = line.strip()

    # Skip empty lines and comments
    if not line or line.startswith("#") or line.startswith("!"):
        return None

    # Remove inline comments
    line = COMMENT_PATTERN.sub("", line).strip()
    if not line:
        return None

    # Try IP-domain format (0.0.0.0 domain.com or 127.0.0.1 domain.com)
    match = IP_DOMAIN_PATTERN.match(line)
    if match:
        return match.group(1)

    # Try AdBlock format (||domain.com^)
    match = ADBLOCK_PATTERN.match(line)
    if match:
        return match.group(1)

    # Plain domain format (no spaces, no URL characters)
    if " " not in line and "/" not in line and "?" not in line:
        return line

    return None
