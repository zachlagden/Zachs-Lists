"""
Flask extensions initialization.
"""

from flask_pymongo import PyMongo
from flask_limiter import Limiter
from flask_cors import CORS
from apscheduler.schedulers.background import BackgroundScheduler

from app.utils.rate_limits import rate_limit_key

# MongoDB
mongo = PyMongo()

# Rate limiting
limiter = Limiter(key_func=rate_limit_key)

# CORS
cors = CORS()

# Scheduler
scheduler = BackgroundScheduler(timezone="UTC")
