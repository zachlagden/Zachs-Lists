from flask import Blueprint, Response, jsonify, request

from app.blueprints.auth import admin_required, login_required
from app.models.analytics import Analytics
from app.models.user import User
from app.services.site_stats import public_report, public_stats

analytics_bp = Blueprint("analytics", __name__)


def requested_days() -> int:
    return Analytics.clamp_days(request.args.get("days", type=int))


@analytics_bp.route("/default", methods=["GET"])
def get_default_analytics() -> Response:
    return jsonify(public_report(requested_days()))


@analytics_bp.route("/user", methods=["GET"])
@login_required
def get_user_analytics(user: User) -> Response:
    return jsonify(
        Analytics.report(
            requested_days(), list_type=Analytics.TYPE_USER, username=user.username
        )
    )


@analytics_bp.route("/user/<list_name>", methods=["GET"])
@login_required
def get_user_list_analytics(
    user: User, list_name: str
) -> Response | tuple[Response, int]:
    if not user.get_list(list_name):
        return jsonify({"error": "List not found"}), 404
    report = Analytics.report(
        requested_days(),
        list_type=Analytics.TYPE_USER,
        username=user.username,
        list_name=list_name,
    )
    return jsonify({"list_name": list_name, **report})


@analytics_bp.route("/admin", methods=["GET"])
@admin_required
def get_admin_analytics(admin: User) -> Response:
    return jsonify(Analytics.admin_report(requested_days()))


@analytics_bp.route("/public/stats", methods=["GET"])
def get_public_stats() -> Response:
    return jsonify(public_stats())
