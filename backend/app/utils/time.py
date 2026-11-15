from datetime import datetime, timedelta, timezone


def utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def week_start(moment: datetime) -> datetime:
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc).replace(tzinfo=None)
    midnight = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight - timedelta(days=(midnight.weekday() + 1) % 7)


def next_week_start(moment: datetime) -> datetime:
    return week_start(moment) + timedelta(days=7)
