"""
Flask application factory.
"""

import os
import logging
from flask import Flask

from app.config import config
from app.extensions import mongo, limiter, cors, scheduler

# Socket.IO instance (will be initialized in create_app)
socketio = None


def create_app(config_name: str = None) -> Flask:
    """Create and configure the Flask application."""
    global socketio

    if config_name is None:
        config_name = os.environ.get("FLASK_ENV", "development")

    app = Flask(__name__)
    app.config.from_object(config[config_name])

    # Configure logging
    configure_logging(app)

    # Initialize extensions
    init_extensions(app)

    # Initialize Socket.IO
    from app.socketio import init_socketio
    socketio = init_socketio(app)

    # Register blueprints
    register_blueprints(app)

    # Create data directories
    create_directories(app)

    # Initialize scheduler (not in testing)
    if not app.config.get("TESTING"):
        init_scheduler(app)

    app.logger.info(f"Application initialized in {config_name} mode")

    return app


def configure_logging(app: Flask) -> None:
    """Configure application logging."""
    log_level = logging.DEBUG if app.debug else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[
            logging.StreamHandler(),
        ],
    )


def init_extensions(app: Flask) -> None:
    """Initialize Flask extensions."""
    mongo.init_app(app)
    limiter.init_app(app)
    cors.init_app(
        app,
        supports_credentials=True,
        origins=[app.config["FRONTEND_URL"]],
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )


def register_blueprints(app: Flask) -> None:
    """Register Flask blueprints."""
    from app.blueprints.auth import auth_bp
    from app.blueprints.user import user_bp
    from app.blueprints.lists import lists_bp
    from app.blueprints.admin import admin_bp
    from app.blueprints.analytics import analytics_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(user_bp, url_prefix="/api/user")
    app.register_blueprint(lists_bp, url_prefix="/api")  # Handles /api/lists and /api/u
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(analytics_bp, url_prefix="/api/analytics")

    # Health check endpoint
    @app.route("/health")
    def health_check():
        return {"status": "healthy"}


def create_directories(app: Flask) -> None:
    """Create necessary data directories."""
    directories = [
        app.config["DATA_DIR"],
        app.config["CACHE_DIR"],
        app.config["USERS_DIR"],
        app.config["DEFAULT_DIR"],
        os.path.join(app.config["DEFAULT_DIR"], "config"),
        os.path.join(app.config["DEFAULT_DIR"], "output"),
    ]
    for directory in directories:
        os.makedirs(directory, exist_ok=True)


def init_scheduler(app: Flask) -> None:
    """Initialize APScheduler for background tasks."""
    from app.scheduled_tasks.tasks import register_scheduled_tasks

    scheduler.start()
    register_scheduled_tasks(app, scheduler)
    app.logger.info("Scheduler started")
