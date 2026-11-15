"""
Admin blueprint - user management, system stats, default list management.
"""

from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, current_app
from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.blueprints.auth import admin_required
from app.extensions import limiter, mongo
from app.models.user import User
from app.models.job import Job
from app.models.cache import CacheMetadata
from app.models.analytics import Analytics
from app.models.system_config import SystemConfig
from app.models.blocklist_library import BlocklistLibrary
from app.models.announcement import Announcement
from app.models.featured_list import FeaturedList
from app.models.limit_request import LimitRequest
from app.services.admin_forms import (
    MAX_DESCRIPTION_LENGTH,
    DefaultConfigCheckUnavailable,
    announcement_fields,
    approved_limit,
    default_config_fields,
    library_entry_fields,
    limit_changes,
    review_response,
)
from app.services.build_admission import DEFAULT_TARGET, AdmissionError, admit_build
from app.services import default_refresh, default_sync
from app.services.job_feed import job_payload, job_payloads
from app.services import limit_review
from app.services.site_stats import storage_bytes
from app.utils.rate_limits import configured_limit
from app.utils.request_fields import (
    json_object,
    object_id,
    optional_bool,
    optional_string,
    pagination,
    query_flag,
    query_int,
    register_field_errors,
    required_bool,
    required_choice,
    required_string,
)
from app.utils.time import utc_iso

admin_bp = Blueprint("admin", __name__)
register_field_errors(admin_bp)

MAX_SEARCH_LENGTH = 100
MAX_BAN_REASON_LENGTH = 500
BAN_DURATIONS = {
    "1d": timedelta(days=1),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "permanent": User.PERMANENT_BAN,
}
ALREADY_HANDLED = {
    "error": "This request was already handled",
    "code": "already_handled",
}


@admin_bp.route("/users", methods=["GET"])
@admin_required
def list_users(user: User):
    """List users with server-side pagination, search, and filtering."""
    page, per_page = pagination()
    search = request.args.get("search", "", type=str).strip()[:MAX_SEARCH_LENGTH]

    show_admins = query_flag("show_admins", True)
    show_regular = query_flag("show_regular", True)
    show_enabled = query_flag("show_enabled", True)
    show_disabled = query_flag("show_disabled", True)

    # Get filtered users (exclude current user)
    users, total = User.get_all_filtered(
        page=page,
        per_page=per_page,
        search=search or None,
        show_admins=show_admins,
        show_regular=show_regular,
        show_enabled=show_enabled,
        show_disabled=show_disabled,
        exclude_user_id=ObjectId(user.id),
    )

    return jsonify(
        {
            "users": [u.to_admin_dict() for u in users],
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total > 0 else 1,
        }
    )


@admin_bp.route("/users/<user_id>", methods=["GET"])
@admin_required
def get_user(admin: User, user_id: str):
    """Get user details."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(target_user.to_admin_dict())


@admin_bp.route("/users/<user_id>", methods=["PUT"])
@admin_required
def update_user(admin: User, user_id: str):
    """Update user settings."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Protect root user from all modifications
    if target_user.is_root:
        return jsonify({"error": "Cannot modify root user"}), 403

    # Non-root admins cannot modify other admins or themselves
    if not admin.is_root and (target_user.is_admin or target_user.id == admin.id):
        return jsonify({"error": "Only root can manage admins"}), 403

    data = json_object()
    is_enabled = optional_bool(data, "is_enabled")
    changes = limit_changes(data["limits"]) if data.get("limits") is not None else None

    if is_enabled is not None:
        target_user.set_enabled(is_enabled)
        current_app.logger.info(
            f"Admin {admin.username} set user {target_user.username} enabled={is_enabled}"
        )

    if changes is not None:
        target_user.apply_limits(changes)
        limit_review.limit_changed(target_user, admin.username)
        current_app.logger.info(
            f"Admin {admin.username} updated limits for user {target_user.username}"
        )

    target_user = User.get_by_id(user_id)
    if target_user is None:
        return jsonify({"error": "User not found"}), 404
    return jsonify(target_user.to_admin_dict())


@admin_bp.route("/users/<user_id>", methods=["DELETE"])
@admin_required
def delete_user(admin: User, user_id: str):
    """Delete user and their data."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Protect root user from deletion
    if target_user.is_root:
        return jsonify({"error": "Cannot delete root user"}), 403

    # Non-root admins cannot delete other admins or themselves
    if not admin.is_root and (target_user.is_admin or target_user.id == admin.id):
        return jsonify({"error": "Only root can manage admins"}), 403

    username = target_user.username
    target_user.delete_with_data()

    current_app.logger.info(f"Admin {admin.username} deleted user {username}")

    return jsonify({"success": True, "message": f"User {username} deleted"})


@admin_bp.route("/users/<user_id>/ban", methods=["POST"])
@admin_required
def ban_user(admin: User, user_id: str):
    """Ban a user."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Protect root user from ban
    if target_user.is_root:
        return jsonify({"error": "Cannot ban root user"}), 403

    # Non-root admins cannot ban other admins or themselves
    if not admin.is_root and (target_user.is_admin or target_user.id == admin.id):
        return jsonify({"error": "Only root can manage admins"}), 403

    data = json_object()
    duration = required_choice(data, "duration", BAN_DURATIONS)
    reason = optional_string(data, "reason", MAX_BAN_REASON_LENGTH) or None

    ban_until = datetime.utcnow() + BAN_DURATIONS[duration]
    target_user.ban(until=ban_until, reason=reason)

    current_app.logger.info(
        f"Admin {admin.username} banned user {target_user.username} until {ban_until} (reason: {reason})"
    )

    return jsonify(
        {
            "success": True,
            "message": f"User {target_user.username} banned until {ban_until.isoformat()}",
            "banned_until": utc_iso(ban_until),
        }
    )


@admin_bp.route("/users/<user_id>/unban", methods=["POST"])
@admin_required
def unban_user(admin: User, user_id: str):
    """Unban a user."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    if not target_user.is_banned:
        return jsonify({"error": "User is not banned"}), 400

    target_user.unban()

    current_app.logger.info(
        f"Admin {admin.username} unbanned user {target_user.username}"
    )

    return jsonify(
        {"success": True, "message": f"User {target_user.username} unbanned"}
    )


@admin_bp.route("/users/<user_id>/admin", methods=["PUT"])
@admin_required
def toggle_user_admin(admin: User, user_id: str):
    """Toggle admin status for a user. Only root can do this."""
    # Only root can change admin status
    if not admin.is_root:
        return jsonify({"error": "Only root can modify admin status"}), 403

    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Cannot modify root user's admin status
    if target_user.is_root:
        return jsonify({"error": "Cannot modify root user"}), 403

    is_admin = required_bool(json_object(), "is_admin")

    target_user.set_admin(is_admin)

    current_app.logger.info(
        f"Root {admin.username} set admin status for {target_user.username} to {is_admin}"
    )

    target_user = User.get_by_id(user_id)
    if target_user is None:
        return jsonify({"error": "User not found"}), 404
    return jsonify(target_user.to_admin_dict())


@admin_bp.route("/users/<user_id>/ips", methods=["GET"])
@admin_required
def get_user_ips(admin: User, user_id: str):
    """Get user's IP access log."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    ip_log = target_user.serialized_ip_log()

    return jsonify(
        {
            "username": target_user.username,
            "ip_count": len(ip_log),
            "ip_log": ip_log,
        }
    )


@admin_bp.route("/rebuild/<user_id>", methods=["POST"])
@admin_required
def trigger_rebuild(admin: User, user_id: str):
    """Trigger rebuild for user (bypasses limits)."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Protect root user from forced rebuild
    if target_user.is_root:
        return jsonify({"error": "Cannot force rebuild for root user"}), 403

    # Non-root admins cannot rebuild other admins or themselves
    if not admin.is_root and (target_user.is_admin or target_user.id == admin.id):
        return jsonify({"error": "Only root can manage admins"}), 403

    try:
        job = admit_build(
            target_user, Job.TYPE_ADMIN, requested_by=admin, force_rebuild=True
        )
    except AdmissionError as refusal:
        return jsonify(refusal.to_response()), refusal.status

    current_app.logger.info(
        f"Admin {admin.username} triggered rebuild for user {target_user.username}: {job.job_id}"
    )

    return jsonify({"job_id": job.job_id, "status": job.status})


@admin_bp.route("/rebuild/default", methods=["POST"])
@admin_required
def trigger_default_rebuild(admin: User):
    """Trigger rebuild for default lists."""
    try:
        job = admit_build(
            DEFAULT_TARGET, Job.TYPE_ADMIN, requested_by=admin, force_rebuild=True
        )
    except AdmissionError as refusal:
        return jsonify(refusal.to_response()), refusal.status

    current_app.logger.info(
        f"Admin {admin.username} triggered default lists rebuild: {job.job_id}"
    )

    return jsonify({"job_id": job.job_id, "status": job.status})


@admin_bp.route("/jobs", methods=["GET"])
@limiter.limit(configured_limit("RATELIMIT_JOBS"))
@admin_required
def list_all_jobs(admin: User):
    """List all jobs."""
    limit = query_int("limit", 50, 1, 200)
    jobs = Job.get_recent(limit=limit)

    return jsonify({"jobs": job_payloads(jobs)})


@admin_bp.route("/jobs/<job_id>", methods=["GET"])
@limiter.limit(configured_limit("RATELIMIT_JOBS"))
@admin_required
def get_admin_job(admin: User, job_id: str):
    """Get job details for admin."""
    job = Job.get_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job_payload(job))


@admin_bp.route("/stats", methods=["GET"])
@limiter.limit(configured_limit("RATELIMIT_ADMIN_STATS"))
@admin_required
def get_stats(admin: User):
    """Get system-wide statistics."""
    # User stats
    total_users = User.count()
    active_users = User.count(is_enabled=True)

    # Job stats
    jobs_today = Job.count_today()
    jobs_processing = Job.count_processing()
    queue_length = Job.count_queued()

    # Cache stats
    cache_size = CacheMetadata.get_total_size()

    # Analytics stats
    analytics = Analytics.get_default_list_totals()

    disk_usage = storage_bytes(current_app.config["DATA_DIR"])

    return jsonify(
        {
            "users": {
                "total": total_users,
                "active": active_users,
            },
            "jobs": {
                "today": jobs_today,
                "processing": jobs_processing,
                "queued": queue_length,
            },
            "storage": {
                "cache_bytes": cache_size,
                "total_bytes": disk_usage,
                "cache_mb": round(cache_size / (1024 * 1024), 2),
                "total_mb": round(disk_usage / (1024 * 1024), 2),
            },
            "analytics": analytics,
            "limits": {
                "enforce_domain_limit": limit_review.enforcing_domain_limit(),
            },
        }
    )


@admin_bp.route("/stats/jobs-per-day", methods=["GET"])
@admin_required
def get_jobs_per_day(admin: User):
    """Get jobs per day for the last N days."""
    days = query_int("days", 30, 1, 365)
    start_date = datetime.utcnow() - timedelta(days=days)

    pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {
            "$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "count": {"$sum": 1},
                "completed": {
                    "$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}
                },
                "failed": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
            }
        },
        {"$sort": {"_id": 1}},
    ]

    results = list(mongo.db.jobs.aggregate(pipeline))

    return jsonify(
        {
            "jobs_per_day": [
                {
                    "date": r["_id"],
                    "total": r["count"],
                    "completed": r["completed"],
                    "failed": r["failed"],
                }
                for r in results
            ]
        }
    )


@admin_bp.route("/stats/user-growth", methods=["GET"])
@admin_required
def get_user_growth(admin: User):
    """Get user signup growth over time."""
    days = query_int("days", 30, 1, 365)
    start_date = datetime.utcnow() - timedelta(days=days)

    pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {
            "$group": {
                "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
                "count": {"$sum": 1},
            }
        },
        {"$sort": {"_id": 1}},
    ]

    results = list(mongo.db.users.aggregate(pipeline))

    # Also get cumulative total over time
    total_before = mongo.db.users.count_documents({"created_at": {"$lt": start_date}})
    cumulative = total_before

    growth_data = []
    for r in results:
        cumulative += r["count"]
        growth_data.append(
            {"date": r["_id"], "new_users": r["count"], "total_users": cumulative}
        )

    return jsonify({"user_growth": growth_data})


@admin_bp.route("/default/config", methods=["GET"])
@admin_required
def get_default_config(admin: User):
    """Get default lists configuration from MongoDB."""
    config_data = SystemConfig.get_default_config()
    status = default_sync.sync_status()
    return jsonify(
        {
            "config": config_data["blocklists"],
            "whitelist": config_data["whitelist"],
            "sync_enabled": status["sync_enabled"],
            "source": status["source"],
        }
    )


@admin_bp.route("/default/config", methods=["PUT"])
@admin_required
def update_default_config(admin: User):
    """Update default lists configuration in MongoDB."""
    if default_sync.sync_enabled():
        return (
            jsonify(
                {
                    "error": "The default lists are synced from "
                    f"{current_app.config['DEFAULT_SYNC_REPO']}. Change them there.",
                    "code": "default_config_managed",
                }
            ),
            409,
        )
    try:
        fields = default_config_fields(json_object())
    except DefaultConfigCheckUnavailable:
        return (
            jsonify(
                {
                    "error": "The whitelist could not be checked, so nothing was saved. Try again shortly.",
                    "code": "validation_unavailable",
                }
            ),
            503,
        )

    SystemConfig.update_default_config(
        fields["blocklists"], fields["whitelist"], admin.username
    )
    if fields["blocklists"] is not None:
        current_app.logger.info(
            f"Admin {admin.username} updated default blocklist config"
        )
    if fields["whitelist"] is not None:
        current_app.logger.info(f"Admin {admin.username} updated default whitelist")

    return jsonify({"success": True})


@admin_bp.route("/default/sync", methods=["GET"])
@admin_required
def get_default_sync(admin: User):
    return jsonify(default_sync.sync_status())


@admin_bp.route("/default/sync", methods=["POST"])
@limiter.limit(configured_limit("RATELIMIT_DEFAULT_SYNC"))
@admin_required
def run_default_sync(admin: User):
    force = optional_bool(json_object(), "force") or False
    if not default_sync.sync_enabled():
        return (
            jsonify(
                {
                    "error": "Default list sync is switched off",
                    "code": "default_sync_disabled",
                }
            ),
            409,
        )
    result = default_refresh.sync_now(force)
    current_app.logger.info(
        f"Admin {admin.username} ran the default list sync: "
        f"{result.sync.status if result.sync else 'not run'}"
    )
    return jsonify({**result.to_dict(), **default_sync.sync_status()})


@admin_bp.route("/featured", methods=["GET"])
@admin_required
def get_featured_lists(admin: User):
    """Get featured community lists."""
    return jsonify(
        {"featured": [entry.to_dict() for entry in FeaturedList.all_ordered()]}
    )


@admin_bp.route("/featured", methods=["POST"])
@admin_required
def add_featured_list(admin: User):
    """Add a list to featured."""
    data = json_object()
    username = required_string(data, "username", 100)
    list_name = required_string(data, "list_name", 100)
    description = optional_string(data, "description", MAX_DESCRIPTION_LENGTH) or ""

    target_user = User.get_by_username(username)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    if not target_user.get_list(list_name):
        return jsonify({"error": "List not found"}), 404

    if FeaturedList.exists(username, list_name):
        return (
            jsonify(
                {"error": "This list is already featured", "code": "already_featured"}
            ),
            409,
        )

    entry = FeaturedList.add(username, list_name, description, admin.username)

    current_app.logger.info(
        f"Admin {admin.username} added featured list: {username}/{list_name}"
    )

    featured = entry.to_dict()
    return jsonify({"success": True, "id": featured["id"], "featured": featured})


@admin_bp.route("/featured/<featured_id>", methods=["DELETE"])
@admin_required
def remove_featured_list(admin: User, featured_id: str):
    """Remove a list from featured."""
    if not FeaturedList.remove(object_id(featured_id, "featured_id")):
        return jsonify({"error": "Featured list not found"}), 404

    current_app.logger.info(
        f"Admin {admin.username} removed featured list: {featured_id}"
    )

    return jsonify({"success": True})


# Limit Request Management


@admin_bp.route("/limit-requests", methods=["GET"])
@admin_required
def get_limit_requests(admin: User):
    """Get all limit requests (optionally filtered by status)."""
    status = request.args.get("status")  # pending, approved, denied

    if status:
        if status == "pending":
            requests = LimitRequest.get_pending()
        else:
            requests = LimitRequest.get_by_status(status)
    else:
        # Get all pending first, then recent approved/denied
        pending = LimitRequest.get_pending()
        approved = LimitRequest.get_by_status(LimitRequest.STATUS_APPROVED, limit=20)
        denied = LimitRequest.get_by_status(LimitRequest.STATUS_DENIED, limit=20)
        requests = pending + approved + denied

    pending_count = LimitRequest.count_pending()

    return jsonify(
        {
            "requests": [r.to_dict() for r in requests],
            "pending_count": pending_count,
        }
    )


@admin_bp.route("/limit-requests/<request_id>/approve", methods=["POST"])
@admin_required
def approve_limit_request(admin: User, request_id: str):
    """Approve a limit request."""
    limit_request = LimitRequest.get_by_id(request_id)
    if not limit_request:
        return jsonify({"error": "Request not found"}), 404

    data = json_object()
    custom_limit = approved_limit(data, limit_request)
    response_message = review_response(data)

    if not limit_request.approve(
        admin_username=admin.username,
        approved_limit=custom_limit,
        response=response_message,
    ):
        return jsonify(ALREADY_HANDLED), 409

    current_app.logger.info(
        f"Admin {admin.username} approved limit request {request_id} "
        f"(limit: {limit_request.approved_limit:,})"
    )

    return jsonify({"success": True, "request": limit_request.to_dict()})


@admin_bp.route("/limit-requests/<request_id>/deny", methods=["POST"])
@admin_required
def deny_limit_request(admin: User, request_id: str):
    """Deny a limit request."""
    limit_request = LimitRequest.get_by_id(request_id)
    if not limit_request:
        return jsonify({"error": "Request not found"}), 404

    response_message = review_response(json_object())

    if not limit_request.deny(admin_username=admin.username, response=response_message):
        return jsonify(ALREADY_HANDLED), 409

    current_app.logger.info(f"Admin {admin.username} denied limit request {request_id}")

    return jsonify({"success": True, "request": limit_request.to_dict()})


@admin_bp.route("/limit-reviews", methods=["GET"])
@admin_required
def get_limit_reviews(admin: User):
    page, per_page = pagination()
    reviews, total = limit_review.open_reviews(page, per_page)
    return jsonify(
        {
            "reviews": reviews,
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if total > 0 else 1,
        }
    )


@admin_bp.route("/limit-reviews/<user_id>/resolve", methods=["POST"])
@admin_required
def resolve_limit_review(admin: User, user_id: str):
    target_id = object_id(user_id, "user_id")
    reason = required_string(
        json_object(), "reason", limit_review.MAX_RESOLVE_REASON_LENGTH
    )
    if not limit_review.resolve_by_admin(target_id, admin.username, reason):
        return (
            jsonify(
                {"error": "This user has no open limit review", "code": "not_open"}
            ),
            404,
        )

    current_app.logger.info(
        f"Admin {admin.username} resolved the limit review for user {user_id}"
    )

    return jsonify({"success": True})


# Blocklist Library Management


@admin_bp.route("/library", methods=["GET"])
@admin_required
def get_library(admin: User):
    """Get all blocklist library entries."""
    category = request.args.get("category")

    if category:
        entries = BlocklistLibrary.get_all(category=category)
    else:
        entries = BlocklistLibrary.get_all()

    return jsonify(
        {
            "library": [e.to_dict() for e in entries],
            "categories": sorted(BlocklistLibrary.VALID_CATEGORIES),
        }
    )


@admin_bp.route("/library", methods=["POST"])
@admin_required
def add_library_entry(admin: User):
    """Add a new entry to the blocklist library."""
    fields = library_entry_fields(json_object(), partial=False)

    if BlocklistLibrary.url_exists(fields["url"]):
        return jsonify({"error": "URL already exists in library"}), 409

    try:
        entry = BlocklistLibrary.create(**fields, added_by=admin.username)
    except DuplicateKeyError:
        return jsonify({"error": "URL already exists in library"}), 409

    current_app.logger.info(
        f"Admin {admin.username} added library entry: {entry.name} ({entry.category})"
    )

    return jsonify({"success": True, "entry": entry.to_dict()}), 201


@admin_bp.route("/library/<entry_id>", methods=["GET"])
@admin_required
def get_library_entry(admin: User, entry_id: str):
    """Get a specific library entry."""
    entry = BlocklistLibrary.get_by_id(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404

    return jsonify(entry.to_dict())


@admin_bp.route("/library/<entry_id>", methods=["PUT"])
@admin_required
def update_library_entry(admin: User, entry_id: str):
    """Update a library entry."""
    entry = BlocklistLibrary.get_by_id(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404

    fields = library_entry_fields(json_object(), partial=True)

    if "url" in fields and BlocklistLibrary.url_exists(
        fields["url"], exclude_id=entry_id
    ):
        return jsonify({"error": "URL already exists in library"}), 409

    try:
        entry.update(**fields)
    except DuplicateKeyError:
        return jsonify({"error": "URL already exists in library"}), 409

    current_app.logger.info(f"Admin {admin.username} updated library entry: {entry_id}")

    entry = BlocklistLibrary.get_by_id(entry_id)
    if entry is None:
        return jsonify({"error": "Entry not found"}), 404
    return jsonify(
        {
            "success": True,
            "entry": entry.to_dict(),
        }
    )


@admin_bp.route("/library/<entry_id>", methods=["DELETE"])
@admin_required
def delete_library_entry(admin: User, entry_id: str):
    """Delete a library entry."""
    entry = BlocklistLibrary.get_by_id(entry_id)
    if not entry:
        return jsonify({"error": "Entry not found"}), 404

    name = entry.name
    entry.delete()

    current_app.logger.info(
        f"Admin {admin.username} deleted library entry: {name} ({entry_id})"
    )

    return jsonify({"success": True})


# Announcement Management


@admin_bp.route("/announcements", methods=["GET"])
@admin_required
def list_announcements(admin: User):
    """List all announcements for admin management."""
    limit = query_int("limit", 50, 1, 200)
    announcements = Announcement.get_all(limit=limit)
    return jsonify({"announcements": [a.to_dict() for a in announcements]})


@admin_bp.route("/announcements", methods=["POST"])
@admin_required
def create_announcement(admin: User):
    """Create a new announcement."""
    fields = announcement_fields(json_object(), partial=False)
    title = fields["title"]

    announcement = Announcement.create(
        title=title,
        message=fields["message"],
        type=fields.get("type", "info"),
        expires_at=fields["expires_at"],
        created_by=admin.username,
    )

    current_app.logger.info(f"Admin {admin.username} created announcement: {title}")

    return jsonify({"success": True, "announcement": announcement.to_dict()}), 201


@admin_bp.route("/announcements/<announcement_id>", methods=["PUT"])
@admin_required
def update_announcement(admin: User, announcement_id: str):
    """Update an announcement."""
    announcement = Announcement.get_by_id(announcement_id)
    if not announcement:
        return jsonify({"error": "Announcement not found"}), 404

    announcement.update(**announcement_fields(json_object(), partial=True))

    current_app.logger.info(
        f"Admin {admin.username} updated announcement {announcement_id}"
    )

    announcement = Announcement.get_by_id(announcement_id)
    if announcement is None:
        return jsonify({"error": "Announcement not found"}), 404
    return jsonify({"success": True, "announcement": announcement.to_dict()})


@admin_bp.route("/announcements/<announcement_id>", methods=["DELETE"])
@admin_required
def delete_announcement(admin: User, announcement_id: str):
    """Delete an announcement."""
    announcement = Announcement.get_by_id(announcement_id)
    if not announcement:
        return jsonify({"error": "Announcement not found"}), 404

    title = announcement.title
    announcement.delete()

    current_app.logger.info(
        f"Admin {admin.username} deleted announcement: {title} ({announcement_id})"
    )

    return jsonify({"success": True})
