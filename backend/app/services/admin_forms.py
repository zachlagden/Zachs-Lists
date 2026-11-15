from collections.abc import Mapping
from typing import Any

from flask import current_app

from app.models.announcement import Announcement
from app.models.blocklist_library import BlocklistLibrary
from app.models.limit_request import LimitRequest
from app.models.user import User
from app.utils.request_fields import (
    FieldError,
    integer_in_range,
    optional_bool,
    optional_choice,
    optional_int,
    optional_string,
    optional_utc_datetime,
    required_choice,
    required_string,
)
from app.utils.validators import (
    WhitelistValidationUnavailable,
    MAX_CONFIG_SOURCES,
    validate_blocklist_config,
    validate_url,
    validate_whitelist,
)

MAX_LIBRARY_DOMAIN_COUNT = 1_000_000_000
MAX_URL_LENGTH = 2048
MAX_NAME_LENGTH = 100
MAX_DESCRIPTION_LENGTH = 500
MAX_FEATURED_ORDER = 1_000_000
MAX_TITLE_LENGTH = 200
MAX_MESSAGE_LENGTH = 5000
MAX_RESPONSE_LENGTH = 1000


def limit_changes(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise FieldError("limits must be an object", "limits")
    maximums = User.limit_maximums()
    changes: dict[str, int] = {}
    for name, limit in value.items():
        field = f"limits.{name}"
        if name not in maximums:
            raise FieldError(f"{field} is not a known limit", field)
        changes[name] = integer_in_range(limit, field, 1, maximums[name])
    return changes


def library_entry_fields(data: Mapping[str, Any], partial: bool) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if not partial or data.get("url") is not None:
        url = required_string(data, "url", MAX_URL_LENGTH)
        if not validate_url(url):
            raise FieldError("url is not a safe HTTP or HTTPS source URL", "url")
        fields["url"] = url
    if not partial or data.get("name") is not None:
        fields["name"] = required_string(data, "name", MAX_NAME_LENGTH)
    if not partial or data.get("category") is not None:
        fields["category"] = required_choice(
            data, "category", BlocklistLibrary.VALID_CATEGORIES
        )
    optional: dict[str, Any] = {
        "description": optional_string(data, "description", MAX_DESCRIPTION_LENGTH),
        "recommended": optional_bool(data, "recommended"),
        "aggressiveness": optional_int(
            data,
            "aggressiveness",
            BlocklistLibrary.MIN_AGGRESSIVENESS,
            BlocklistLibrary.MAX_AGGRESSIVENESS,
        ),
        "domain_count": optional_int(data, "domain_count", 0, MAX_LIBRARY_DOMAIN_COUNT),
    }
    fields.update(
        {name: value for name, value in optional.items() if value is not None}
    )
    return fields


def announcement_fields(data: Mapping[str, Any], partial: bool) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if not partial or "title" in data:
        fields["title"] = required_string(data, "title", MAX_TITLE_LENGTH)
    if not partial or "message" in data:
        fields["message"] = required_string(data, "message", MAX_MESSAGE_LENGTH)
    announcement_type = optional_choice(data, "type", Announcement.VALID_TYPES)
    if announcement_type is not None:
        fields["type"] = announcement_type
    is_active = optional_bool(data, "is_active")
    if partial and is_active is not None:
        fields["is_active"] = is_active
    if not partial or "expires_at" in data:
        fields["expires_at"] = optional_utc_datetime(data, "expires_at")
    return fields


def approved_limit(data: Mapping[str, Any], limit_request: LimitRequest) -> int | None:
    return optional_int(
        data,
        "custom_limit",
        max(1, limit_request.current_limit),
        current_app.config["MAX_DOMAINS_LIMIT"],
    )


def review_response(data: Mapping[str, Any]) -> str | None:
    return optional_string(data, "response", MAX_RESPONSE_LENGTH) or None


class DefaultConfigCheckUnavailable(Exception):
    pass


def default_config_fields(data: Mapping[str, Any]) -> dict[str, str | None]:
    blocklists = data.get("config")
    whitelist = data.get("whitelist")
    if blocklists is not None:
        errors = validate_blocklist_config(blocklists, MAX_CONFIG_SOURCES)
        if errors:
            raise FieldError(
                "The blocklist configuration has errors",
                "config",
                "invalid_config",
                details=errors,
            )
    if whitelist is not None:
        try:
            errors = validate_whitelist(whitelist)
        except WhitelistValidationUnavailable:
            raise DefaultConfigCheckUnavailable() from None
        if errors:
            raise FieldError(
                "The whitelist has errors",
                "whitelist",
                "invalid_whitelist",
                details=errors,
            )
    return {"blocklists": blocklists, "whitelist": whitelist}
