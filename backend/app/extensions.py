"""
Flask extensions initialization.
"""

from flask_pymongo import PyMongo
from flask_limiter import Limiter
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler

from app.utils.client_ip import get_client_ip

# MongoDB
mongo = PyMongo()

# Rate limiting
limiter = Limiter(
    key_func=get_client_ip,
    default_limits=["100 per hour"],
    storage_uri="memory://",
)

# CORS
cors = CORS()

# Scheduler
scheduler = BackgroundScheduler(timezone="UTC")
