from collections.abc import Collection, Mapping
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from flask import Blueprint, Flask, Response, jsonify, request

MAX_PAGE = 100_000


class FieldError(Exception):
    def __init__(
        self,
        message: str,
        field: str | None = None,
        code: str = "invalid_field",
        status: int = 400,
        **details: Any,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.field = field
        self.code = code
        self.status = status
        self.details = details

    def to_response(self) -> tuple[Response, int]:
        body = {
            "error": self.message,
            "code": self.code,
            "field": self.field,
            **self.details,
        }
        return jsonify(body), self.status


def register_field_errors(target: Flask | Blueprint) -> None:
    @target.errorhandler(FieldError)
    def field_error(error: FieldError) -> tuple[Response, int]:
        return error.to_response()


def json_object() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if data is None and not request.get_data(cache=True):
        return {}
    if not isinstance(data, dict):
        raise FieldError("Expected a JSON object", code="invalid_json")
    return data


def is_utf8_text(value: str) -> bool:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _string(data: Mapping[str, Any], field: str, max_length: int) -> str | None:
    value = data.get(field)
    if value is None:
        return None
    if not isinstance(value, str):
        raise FieldError(f"{field} must be a string", field)
    if not is_utf8_text(value):
        raise FieldError(f"{field} must be valid UTF-8 text", field)
    value = value.strip()
    if len(value) > max_length:
        raise FieldError(f"{field} must be at most {max_length} characters", field)
    return value


def required_string(
    data: Mapping[str, Any], field: str, max_length: int = 200, min_length: int = 1
) -> str:
    value = _string(data, field, max_length)
    if not value:
        raise FieldError(f"{field} is required", field)
    if len(value) < min_length:
        raise FieldError(f"{field} must be at least {min_length} characters", field)
    return value


def optional_string(
    data: Mapping[str, Any], field: str, max_length: int = 200
) -> str | None:
    return _string(data, field, max_length)


def required_text(data: Mapping[str, Any], field: str) -> str:
    value = data.get(field)
    if value is None:
        raise FieldError(f"{field} is required", field)
    if not isinstance(value, str):
        raise FieldError(f"{field} must be a string", field)
    if not is_utf8_text(value):
        raise FieldError(f"{field} must be valid UTF-8 text", field)
    return value


def integer_in_range(value: Any, field: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise FieldError(f"{field} must be a whole number", field)
    if not minimum <= value <= maximum:
        raise FieldError(f"{field} must be between {minimum} and {maximum}", field)
    return value


def required_int(
    data: Mapping[str, Any], field: str, minimum: int, maximum: int
) -> int:
    if data.get(field) is None:
        raise FieldError(f"{field} is required", field)
    return integer_in_range(data[field], field, minimum, maximum)


def optional_int(
    data: Mapping[str, Any], field: str, minimum: int, maximum: int
) -> int | None:
    if data.get(field) is None:
        return None
    return integer_in_range(data[field], field, minimum, maximum)


def required_bool(data: Mapping[str, Any], field: str) -> bool:
    value = data.get(field)
    if not isinstance(value, bool):
        raise FieldError(f"{field} must be true or false", field)
    return value


def optional_bool(data: Mapping[str, Any], field: str) -> bool | None:
    if data.get(field) is None:
        return None
    return required_bool(data, field)


def required_choice(
    data: Mapping[str, Any], field: str, choices: Collection[str]
) -> str:
    value = data.get(field)
    if not isinstance(value, str) or value not in choices:
        raise FieldError(f"{field} must be one of: {', '.join(sorted(choices))}", field)
    return value


def optional_choice(
    data: Mapping[str, Any], field: str, choices: Collection[str]
) -> str | None:
    if data.get(field) is None:
        return None
    return required_choice(data, field, choices)


def optional_utc_datetime(data: Mapping[str, Any], field: str) -> datetime | None:
    value = data.get(field)
    if value is None:
        return None
    message = f"{field} must be an ISO 8601 time with a time zone"
    if not isinstance(value, str) or len(value) > 40:
        raise FieldError(message, field)
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise FieldError(message, field) from None
    if parsed.tzinfo is None:
        raise FieldError(message, field)
    try:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except OverflowError:
        raise FieldError(message, field) from None


def object_id(value: Any, field: str) -> ObjectId:
    if not isinstance(value, str) or not ObjectId.is_valid(value):
        raise FieldError(f"{field} is not a valid identifier", field, "invalid_id")
    return ObjectId(value)


def query_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = request.args.get(name, type=int)
    if value is None:
        return default
    return max(minimum, min(value, maximum))


def query_flag(name: str, default: bool) -> bool:
    value = request.args.get(name)
    if value is None:
        return default
    return value.lower() == "true"


def pagination(default_per_page: int = 25, max_per_page: int = 100) -> tuple[int, int]:
    return (
        query_int("page", 1, 1, MAX_PAGE),
        query_int("per_page", default_per_page, 1, max_per_page),
    )
