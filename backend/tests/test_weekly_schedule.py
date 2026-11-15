from datetime import datetime, timedelta, timezone

import pytest
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.scheduled_tasks.tasks import register_scheduled_tasks
from app.utils.weekly_schedule import SCHEDULE_TIMEZONE, USER_REBUILD, WeeklyTime
from conftest import Api

SUNDAY_REBUILD = datetime(2026, 11, 15, 7, 30)
NEXT_SUNDAY_REBUILD = datetime(2026, 11, 22, 7, 30)


@pytest.mark.parametrize(
    ("now", "expected"),
    [
        (datetime(2026, 11, 15, 7, 29, 59, 999999), SUNDAY_REBUILD),
        (datetime(2026, 11, 15, 0, 0), SUNDAY_REBUILD),
        (SUNDAY_REBUILD, NEXT_SUNDAY_REBUILD),
        (datetime(2026, 11, 15, 7, 30, 0, 1), NEXT_SUNDAY_REBUILD),
        (datetime(2026, 11, 15, 23, 59, 59), NEXT_SUNDAY_REBUILD),
        (datetime(2026, 11, 16, 0, 0), NEXT_SUNDAY_REBUILD),
        (datetime(2026, 11, 18, 12, 0), NEXT_SUNDAY_REBUILD),
        (datetime(2026, 11, 21, 23, 59, 59), NEXT_SUNDAY_REBUILD),
        (datetime(2026, 12, 31, 12, 0), datetime(2027, 1, 3, 7, 30)),
    ],
)
def test_next_user_rebuild_is_the_first_sunday_slot_after_now(
    now: datetime, expected: datetime
) -> None:
    assert USER_REBUILD.next_after(now) == expected


def test_next_rebuild_reads_an_aware_time_as_its_utc_instant() -> None:
    plus_five = timezone(timedelta(hours=5))

    before = datetime(2026, 11, 15, 12, 29, tzinfo=plus_five)
    after = datetime(2026, 11, 15, 12, 30, tzinfo=plus_five)

    assert USER_REBUILD.next_after(before) == SUNDAY_REBUILD
    assert USER_REBUILD.next_after(after) == NEXT_SUNDAY_REBUILD


def test_a_weekday_slot_wraps_into_the_following_week() -> None:
    tuesday_evening = WeeklyTime(weekday=1, hour=18, minute=5)

    assert tuesday_evening.cron_day == "tue"
    assert tuesday_evening.next_after(datetime(2026, 11, 17, 18, 4)) == datetime(
        2026, 11, 17, 18, 5
    )
    assert tuesday_evening.next_after(datetime(2026, 11, 17, 18, 5)) == datetime(
        2026, 11, 24, 18, 5
    )


def test_the_scheduler_fires_the_user_rebuild_at_the_calculated_time(
    api: Api,
) -> None:
    scheduler = BackgroundScheduler(timezone="UTC")
    register_scheduled_tasks(api.app, scheduler)
    trigger = scheduler.get_job("weekly_user_rebuild").trigger
    assert isinstance(trigger, CronTrigger)
    assert SCHEDULE_TIMEZONE == "UTC"

    for now in (
        datetime(2026, 11, 15, 7, 29, 59),
        SUNDAY_REBUILD,
        datetime(2026, 11, 18, 12, 0),
    ):
        aware = now.replace(tzinfo=timezone.utc)
        fire_time = trigger.get_next_fire_time(None, aware + timedelta(microseconds=1))
        assert fire_time.astimezone(timezone.utc).replace(
            tzinfo=None
        ) == USER_REBUILD.next_after(now)
