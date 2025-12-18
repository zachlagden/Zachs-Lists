"""
Security utilities for path sanitization and content safety checks.
"""

import os
import re
from typing import List

# Patterns that might indicate malicious content
DANGEROUS_PATTERNS = [
    re.compile(r"<script", re.IGNORECASE),
    re.compile(r"javascript:", re.IGNORECASE),
    re.compile(r"data:text/html", re.IGNORECASE),
    re.compile(r"eval\s*\(", re.IGNORECASE),
    re.compile(r"document\.", re.IGNORECASE),
    re.compile(r"window\.", re.IGNORECASE),
    re.compile(r"onclick", re.IGNORECASE),
    re.compile(r"onerror", re.IGNORECASE),
    re.compile(r"onload", re.IGNORECASE),
    re.compile(r"<iframe", re.IGNORECASE),
    re.compile(r"<object", re.IGNORECASE),
    re.compile(r"<embed", re.IGNORECASE),
]

# Patterns that should be present in valid blocklists
VALID_BLOCKLIST_PATTERNS = [
    re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\s+\S+"),  # Hosts format
    re.compile(r"^\|\|[a-zA-Z0-9]"),  # AdBlock format
    re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}$"),  # Plain domain
]


def sanitize_path(base_dir: str, user_path: str) -> str:
    """
    Sanitize path to prevent directory traversal attacks.

    Args:
        base_dir: Base directory that the path must be within
        user_path: User-provided path component

    Returns:
        Safe absolute path

    Raises:
        ValueError: If path traversal is detected
    """
    # Normalize base directory
    base_dir = os.path.normpath(os.path.abspath(base_dir))

    # Remove any leading slashes from user path
    user_path = user_path.lstrip("/\\")

    # Join and normalize
    full_path = os.path.normpath(os.path.join(base_dir, user_path))

    # Ensure the path is within base_dir
    if not full_path.startswith(base_dir + os.sep) and full_path != base_dir:
        raise ValueError("Invalid path: directory traversal detected")

    return full_path


def check_content_safety(content: bytes) -> bool:
    """
    Check if downloaded content appears safe for a blocklist.

    Args:
        content: Raw bytes content

    Returns:
        True if content appears safe, False otherwise
    """
    try:
        # Decode content
        text = content.decode("utf-8", errors="ignore")

        # Check first 20KB for dangerous patterns
        sample = text[:20480]

        # Look for dangerous patterns
        for pattern in DANGEROUS_PATTERNS:
            if pattern.search(sample):
                return False

        # Basic sanity check: should have some valid blocklist lines
        lines = sample.split("\n")
        valid_lines = 0
        total_lines = 0

        for line in lines[:200]:  # Check first 200 lines
            line = line.strip()
            if not line or line.startswith("#") or line.startswith("!"):
                continue

            total_lines += 1
            for pattern in VALID_BLOCKLIST_PATTERNS:
                if pattern.match(line):
                    valid_lines += 1
                    break

        # If we have content but very few valid lines, it might be suspicious
        if total_lines > 10 and valid_lines < total_lines * 0.1:
            return False

        return True

    except Exception:
        return False


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename for safe file system operations.

    Args:
        filename: User-provided filename

    Returns:
        Sanitized filename
    """
    # Remove directory components
    filename = os.path.basename(filename)

    # Remove or replace dangerous characters
    filename = re.sub(r"[^\w\-_\.]", "_", filename)

    # Prevent hidden files
    filename = filename.lstrip(".")

    # Limit length
    if len(filename) > 100:
        # Keep extension if present
        base, ext = os.path.splitext(filename)
        if ext:
            filename = base[: 100 - len(ext)] + ext
        else:
            filename = filename[:100]

    return filename or "unnamed"


def validate_file_permissions(filepath: str, expected_mode: int) -> bool:
    """
    Validate that a file has expected permissions.

    Args:
        filepath: Path to file
        expected_mode: Expected permission mode (e.g., 0o644)

    Returns:
        True if permissions match
    """
    try:
        actual_mode = os.stat(filepath).st_mode & 0o777
        return actual_mode == expected_mode
    except OSError:
        return False


def set_secure_permissions(filepath: str, is_output: bool = False) -> None:
    """
    Set secure permissions on a file.

    Args:
        filepath: Path to file
        is_output: Whether this is an output file (read-only) or config file
    """
    if is_output:
        # Output files: read-only for everyone
        os.chmod(filepath, 0o444)
    else:
        # Config files: read-write for owner only
        os.chmod(filepath, 0o600)
