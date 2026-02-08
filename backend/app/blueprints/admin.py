"""
Admin blueprint - user management, system stats, default list management.
"""

import os
from flask import Blueprint, request, jsonify, current_app
from bson import ObjectId

from app.blueprints.auth import admin_required
from app.models.user import User
from app.models.job import Job
from app.models.cache import CacheMetadata
from app.models.analytics import Analytics
from app.models.system_config import SystemConfig
from app.models.blocklist_library import BlocklistLibrary

admin_bp = Blueprint("admin", __name__)


@admin_bp.route("/users", methods=["GET"])
@admin_required
def list_users(user: User):
    """List users with server-side pagination, search, and filtering."""
    # Pagination
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 25, type=int)
    per_page = min(per_page, 100)  # Cap at 100

    # Search
    search = request.args.get("search", "", type=str).strip() or None

    # Filters (default all True)
    show_admins = request.args.get("show_admins", "true").lower() == "true"
    show_regular = request.args.get("show_regular", "true").lower() == "true"
    show_enabled = request.args.get("show_enabled", "true").lower() == "true"
    show_disabled = request.args.get("show_disabled", "true").lower() == "true"

    # Get filtered users (exclude current user)
    users, total = User.get_all_filtered(
        page=page,
        per_page=per_page,
        search=search,
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

    data = request.get_json()

    # Update enabled status
    if "is_enabled" in data:
        target_user.set_enabled(data["is_enabled"])
        current_app.logger.info(
            f"Admin {admin.username} set user {target_user.username} enabled={data['is_enabled']}"
        )

    # Update limits
    if "limits" in data:
        target_user.set_limits(data["limits"])
        current_app.logger.info(
            f"Admin {admin.username} updated limits for user {target_user.username}"
        )

    # Refresh user data
    target_user = User.get_by_id(user_id)
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
    from datetime import datetime, timedelta

    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Protect root user from ban
    if target_user.is_root:
        return jsonify({"error": "Cannot ban root user"}), 403

    # Non-root admins cannot ban other admins or themselves
    if not admin.is_root and (target_user.is_admin or target_user.id == admin.id):
        return jsonify({"error": "Only root can manage admins"}), 403

    data = request.get_json()
    duration = data.get("duration")  # "1d", "7d", "30d", "permanent"
    reason = data.get("reason")

    # Calculate ban expiration
    duration_map = {
        "1d": timedelta(days=1),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "permanent": timedelta(days=36500),  # ~100 years
    }

    if duration not in duration_map:
        return (
            jsonify({"error": "Invalid duration. Use: 1d, 7d, 30d, or permanent"}),
            400,
        )

    ban_until = datetime.utcnow() + duration_map[duration]
    target_user.ban(until=ban_until, reason=reason)

    current_app.logger.info(
        f"Admin {admin.username} banned user {target_user.username} until {ban_until} (reason: {reason})"
    )

    return jsonify(
        {
            "success": True,
            "message": f"User {target_user.username} banned until {ban_until.isoformat()}",
            "banned_until": ban_until.isoformat(),
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

    data = request.get_json()
    is_admin = data.get("is_admin", False)

    target_user.set_admin(is_admin)

    current_app.logger.info(
        f"Root {admin.username} set admin status for {target_user.username} to {is_admin}"
    )

    # Refresh and return updated user
    target_user = User.get_by_id(user_id)
    return jsonify(target_user.to_admin_dict())


@admin_bp.route("/users/<user_id>/ips", methods=["GET"])
@admin_required
def get_user_ips(admin: User, user_id: str):
    """Get user's IP access log."""
    target_user = User.get_by_id(user_id)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    # Serialize IP log with proper datetime formatting
    ip_log = [
        {
            "ip_hash": entry.get("ip_hash"),
            "first_seen": (
                entry["first_seen"].isoformat() if entry.get("first_seen") else None
            ),
            "last_seen": (
                entry["last_seen"].isoformat() if entry.get("last_seen") else None
            ),
            "access_count": entry.get("access_count", 0),
        }
        for entry in target_user.ip_log
    ]

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

    # Check if user has config
    config = target_user.get_config("blocklists.conf")
    if not config:
        return jsonify({"error": "User has no blocklist configuration"}), 400

    from app.services.job_queue import JobQueue

    job = JobQueue.queue_job(target_user, job_type=Job.TYPE_ADMIN)

    current_app.logger.info(
        f"Admin {admin.username} triggered rebuild for user {target_user.username}: {job.job_id}"
    )

    return jsonify({"job_id": job.job_id, "status": job.status})


@admin_bp.route("/rebuild/default", methods=["POST"])
@admin_required
def trigger_default_rebuild(admin: User):
    """Trigger rebuild for default lists."""
    from app.services.job_queue import JobQueue

    job = JobQueue.queue_default_job(job_type=Job.TYPE_ADMIN)

    current_app.logger.info(
        f"Admin {admin.username} triggered default lists rebuild: {job.job_id}"
    )

    return jsonify({"job_id": job.job_id, "status": job.status})


@admin_bp.route("/jobs", methods=["GET"])
@admin_required
def list_all_jobs(admin: User):
    """List all jobs."""
    limit = request.args.get("limit", 50, type=int)
    jobs = Job.get_recent(limit=limit)

    return jsonify({"jobs": [j.to_dict() for j in jobs]})


@admin_bp.route("/jobs/<job_id>", methods=["GET"])
@admin_required
def get_admin_job(admin: User, job_id: str):
    """Get job details for admin."""
    job = Job.get_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job.to_dict())


@admin_bp.route("/stats", methods=["GET"])
@admin_required
def get_stats(admin: User):
    """Get system-wide statistics."""
    from app.services.job_queue import JobQueue

    # User stats
    total_users = User.count()
    active_users = User.count(is_enabled=True)

    # Job stats
    jobs_today = Job.count_today()
    jobs_processing = Job.count_processing()
    queue_length = JobQueue.queue_length()

    # Cache stats
    cache_size = CacheMetadata.get_total_size()

    # Analytics stats
    analytics = Analytics.get_default_list_totals()

    # Disk usage
    data_dir = current_app.config["DATA_DIR"]
    disk_usage = get_directory_size(data_dir)

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
        }
    )


@admin_bp.route("/stats/jobs-per-day", methods=["GET"])
@admin_required
def get_jobs_per_day(admin: User):
    """Get jobs per day for the last N days."""
    from datetime import datetime, timedelta
    from app.extensions import mongo

    days = request.args.get("days", 30, type=int)
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
    from datetime import datetime, timedelta
    from app.extensions import mongo

    days = request.args.get("days", 30, type=int)
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
    return jsonify(
        {
            "config": config_data["blocklists"],
            "whitelist": config_data["whitelist"],
        }
    )


@admin_bp.route("/default/config", methods=["PUT"])
@admin_required
def update_default_config(admin: User):
    """Update default lists configuration in MongoDB."""
    data = request.get_json()

    if "config" in data:
        SystemConfig.update_default_blocklists(data["config"], admin.username)
        current_app.logger.info(
            f"Admin {admin.username} updated default blocklist config"
        )

    if "whitelist" in data:
        SystemConfig.update_default_whitelist(data["whitelist"], admin.username)
        current_app.logger.info(f"Admin {admin.username} updated default whitelist")

    return jsonify({"success": True})


@admin_bp.route("/featured", methods=["GET"])
@admin_required
def get_featured_lists(admin: User):
    """Get featured community lists."""
    from app.extensions import mongo

    featured = list(mongo.db.featured_lists.find().sort("order", 1))

    return jsonify(
        {
            "featured": [
                {
                    "id": str(f["_id"]),
                    "username": f["username"],
                    "list_name": f["list_name"],
                    "description": f.get("description", ""),
                    "order": f.get("order", 0),
                }
                for f in featured
            ]
        }
    )


@admin_bp.route("/featured", methods=["POST"])
@admin_required
def add_featured_list(admin: User):
    """Add a list to featured."""
    from app.extensions import mongo
    from datetime import datetime

    data = request.get_json()
    username = data.get("username")
    list_name = data.get("list_name")
    description = data.get("description", "")

    # Validate user and list exist
    target_user = User.get_by_username(username)
    if not target_user:
        return jsonify({"error": "User not found"}), 404

    list_info = target_user.get_list(list_name)
    if not list_info:
        return jsonify({"error": "List not found"}), 404

    # Get next order number
    max_order = mongo.db.featured_lists.find_one(sort=[("order", -1)])
    next_order = (max_order.get("order", 0) + 1) if max_order else 1

    # Insert
    result = mongo.db.featured_lists.insert_one(
        {
            "username": username,
            "list_name": list_name,
            "description": description,
            "order": next_order,
            "created_at": datetime.utcnow(),
            "created_by": admin.username,
        }
    )

    current_app.logger.info(
        f"Admin {admin.username} added featured list: {username}/{list_name}"
    )

    return jsonify({"success": True, "id": str(result.inserted_id)})


@admin_bp.route("/featured/<featured_id>", methods=["DELETE"])
@admin_required
def remove_featured_list(admin: User, featured_id: str):
    """Remove a list from featured."""
    from app.extensions import mongo

    result = mongo.db.featured_lists.delete_one({"_id": ObjectId(featured_id)})

    if result.deleted_count == 0:
        return jsonify({"error": "Featured list not found"}), 404

    current_app.logger.info(
        f"Admin {admin.username} removed featured list: {featured_id}"
    )

    return jsonify({"success": True})


def get_directory_size(path: str) -> int:
    """Get total size of a directory."""
    total = 0
    try:
        for dirpath, dirnames, filenames in os.walk(path):
            for filename in filenames:
                filepath = os.path.join(dirpath, filename)
                try:
                    total += os.path.getsize(filepath)
                except OSError:
                    pass
    except Exception:
        pass
    return total


# Limit Request Management


@admin_bp.route("/limit-requests", methods=["GET"])
@admin_required
def get_limit_requests(admin: User):
    """Get all limit requests (optionally filtered by status)."""
    from app.models.limit_request import LimitRequest

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
    from app.models.limit_request import LimitRequest

    limit_request = LimitRequest.get_by_id(request_id)
    if not limit_request:
        return jsonify({"error": "Request not found"}), 404

    if limit_request.status != LimitRequest.STATUS_PENDING:
        return jsonify({"error": "Request is not pending"}), 400

    data = request.get_json() or {}
    custom_limit = data.get("custom_limit")
    response_message = data.get("response")

    # Validate custom limit if provided
    if custom_limit is not None:
        max_limit = current_app.config.get("MAX_DOMAINS_LIMIT", 10_000_000)
        if custom_limit < limit_request.current_limit:
            return (
                jsonify({"error": "Custom limit cannot be lower than current limit"}),
                400,
            )
        if custom_limit > max_limit:
            return jsonify({"error": f"Custom limit cannot exceed {max_limit:,}"}), 400

    # Approve the request
    limit_request.approve(
        admin_username=admin.username,
        approved_limit=custom_limit,
        response=response_message,
    )

    current_app.logger.info(
        f"Admin {admin.username} approved limit request {request_id} "
        f"(limit: {custom_limit or limit_request.requested_tier:,})"
    )

    # Return updated request
    limit_request = LimitRequest.get_by_id(request_id)
    return jsonify(
        {
            "success": True,
            "request": limit_request.to_dict(),
        }
    )


@admin_bp.route("/limit-requests/<request_id>/deny", methods=["POST"])
@admin_required
def deny_limit_request(admin: User, request_id: str):
    """Deny a limit request."""
    from app.models.limit_request import LimitRequest

    limit_request = LimitRequest.get_by_id(request_id)
    if not limit_request:
        return jsonify({"error": "Request not found"}), 404

    if limit_request.status != LimitRequest.STATUS_PENDING:
        return jsonify({"error": "Request is not pending"}), 400

    data = request.get_json() or {}
    response_message = data.get("response")

    # Deny the request
    limit_request.deny(
        admin_username=admin.username,
        response=response_message,
    )

    current_app.logger.info(f"Admin {admin.username} denied limit request {request_id}")

    # Return updated request
    limit_request = LimitRequest.get_by_id(request_id)
    return jsonify(
        {
            "success": True,
            "request": limit_request.to_dict(),
        }
    )


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
    data = request.get_json()

    url = data.get("url", "").strip()
    name = data.get("name", "").strip()
    category = data.get("category", "").strip()
    description = data.get("description", "").strip()
    recommended = data.get("recommended", False)
    aggressiveness = data.get("aggressiveness", 3)
    domain_count = data.get("domain_count", 0)

    # Validate required fields
    if not url:
        return jsonify({"error": "URL is required"}), 400
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if not category:
        return jsonify({"error": "Category is required"}), 400

    # Validate category
    if category not in BlocklistLibrary.VALID_CATEGORIES:
        return (
            jsonify(
                {
                    "error": f"Invalid category. Must be one of: {', '.join(sorted(BlocklistLibrary.VALID_CATEGORIES))}"
                }
            ),
            400,
        )

    # Validate URL format
    from app.utils.validators import validate_url

    if not validate_url(url):
        return jsonify({"error": "Invalid or unsafe URL"}), 400

    # Check for duplicate URL
    if BlocklistLibrary.url_exists(url):
        return jsonify({"error": "URL already exists in library"}), 409

    # Create entry
    entry = BlocklistLibrary.create(
        url=url,
        name=name,
        category=category,
        description=description,
        recommended=recommended,
        aggressiveness=aggressiveness,
        domain_count=domain_count,
        added_by=admin.username,
    )

    current_app.logger.info(
        f"Admin {admin.username} added library entry: {name} ({category})"
    )

    return (
        jsonify(
            {
                "success": True,
                "entry": entry.to_dict(),
            }
        ),
        201,
    )


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

    data = request.get_json()

    # Validate category if provided
    if "category" in data and data["category"] not in BlocklistLibrary.VALID_CATEGORIES:
        return (
            jsonify(
                {
                    "error": f"Invalid category. Must be one of: {', '.join(sorted(BlocklistLibrary.VALID_CATEGORIES))}"
                }
            ),
            400,
        )

    # Validate URL if provided
    if "url" in data:
        from app.utils.validators import validate_url

        if not validate_url(data["url"]):
            return jsonify({"error": "Invalid or unsafe URL"}), 400
        # Check for duplicate URL (excluding current entry)
        if BlocklistLibrary.url_exists(data["url"], exclude_id=entry_id):
            return jsonify({"error": "URL already exists in library"}), 409

    # Update entry
    entry.update(
        url=data.get("url"),
        name=data.get("name"),
        category=data.get("category"),
        description=data.get("description"),
        recommended=data.get("recommended"),
        aggressiveness=data.get("aggressiveness"),
        domain_count=data.get("domain_count"),
    )

    current_app.logger.info(f"Admin {admin.username} updated library entry: {entry_id}")

    # Return updated entry
    entry = BlocklistLibrary.get_by_id(entry_id)
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
