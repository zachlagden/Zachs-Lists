"""
Authentication blueprint - GitHub OAuth.
"""

import secrets
import re
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
    url_for,
)
import requests

from app.models.user import User
from app.utils.client_ip import get_client_ip

auth_bp = Blueprint("auth", __name__)


def login_required(f):
    """Decorator to require authentication."""

    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Authentication required"}), 401

        user = User.get_by_id(user_id)
        if not user:
            session.clear()
            return jsonify({"error": "User not found"}), 401

        if session.get("auth_version", 0) != user.auth_version:
            session.clear()
            return jsonify({"error": "Session expired; sign in again"}), 401

        if not user.is_enabled:
            session.clear()
            return jsonify({"error": "Account disabled"}), 403

        if user.is_banned:
            session.clear()
            ban_info = {"error": "Account banned"}
            if user.ban_reason:
                ban_info["reason"] = user.ban_reason
            if user.banned_until:
                ban_info["until"] = user.banned_until.isoformat()
            return jsonify(ban_info), 403

        return f(user, *args, **kwargs)

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


@auth_bp.route("/me")
@login_required
def get_current_user(user: User) -> Response:
    ip = get_client_ip()
    if ip != "unknown":
        user.log_ip_access(ip)

    return jsonify(user.to_dict())
