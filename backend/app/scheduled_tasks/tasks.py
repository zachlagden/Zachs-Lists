"""
Scheduled tasks for the application.

Tasks:
- Hourly default list sync check (minute 15)
- Weekly rebuild of default lists (Sunday 06:30 UTC)
- Weekly rebuild of all user lists (Sunday 07:30 UTC)
- Daily cache cleanup (3 AM UTC)
"""

import logging
from datetime import datetime, timedelta

from apscheduler.triggers.cron import CronTrigger

from app.services.default_refresh import (
    DEFAULT_REBUILD_HOUR,
    DEFAULT_REBUILD_MINUTE,
    HOURLY_SYNC_MINUTE,
    hourly_check,
    weekly_rebuild,
)
from app.utils.weekly_schedule import SCHEDULE_TIMEZONE, USER_REBUILD

logger = logging.getLogger(__name__)

JOB_HISTORY_DAYS = 30


def delete_finished_jobs_before(cutoff: datetime) -> int:
    from app.extensions import mongo
    from app.models.job import Job

    finished = [Job.STATUS_COMPLETED, Job.STATUS_FAILED, Job.STATUS_SKIPPED]
    result = mongo.db[Job.COLLECTION].delete_many(
        {"created_at": {"$lt": cutoff}, "status": {"$in": finished}}
    )
    return result.deleted_count


def register_scheduled_tasks(app, scheduler):
    """
    Register all scheduled tasks with APScheduler.

    Args:
        app: Flask application instance
        scheduler: APScheduler instance
    """

    @scheduler.scheduled_job(
        CronTrigger(minute=HOURLY_SYNC_MINUTE, timezone=SCHEDULE_TIMEZONE),
        id="hourly_default_sync",
        name="Hourly Default Lists Sync Check",
    )
    def hourly_default_sync():
        with app.app_context():
            try:
                hourly_check(datetime.utcnow())

            except Exception as e:
                logger.exception(f"Failed default lists sync check: {e}")

    @scheduler.scheduled_job(
        CronTrigger(
            day_of_week="sun",
            hour=DEFAULT_REBUILD_HOUR,
            minute=DEFAULT_REBUILD_MINUTE,
            timezone=SCHEDULE_TIMEZONE,
        ),
        id="weekly_default_rebuild",
        name="Weekly Default Lists Rebuild",
    )
    def weekly_default_rebuild():
        with app.app_context():
            try:
                logger.info("Starting weekly default lists rebuild")
                weekly_rebuild()

            except Exception as e:
                logger.exception(f"Failed to queue default rebuild: {e}")

    @scheduler.scheduled_job(
        CronTrigger(
            day_of_week=USER_REBUILD.cron_day,
            hour=USER_REBUILD.hour,
            minute=USER_REBUILD.minute,
            timezone=SCHEDULE_TIMEZONE,
        ),
        id="weekly_user_rebuild",
        name="Weekly User Lists Rebuild",
    )
    def weekly_user_rebuild():
        with app.app_context():
            try:
                from app.services.build_admission import queue_scheduled_user_builds

                logger.info("Starting weekly user lists rebuild")
                queued, skipped = queue_scheduled_user_builds()
                logger.info(
                    f"Queued weekly rebuild for {queued} users, skipped {skipped}"
                )

            except Exception as e:
                logger.exception(f"Failed to queue user rebuilds: {e}")

    @scheduler.scheduled_job(
        CronTrigger(hour=3, minute=0, timezone=SCHEDULE_TIMEZONE),
        id="daily_cache_cleanup",
        name="Daily Cache Cleanup",
    )
    def daily_cache_cleanup():
        """Clean up stale cache entries daily at 3 AM UTC."""
        with app.app_context():
            try:
                from app.services.cache_manager import CacheManager

                cache_manager = CacheManager()
                cleaned = cache_manager.cleanup_stale()

                if cleaned > 0:
                    logger.info(f"Cleaned up {cleaned} stale cache entries")

            except Exception as e:
                logger.exception(f"Failed cache cleanup: {e}")

    @scheduler.scheduled_job(
        CronTrigger(hour=4, minute=0, timezone=SCHEDULE_TIMEZONE),
        id="daily_job_cleanup",
        name="Daily Job History Cleanup",
    )
    def daily_job_cleanup():
        """Clean up old job records daily at 4 AM UTC."""
        with app.app_context():
            try:
                cutoff = datetime.utcnow() - timedelta(days=JOB_HISTORY_DAYS)
                deleted = delete_finished_jobs_before(cutoff)

                if deleted > 0:
                    logger.info(f"Cleaned up {deleted} old job records")

            except Exception as e:
                logger.exception(f"Failed job cleanup: {e}")

    @scheduler.scheduled_job(
        "interval",
        minutes=1,
        id="reset_stale_jobs",
        name="Reset Stale Jobs",
    )
    def reset_stale_jobs():
        """Reset jobs from dead workers back to queued status.

        Runs every minute. Jobs that haven't received a heartbeat in 2 minutes
        are considered stale and reset to queued status so they can be picked
        up by another worker.
        """
        with app.app_context():
            try:
                from app.models.job import Job

                reset_count, abandoned_count = Job.reset_stale(
                    timeout_minutes=Job.STALE_AFTER_MINUTES
                )

                if reset_count > 0:
                    logger.info(f"Reset {reset_count} stale job(s) to queued status")

                if abandoned_count > 0:
                    logger.warning(
                        f"Abandoned {abandoned_count} job(s) that repeatedly died "
                        f"before completing"
                    )

            except Exception as e:
                logger.exception(f"Failed to reset stale jobs: {e}")

    @scheduler.scheduled_job(
        "interval",
        minutes=30,
        id="prune_dead_workers",
        name="Prune Dead Worker Registrations",
    )
    def prune_dead_workers():
        """Remove liveness records left behind by workers that died abruptly.

        Workers deregister themselves on clean shutdown. A worker killed
        mid-run leaves its record behind, so anything that has not sent a
        heartbeat in an hour is removed.
        """
        with app.app_context():
            try:
                from app.models.worker import Worker

                pruned = Worker.prune_stale(stale_after_seconds=3600)

                if pruned > 0:
                    logger.info(f"Pruned {pruned} dead worker registration(s)")

            except Exception as e:
                logger.exception(f"Failed to prune dead workers: {e}")

    logger.info("Registered scheduled tasks")
