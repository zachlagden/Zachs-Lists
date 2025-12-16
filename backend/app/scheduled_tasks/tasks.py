"""
Scheduled tasks for the application.

Tasks:
- Weekly rebuild of all user lists (Sunday 2 AM UTC)
- Weekly rebuild of default lists (Sunday 1 AM UTC)
- Reset weekly manual update counters (Sunday midnight UTC)
- Daily cache cleanup (3 AM UTC)
"""

import logging
from datetime import datetime

from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)


def register_scheduled_tasks(app, scheduler):
    """
    Register all scheduled tasks with APScheduler.

    Args:
        app: Flask application instance
        scheduler: APScheduler instance
    """

    @scheduler.scheduled_job(
        CronTrigger(day_of_week="sun", hour=1, minute=0),
        id="weekly_default_rebuild",
        name="Weekly Default Lists Rebuild",
    )
    def weekly_default_rebuild():
        """Rebuild default lists every Sunday at 1 AM UTC."""
        with app.app_context():
            try:
                from app.services.job_queue import JobQueue
                from app.models.job import Job

                logger.info("Starting weekly default lists rebuild")
                job = JobQueue.queue_default_job(job_type=Job.TYPE_SCHEDULED)
                logger.info(f"Queued default rebuild job: {job.job_id}")

            except Exception as e:
                logger.exception(f"Failed to queue default rebuild: {e}")

    @scheduler.scheduled_job(
        CronTrigger(day_of_week="sun", hour=2, minute=0),
        id="weekly_user_rebuild",
        name="Weekly User Lists Rebuild",
    )
    def weekly_user_rebuild():
        """Rebuild all user lists every Sunday at 2 AM UTC."""
        with app.app_context():
            try:
                from app.models.user import User
                from app.services.job_queue import JobQueue
                from app.models.job import Job

                logger.info("Starting weekly user lists rebuild")

                # Get all enabled users with configs
                users = User.get_all_enabled()
                queued = 0

                for user in users:
                    # Check if user has a config
                    config = user.get_config("blocklists.conf")
                    if config and config.strip():
                        try:
                            JobQueue.queue_job(user, job_type=Job.TYPE_SCHEDULED)
                            queued += 1
                        except Exception as e:
                            logger.error(
                                f"Failed to queue rebuild for {user.username}: {e}"
                            )

                logger.info(f"Queued weekly rebuild for {queued} users")

            except Exception as e:
                logger.exception(f"Failed to queue user rebuilds: {e}")

    @scheduler.scheduled_job(
        CronTrigger(day_of_week="sun", hour=0, minute=0),
        id="reset_weekly_limits",
        name="Reset Weekly Manual Update Limits",
    )
    def reset_weekly_limits():
        """Reset weekly manual update counters every Sunday at midnight UTC."""
        with app.app_context():
            try:
                from app.extensions import mongo

                result = mongo.db.users.update_many(
                    {},
                    {
                        "$set": {
                            "stats.manual_updates_this_week": 0,
                            "stats.week_reset_at": datetime.utcnow(),
                        }
                    },
                )

                logger.info(
                    f"Reset weekly limits for {result.modified_count} users"
                )

            except Exception as e:
                logger.exception(f"Failed to reset weekly limits: {e}")

    @scheduler.scheduled_job(
        CronTrigger(hour=3, minute=0),
        id="daily_cache_cleanup",
        name="Daily Cache Cleanup",
    )
    def daily_cache_cleanup():
        """Clean up stale cache entries daily at 3 AM UTC."""
        with app.app_context():
            try:
                from app.services.cache_manager import CacheManager

                cache_manager = CacheManager()
                cleaned = cache_manager.cleanup_stale(days=30)

                if cleaned > 0:
                    logger.info(f"Cleaned up {cleaned} stale cache entries")

            except Exception as e:
                logger.exception(f"Failed cache cleanup: {e}")

    @scheduler.scheduled_job(
        CronTrigger(hour=4, minute=0),
        id="daily_job_cleanup",
        name="Daily Job History Cleanup",
    )
    def daily_job_cleanup():
        """Clean up old job records daily at 4 AM UTC."""
        with app.app_context():
            try:
                from app.extensions import mongo
                from datetime import timedelta

                # Delete jobs older than 30 days
                cutoff = datetime.utcnow() - timedelta(days=30)

                result = mongo.db.jobs.delete_many({"created_at": {"$lt": cutoff}})

                if result.deleted_count > 0:
                    logger.info(f"Cleaned up {result.deleted_count} old job records")

            except Exception as e:
                logger.exception(f"Failed job cleanup: {e}")

    @scheduler.scheduled_job(
        CronTrigger(day=1, hour=5, minute=0),
        id="monthly_analytics_aggregation",
        name="Monthly Analytics Aggregation",
    )
    def monthly_analytics_aggregation():
        """Aggregate old analytics data monthly (1st of month, 5 AM UTC)."""
        with app.app_context():
            try:
                from app.extensions import mongo
                from datetime import timedelta

                # Keep daily granularity for last 90 days, aggregate older data
                cutoff = datetime.utcnow() - timedelta(days=90)

                # Remove old daily analytics (we could aggregate first if needed)
                result = mongo.db.analytics.delete_many({"date": {"$lt": cutoff}})

                if result.deleted_count > 0:
                    logger.info(
                        f"Cleaned up {result.deleted_count} old analytics records"
                    )

            except Exception as e:
                logger.exception(f"Failed analytics aggregation: {e}")

    @scheduler.scheduled_job(
        "interval",
        minutes=1,
        id="reset_stale_jobs",
        name="Reset Stale Jobs",
    )
    def reset_stale_jobs():
        """Reset jobs from dead workers back to queued status.

        Runs every minute. Jobs that haven't received a heartbeat in 10 minutes
        are considered stale and reset to queued status so they can be picked
        up by another worker.
        """
        with app.app_context():
            try:
                from app.models.job import Job

                reset_count = Job.reset_stale(timeout_minutes=10)

                if reset_count > 0:
                    logger.info(f"Reset {reset_count} stale job(s) to queued status")

            except Exception as e:
                logger.exception(f"Failed to reset stale jobs: {e}")

    logger.info("Registered scheduled tasks")


def trigger_default_rebuild(app):
    """Manually trigger default lists rebuild."""
    with app.app_context():
        from app.services.job_queue import JobQueue
        from app.models.job import Job

        job = JobQueue.queue_default_job(job_type=Job.TYPE_ADMIN)
        return job


def trigger_all_user_rebuilds(app):
    """Manually trigger rebuild for all users."""
    with app.app_context():
        from app.models.user import User
        from app.services.job_queue import JobQueue
        from app.models.job import Job

        users = User.get_all_enabled()
        jobs = []

        for user in users:
            config = user.get_config("blocklists.conf")
            if config and config.strip():
                job = JobQueue.queue_job(user, job_type=Job.TYPE_ADMIN)
                jobs.append(job)

        return jobs
