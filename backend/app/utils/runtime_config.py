from flask import Flask


def validate_runtime_config(app: Flask) -> None:
    if app.config.get("TESTING") or app.config.get("DEBUG"):
        return
    secret = app.config.get("SECRET_KEY")
    if (
        not isinstance(secret, str)
        or len(secret) < 32
        or secret == "dev-secret-key-change-in-production"
    ):
        raise ValueError("Production requires a strong session secret")
    root_id = app.config.get("ROOT_GITHUB_ID")
    if type(root_id) is not int or root_id <= 0:
        raise ValueError("Production requires an immutable root GitHub identifier")
    if not app.config.get("GITHUB_CLIENT_ID") or not app.config.get(
        "GITHUB_CLIENT_SECRET"
    ):
        raise ValueError("Production requires GitHub OAuth configuration")
