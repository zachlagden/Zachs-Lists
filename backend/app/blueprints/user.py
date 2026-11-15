"""
User blueprint - config, whitelist, lists, jobs, build.
"""

import hashlib
import secrets
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app

from app.blueprints.auth import login_required
from app.extensions import limiter, mongo
from app.models.user import User
from app.models.job import Job
from app.services.build_admission import AdmissionError, admit_build
from app.services.job_feed import job_payload, job_payloads
from app.services.limit_review import enforcing_domain_limit
from app.utils.validators import (
    WhitelistValidationUnavailable,
    validate_whitelist,
    validate_config_urls,
    VALID_CATEGORIES,
)
from app.socketio import emit_validation_progress, emit_validation_complete
from app.models.blocklist_library import BlocklistLibrary
from app.models.cache import CacheMetadata
from app.utils.config_revision import ConfigRevisionConflict
from app.models.announcement import Announcement
from app.models.limit_request import LimitRequest, PendingRequestExists
from app.services import default_template
from app.utils.rate_limits import configured_limit
from app.utils.request_fields import (
    FieldError,
    is_utf8_text,
    json_object,
    object_id,
    optional_bool,
    query_int,
    register_field_errors,
    required_choice,
    required_int,
    required_string,
    required_text,
)
from app.utils.time import utc_iso
from app.utils.weekly_schedule import USER_REBUILD

user_bp = Blueprint("user", __name__)
register_field_errors(user_bp)

MAX_METADATA_URLS = 100
MAX_METADATA_URL_LENGTH = 8192
MIN_REASON_LENGTH = 10
MAX_REASON_LENGTH = 1000
PENDING_REQUEST_EXISTS = {
    "error": "You already have a pending limit request",
    "code": "pending_request_exists",
}


def _generate_config_hash(config: str) -> str:
    """Generate SHA256 hash of config content for validation token."""
    return hashlib.sha256(config.encode("utf-8")).hexdigest()


@user_bp.route("/config", methods=["GET"])
@login_required
def get_config(user: User):
    """Get user's blocklist configuration."""
    config = user.get_config("blocklists.conf")
    return jsonify({"config": config or "", "revision": user.config_revision})


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
    if not isinstance(validation_token, str) or not 1 <= len(validation_token) <= 128:
        return jsonify({"error": "Validation required before saving"}), 400

    # Look up the validation token
    token_doc = mongo.db.validation_tokens.find_one(
        {
            "_id": validation_token,
            "user_id": ObjectId(user.id),
            "expires_at": {"$gt": datetime.utcnow()},
        }
    )

    if not token_doc:
        return jsonify({"error": "Validation expired, please re-validate"}), 400

    # Verify the config hasn't been modified since validation
    config_hash = _generate_config_hash(config)
    if token_doc["config_hash"] != config_hash:
        return (
            jsonify(
                {"error": "Config was modified after validation, please re-validate"}
            ),
            400,
        )

    # Check if validation had errors (shouldn't allow save with errors)
    if token_doc.get("has_errors"):
        return jsonify({"error": "Cannot save config with validation errors"}), 400

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

    consumed = mongo.db.validation_tokens.find_one_and_delete(
        {
            "_id": validation_token,
            "user_id": ObjectId(user.id),
            "config_hash": config_hash,
            "has_errors": False,
            "expires_at": {"$gt": datetime.utcnow()},
        }
    )
    if not consumed:
        return (
            jsonify({"error": "Validation expired or already used; re-validate"}),
            400,
        )
    try:
        user.save_config(
            "blocklists.conf", config, expected_revision=consumed["revision"]
        )
    except ConfigRevisionConflict:
        return (
            jsonify(
                {
                    "error": "Configuration changed; reload and re-validate",
                    "code": "config_conflict",
                }
            ),
            409,
        )

    current_app.logger.info(
        f"User {user.username} updated blocklist config (validated)"
    )

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
    validation_id = secrets.token_urlsafe(32)

    def emit_progress(progress):
        emit_validation_progress(user.id, {**progress, "validation_id": validation_id})

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
        "_id": validation_id,
        "user_id": ObjectId(user.id),
        "revision": user.config_revision,
        "config_hash": config_hash,
        "has_errors": result.has_errors,
        "created_at": now,
        "expires_at": now + timedelta(minutes=10),
    }

    if not result.has_errors:
        mongo.db.validation_tokens.insert_one(token_doc)

    # Build response with validation token
    response_data = result.to_dict()
    response_data["validation_token"] = validation_id if not result.has_errors else None
    response_data["validation_id"] = validation_id
    response_data["revision"] = token_doc["revision"]

    # Emit completion event (without token for socket listeners)
    emit_validation_complete(
        user.id, {**result.to_dict(), "validation_id": validation_id}
    )

    return jsonify(response_data)


@user_bp.route("/config/categories", methods=["GET"])
@login_required
def get_categories(user: User):
    """Get the list of valid categories."""
    return jsonify(
        {
            "categories": sorted(VALID_CATEGORIES),
            "nsfw_excluded_from_all_domains": True,
        }
    )


@user_bp.route("/config/url-metadata", methods=["POST"])
@limiter.limit(configured_limit("RATELIMIT_URL_METADATA"))
@login_required
def get_url_metadata(user: User):
    """Fetch cached metadata (domain counts) for a list of URLs."""
    urls = json_object().get("urls")

    if not isinstance(urls, list) or not 1 <= len(urls) <= MAX_METADATA_URLS:
        raise FieldError(f"Provide 1-{MAX_METADATA_URLS} URLs", "urls")
    if not all(
        isinstance(url, str)
        and len(url) <= MAX_METADATA_URL_LENGTH
        and is_utf8_text(url)
        for url in urls
    ):
        raise FieldError("urls must be a list of URL strings", "urls")

    result = {}
    for url in urls:
        # CacheMetadata uses URL hash as key
        url_hash = hashlib.sha256(url.encode()).hexdigest()
        cached = CacheMetadata.get_by_url_hash(url_hash)

        if cached and cached.stats:
            result[url] = {
                "domain_count": cached.stats.get("domain_count"),
                "cached": True,
            }
        else:
            result[url] = {
                "domain_count": None,
                "cached": False,
            }

    return jsonify(result)


@user_bp.route("/library", methods=["GET"])
@login_required
def get_library(user: User):
    """Get blocklist library grouped by category for visual editor."""
    grouped = BlocklistLibrary.get_grouped_by_category()

    return jsonify(
        {
            "library": {
                category: [entry.to_dict() for entry in entries]
                for category, entries in grouped.items()
            },
            "categories": sorted(VALID_CATEGORIES),
        }
    )


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
    whitelist = required_text(json_object(), "whitelist")

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
    try:
        errors = validate_whitelist(whitelist)
    except WhitelistValidationUnavailable:
        return (
            jsonify(
                {
                    "error": "The whitelist could not be checked, so it was not saved. Try again shortly."
                }
            ),
            503,
        )
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
    from bson import ObjectId

    refreshed = User.get_by_id(user.id)
    if refreshed is None:
        return jsonify({"error": "Account no longer exists"}), 401
    user = refreshed

    return jsonify(
        {
            "lists": user.serialized_lists(),
            "published_at": utc_iso(user.published_at),
            "generation_id": user.published_generation,
            "stats": {
                **user.stats,
                "last_build_at": utc_iso(user.stats.get("last_build_at")),
                "week_reset_at": utc_iso(user.stats.get("week_reset_at")),
            },
            "limits": user.limits,
            "remaining_updates": user.get_remaining_manual_updates(),
            "enforce_domain_limit": enforcing_domain_limit(),
            "next_rebuild_at": utc_iso(USER_REBUILD.next_after(datetime.utcnow())),
            "last_checked_at": utc_iso(Job.last_ended_at(ObjectId(user.id))),
        }
    )


@user_bp.route("/build", methods=["POST"])
@login_required
def trigger_build(user: User):
    """Trigger manual build."""
    try:
        job = admit_build(user, Job.TYPE_MANUAL, requested_by=user)
    except AdmissionError as refusal:
        return jsonify(refusal.to_response()), refusal.status

    current_app.logger.info(
        f"User {user.username} triggered manual build: {job.job_id}"
    )
    current = User.get_by_id(user.id) or user

    return jsonify(
        {
            "job_id": job.job_id,
            "status": job.status,
            "remaining_updates": current.get_remaining_manual_updates(),
        }
    )


@user_bp.route("/jobs", methods=["GET"])
@limiter.limit(configured_limit("RATELIMIT_JOBS"))
@login_required
def get_jobs(user: User):
    """Get user's job history."""
    from bson import ObjectId

    limit = query_int("limit", 20, 1, 100)
    jobs = Job.get_by_user(ObjectId(user.id), limit=limit)

    # Check for unread failures
    has_unread_failures = Job.has_unread_failures(ObjectId(user.id))

    return jsonify(
        {
            "jobs": job_payloads(jobs),
            "has_unread_failures": has_unread_failures,
        }
    )


@user_bp.route("/jobs/<job_id>", methods=["GET"])
@limiter.limit(configured_limit("RATELIMIT_JOBS"))
@login_required
def get_job(user: User, job_id: str):
    """Get specific job status."""
    job = Job.get_by_id(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404

    owned = job.user_id is not None and str(job.user_id) == user.id
    shared_with_admins = job.user_id is None and user.is_admin
    if not owned and not shared_with_admins:
        return jsonify({"error": "Job not found"}), 404

    return jsonify(job_payload(job))


@user_bp.route("/jobs/mark-read", methods=["POST"])
@limiter.limit(configured_limit("RATELIMIT_JOBS"))
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
    overwrite = optional_bool(json_object(), "overwrite") or False
    try:
        copied = default_template.copy_default_template(user, overwrite)
    except default_template.TemplateRefusal as refusal:
        return jsonify(refusal.to_response()), refusal.status

    current_app.logger.info(f"User {user.username} copied default template")

    return jsonify(
        {
            "success": True,
            "message": "Default template copied successfully",
            "copied": copied,
        }
    )


# Limit Request Endpoints


@user_bp.route("/limit-request", methods=["POST"])
@login_required
def submit_limit_request(user: User):
    """Submit a request for a higher domain limit."""
    data = json_object()
    domain_tiers = current_app.config["DOMAIN_TIERS"]
    current_limit = user.limits["max_domains"]
    available_tiers = [t for t in domain_tiers if t > current_limit]

    if not available_tiers:
        return jsonify({"error": "You are already at the maximum tier"}), 400

    requested_tier = required_int(
        data, "requested_tier", min(available_tiers), max(available_tiers)
    )
    if requested_tier not in available_tiers:
        raise FieldError(
            "Invalid tier requested",
            "requested_tier",
            available_tiers=available_tiers,
        )

    reason = required_string(data, "reason", MAX_REASON_LENGTH, MIN_REASON_LENGTH)
    intended_use = (
        required_choice(data, "intended_use", LimitRequest.INTENDED_USE_OPTIONS)
        if data.get("intended_use") is not None
        else "personal"
    )

    if LimitRequest.has_pending_request(user.id):
        return jsonify(PENDING_REQUEST_EXISTS), 409

    try:
        limit_request = LimitRequest.create(
            user=user,
            requested_tier=requested_tier,
            reason=reason,
            intended_use=intended_use,
        )
    except PendingRequestExists:
        return jsonify(PENDING_REQUEST_EXISTS), 409

    current_app.logger.info(
        f"User {user.username} submitted limit request for {requested_tier:,} domains"
    )

    return (
        jsonify(
            {
                "success": True,
                "request": limit_request.to_dict(),
            }
        ),
        201,
    )


@user_bp.route("/limit-request", methods=["GET"])
@login_required
def get_limit_requests(user: User):
    """Get user's limit requests."""
    requests = LimitRequest.get_by_user(user.id)

    domain_tiers = current_app.config["DOMAIN_TIERS"]
    current_limit = user.limits["max_domains"]
    available_tiers = [t for t in domain_tiers if t > current_limit]
    has_pending = LimitRequest.has_pending_request(user.id)

    return jsonify(
        {
            "requests": [r.to_dict() for r in requests],
            "current_limit": current_limit,
            "available_tiers": available_tiers,
            "has_pending": has_pending,
            "max_limit": current_app.config["MAX_DOMAINS_LIMIT"],
        }
    )


# Notification Endpoints


@user_bp.route("/notifications", methods=["GET"])
@login_required
def get_notifications(user: User):
    """Get user's notifications."""
    refreshed = User.get_by_id(user.id)
    if refreshed is None:
        return jsonify({"error": "Account no longer exists"}), 401
    user = refreshed

    # Get unread count
    unread_count = len(user.get_unread_notifications())

    return jsonify(
        {
            "notifications": user._serialize_notifications(),
            "unread_count": unread_count,
        }
    )


@user_bp.route("/notifications/<notification_id>/read", methods=["POST"])
@login_required
def mark_notification_read(user: User, notification_id: str):
    """Mark a notification as read."""
    success = user.mark_notification_read(notification_id)

    if not success:
        return jsonify({"error": "Notification not found"}), 404

    return jsonify({"success": True})


# Announcement Endpoints


@user_bp.route("/announcements", methods=["GET"])
@login_required
def get_announcements(user: User):
    """Get active announcements excluding dismissed ones."""
    active = Announcement.get_active()
    dismissed = set(user.dismissed_announcements)

    announcements = [a.to_dict() for a in active if a.id not in dismissed]

    return jsonify({"announcements": announcements})


@user_bp.route("/announcements/<announcement_id>/dismiss", methods=["POST"])
@login_required
def dismiss_announcement(user: User, announcement_id: str):
    """Dismiss an announcement for this user."""
    object_id(announcement_id, "announcement_id")
    if Announcement.get_by_id(announcement_id) is None:
        return jsonify({"error": "Announcement not found"}), 404
    user.dismiss_announcement(announcement_id)
    return jsonify({"success": True})
