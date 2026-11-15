"""Write or remove a published allowlist in the list output directory."""

import os

from flask import current_app

from app.allowlist import sync_published_allowlist
from app.generator_host import host_from_public_url
from app.models.system_config import SystemConfig
from app.models.user import User


def _generator_host() -> str:
    return host_from_public_url(current_app.config.get("FRONTEND_URL"))


def sync_user_allowlist(user: User) -> None:
    sync_published_allowlist(
        user.get_output_dir(),
        user.get_config("whitelist.txt") or "",
        user.publish_allowlist,
        generator=_generator_host(),
    )


def sync_default_allowlist() -> None:
    output_dir = os.path.join(current_app.config["DEFAULT_DIR"], "output")
    sync_published_allowlist(
        output_dir,
        SystemConfig.get_default_whitelist() or "",
        SystemConfig.is_allowlist_published(),
        generator=_generator_host(),
    )
