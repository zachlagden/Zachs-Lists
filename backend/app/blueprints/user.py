"""
User blueprint - config, whitelist, lists, jobs, build.
"""

import os
import hashlib
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
import gevent

from app.blueprints.auth import login_required
from app.extensions import mongo
from app.models.user import User
from app.models.job import Job
from app.utils.validators import (
    validate_blocklist_config,
    validate_blocklist_config_strict,
    validate_whitelist,
    validate_config_urls,
    VALID_CATEGORIES,
)
from app.socketio import emit_validation_progress, emit_validation_complete
from app.models.blocklist_library import BlocklistLibrary

user_bp = Blueprint("user", __name__)


def _generate_config_hash(config: str) -> str:
    """Generate SHA256 hash of config content for validation token."""
    return hashlib.sha256(config.encode("utf-8")).hexdigest()


@user_bp.route("/config", methods=["GET"])
@login_required
def get_config(user: User):
    """Get user's blocklist configuration."""
    config = user.get_config("blocklists.conf")
    return jsonify({"config": config or ""})


@user_bp.route("/config", methods=["PUT"])
@login_required
def update_config(user: User):
    """
    Update blocklist configuration.

    Requires a validation_token from a prior validation to ensure
    the config being saved is exactly what was validated.
    """
    from bson import ObjectId

    data = request.get_json()
    config = data.get("config", "")
    validation_token = data.get("validation_token")

    # Require validation token
    if not validation_token:
        return jsonify({"error": "Validation required before saving"}), 400

    # Look up the validation token
    token_doc = mongo.db.validation_tokens.find_one({
        "user_id": ObjectId(user.id),
        "expires_at": {"$gt": datetime.utcnow()}
    })

    if not token_doc:
        return jsonify({"error": "Validation expired, please re-validate"}), 400

    # Verify the config hasn't been modified since validation
    config_hash = _generate_config_hash(config)
    if token_doc["config_hash"] != config_hash:
        return jsonify({
            "error": "Config was modified after validation, please re-validate"
        }), 400

    # Check if validation had errors (shouldn't allow save with errors)
    if token_doc.get("has_errors"):
        return jsonify({
            "error": "Cannot save config with validation errors"
        }), 400

    # Validate size (double-check)
    max_size = user.limits["max_config_size_mb"] * 1024 * 1024
    if len(config.encode("utf-8")) > max_size:
        return (
            jsonify(
                {
                    "error": f"Config file too large. Maximum size: {user.limits['max_config_size_mb']}MB"
                }
            ),
            400,
        )

    # Save config
    user.save_config("blocklists.conf", config)

    # Delete the used validation token (one-time use)
    mongo.db.validation_tokens.delete_one({"user_id": ObjectId(user.id)})

    current_app.logger.info(f"User {user.username} updated blocklist config (validated)")

    return jsonify({"success": True})


@user_bp.route("/config/validate", methods=["POST"])
@login_required
def validate_config(user: User):
    """
    Validate config with HEAD requests to check URLs.

    Emits progress via Socket.IO to validation:{user_id} room.
    Client should subscribe to this room before calling this endpoint.

    On successful validation (no errors), generates a validation token
    that must be provided when saving the config. This ensures the exact
    validated config is what gets saved.
    """
    from bson import ObjectId

    data = request.get_json()
    config = data.get("config", "")

    # Validate size first
    max_size = user.limits["max_config_size_mb"] * 1024 * 1024
    if len(config.encode("utf-8")) > max_size:
        return (
            jsonify(
                {
                    "error": f"Config file too large. Maximum size: {user.limits['max_config_size_mb']}MB"
                }
            ),
            400,
        )

    # Progress callback that emits Socket.IO events
    def emit_progress(progress):
        emit_validation_progress(user.id, progress)

    # Run validation with HEAD requests
    result = validate_config_urls(
        config,
        user.limits["max_source_lists"],
        emit_progress=emit_progress,
    )

    # Generate and store validation token
    # Token ties the exact config content to this validation result
    config_hash = _generate_config_hash(config)
    now = datetime.utcnow()

    token_doc = {
        "user_id": ObjectId(user.id),
        "config_hash": config_hash,
        "has_errors": result.has_errors,
        "created_at": now,
        "expires_at": now + timedelta(minutes=10),
    }

    # Upsert - one token per user (replace any existing)
    mongo.db.validation_tokens.update_one(
        {"user_id": ObjectId(user.id)},
        {"$set": token_doc},
        upsert=True
    )

    # Build response with validation token
    response_data = result.to_dict()
    response_data["validation_token"] = config_hash  # Use hash as token for simplicity

    # Emit completion event (without token for socket listeners)
    emit_validation_complete(user.id, result.to_dict())

    return jsonify(response_data)


@user_bp.route("/config/categories", methods=["GET"])
@login_required
def get_categories(user: User):
    """Get the list of valid categories."""
    return jsonify({
        "categories": sorted(VALID_CATEGORIES),
        "nsfw_excluded_from_all_domains": True,
    })


@user_bp.route("/library", methods=["GET"])
@login_required
def get_library(user: User):
    """Get blocklist library grouped by category for visual editor."""
    grouped = BlocklistLibrary.get_grouped_by_category()

    return jsonify({
        "library": {
            category: [entry.to_dict() for entry in entries]
            for category, entries in grouped.items()
        },
        "categories": sorted(VALID_CATEGORIES),
    })


@user_bp.route("/whitelist", methods=["GET"])
@login_required
def get_whitelist(user: User):
    """Get user's whitelist."""
    whitelist = user.get_config("whitelist.txt")
    return jsonify({"whitelist": whitelist or ""})


@user_bp.route("/whitelist", methods=["PUT"])
@login_required
def update_whitelist(user: User):
    """Update whitelist."""
    data = request.get_json()
    whitelist = data.get("whitelist", "")

    # Validate size
    max_size = user.limits["max_config_size_mb"] * 1024 * 1024
    if len(whitelist.encode("utf-8")) > max_size:
        return (
            jsonify(
                {
                    "error": f"Whitelist file too large. Maximum size: {user.limits['max_config_size_mb']}MB"
                }
            ),
            400,
        )

    # Validate patterns
    errors = validate_whitelist(whitelist)
    if errors:
        return jsonify({"error": "Invalid whitelist", "details": errors}), 400

    # Save whitelist
    user.save_config("whitelist.txt", whitelist)
    current_app.logger.info(f"User {user.username} updated whitelist")

    return jsonify({"success": True})


@user_bp.route("/lists", methods=["GET"])
@login_required
def get_lists(user: User):
    """Get user's output lists with stats."""
    # Get fresh user data
    user = User.get_by_id(user.id)

    return jsonify(
        {
            "lists": user.lists,
            "stats": {
                **user.stats,
                "last_build_at": (
                    user.stats["last_build_at"].isoformat()
                    if user.stats.get("last_build_at")
                    else None
                ),
                "week_reset_at": (
                    user.stats["week_reset_at"].isoformat()
                    if user.stats.get("week_reset_at")
                    else None
                ),
            },
            "limits": user.limits,
            "remaining_updates": user.get_remaining_manual_updates(),
        }
    )


@user_bp.route("/build", methods=["POST"])
@login_required
def trigger_build(user: User):
    """Trigger manual build."""
    from bson import ObjectId

    # Check if user has a config
    config = user.get_config("blocklists.conf")
    if not config or not config.strip():
        return jsonify({"error": "No blocklist configuration found"}), 400

    # Check manual update limit
    if not user.can_do_manual_update():
        return (
            jsonify(
                {
                    "error": "Weekly manual update limit reached",
                    "remaining": 0,
                    "resets_at": user.stats["week_reset_at"].isoformat(),
                }
            ),
            429,
        )

    # Check if user already has an active job
    if Job.has_active_job_for_user(ObjectId(user.id)):
        return (
            jsonify(
                {
                    "error": "A build is already in progress",
                    "remaining_updates": user.get_remaining_manual_updates(),
                }
            ),
            429,
        )

    # Check cooldown (5 minutes between manual builds)
    cooldown_remaining = Job.get_cooldown_remaining(ObjectId(user.id), cooldown_minutes=5)
    if cooldown_remaining > 0:
        minutes = cooldown_remaining // 60
        seconds = cooldown_remaining % 60
        return (
            jsonify(
                {
                    "error": f"Please wait {minutes}m {seconds}s before triggering another build",
                    "cooldown_remaining": cooldown_remaining,
                    "remaining_updates": user.get_remaining_manual_updates(),
                }
            ),
            429,
        )

    # Queue job
    from app.services.job_queue import JobQueue

    job = JobQueue.queue_job(user, job_type=Job.TYPE_MANUAL)
    user.increment_manual_updates()

    current_app.logger.info(f"User {user.username} triggered manual build: {job.job_id}")

    return jsonify(
        {
            "job_id": job.job_id,
            "status": job.status,
            "remaining_updates": user.get_remaining_manual_updates(),
        }
    )


@user_bp.route("/jobs", methods=["GET"])
@login_required
def get_jobs(user: User):
    """Get user's job history."""
    from bson import ObjectId

    limit = request.args.get("limit", 20, type=int)
    jobs = Job.get_by_user(ObjectId(user.id), limit=limit)

    # Check for unread failures
    has_unread_failures = Job.has_unread_failures(ObjectId(user.id))

    return jsonify(
        {
            "jobs": [j.to_dict() for j in jobs],
            "has_unread_failures": has_unread_failures,
        }
    )


@user_bp.route("/jobs/<job_id>", methods=["GET"])
@login_required
def get_job(user: User, job_id: str):
    """Get specific job status."""
    job = Job.get_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    # Check ownership
    if job.user_id and str(job.user_id) != user.id:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job.to_dict())


@user_bp.route("/jobs/mark-read", methods=["POST"])
@login_required
def mark_jobs_read(user: User):
    """Mark all failed jobs as read."""
    from bson import ObjectId

    Job.mark_failures_read(ObjectId(user.id))
    return jsonify({"success": True})


@user_bp.route("/copy-default-template", methods=["POST"])
@login_required
def copy_default_template(user: User):
    """Copy default config as a template for user."""
    from app.extensions import mongo

    # Get default config from MongoDB system_config collection
    system_config = mongo.db["system_config"].find_one({"_id": "default_config"})

    if not system_config:
        return jsonify({"error": "Default configuration not available"}), 404

    config_content = system_config.get("blocklists", "")
    whitelist_content = system_config.get("whitelist", "")

    # Check for overwrite option
    data = request.get_json() or {}
    overwrite = data.get("overwrite", False)

    existing_config = user.get_config("blocklists.conf")
    if existing_config and not overwrite:
        return (
            jsonify(
                {
                    "error": "Configuration already exists",
                    "has_existing": True,
                    "message": "Set overwrite=true to replace existing configuration",
                }
            ),
            409,
        )

    # Save configs
    user.save_config("blocklists.conf", config_content)
    if whitelist_content:
        user.save_config("whitelist.txt", whitelist_content)

    current_app.logger.info(f"User {user.username} copied default template")

    return jsonify(
        {
            "success": True,
            "message": "Default template copied successfully",
            "copied": {
                "blocklists_conf": True,
                "whitelist_txt": bool(whitelist_content),
            },
        }
    )


# Limit Request Endpoints

@user_bp.route("/limit-request", methods=["POST"])
@login_required
def submit_limit_request(user: User):
    """Submit a request for a higher domain limit."""
    from app.models.limit_request import LimitRequest

    data = request.get_json()
    requested_tier = data.get("requested_tier")
    reason = data.get("reason", "").strip()
    intended_use = data.get("intended_use", "personal")

    # Validate requested tier
    domain_tiers = current_app.config.get("DOMAIN_TIERS", [2_000_000, 5_000_000, 10_000_000])
    current_limit = user.limits.get("max_domains", domain_tiers[0])

    # Filter to tiers higher than current limit
    available_tiers = [t for t in domain_tiers if t > current_limit]

    if not available_tiers:
        return jsonify({"error": "You are already at the maximum tier"}), 400

    if requested_tier not in available_tiers:
        return jsonify({
            "error": "Invalid tier requested",
            "available_tiers": available_tiers
        }), 400

    # Validate reason
    if not reason or len(reason) < 10:
        return jsonify({"error": "Please provide a reason (at least 10 characters)"}), 400

    if len(reason) > 1000:
        return jsonify({"error": "Reason too long (max 1000 characters)"}), 400

    # Validate intended use
    if intended_use not in LimitRequest.INTENDED_USE_OPTIONS:
        return jsonify({
            "error": "Invalid intended use",
            "options": LimitRequest.INTENDED_USE_OPTIONS
        }), 400

    # Check for existing pending request
    if LimitRequest.has_pending_request(user.id):
        return jsonify({"error": "You already have a pending limit request"}), 400

    # Create request
    limit_request = LimitRequest.create(
        user=user,
        requested_tier=requested_tier,
        reason=reason,
        intended_use=intended_use,
    )

    current_app.logger.info(
        f"User {user.username} submitted limit request for {requested_tier:,} domains"
    )

    return jsonify({
        "success": True,
        "request": limit_request.to_dict(),
    }), 201


@user_bp.route("/limit-request", methods=["GET"])
@login_required
def get_limit_requests(user: User):
    """Get user's limit requests."""
    from app.models.limit_request import LimitRequest

    requests = LimitRequest.get_by_user(user.id)

    # Also get available tiers for the user
    domain_tiers = current_app.config.get("DOMAIN_TIERS", [2_000_000, 5_000_000, 10_000_000])
    current_limit = user.limits.get("max_domains", domain_tiers[0])
    available_tiers = [t for t in domain_tiers if t > current_limit]
    has_pending = LimitRequest.has_pending_request(user.id)

    return jsonify({
        "requests": [r.to_dict() for r in requests],
        "current_limit": current_limit,
        "available_tiers": available_tiers,
        "has_pending": has_pending,
        "max_limit": current_app.config.get("MAX_DOMAINS_LIMIT", 10_000_000),
    })


# Notification Endpoints

@user_bp.route("/notifications", methods=["GET"])
@login_required
def get_notifications(user: User):
    """Get user's notifications."""
    # Refresh user data
    user = User.get_by_id(user.id)

    # Get unread count
    unread_count = len(user.get_unread_notifications())

    return jsonify({
        "notifications": user._serialize_notifications(),
        "unread_count": unread_count,
    })


@user_bp.route("/notifications/<notification_id>/read", methods=["POST"])
@login_required
def mark_notification_read(user: User, notification_id: str):
    """Mark a notification as read."""
    success = user.mark_notification_read(notification_id)

    if not success:
        return jsonify({"error": "Notification not found"}), 404

    return jsonify({"success": True})
