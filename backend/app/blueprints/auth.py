"""
Authentication blueprint - GitHub OAuth.
"""

import secrets
from functools import wraps
from flask import Blueprint, redirect, request, session, jsonify, current_app, url_for
import requests

from app.models.user import User

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

    query_string = "&".join(f"{k}={v}" for k, v in params.items())
    auth_url = f"{current_app.config['GITHUB_AUTHORIZE_URL']}?{query_string}"

    return redirect(auth_url)


@auth_bp.route("/callback")
def github_callback():
    """Handle GitHub OAuth callback."""
    error = request.args.get("error")
    if error:
        current_app.logger.error(f"GitHub OAuth error: {error}")
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error={error}")

    code = request.args.get("code")
    state = request.args.get("state")

    # Verify state
    if not state or state != session.get("oauth_state"):
        current_app.logger.error("OAuth state mismatch")
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=state_mismatch")

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
        token_data = token_response.json()

        if "error" in token_data:
            current_app.logger.error(f"Token exchange error: {token_data}")
            return redirect(
                f"{current_app.config['FRONTEND_URL']}/login?error=token_exchange_failed"
            )

        access_token = token_data.get("access_token")
        if not access_token:
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
        user_data = user_response.json()

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
            emails = emails_response.json()
            for e in emails:
                if e.get("primary"):
                    email = e.get("email")
                    break

        # Find or create user
        user = User.find_or_create_from_github(
            github_id=user_data["id"],
            username=user_data["login"],
            email=email,
            avatar_url=user_data.get("avatar_url"),
            access_token=access_token,
            name=user_data.get("name"),  # GitHub display name
        )

        # Check if user is admin - reject non-admins during development
        if not user.is_admin:
            current_app.logger.warning(f"Non-admin user {user.username} attempted login - rejected")
            return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=admin_only")

        # Set session
        session.permanent = True
        session["user_id"] = str(user.id)

        current_app.logger.info(f"Admin {user.username} logged in")
        return redirect(f"{current_app.config['FRONTEND_URL']}/dashboard")

    except requests.RequestException as e:
        current_app.logger.error(f"GitHub API error: {e}")
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=api_error")


@auth_bp.route("/logout", methods=["POST"])
def logout():
    """Clear user session."""
    session.clear()
    return jsonify({"success": True})


@auth_bp.route("/me")
@login_required
def get_current_user(user):
    """Get current authenticated user info."""
    # Log IP access for security tracking
    ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    if ip:
        # Take first IP if multiple (X-Forwarded-For can be comma-separated)
        ip = ip.split(",")[0].strip()
        user.log_ip_access(ip)

    return jsonify(user.to_dict())
