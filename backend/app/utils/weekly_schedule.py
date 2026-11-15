from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

SCHEDULE_TIMEZONE = "UTC"
CRON_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
SUNDAY = 6


@dataclass(frozen=True)
class WeeklyTime:
    weekday: int
    hour: int
    minute: int

    @property
    def cron_day(self) -> str:
        return CRON_DAYS[self.weekday]

    def next_after(self, now: datetime) -> datetime:
        if now.tzinfo is not None:
            now = now.astimezone(timezone.utc).replace(tzinfo=None)
        this_week = now.replace(
            hour=self.hour, minute=self.minute, second=0, microsecond=0
        ) + timedelta(days=(self.weekday - now.weekday()) % 7)
        if this_week > now:
            return this_week
        return this_week + timedelta(days=7)


USER_REBUILD = WeeklyTime(weekday=SUNDAY, hour=7, minute=30)
