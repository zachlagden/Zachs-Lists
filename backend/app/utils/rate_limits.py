import time
from collections.abc import Callable

from flask import Flask, Response, current_app, jsonify, request, session
from flask_limiter import Limiter, RateLimitExceeded

from app.utils.client_ip import get_client_ip


def rate_limit_key() -> str:
    if request.path.startswith("/api/"):
        user_id = session.get("user_id")
        if isinstance(user_id, str) and user_id:
            return f"user:{user_id}"
    return f"ip:{get_client_ip()}"


def configured_limit(config_key: str) -> Callable[[], str]:
    def limit() -> str:
        return str(current_app.config[config_key])

    return limit


def register_rate_limit_responses(app: Flask, limiter: Limiter) -> None:
    @app.errorhandler(RateLimitExceeded)
    def too_many_requests(error: RateLimitExceeded) -> tuple[Response, int]:
        breached = limiter.current_limit
        retry_after = 1
        if breached is not None:
            retry_after = max(1, int(breached.reset_at - time.time()))
        response = jsonify(
            {
                "error": "Too many requests. Try again shortly.",
                "code": "rate_limited",
                "retry_after": retry_after,
            }
        )
        response.headers["Retry-After"] = str(retry_after)
        return response, 429
