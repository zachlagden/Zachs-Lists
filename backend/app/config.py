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

    # Data paths (output files still on filesystem for nginx serving)
    DATA_DIR = os.environ.get("DATA_DIR", "/opt/webapps/zml/lists.zachlagden.uk/data")
    USERS_DIR = os.path.join(DATA_DIR, "users")
    DEFAULT_DIR = os.path.join(DATA_DIR, "default")

    # Frontend
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    # User limits
    DEFAULT_MAX_SOURCE_LISTS = 40
    DEFAULT_MAX_DOMAINS = 4_000_000  # 4 million domains
    MAX_DOMAINS_LIMIT = 20_000_000  # Maximum requestable: 20 million
    DOMAIN_TIERS = [4_000_000, 10_000_000, 20_000_000]  # Available tiers
    DEFAULT_MAX_CONFIG_SIZE_MB = 10
    DEFAULT_MANUAL_UPDATES_PER_WEEK = 3

    # Processing
    MAX_CONCURRENT_JOBS = 5
    JOB_TIMEOUT_SECONDS = 600  # 10 minutes
    HTTP_TIMEOUT_SECONDS = 30
    MAX_RETRIES = 3
    RETRY_BACKOFF = 0.5

    # Rate limiting
    RATELIMIT_DEFAULT = "100/hour"
    RATELIMIT_STORAGE_URL = os.environ.get("REDIS_URL", "memory://")

    # Analytics
    GEOIP_DATABASE_PATH = os.environ.get(
        "GEOIP_DATABASE_PATH", "/opt/webapps/zml/lists.zachlagden.uk/data/GeoLite2-City.mmdb"
    )

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
