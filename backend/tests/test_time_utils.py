from datetime import datetime, timedelta, timezone

from app.utils.time import utc_iso


def test_none_stays_none() -> None:
    assert utc_iso(None) is None


def test_naive_value_is_treated_as_utc() -> None:
    assert utc_iso(datetime(2026, 1, 2, 3, 4, 5, 678901)) == "2026-01-02T03:04:05.678Z"


def test_whole_second_still_carries_milliseconds() -> None:
    assert utc_iso(datetime(2026, 1, 2, 3, 4, 5)) == "2026-01-02T03:04:05.000Z"


def test_aware_utc_value_keeps_its_instant() -> None:
    value = datetime(2026, 1, 2, 3, 4, 5, 120000, tzinfo=timezone.utc)
    assert utc_iso(value) == "2026-01-02T03:04:05.120Z"


def test_aware_offset_value_is_converted_to_utc() -> None:
    value = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone(timedelta(hours=5)))
    assert utc_iso(value) == "2026-01-01T22:04:05.000Z"


def test_negative_offset_rolls_forward_into_utc() -> None:
    value = datetime(
        2026, 12, 31, 20, 0, 0, tzinfo=timezone(timedelta(hours=-5, minutes=-30))
    )
    assert utc_iso(value) == "2027-01-01T01:30:00.000Z"
