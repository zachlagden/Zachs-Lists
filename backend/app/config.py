"""
Flask application configuration.
"""

import os
from datetime import timedelta


class Config:
    """Base configuration."""

    # Flask
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")
    SESSION_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    MAX_CONTENT_LENGTH = 12 * 1024 * 1024

    # MongoDB
    MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/pihole_lists")

    # GitHub OAuth
    GITHUB_CLIENT_ID = os.environ.get("GITHUB_CLIENT_ID")
    GITHUB_CLIENT_SECRET = os.environ.get("GITHUB_CLIENT_SECRET")
    GITHUB_REDIRECT_URI = os.environ.get(
        "GITHUB_REDIRECT_URI", "http://localhost:5000/api/auth/callback"
    )
    GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
    GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
    GITHUB_API_URL = "https://api.github.com"

    # Root user (super admin) - REQUIRED
    ROOT_USERNAME = os.environ.get("ROOT_USERNAME")
    _ROOT_GITHUB_ID = os.environ.get("ROOT_GITHUB_ID", "")
    ROOT_GITHUB_ID = int(_ROOT_GITHUB_ID) if _ROOT_GITHUB_ID.isdigit() else None

    # Data paths
    DATA_DIR = os.environ.get("DATA_DIR", "./data")
    USERS_DIR = os.path.join(DATA_DIR, "users")
    DEFAULT_DIR = os.path.join(DATA_DIR, "default")
    WORKER_BIN = os.environ.get("WORKER_BIN", "/app/rust-worker")

    # Frontend
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    # User limits
    DEFAULT_MAX_SOURCE_LISTS = 40
    DEFAULT_MAX_DOMAINS = 4_000_000  # 4 million domains
    MAX_DOMAINS_LIMIT = 20_000_000  # Maximum requestable: 20 million
    DOMAIN_TIERS = [4_000_000, 10_000_000, 20_000_000]  # Available tiers
    DEFAULT_MAX_CONFIG_SIZE_MB = 10
    DEFAULT_MANUAL_UPDATES_PER_WEEK = 3
    MAX_SOURCE_LISTS_LIMIT = 1000
    MAX_CONFIG_SIZE_MB_LIMIT = 10
    MAX_MANUAL_UPDATES_PER_WEEK_LIMIT = 100
    ENFORCE_DOMAIN_LIMIT = os.environ.get(
        "ENFORCE_DOMAIN_LIMIT", ""
    ).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )

    # Processing
    MAX_CONCURRENT_JOBS = 5
    JOB_TIMEOUT_SECONDS = 600  # 10 minutes
    HTTP_TIMEOUT_SECONDS = 30
    MAX_RETRIES = 3
    RETRY_BACKOFF = 0.5

    # Job relay
    JOB_POLL_ACTIVE_SECONDS = float(os.environ.get("JOB_POLL_ACTIVE_SECONDS", "0.5"))
    JOB_POLL_IDLE_SECONDS = float(os.environ.get("JOB_POLL_IDLE_SECONDS", "2"))

    # Rate limiting
    RATELIMIT_DEFAULT = os.environ.get("RATELIMIT_DEFAULT", "100 per hour")
    RATELIMIT_STORAGE_URI = (
        os.environ.get("RATELIMIT_STORAGE_URL")
        or os.environ.get("REDIS_URL")
        or "memory://"
    )
    RATELIMIT_IN_MEMORY_FALLBACK_ENABLED = True
    RATELIMIT_AUTH_ME = "60 per minute"
    RATELIMIT_JOBS = "120 per minute"
    RATELIMIT_URL_METADATA = "60 per minute"
    RATELIMIT_ADMIN_STATS = "60 per minute"
    TRUSTED_PROXY_HOSTS = tuple(
        host.strip()
        for host in os.environ.get("TRUSTED_PROXY_HOSTS", "").split(",")
        if host.strip()
    )

    # Analytics
    GEOIP_DATABASE_PATH = os.environ.get("GEOIP_DATABASE_PATH", "")

    # Scheduler
    SCHEDULER_API_ENABLED = False
    SCHEDULER_TIMEZONE = "UTC"


class DevelopmentConfig(Config):
    """Development configuration."""

    DEBUG = True
    SESSION_COOKIE_SECURE = False


class ProductionConfig(Config):
    """Production configuration."""

    DEBUG = False


class TestingConfig(Config):
    """Testing configuration."""

    TESTING = True
    MONGO_URI = "mongodb://localhost:27017/pihole_lists_test"
    SESSION_COOKIE_SECURE = False


config = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
    "default": DevelopmentConfig,
}
