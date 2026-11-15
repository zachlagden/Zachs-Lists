"""
Lists blueprint - serve public blocklists.
"""

import os
from typing import Any

from flask import Blueprint, Response, abort, current_app, jsonify, request

from app.models.analytics import Analytics
from app.models.featured_list import FeaturedList
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services import published_lists
from app.services.download_recorder import record_download
from app.services.published_lists import ListFile, PublicationUnavailable
from app.utils.time import utc_iso

# Two blueprints: one for public file serving (no prefix), one for API metadata (with /api prefix)
lists_public_bp = Blueprint(
    "lists_public", __name__
)  # Handles /lists/ and /u/ file serving
lists_api_bp = Blueprint(
    "lists_api", __name__
)  # Handles /api/lists and /api/browse metadata

LIST_CACHE_CONTROL = "public, max-age=3600"
UNAVAILABLE_RETRY_SECONDS = "60"


def _default_output_dir() -> str:
    return os.path.join(current_app.config["DEFAULT_DIR"], "output")


def _unavailable() -> tuple[Response, int]:
    response = jsonify(
        {
            "error": "Lists are temporarily unavailable",
            "code": "publication_unavailable",
        }
    )
    response.headers["Retry-After"] = UNAVAILABLE_RETRY_SECONDS
    return response, 503


def _serve(
    file: ListFile,
    list_type: str,
    list_name: str,
    username: str | None,
    format_type: str,
) -> Response:
    response = published_lists.respond(file)
    size_bytes = published_lists.sent_bytes(response, file)
    if size_bytes is not None:
        record_download(
            list_type=list_type,
            list_name=list_name,
            username=username,
            format_type=format_type,
            size_bytes=size_bytes,
        )
    response.headers["Cache-Control"] = LIST_CACHE_CONTROL
    response.headers["X-List-Type"] = list_type
    response.headers["X-List-Name"] = list_name
    response.headers["X-Format"] = format_type
    return response


@lists_public_bp.route("/lists/<name>.txt")
def serve_default_list(name: str) -> Response | tuple[Response, int]:
    """Serve default/official blocklist files."""
    if not name or not name.replace("_", "").isalnum():
        abort(404)

    format_type = published_lists.requested_format(request.args.get("format"))
    try:
        file = published_lists.resolve(
            _default_output_dir(),
            SystemConfig.get_default_publication()["generation_id"],
            name,
            format_type,
            legacy_unsuffixed=True,
        )
    except PublicationUnavailable:
        return _unavailable()
    if file is None:
        abort(404)

    return _serve(file, Analytics.TYPE_DEFAULT, name, None, format_type)


@lists_public_bp.route("/u/<username>/<name>.txt")
def serve_user_list(username: str, name: str) -> Response | tuple[Response, int]:
    """Serve user blocklist files."""
    if not username or not name:
        abort(404)
    if not username.replace("-", "").replace("_", "").isalnum():
        abort(404)
    if not name.replace("-", "").replace("_", "").isalnum():
        abort(404)

    user = User.get_by_username(username)
    if not user or not user.is_enabled or user.is_banned:
        abort(404)

    list_info = user.get_list(name)
    if not list_info:
        abort(404)

    format_type = published_lists.requested_format(request.args.get("format"))
    try:
        file = published_lists.resolve(
            user.get_output_dir(), user.published_generation, name, format_type
        )
    except PublicationUnavailable:
        return _unavailable()
    if file is None:
        abort(404)

    response = _serve(file, Analytics.TYPE_USER, name, username, format_type)
    response.headers["X-Username"] = username
    response.headers["X-Domain-Count"] = str(list_info.get("domain_count", 0))
    return response


@lists_api_bp.route("/lists")
def list_default_lists() -> Response | tuple[Response, int]:
    """Get information about all default lists."""
    publication = SystemConfig.get_default_publication()
    try:
        summaries: list[dict[str, Any]] = published_lists.summaries(
            _default_output_dir(),
            publication["generation_id"],
            publication["published_at"],
            publication["total_domains"],
        )
    except PublicationUnavailable:
        return _unavailable()
    return jsonify(summaries)


@lists_api_bp.route("/browse/featured")
def get_featured_lists():
    """Get featured community lists."""
    result = []
    for entry in FeaturedList.all_ordered():
        f = entry.to_dict()
        user = User.get_by_username(entry.username)
        if not user or not user.is_enabled or user.is_banned:
            continue

        list_info = user.get_list(f.get("list_name"))
        if not list_info:
            continue

        result.append(
            {
                **f,
                "domain_count": list_info.get("domain_count", 0),
                "last_updated": utc_iso(list_info.get("last_updated")),
            }
        )

    return jsonify(result)
