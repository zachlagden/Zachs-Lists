"""
Analytics blueprint - public and user analytics endpoints.
"""

from flask import Blueprint, request, jsonify, current_app

from app.blueprints.auth import login_required, admin_required
from app.models.user import User
from app.models.analytics import Analytics

analytics_bp = Blueprint("analytics", __name__)


@analytics_bp.route("/default", methods=["GET"])
def get_default_analytics():
    """Get public statistics for default lists."""
    days = request.args.get("days", 30, type=int)
    days = min(days, 90)  # Max 90 days

    # Get aggregated stats
    stats = Analytics.get_stats(list_type=Analytics.TYPE_DEFAULT, days=days)

    # Get daily breakdown for charts
    daily = Analytics.get_daily_stats(list_type=Analytics.TYPE_DEFAULT, days=days)

    # Get totals
    totals = Analytics.get_default_list_totals()

    return jsonify(
        {
            "period_days": days,
            "stats": stats,
            "daily": daily,
            "totals": totals,
        }
    )


@analytics_bp.route("/user", methods=["GET"])
@login_required
def get_user_analytics(user: User):
    """Get statistics for user's lists."""
    days = request.args.get("days", 30, type=int)
    days = min(days, 90)

    # Get aggregated stats
    stats = Analytics.get_stats(
        list_type=Analytics.TYPE_USER, username=user.username, days=days
    )

    # Get daily breakdown
    daily = Analytics.get_daily_stats(
        list_type=Analytics.TYPE_USER, username=user.username, days=days
    )

    # Get geo stats
    geo = Analytics.get_geo_stats(
        list_type=Analytics.TYPE_USER, username=user.username, days=days
    )

    return jsonify(
        {
            "period_days": days,
            "stats": stats,
            "daily": daily,
            "geo": geo,
        }
    )


@analytics_bp.route("/user/<list_name>", methods=["GET"])
@login_required
def get_user_list_analytics(user: User, list_name: str):
    """Get detailed statistics for a specific user list."""
    days = request.args.get("days", 30, type=int)
    days = min(days, 90)

    # Verify user owns this list
    list_info = user.get_list(list_name)
    if not list_info:
        return jsonify({"error": "List not found"}), 404

    # Get aggregated stats
    stats = Analytics.get_stats(
        list_type=Analytics.TYPE_USER,
        list_name=list_name,
        username=user.username,
        days=days,
    )

    # Get daily breakdown
    daily = Analytics.get_daily_stats(
        list_type=Analytics.TYPE_USER,
        list_name=list_name,
        username=user.username,
        days=days,
    )

    # Get geo stats
    geo = Analytics.get_geo_stats(
        list_type=Analytics.TYPE_USER,
        list_name=list_name,
        username=user.username,
        days=days,
    )

    return jsonify(
        {
            "list_name": list_name,
            "period_days": days,
            "stats": stats,
            "daily": daily,
            "geo": geo,
        }
    )


@analytics_bp.route("/admin", methods=["GET"])
@admin_required
def get_admin_analytics(admin: User):
    """Get system-wide analytics for admin."""
    days = request.args.get("days", 30, type=int)
    days = min(days, 90)

    # Get default list stats
    default_stats = Analytics.get_stats(list_type=Analytics.TYPE_DEFAULT, days=days)
    default_daily = Analytics.get_daily_stats(
        list_type=Analytics.TYPE_DEFAULT, days=days
    )
    default_geo = Analytics.get_geo_stats(list_type=Analytics.TYPE_DEFAULT, days=days)

    # Get user list stats (all users combined)
    user_stats = Analytics.get_stats(list_type=Analytics.TYPE_USER, days=days)
    user_daily = Analytics.get_daily_stats(list_type=Analytics.TYPE_USER, days=days)

    # Combined stats
    combined_stats = {
        "total_requests": default_stats["total_requests"]
        + user_stats["total_requests"],
        "total_bandwidth": default_stats["total_bandwidth"]
        + user_stats["total_bandwidth"],
        "total_unique_ips": default_stats["total_unique_ips"]
        + user_stats["total_unique_ips"],
    }

    return jsonify(
        {
            "period_days": days,
            "combined": combined_stats,
            "default_lists": {
                "stats": default_stats,
                "daily": default_daily,
                "geo": default_geo,
            },
            "user_lists": {
                "stats": user_stats,
                "daily": user_daily,
            },
        }
    )


@analytics_bp.route("/public/stats", methods=["GET"])
def get_public_stats():
    """Get public statistics for homepage display."""
    # Get total requests and domains
    totals = Analytics.get_default_list_totals()

    # Get user count
    user_count = User.count(is_enabled=True)

    # Get domain count from default lists
    import os

    default_dir = current_app.config["DEFAULT_DIR"]
    output_dir = os.path.join(default_dir, "output")

    total_domains = 0
    if os.path.exists(output_dir):
        all_domains_file = os.path.join(output_dir, "all_domains_hosts.txt")
        if os.path.exists(all_domains_file):
            # Read domain count from file header
            try:
                with open(all_domains_file, "r") as f:
                    for line in f:
                        if "Total domains:" in line:
                            total_domains = int(line.split(":")[-1].strip())
                            break
            except Exception:
                pass

    return jsonify(
        {
            "total_domains": total_domains,
            "total_requests": totals.get("total_requests", 0),
            "total_bandwidth_bytes": totals.get("total_bandwidth", 0),
            "user_count": user_count,
        }
    )
