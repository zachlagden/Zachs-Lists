"""
Authentication blueprint - GitHub OAuth.
"""

import secrets
import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlencode
from functools import wraps
from flask import (
    Blueprint,
    Response,
    redirect,
    request,
    session,
    jsonify,
    current_app,
)
import requests

from app.extensions import limiter
from app.models.user import User
from app.utils.client_ip import get_client_ip
from app.utils.rate_limits import configured_limit
from app.utils.time import utc_iso

auth_bp = Blueprint("auth", __name__)


SessionRefusal = Literal["signed_out", "unknown_user", "stale", "disabled", "banned"]


@dataclass(frozen=True)
class SessionCheck:
    user: User | None
    refusal: SessionRefusal | None
    refused_account: User | None = None


def _session_refusal(user: User | None) -> SessionRefusal | None:
    if user is None:
        return "unknown_user"
    if session.get("auth_version", 0) != user.auth_version:
        return "stale"
    if not user.is_enabled:
        return "disabled"
    if user.is_banned:
        return "banned"
    return None


def check_session() -> SessionCheck:
    user_id = session.get("user_id")
    if not user_id:
        return SessionCheck(None, "signed_out")
    user = User.get_by_id(user_id)
    refusal = _session_refusal(user)
    if refusal is None:
        return SessionCheck(user, None)
    session.clear()
    return SessionCheck(None, refusal, user)


def session_user() -> User | None:
    return check_session().user


def _refusal_response(check: SessionCheck) -> tuple[Response, int]:
    if check.refusal == "signed_out":
        return jsonify({"error": "Authentication required"}), 401
    if check.refusal == "unknown_user":
        return jsonify({"error": "User not found"}), 401
    if check.refusal == "stale":
        return jsonify({"error": "Session expired; sign in again"}), 401
    if check.refusal == "disabled":
        return jsonify({"error": "Account disabled"}), 403
    ban_info: dict[str, str | None] = {"error": "Account banned"}
    account = check.refused_account
    if account is not None and account.ban_reason:
        ban_info["reason"] = account.ban_reason
    if account is not None and account.banned_until:
        ban_info["until"] = utc_iso(account.banned_until)
    return jsonify(ban_info), 403


def login_required(f):
    """Decorator to require authentication."""

    @wraps(f)
    def decorated(*args, **kwargs):
        check = check_session()
        if check.user is None:
            return _refusal_response(check)
        return f(check.user, *args, **kwargs)

    return decorated


def admin_required(f):
    """Decorator to require admin access."""

    @wraps(f)
    @login_required
    def decorated(user, *args, **kwargs):
        if not user.is_admin:
            return jsonify({"error": "Admin access required"}), 403
        return f(user, *args, **kwargs)

    return decorated


@auth_bp.route("/github")
def github_login():
    """Redirect to GitHub OAuth authorization page."""
    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)
    session["oauth_state"] = state

    params = {
        "client_id": current_app.config["GITHUB_CLIENT_ID"],
        "redirect_uri": current_app.config["GITHUB_REDIRECT_URI"],
        "scope": "read:user user:email",
        "state": state,
    }

    query_string = urlencode(params)
    auth_url = f"{current_app.config['GITHUB_AUTHORIZE_URL']}?{query_string}"

    return redirect(auth_url)


@auth_bp.route("/callback")
def github_callback():
    """Handle GitHub OAuth callback."""
    error = request.args.get("error")
    if error:
        current_app.logger.warning("GitHub declined OAuth authorisation")
        return redirect(
            f"{current_app.config['FRONTEND_URL']}/login?error=oauth_declined"
        )

    code = request.args.get("code")
    state = request.args.get("state")

    # Verify state
    if not state or state != session.get("oauth_state"):
        current_app.logger.error("OAuth state mismatch")
        return redirect(
            f"{current_app.config['FRONTEND_URL']}/login?error=state_mismatch"
        )

    session.pop("oauth_state", None)

    if not code:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=no_code")

    # Exchange code for access token
    try:
        token_response = requests.post(
            current_app.config["GITHUB_TOKEN_URL"],
            data={
                "client_id": current_app.config["GITHUB_CLIENT_ID"],
                "client_secret": current_app.config["GITHUB_CLIENT_SECRET"],
                "code": code,
                "redirect_uri": current_app.config["GITHUB_REDIRECT_URI"],
            },
            headers={"Accept": "application/json"},
            timeout=10,
        )
        token_response.raise_for_status()
        token_data = token_response.json()
        if not isinstance(token_data, dict):
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=api_error"
            )

        if "error" in token_data:
            current_app.logger.warning("GitHub token exchange was declined")
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=token_exchange_failed"
            )

        access_token = token_data.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=no_access_token"
            )

        # Get user info from GitHub
        user_response = requests.get(
            f"{current_app.config['GITHUB_API_URL']}/user",
            headers={
                "Authorization": f"token {access_token}",
                "Accept": "application/json",
            },
            timeout=10,
        )
        user_response.raise_for_status()
        user_data = user_response.json()
        if (
            not isinstance(user_data, dict)
            or type(user_data.get("id")) is not int
            or user_data["id"] <= 0
        ):
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=invalid_profile"
            )
        login = user_data.get("login")
        if not isinstance(login, str) or not re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?", login
        ):
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=invalid_profile"
            )

        # Get user email if not public
        email = user_data.get("email")
        if not email:
            emails_response = requests.get(
                f"{current_app.config['GITHUB_API_URL']}/user/emails",
                headers={
                    "Authorization": f"token {access_token}",
                    "Accept": "application/json",
                },
                timeout=10,
            )
            emails_response.raise_for_status()
            emails = emails_response.json()
            if not isinstance(emails, list):
                return redirect(
                    f"{current_app.config['FRONTEND_URL']}/login?error=api_error"
                )
            for e in emails:
                if isinstance(e, dict) and e.get("primary"):
                    email = e.get("email")
                    break

        # Find or create user
        user = User.find_or_create_from_github(
            github_id=user_data["id"],
            username=user_data["login"],
            email=email,
            avatar_url=user_data.get("avatar_url"),
            name=user_data.get("name"),  # GitHub display name
        )

        if not user.is_enabled:
            current_app.logger.info(f"Disabled user {user.username} refused at login")
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=account_disabled"
            )
        if user.is_banned:
            current_app.logger.info(f"Banned user {user.username} refused at login")
            refusal = {"error": "account_banned"}
            ban_ends_at = utc_iso(user.ban_ends_at)
            if ban_ends_at:
                refusal["until"] = ban_ends_at
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?{urlencode(refusal)}"
            )

        # Set session
        session.permanent = True
        session["user_id"] = str(user.id)
        session["auth_version"] = user.auth_version

        current_app.logger.info(f"User {user.username} logged in")
        return redirect(f"{current_app.config['FRONTEND_URL']}/dashboard")

    except requests.RequestException:
        current_app.logger.warning("GitHub login request failed")
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=api_error")
    except ValueError:
        current_app.logger.warning("GitHub account setup needs a retry")
        return redirect(
            f"{current_app.config['FRONTEND_URL']}/login?error=account_setup_retry"
        )


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """Clear user session."""
    user_id = session.get("user_id")
    if isinstance(user_id, str):
        user = User.get_by_id(user_id)
        if user is not None and session.get("auth_version", 0) == user.auth_version:
            user.revoke_sessions()
    session.clear()
    return jsonify({"success": True})


@auth_bp.route("/session")
@limiter.limit(configured_limit("RATELIMIT_AUTH_ME"))
def get_session() -> Response:
    user = session_user()
    if user is None:
        return jsonify({"user": None})
    ip = get_client_ip()
    if ip != "unknown":
        user.log_ip_access(ip)
    return jsonify({"user": user.to_dict()})


@auth_bp.route("/me")
@limiter.limit(configured_limit("RATELIMIT_AUTH_ME"))
@login_required
def get_current_user(user: User) -> Response:
    ip = get_client_ip()
    if ip != "unknown":
        user.log_ip_access(ip)

    return jsonify(user.to_dict())
