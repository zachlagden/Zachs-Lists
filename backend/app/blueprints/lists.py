"""
Lists blueprint - serve public blocklists.
"""

import os
import gzip
import hashlib
from io import BytesIO
from datetime import datetime
from flask import Blueprint, send_file, request, abort, jsonify, current_app

from app.models.user import User
from app.models.analytics import Analytics

lists_bp = Blueprint("lists", __name__)


def get_client_ip() -> str:
    """Get client IP address, prioritizing Cloudflare headers."""
    # Cloudflare's connecting IP (most reliable when behind CF)
    if request.headers.get("CF-Connecting-IP"):
        return request.headers.get("CF-Connecting-IP")
    # Fallback to X-Forwarded-For
    if request.headers.get("X-Forwarded-For"):
        return request.headers.get("X-Forwarded-For").split(",")[0].strip()
    # Fallback to X-Real-IP (nginx)
    if request.headers.get("X-Real-IP"):
        return request.headers.get("X-Real-IP")
    return request.remote_addr or "unknown"


def hash_ip(ip: str) -> str:
    """Hash IP for privacy."""
    return hashlib.sha256(ip.encode()).hexdigest()[:16]


def get_geo_data(ip: str) -> tuple:
    """Get geographic data for IP using GeoLite2."""
    try:
        import geoip2.database

        db_path = current_app.config.get("GEOIP_DATABASE_PATH")
        if not db_path or not os.path.exists(db_path):
            return None, None

        with geoip2.database.Reader(db_path) as reader:
            response = reader.city(ip)
            country = response.country.iso_code
            city = response.city.name
            return country, city
    except Exception:
        return None, None


def record_analytics(
    list_type: str,
    list_name: str,
    username: str,
    format_type: str,
    file_size: int,
) -> None:
    """Record analytics for a list request."""
    try:
        ip = get_client_ip()
        ip_hash = hash_ip(ip)
        country, city = get_geo_data(ip)
        referrer = request.headers.get("Referer", "")

        Analytics.record_request(
            list_type=list_type,
            list_name=list_name,
            username=username,
            format_type=format_type,
            ip_hash=ip_hash,
            country=country,
            city=city,
            referrer=referrer[:200] if referrer else None,  # Limit referrer length
            size_bytes=file_size,
        )
    except Exception as e:
        current_app.logger.error(f"Failed to record analytics: {e}")


def serve_list_file(output_path: str) -> object:
    """
    Serve a list file with gzip support.

    Storage strategy: Only .gz files are stored (85% disk savings).
    - If client accepts gzip: serve .gz directly with Content-Encoding header
    - If client doesn't accept gzip: decompress on-the-fly and serve

    Args:
        output_path: Path to the file (without .gz extension)
    """
    accept_encoding = request.headers.get("Accept-Encoding", "")
    gz_path = output_path + ".gz"

    # We now ONLY store .gz files - check if it exists
    if not os.path.exists(gz_path):
        # Fallback: check for legacy plain text file
        if os.path.exists(output_path):
            # Serve legacy plain file directly
            response = send_file(
                output_path, mimetype="text/plain; charset=utf-8", as_attachment=False
            )
            response.headers["Vary"] = "Accept-Encoding"
            return response
        abort(404)

    # Client accepts gzip - serve compressed file directly (99% of requests)
    if "gzip" in accept_encoding.lower():
        response = send_file(
            gz_path, mimetype="text/plain; charset=utf-8", as_attachment=False
        )
        response.headers["Content-Encoding"] = "gzip"
    else:
        # Rare case: client doesn't support gzip - decompress on-the-fly
        with gzip.open(gz_path, "rb") as f:
            content = f.read()
        response = send_file(
            BytesIO(content),
            mimetype="text/plain; charset=utf-8",
            as_attachment=False,
        )

    response.headers["Vary"] = "Accept-Encoding"
    return response


def get_list_file_size(output_path: str) -> int:
    """
    Get the uncompressed size of a list file.

    For gzip-only storage, reads the uncompressed size from gzip footer.
    Falls back to actual file size for legacy plain text files.
    """
    gz_path = output_path + ".gz"

    if os.path.exists(gz_path):
        # Read uncompressed size from gzip footer (last 4 bytes, little-endian)
        # Note: This only works for files < 4GB, which is fine for blocklists
        try:
            with open(gz_path, "rb") as f:
                f.seek(-4, 2)  # Seek to last 4 bytes
                size_bytes = f.read(4)
                return int.from_bytes(size_bytes, "little")
        except Exception:
            # Fallback to compressed size
            return os.path.getsize(gz_path)
    elif os.path.exists(output_path):
        # Legacy plain text file
        return os.path.getsize(output_path)
    return 0


def list_file_exists(output_path: str) -> bool:
    """Check if a list file exists (either .gz or legacy plain)."""
    return os.path.exists(output_path + ".gz") or os.path.exists(output_path)


@lists_bp.route("/lists/<name>.txt")
def serve_default_list(name: str):
    """Serve default/official blocklist files."""
    # Validate name
    if not name or not name.replace("_", "").isalnum():
        abort(404)

    # Get format
    format_type = request.args.get("format", "hosts")
    if format_type not in ["hosts", "plain", "adblock"]:
        format_type = "hosts"

    # Build file path
    default_dir = current_app.config["DEFAULT_DIR"]
    filename = f"{name}_{format_type}.txt"
    output_path = os.path.join(default_dir, "output", filename)

    if not list_file_exists(output_path):
        # Try without format suffix for backwards compatibility
        alt_path = os.path.join(default_dir, "output", f"{name}.txt")
        if list_file_exists(alt_path):
            output_path = alt_path
        else:
            abort(404)

    # Get file size (uncompressed for analytics)
    file_size = get_list_file_size(output_path)

    # Record analytics
    record_analytics(
        list_type=Analytics.TYPE_DEFAULT,
        list_name=name,
        username=None,
        format_type=format_type,
        file_size=file_size,
    )

    # Serve file with gzip support
    response = serve_list_file(output_path)

    # Add headers
    response.headers["Cache-Control"] = "public, max-age=3600"  # 1 hour
    response.headers["X-List-Type"] = "default"
    response.headers["X-List-Name"] = name
    response.headers["X-Format"] = format_type

    return response


@lists_bp.route("/u/<username>/<name>.txt")
def serve_user_list(username: str, name: str):
    """Serve user blocklist files."""
    # Validate inputs
    if not username or not name:
        abort(404)
    if not username.replace("-", "").replace("_", "").isalnum():
        abort(404)
    if not name.replace("-", "").replace("_", "").isalnum():
        abort(404)

    # Get user
    user = User.get_by_username(username)
    if not user or not user.is_enabled:
        abort(404)

    # Check if list exists and is public
    list_info = user.get_list(name)
    if not list_info:
        abort(404)

    if not list_info.get("is_public", False):
        abort(403)

    # Get format
    format_type = request.args.get("format", "hosts")
    if format_type not in ["hosts", "plain", "adblock"]:
        format_type = "hosts"

    # Build file path
    output_path = user.get_output_path(name, format_type)
    if not list_file_exists(output_path):
        abort(404)

    # Get file size (uncompressed for analytics)
    file_size = get_list_file_size(output_path)

    # Record analytics
    record_analytics(
        list_type=Analytics.TYPE_USER,
        list_name=name,
        username=username,
        format_type=format_type,
        file_size=file_size,
    )

    # Serve file with gzip support
    response = serve_list_file(output_path)

    # Add headers
    response.headers["Cache-Control"] = "public, max-age=3600"
    response.headers["X-List-Type"] = "user"
    response.headers["X-List-Name"] = name
    response.headers["X-Username"] = username
    response.headers["X-Format"] = format_type
    response.headers["X-Domain-Count"] = str(list_info.get("domain_count", 0))

    return response


@lists_bp.route("/lists")
def list_default_lists():
    """Get information about all default lists."""
    default_dir = current_app.config["DEFAULT_DIR"]
    output_dir = os.path.join(default_dir, "output")

    if not os.path.exists(output_dir):
        return jsonify([])

    # Group files by base name
    # Support both .txt.gz (new) and .txt (legacy) files
    lists = {}
    for filename in os.listdir(output_dir):
        # Handle both .txt.gz and .txt files
        if filename.endswith(".txt.gz"):
            base_name = filename[:-7]  # Remove .txt.gz
            is_gzip = True
        elif filename.endswith(".txt"):
            base_name = filename[:-4]  # Remove .txt
            is_gzip = False
        else:
            continue

        # Parse filename (name_format)
        parts = base_name.rsplit("_", 1)
        if len(parts) == 2:
            name, format_type = parts
            if format_type not in ["hosts", "plain", "adblock"]:
                name = base_name
                format_type = "hosts"
        else:
            name = base_name
            format_type = "hosts"

        filepath = os.path.join(output_dir, filename)

        if name not in lists:
            mtime = os.path.getmtime(filepath)
            lists[name] = {
                "name": name,
                "formats": set(),
                "size_bytes": 0,
                "last_updated": datetime.fromtimestamp(mtime).isoformat(),
            }

        lists[name]["formats"].add(format_type)

        # Get uncompressed size
        if is_gzip:
            size = get_list_file_size(filepath[:-3])  # Remove .gz for helper
        else:
            size = os.path.getsize(filepath)
        lists[name]["size_bytes"] = max(lists[name]["size_bytes"], size)

        # Try to get domain count from file
        if "domain_count" not in lists[name]:
            try:
                if is_gzip:
                    with gzip.open(filepath, "rt", encoding="utf-8") as f:
                        for line in f:
                            if "Total domains:" in line:
                                count = int(line.split(":")[-1].strip())
                                lists[name]["domain_count"] = count
                                break
                else:
                    with open(filepath, "r") as f:
                        for line in f:
                            if "Total domains:" in line:
                                count = int(line.split(":")[-1].strip())
                                lists[name]["domain_count"] = count
                                break
            except Exception:
                lists[name]["domain_count"] = 0

    # Convert sets to lists for JSON serialization
    for name in lists:
        lists[name]["formats"] = list(lists[name]["formats"])

    return jsonify(list(lists.values()))


@lists_bp.route("/api/browse/featured")
def get_featured_lists():
    """Get featured community lists."""
    from app.extensions import mongo

    featured = list(
        mongo.db.featured_lists.find().sort("display_order", 1)
    )

    result = []
    for f in featured:
        # Get list info
        user = User.get_by_username(f.get("username"))
        if not user or not user.is_enabled:
            continue

        list_info = user.get_list(f.get("list_name"))
        if not list_info or not list_info.get("is_public"):
            continue

        result.append({
            "id": str(f["_id"]),
            "username": f.get("username"),
            "list_name": f.get("list_name"),
            "description": f.get("description", ""),
            "domain_count": list_info.get("domain_count", 0),
            "last_updated": list_info.get("last_updated", "").isoformat() if list_info.get("last_updated") else None,
            "display_order": f.get("display_order", 0),
        })

    return jsonify(result)


@lists_bp.route("/api/browse/community")
def get_community_lists():
    """Get all public community lists."""
    from app.extensions import mongo

    # Get all enabled users with public lists
    users = list(mongo.db.users.find({"is_enabled": True, "lists.is_public": True}))

    result = []
    for u in users:
        username = u.get("username")
        for list_info in u.get("lists", []):
            if not list_info.get("is_public"):
                continue
            result.append({
                "username": username,
                "name": list_info.get("name"),
                "domain_count": list_info.get("domain_count", 0),
                "last_updated": list_info.get("last_updated", "").isoformat() if list_info.get("last_updated") else None,
            })

    # Sort by domain count (most popular first)
    result.sort(key=lambda x: x.get("domain_count", 0), reverse=True)

    return jsonify(result[:100])  # Limit to 100
