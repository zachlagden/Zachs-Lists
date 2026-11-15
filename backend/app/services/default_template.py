from typing import Any

from app.models.system_config import SystemConfig
from app.models.user import User
from app.utils.validators import (
    WhitelistValidationUnavailable,
    parse_config_lines,
    validate_blocklist_config,
    validate_whitelist,
)


class TemplateRefusal(Exception):
    def __init__(self, code: str, message: str, status: int, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details

    def to_response(self) -> dict[str, Any]:
        return {"error": self.message, "code": self.code, **self.details}


def copy_default_template(user: User, overwrite: bool) -> dict[str, bool]:
    template = SystemConfig.get_default_config()
    blocklists: str = template["blocklists"] or ""
    whitelist: str = template["whitelist"] or ""
    if not blocklists.strip():
        raise TemplateRefusal(
            "template_unavailable", "Default configuration not available", 404
        )
    if user.get_config("blocklists.conf") and not overwrite:
        raise TemplateRefusal(
            "config_exists",
            "Configuration already exists",
            409,
            has_existing=True,
        )

    limits = user.limits
    source_count = len(parse_config_lines(blocklists))
    if source_count > limits["max_source_lists"]:
        raise TemplateRefusal(
            "template_exceeds_limit",
            f"The default template has {source_count} sources and your limit is "
            f"{limits['max_source_lists']}. Nothing was changed.",
            400,
            source_count=source_count,
            max_source_lists=limits["max_source_lists"],
        )
    max_bytes = limits["max_config_size_mb"] * 1024 * 1024
    if max(len(blocklists.encode()), len(whitelist.encode())) > max_bytes:
        raise TemplateRefusal(
            "template_exceeds_limit",
            "The default template is larger than your configuration size limit of "
            f"{limits['max_config_size_mb']} MB. Nothing was changed.",
            400,
        )

    errors = validate_blocklist_config(blocklists, limits["max_source_lists"])
    if not errors and whitelist.strip():
        try:
            errors = validate_whitelist(whitelist)
        except WhitelistValidationUnavailable:
            raise TemplateRefusal(
                "validation_unavailable",
                "The default template could not be checked, so nothing was changed. "
                "Try again shortly.",
                503,
            ) from None
    if errors:
        raise TemplateRefusal(
            "template_invalid",
            "The default template has errors, so nothing was changed. "
            "An administrator needs to fix it.",
            400,
            details=errors,
        )

    user.save_configs({"blocklists.conf": blocklists, "whitelist.txt": whitelist})
    return {"blocklists_conf": True, "whitelist_txt": bool(whitelist)}
