from typing import Any

from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge


def register_input_checks(app: Flask) -> None:
    @app.before_request
    def check_json_object() -> tuple[Response, int] | None:
        if not request.path.startswith("/api/") or request.method not in (
            "POST",
            "PUT",
            "PATCH",
        ):
            return None
        if not request.content_length and not request.environ.get(
            "wsgi.input_terminated"
        ):
            return None
        if not request.is_json:
            return (
                jsonify({"error": "Expected a JSON object", "code": "invalid_json"}),
                415,
            )
        data: Any = request.get_json()
        if not isinstance(data, dict):
            return (
                jsonify({"error": "Expected a JSON object", "code": "invalid_json"}),
                400,
            )
        for name in ("config", "whitelist"):
            if name in data and not isinstance(data[name], str):
                return (
                    jsonify(
                        {"error": f"{name} must be a string", "code": "invalid_field"}
                    ),
                    400,
                )
            if name in data and len(data[name].encode("utf-8")) > 10 * 1024 * 1024:
                return (
                    jsonify(
                        {
                            "error": f"{name} exceeds the size limit",
                            "code": "input_too_large",
                        }
                    ),
                    413,
                )
        return None

    @app.errorhandler(BadRequest)
    def bad_request(error: BadRequest) -> tuple[Response, int]:
        return (
            jsonify({"error": "Invalid request body", "code": "invalid_request"}),
            400,
        )

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(error: RequestEntityTooLarge) -> tuple[Response, int]:
        return (
            jsonify(
                {
                    "error": "Request body exceeds the size limit",
                    "code": "input_too_large",
                }
            ),
            413,
        )
