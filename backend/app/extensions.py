"""
Flask extensions initialization.
"""

from flask_pymongo import PyMongo
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler

# MongoDB
mongo = PyMongo()

# Rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100 per hour"],
    storage_uri="memory://",
)

# CORS
cors = CORS()

# Scheduler
scheduler = BackgroundScheduler(timezone="UTC")
