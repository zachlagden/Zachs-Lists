"""
Validation utilities for domains, URLs, configs, and whitelists.

Adapted from pihole_downloader.py with additional validation for web context.
"""

import re
import functools
from typing import List, Optional, Callable, Any
from urllib.parse import urlparse
from dataclasses import dataclass, field
from enum import Enum

import requests
import gevent
from gevent.pool import Pool

# Constants
MAX_DOMAIN_LENGTH = 253
MAX_SOURCE_SIZE_BYTES = 100 * 1024 * 1024  # 100MB max per source

# Valid categories for blocklist configuration
VALID_CATEGORIES = frozenset(
    {
        "comprehensive",
        "malicious",
        "advertising",
        "tracking",
        "suspicious",
        "nsfw",
    }
)


class ValidationSeverity(Enum):
    """Severity levels for validation results."""

    ERROR = "error"
    WARNING = "warning"


@dataclass
class ValidationIssue:
    """A single validation issue (error or warning)."""

    severity: ValidationSeverity
    message: str
    line: Optional[int] = None
    url: Optional[str] = None


@dataclass
class ValidationResult:
    """Result of config validation."""

    issues: List[ValidationIssue] = field(default_factory=list)
    validated_count: int = 0

    @property
    def errors(self) -> List[ValidationIssue]:
        return [i for i in self.issues if i.severity == ValidationSeverity.ERROR]

    @property
    def warnings(self) -> List[ValidationIssue]:
        return [i for i in self.issues if i.severity == ValidationSeverity.WARNING]

    @property
    def has_errors(self) -> bool:
        return len(self.errors) > 0

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0

    def to_dict(self) -> dict:
        return {
            "issues": [
                {
                    "severity": i.severity.value,
                    "message": i.message,
                    "line": i.line,
                    "url": i.url,
                }
                for i in self.issues
            ],
            "errors": [
                {"message": i.message, "line": i.line, "url": i.url}
                for i in self.errors
            ],
            "warnings": [
                {"message": i.message, "line": i.line, "url": i.url}
                for i in self.warnings
            ],
            "validated_count": self.validated_count,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "has_errors": self.has_errors,
            "has_warnings": self.has_warnings,
        }


@dataclass
class ParsedConfigLine:
    """A parsed line from the blocklist config."""

    line_num: int
    url: str
    name: str
    category: str
    raw: str


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


def parse_config_lines(config: str) -> List[ParsedConfigLine]:
    """
    Parse blocklist config into structured lines.

    Args:
        config: Configuration file content

    Returns:
        List of parsed config lines (skipping comments and empty lines)
    """
    lines = []
    for line_num, line in enumerate(config.splitlines(), 1):
        raw = line
        line = line.strip()

        # Skip empty lines and comments
        if not line or line.startswith("#"):
            continue

        # Parse line
        parts = line.split("|")
        if len(parts) != 3:
            continue

        url, name, category = [p.strip() for p in parts]
        lines.append(
            ParsedConfigLine(
                line_num=line_num,
                url=url,
                name=name,
                category=category,
                raw=raw,
            )
        )

    return lines


def validate_config_urls(
    config: str,
    max_sources: int,
    emit_progress: Optional[Callable[[dict], Any]] = None,
) -> ValidationResult:
    """
    Validate blocklist config with HEAD requests to verify URLs.

    This function performs:
    1. Basic format validation (url|name|category)
    2. Category validation against VALID_CATEGORIES
    3. HEAD requests to verify URLs exist and check content-type/size

    Uses gevent for concurrent HEAD requests.

    Args:
        config: Configuration file content
        max_sources: Maximum number of sources allowed
        emit_progress: Optional callback for progress updates.
                       Called with: {'current': int, 'total': int, 'url': str, 'status': str}

    Returns:
        ValidationResult with errors and warnings
    """
    result = ValidationResult()
    parsed_lines = parse_config_lines(config)
    seen_names = set()

    # Check source count first
    if len(parsed_lines) > max_sources:
        result.issues.append(
            ValidationIssue(
                severity=ValidationSeverity.ERROR,
                message=f"Too many sources ({len(parsed_lines)}). Maximum allowed: {max_sources}",
            )
        )

    # First pass: validate format (synchronous)
    lines_to_validate = []
    for line in parsed_lines:
        # Validate URL format
        if not validate_url(line.url):
            result.issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Invalid or unsafe URL",
                    line=line.line_num,
                    url=line.url,
                )
            )
            continue

        # Validate name
        if not re.match(r"^[\w\-]+$", line.name):
            result.issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Invalid name '{line.name}'. Use alphanumeric, dashes, underscores only.",
                    line=line.line_num,
                    url=line.url,
                )
            )
            continue

        # Check for duplicate names
        if line.name.lower() in seen_names:
            result.issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Duplicate name '{line.name}'",
                    line=line.line_num,
                    url=line.url,
                )
            )
            continue
        seen_names.add(line.name.lower())

        # Validate category (strict enforcement)
        if line.category not in VALID_CATEGORIES:
            result.issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"Invalid category '{line.category}'. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}",
                    line=line.line_num,
                    url=line.url,
                )
            )
            continue

        lines_to_validate.append(line)

    # Second pass: HEAD requests using gevent pool for concurrency
    validated_count = [0]  # Use list for mutable reference in closure
    total = len(lines_to_validate)

    def validate_url_head(line: ParsedConfigLine) -> Optional[ValidationIssue]:
        """Validate a single URL with HEAD request."""
        if emit_progress:
            validated_count[0] += 1
            emit_progress(
                {
                    "current": validated_count[0],
                    "total": total,
                    "url": line.url,
                    "status": "validating",
                }
            )

        try:
            resp = requests.head(
                line.url,
                timeout=15,
                allow_redirects=True,
                headers={"User-Agent": "BlocklistValidator/1.0 (lists.zachlagden.uk)"},
            )

            # Check status
            if resp.status_code >= 400:
                return ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    message=f"URL returned HTTP {resp.status_code}",
                    line=line.line_num,
                    url=line.url,
                )

            # Check content-length if available
            content_length = resp.headers.get("content-length")
            if content_length:
                try:
                    size = int(content_length)
                    if size > MAX_SOURCE_SIZE_BYTES:
                        return ValidationIssue(
                            severity=ValidationSeverity.ERROR,
                            message=f"File too large: {size:,} bytes (max {MAX_SOURCE_SIZE_BYTES:,} bytes)",
                            line=line.line_num,
                            url=line.url,
                        )
                except ValueError:
                    pass

            # Check content-type (warning only, not blocking)
            content_type = resp.headers.get("content-type", "").lower()
            if (
                content_type
                and "text" not in content_type
                and "octet-stream" not in content_type
            ):
                return ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    message=f"Unexpected content-type: {content_type}",
                    line=line.line_num,
                    url=line.url,
                )

            return None  # No issue

        except requests.exceptions.HTTPError as e:
            if (
                hasattr(e, "response")
                and e.response is not None
                and e.response.status_code == 405
            ):
                return ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    message="HEAD request not supported by server",
                    line=line.line_num,
                    url=line.url,
                )
            return ValidationIssue(
                severity=ValidationSeverity.WARNING,
                message=f"HTTP error: {str(e)[:50]}",
                line=line.line_num,
                url=line.url,
            )
        except requests.exceptions.Timeout:
            return ValidationIssue(
                severity=ValidationSeverity.WARNING,
                message="Request timed out during validation",
                line=line.line_num,
                url=line.url,
            )
        except requests.exceptions.RequestException as e:
            return ValidationIssue(
                severity=ValidationSeverity.WARNING,
                message=f"Could not validate: {str(e)[:50]}",
                line=line.line_num,
                url=line.url,
            )
        except Exception as e:
            return ValidationIssue(
                severity=ValidationSeverity.WARNING,
                message=f"Validation error: {str(e)[:50]}",
                line=line.line_num,
                url=line.url,
            )

    # Run HEAD requests concurrently using gevent pool (max 10 concurrent)
    pool = Pool(10)
    issues = pool.map(validate_url_head, lines_to_validate)

    # Collect issues
    for issue in issues:
        if issue:
            result.issues.append(issue)

    result.validated_count = len(lines_to_validate)

    if emit_progress:
        emit_progress(
            {
                "current": total,
                "total": total,
                "url": "",
                "status": "complete",
            }
        )

    return result


def validate_blocklist_config_strict(config: str, max_sources: int) -> List[str]:
    """
    Validate blocklists.conf content with strict category enforcement.

    This is the synchronous version that only validates format,
    without making HTTP requests.

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

        # Validate category (strict enforcement)
        if category not in VALID_CATEGORIES:
            errors.append(
                f"Line {line_num}: Invalid category '{category}'. Must be one of: {', '.join(sorted(VALID_CATEGORIES))}"
            )
            continue

        sources.append((url, name, category))

    # Check source count
    if len(sources) > max_sources:
        errors.append(
            f"Too many sources ({len(sources)}). Maximum allowed: {max_sources}"
        )

    return errors
