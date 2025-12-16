"""
WSGI entry point for the application.

Note: Job processing is now handled by separate worker processes (rust-worker/).
This file starts the web server with the JobStatusPoller for WebSocket updates.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from project root .env
# Try parent directory first (project root), then current directory
env_paths = [
    Path(__file__).parent.parent / ".env",  # Project root
    Path(__file__).parent / ".env",          # Backend directory (fallback)
]

for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

from app import create_app
from app.socketio import socketio
from app.services.job_poller import job_poller

# Create application
app = create_app(os.environ.get("FLASK_ENV", "production"))

# Initialize job status poller for WebSocket updates
with app.app_context():
    job_poller.init_app(app)

if __name__ == "__main__":
    # Use socketio.run() for WebSocket support
    # allow_unsafe_werkzeug=True is required for Flask-SocketIO 5.x with werkzeug dev server
    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=True,
        use_reloader=False,  # Disable reloader to avoid issues with threading
        allow_unsafe_werkzeug=True,
    )
