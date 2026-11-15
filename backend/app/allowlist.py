"""Publish a user whitelist as a Pi-hole v6 subscribed allowlist.

Pi-hole v6 gravity (FTL gravity-parseList.c) accepts only plain domains and
ABP exceptions of the form ``@@||example.com^`` in a subscribed allowlist.
Regex, wildcards inside the rule, and ``$`` modifiers are not supported.
"""

import gzip
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.generator_host import BLOCKLIST_GENERATOR_HOST
from app.utils.validators import validate_domain

ALLOWLIST_NAME = "allowlist"
BLOCKLIST_FORMATS = ("hosts", "plain", "adblock")
ALLOWLIST_FORMATS = ("adblock", "plain")
ALLOWLIST_PRIMARY_FORMAT = "adblock"

_KIND_EXACT = "exact"
_KIND_SUBDOMAIN = "subdomain"
_KIND_WILDCARD_SUBDOMAIN = "wildcard_subdomain"
_KIND_UNSUPPORTED = "unsupported"
_KIND_REGEX = "regex"
_PLAIN = "plain"


@dataclass(frozen=True)
class ParsedWhitelistEntry:
    kind: str
    original: str
    domain: str | None = None


def is_blocklist_catalog_name(name: str | None) -> bool:
    """Blocklist catalogs must not treat the published allowlist as a category."""
    return isinstance(name, str) and bool(name) and name != ALLOWLIST_NAME


def blocklist_format(requested: str | None) -> str:
    if requested in BLOCKLIST_FORMATS:
        return requested
    return "hosts"


def allowlist_format(requested: str | None) -> str | None:
    if requested is None or requested == "":
        return ALLOWLIST_PRIMARY_FORMAT
    if requested in ALLOWLIST_FORMATS:
        return requested
    return None


def parse_whitelist(whitelist: str) -> list[ParsedWhitelistEntry]:
    entries: list[ParsedWhitelistEntry] = []
    for line in whitelist.splitlines():
        pattern = line.split("#", 1)[0].strip()
        if pattern:
            entries.append(_classify(pattern))
    return entries


def render_allowlist(
    whitelist: str,
    output_format: str,
    generated_at: datetime,
    generator: str | None = None,
) -> str:
    if output_format not in ALLOWLIST_FORMATS:
        raise ValueError(f"Unsupported allowlist format: {output_format}")

    entries = parse_whitelist(whitelist)
    rules: list[str] = []
    seen_rules: set[str] = set()
    wildcard_notes: list[str] = []
    omitted_subdomains: list[str] = []
    unsupported: list[str] = []
    regexes: list[str] = []

    for entry in entries:
        if entry.kind == _KIND_REGEX:
            regexes.append(entry.original)
            continue
        if entry.kind == _KIND_UNSUPPORTED:
            unsupported.append(entry.original)
            continue
        if entry.kind == _KIND_WILDCARD_SUBDOMAIN:
            wildcard_notes.append(entry.original)
        if entry.kind in (_KIND_SUBDOMAIN, _KIND_WILDCARD_SUBDOMAIN):
            omitted_subdomains.append(entry.original)
        if output_format == _PLAIN and entry.kind != _KIND_EXACT:
            continue
        rule = _rule_for(entry)
        if rule is None or rule in seen_rules:
            continue
        seen_rules.add(rule)
        rules.append(rule)

    header = _header(
        output_format,
        generated_at,
        len(rules),
        wildcard_notes,
        omitted_subdomains,
        unsupported,
        regexes,
        generator or BLOCKLIST_GENERATOR_HOST,
    )
    if not rules:
        return header + "\n"
    return header + "\n" + "\n".join(rules) + "\n"


def sync_published_allowlist(
    output_dir: str | Path,
    whitelist: str,
    enabled: bool,
    generated_at: datetime | None = None,
    generator: str | None = None,
) -> None:
    """Write both allowlist formats, or remove them when publishing is off."""
    directory = Path(output_dir)
    if not enabled:
        remove_published_allowlist(directory)
        return

    moment = generated_at or datetime.now(UTC)
    directory.mkdir(parents=True, exist_ok=True)
    for output_format in ALLOWLIST_FORMATS:
        text = render_allowlist(whitelist, output_format, moment, generator)
        _write_gzip_atomic(directory / f"{ALLOWLIST_NAME}_{output_format}.txt.gz", text)
    _remove_paths(_hosts_artifacts(directory))


def remove_published_allowlist(output_dir: str | Path) -> None:
    directory = Path(output_dir)
    _remove_paths(_artifact_paths(directory))


def _classify(pattern: str) -> ParsedWhitelistEntry:
    if len(pattern) > 2 and pattern.startswith("/") and pattern.endswith("/"):
        return ParsedWhitelistEntry(_KIND_REGEX, pattern, None)
    if pattern.startswith("@@"):
        domain = pattern[2:].lower()
        if validate_domain(domain):
            return ParsedWhitelistEntry(_KIND_SUBDOMAIN, pattern, domain)
        return ParsedWhitelistEntry(_KIND_UNSUPPORTED, pattern, None)
    if "*" in pattern:
        remainder = pattern[2:]
        if (
            pattern.startswith("*.")
            and "*" not in remainder
            and validate_domain(remainder.lower())
        ):
            return ParsedWhitelistEntry(
                _KIND_WILDCARD_SUBDOMAIN, pattern, remainder.lower()
            )
        return ParsedWhitelistEntry(_KIND_UNSUPPORTED, pattern, None)
    domain = pattern.lower()
    if validate_domain(domain):
        return ParsedWhitelistEntry(_KIND_EXACT, pattern, domain)
    return ParsedWhitelistEntry(_KIND_UNSUPPORTED, pattern, None)


def _rule_for(entry: ParsedWhitelistEntry) -> str | None:
    if entry.domain is None:
        return None
    if entry.kind == _KIND_EXACT:
        return entry.domain
    if entry.kind in (_KIND_SUBDOMAIN, _KIND_WILDCARD_SUBDOMAIN):
        return f"@@||{entry.domain}^"
    return None


def _header(
    output_format: str,
    generated_at: datetime,
    rule_count: int,
    wildcard_notes: list[str],
    omitted_subdomains: list[str],
    unsupported: list[str],
    regexes: list[str],
    generator: str,
) -> str:
    lines = [
        f"# Allowlist generated by {generator}",
        f"# Generated: {_format_timestamp(generated_at)}",
        f"# Allow rules: {rule_count}",
    ]
    if output_format == _PLAIN:
        lines.append("# Plain format lists exact domains only.")
        lines.append(
            "# It does not honor subdomain semantics: @@ and *. patterns are omitted."
        )
        lines.append(
            "# The URL without a format parameter is the Pi-hole v6 allowlist."
        )
        if omitted_subdomains:
            lines.append("# Omitted subdomain patterns:")
            lines.extend(f"#   {pattern}" for pattern in _unique(omitted_subdomains))
    else:
        lines.append(
            "# Pi-hole v6 subscribed allowlist. Exact domains are listed as-is."
        )
        lines.append(
            "# @@example.com (apex and subdomains) is emitted as @@||example.com^."
        )
        if wildcard_notes:
            lines.append(
                "# Subdomain-only patterns (*.example.com) use that same exception."
            )
            lines.append("# Pi-hole v6 also allows the apex for @@||example.com^:")
            lines.extend(f"#   {pattern}" for pattern in _unique(wildcard_notes))
    if unsupported:
        lines.append(
            "# These patterns cannot be expressed in a Pi-hole v6 subscribed "
            "allowlist and were not emitted:"
        )
        lines.extend(f"#   {pattern}" for pattern in _unique(unsupported))
    if regexes:
        lines.append(
            "# Regex is not supported in subscribed lists. Add these locally "
            "with pihole --allow-regex:"
        )
        lines.extend(f"#   {pattern}" for pattern in _unique(regexes))
    return "\n".join(lines) + "\n"


def _format_timestamp(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    else:
        moment = moment.astimezone(UTC)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _unique(items: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


def _artifact_paths(output_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for output_format in (*ALLOWLIST_FORMATS, "hosts"):
        paths.extend(_paths_for(output_dir, output_format))
    return paths


def _hosts_artifacts(output_dir: Path) -> list[Path]:
    return _paths_for(output_dir, "hosts")


def _paths_for(output_dir: Path, output_format: str) -> list[Path]:
    base = output_dir / f"{ALLOWLIST_NAME}_{output_format}.txt"
    gzip_path = Path(str(base) + ".gz")
    return [base, gzip_path, Path(str(gzip_path) + ".tmp")]


def _remove_paths(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


def _write_gzip_atomic(path: Path, text: str) -> None:
    temporary = Path(str(path) + ".tmp")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with gzip.open(temporary, "wt", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
