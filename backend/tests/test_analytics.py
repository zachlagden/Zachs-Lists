import gzip
import importlib.util
import logging
import os
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import Mock
from uuid import uuid4

import mongomock
import pytest
from bson import ObjectId
from flask import Flask
from geoip2.errors import AddressNotFoundError
from pymongo import MongoClient
from pymongo.errors import OperationFailure, ServerSelectionTimeoutError

from app.blueprints.admin import admin_bp
from app.blueprints.analytics import analytics_bp
from app.blueprints.lists import lists_public_bp
from app.config import TestingConfig
from app.db_indexes import ensure_indexes
from app.extensions import limiter, mongo
from app.models.analytics import Analytics
from app.services import download_recorder, geoip, site_stats

REPORT_KEYS = {
    "period_days",
    "totals",
    "daily",
    "formats",
    "hourly",
    "top_countries",
    "top_cities",
    "top_referrers",
}
VISITOR = "0123456789abcdef"
OTHER_VISITOR = "fedcba9876543210"

script_path = Path(__file__).resolve().parents[1] / "scripts/remove_legacy_analytics.py"
script_spec = importlib.util.spec_from_file_location("legacy_analytics", script_path)
assert script_spec is not None and script_spec.loader is not None
legacy_script = importlib.util.module_from_spec(script_spec)
script_spec.loader.exec_module(legacy_script)


def reset_process_state() -> None:
    download_recorder.failures.reset()
    download_recorder.database_pause.reset()
    site_stats.clear_caches()
    geoip.close_readers()


@pytest.fixture
def database(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    db: Any = mongomock.MongoClient().default
    monkeypatch.setattr(mongo, "db", db)
    reset_process_state()
    yield db
    reset_process_state()


def build_api(tmp_path: Path) -> Flask:
    application = Flask(__name__)
    application.config.from_object(TestingConfig)
    application.config.update(
        SECRET_KEY="test-session-key",
        DATA_DIR=str(tmp_path),
        DEFAULT_DIR=str(tmp_path / "default"),
        GEOIP_DATABASE_PATH="",
    )
    limiter.init_app(application)
    application.register_blueprint(lists_public_bp)
    application.register_blueprint(analytics_bp, url_prefix="/api/analytics")
    application.register_blueprint(admin_bp, url_prefix="/api/admin")
    output = tmp_path / "default" / "output"
    output.mkdir(parents=True)
    with gzip.open(output / "all_domains_hosts.txt.gz", "wb") as archive:
        archive.write(b"0.0.0.0 ads.example.com\n")
    with application.app_context():
        limiter.reset()
    return application


@pytest.fixture
def api(database: Any, tmp_path: Path) -> Flask:
    return build_api(tmp_path)


def signed_in(api: Flask, user: Mock) -> Any:
    client = api.test_client()
    with client.session_transaction() as session:
        session["user_id"] = user.id
    return client


def record(**overrides: Any) -> None:
    arguments: dict[str, Any] = {
        "list_type": Analytics.TYPE_DEFAULT,
        "list_name": "all_domains",
        "username": None,
        "format_type": "hosts",
        "visitor_hash": VISITOR,
        "size_bytes": 10,
    }
    arguments.update(overrides)
    Analytics.record_download(**arguments)


def day_document(database: Any) -> dict[str, Any]:
    documents = list(database[Analytics.COLLECTION].find())
    assert len(documents) == 1
    return documents[0]


def test_recording_counts_requests_and_visitors_without_storing_them_in_the_day(
    database: Any,
) -> None:
    record(country="GB", format_type="hosts")
    record(country="GB", format_type="plain")
    record(country="de", visitor_hash=OTHER_VISITOR, format_type="adblock")

    document = day_document(database)
    assert document["schema_version"] == Analytics.SCHEMA_VERSION
    assert document["date"] == Analytics.today()
    assert document["requests"] == 3
    assert document["bandwidth_bytes"] == 30
    assert document["formats"] == {"hosts": 1, "plain": 1, "adblock": 1}
    assert document["countries"] == {"GB": 2, "DE": 1}
    assert sum(document["hours"].values()) == 3
    assert not any(isinstance(value, list) for value in document.values())
    assert database[Analytics.VISITORS_COLLECTION].count_documents({}) == 2

    report = Analytics.report(30, list_type=Analytics.TYPE_DEFAULT)
    assert set(report) == REPORT_KEYS
    assert report["totals"] == {
        "requests": 3,
        "unique_visitors": 2,
        "bandwidth_bytes": 30,
    }
    assert len(report["daily"]) == 30
    assert report["daily"][-1] == {
        "date": f"{Analytics.today():%Y-%m-%d}",
        "requests": 3,
        "unique_visitors": 2,
        "bandwidth_bytes": 30,
    }
    assert report["daily"][0]["requests"] == 0
    assert report["formats"] == {"hosts": 1, "plain": 1, "adblock": 1}
    assert sum(report["hourly"]) == 3 and len(report["hourly"]) == 24
    assert report["top_countries"] == [
        {"code": "GB", "requests": 2},
        {"code": "DE", "requests": 1},
    ]


def test_period_visitors_are_distinct_across_days_and_lists(database: Any) -> None:
    yesterday = datetime.utcnow() - timedelta(days=1)
    record(now=yesterday)
    record()
    record(list_name="ads")
    record(list_type=Analytics.TYPE_USER, username="sam", list_name="mine")
    record(
        list_type=Analytics.TYPE_USER,
        username="sam",
        list_name="mine",
        visitor_hash=OTHER_VISITOR,
    )

    default = Analytics.report(7, list_type=Analytics.TYPE_DEFAULT)
    assert default["totals"]["requests"] == 3
    assert default["totals"]["unique_visitors"] == 1
    assert [day["unique_visitors"] for day in default["daily"][-2:]] == [1, 1]

    admin = Analytics.admin_report(7)
    assert set(admin) == {"period_days", "overall", "default_lists", "user_lists"}
    assert admin["default_lists"]["totals"]["unique_visitors"] == 1
    assert admin["user_lists"]["totals"]["unique_visitors"] == 2
    assert admin["overall"]["totals"]["unique_visitors"] == 2
    assert admin["overall"]["totals"]["requests"] == 5
    assert admin["overall"]["daily"][-1]["unique_visitors"] == 2

    one_day = Analytics.report(1, list_type=Analytics.TYPE_DEFAULT)
    assert one_day["totals"]["requests"] == 2
    assert len(one_day["daily"]) == 1


def test_dots_and_dollars_stay_inside_one_key(database: Any) -> None:
    for _ in range(2):
        record(
            country="US",
            city="St. Louis $ilver",
            referrer="https://sub.example.com/a$b.c?x=$y",
        )
    record(referrer="https://exa$mple.com/list")
    record(referrer="not a url")
    record(country="$x", city="\x00\x1f")

    document = day_document(database)
    assert document["cities"] == {"US:St． Louis ＄ilver": 2}
    assert document["cities_keys"] == ["US:St． Louis ＄ilver"]
    assert document["referrers"] == {"sub,example,com": 2}
    assert document["countries"] == {"US": 2, "ZZ": 3}
    assert set(document) == {
        "_id",
        "schema_version",
        "list_type",
        "username",
        "list_name",
        "date",
        "requests",
        "bandwidth_bytes",
        "formats",
        "hours",
        "countries",
        "cities",
        "cities_keys",
        "referrers",
        "referrers_keys",
    }

    report = Analytics.report(1)
    assert report["top_cities"] == [
        {"country": "US", "city": "St. Louis $ilver", "requests": 2}
    ]
    assert report["top_referrers"] == [{"host": "sub.example.com", "requests": 2}]


def test_cities_and_referrers_are_capped_with_an_other_bucket(
    database: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Analytics, "MAX_CITIES_PER_DAY", 2)
    monkeypatch.setattr(Analytics, "MAX_REFERRERS_PER_DAY", 1)
    for city, host in (
        ("Leeds", "one.example"),
        ("York", "two.example"),
        ("Bath", "one.example"),
        ("Leeds", "three.example"),
        ("Hull", None),
    ):
        record(country="GB", city=city, referrer=f"https://{host}/" if host else None)

    document = day_document(database)
    assert document["requests"] == 5
    assert document["cities"] == {"GB:Leeds": 2, "GB:York": 1}
    assert document["cities_other"] == 2
    assert document["cities_keys"] == ["GB:Leeds", "GB:York"]
    assert document["referrers"] == {"one,example": 2}
    assert document["referrers_other"] == 2
    assert document["referrers_keys"] == ["one,example"]


def test_invalid_identity_is_rejected_before_any_write(database: Any) -> None:
    for overrides in (
        {"list_type": "other"},
        {"list_name": "a.b"},
        {"list_name": "$set"},
        {"username": "sam.x", "list_type": Analytics.TYPE_USER},
        {"format_type": "json"},
        {"visitor_hash": "203.0.113.9"},
    ):
        with pytest.raises(ValueError):
            record(**overrides)
    assert database[Analytics.COLLECTION].count_documents({}) == 0
    assert database[Analytics.VISITORS_COLLECTION].count_documents({}) == 0


def insert_legacy_documents(database: Any) -> None:
    today = Analytics.today()
    database[Analytics.COLLECTION].insert_many(
        [
            {
                "_id": ObjectId(),
                "list_type": "default",
                "list_name": "all_domains",
                "username": None,
                "date": today,
                "requests": 900,
                "unique_ips": 40,
                "ip_hashes": ["aaaa", "bbbb"],
                "formats": {"hosts": 900},
                "bandwidth_bytes": 9000,
                "geo": {"countries": {"GB": 900}, "cities": {"St": {" Louis": 1}}},
                "hourly_distribution": {"3": 900},
                "top_referrers": [{"url": "https://example.com", "count": 1}],
            },
            {
                "_id": "v2:default::broken:today",
                "schema_version": Analytics.SCHEMA_VERSION,
                "list_type": "default",
                "list_name": "broken",
                "username": None,
                "date": today,
                "requests": "many",
                "bandwidth_bytes": None,
                "formats": ["hosts"],
                "hours": {"h99": 4, "h03": "x"},
                "countries": "GB",
                "cities": {"GB:Leeds": -5},
                "referrers": 7,
            },
        ]
    )


def test_readers_ignore_legacy_and_malformed_documents(database: Any) -> None:
    insert_legacy_documents(database)
    record(country="GB")

    report = Analytics.report(30, list_type=Analytics.TYPE_DEFAULT)
    assert report["totals"] == {
        "requests": 1,
        "unique_visitors": 1,
        "bandwidth_bytes": 10,
    }
    assert report["formats"] == {"hosts": 1, "plain": 0, "adblock": 0}
    assert report["top_countries"] == [{"code": "GB", "requests": 1}]
    assert report["top_cities"] == []
    assert Analytics.get_default_list_totals() == {
        "total_requests": 1,
        "total_bandwidth": 10,
        "period_days": 90,
    }


def test_legacy_cleanup_script_only_deletes_when_applied(database: Any) -> None:
    insert_legacy_documents(database)
    record()

    preview = legacy_script.run(database)
    assert preview["legacy_documents"] == 1
    assert preview["current_documents"] == 2
    assert preview["deleted"] == 0 and preview["applied"] is False
    assert database[Analytics.COLLECTION].count_documents({}) == 3

    applied = legacy_script.run(database, apply=True)
    assert applied["deleted"] == 1
    assert database[Analytics.COLLECTION].count_documents({}) == 2
    assert (
        database[Analytics.COLLECTION].count_documents({"ip_hashes": {"$exists": 1}})
        == 0
    )


def test_missing_geoip_database_is_tolerated_and_reported_once(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    geoip.close_readers()
    missing = str(tmp_path / "absent.mmdb")
    with caplog.at_level(logging.INFO, logger=geoip.__name__):
        for _ in range(3):
            assert geoip.locate("", "203.0.113.9") == (None, None)
            assert geoip.locate(missing, "203.0.113.9") == (None, None)
    messages = [entry.getMessage() for entry in caplog.records]
    assert len(messages) == 2
    assert sum("absent.mmdb" in message for message in messages) == 1
    geoip.close_readers()


def test_geoip_database_is_opened_once_per_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    geoip.close_readers()
    reader = Mock()
    reader.city.return_value.country.iso_code = "GB"
    reader.city.return_value.city.name = "Leeds"
    opened = Mock(return_value=reader)
    monkeypatch.setattr(geoip.geoip2.database, "Reader", opened)

    assert geoip.locate("/example/GeoLite2-City.mmdb", "203.0.113.9") == (
        "GB",
        "Leeds",
    )
    reader.city.side_effect = AddressNotFoundError("not found")
    assert geoip.locate("/example/GeoLite2-City.mmdb", "203.0.113.10") == (None, None)
    opened.assert_called_once_with("/example/GeoLite2-City.mmdb")
    geoip.close_readers()
    reader.close.assert_called_once_with()


def test_download_is_recorded_with_a_keyed_hash_and_head_is_not(
    api: Flask, database: Any
) -> None:
    client = api.test_client()
    peer = {"REMOTE_ADDR": "203.0.113.9"}
    assert client.get("/lists/all_domains.txt", environ_overrides=peer).status_code == (
        200
    )
    assert client.get("/lists/all_domains.txt", environ_overrides=peer).status_code == (
        200
    )
    assert (
        client.head("/lists/all_domains.txt", environ_overrides=peer).status_code == 200
    )

    assert day_document(database)["requests"] == 2
    visitors = list(database[Analytics.VISITORS_COLLECTION].find())
    assert len(visitors) == 1
    assert "203.0.113.9" not in str(visitors) + str(day_document(database))
    with api.app_context():
        assert visitors[0]["visitor"] == download_recorder.visitor_hash("203.0.113.9")
        api.config["SECRET_KEY"] = "another-key"
        assert visitors[0]["visitor"] != download_recorder.visitor_hash("203.0.113.9")


def test_recording_failure_leaves_the_download_intact_and_logs_once_per_kind(
    api: Flask,
    database: Any,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    failing = Mock(
        side_effect=OperationFailure(
            "Updating the path 'ip_hashes' would create a conflict", code=40
        )
    )
    monkeypatch.setattr(Analytics, "record_download", failing)
    client = api.test_client()
    with caplog.at_level(logging.ERROR, logger=download_recorder.__name__):
        for _ in range(5):
            response = client.get("/lists/all_domains.txt")
            assert response.status_code == 200
            assert response.data == b"0.0.0.0 ads.example.com\n"
        failing.side_effect = ValueError("Unknown format")
        assert client.get("/lists/all_domains.txt").status_code == 200

    assert failing.call_count == 6
    messages = [entry.getMessage() for entry in caplog.records]
    assert len(messages) == 2
    assert "OperationFailure (MongoDB code 40)" in messages[0]
    assert "ip_hashes" in messages[0]
    assert "ValueError" in messages[1]
    assert all(entry.exc_info for entry in caplog.records)


def test_repeated_failures_are_reported_again_with_a_count() -> None:
    log = download_recorder.FailureLog(repeat_seconds=0)
    quiet = download_recorder.FailureLog(repeat_seconds=600)
    for _ in range(3):
        quiet.report("recording", ValueError("example"))
    assert quiet._suppressed == {("recording", "ValueError", None): 2}
    log.report("recording", ValueError("example"))
    assert log._suppressed == {}


def test_unreachable_database_pauses_recording(
    api: Flask, database: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = Mock(side_effect=ServerSelectionTimeoutError("no servers"))
    monkeypatch.setattr(Analytics, "record_download", failing)
    client = api.test_client()
    for _ in range(4):
        assert client.get("/lists/all_domains.txt").status_code == 200
    failing.assert_called_once()
    download_recorder.database_pause.reset()
    assert client.get("/lists/all_domains.txt").status_code == 200
    assert failing.call_count == 2


def test_geoip_failure_still_counts_the_download(
    api: Flask, database: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(geoip, "locate", Mock(side_effect=TypeError("wrong database")))
    assert api.test_client().get("/lists/all_domains.txt").status_code == 200
    document = day_document(database)
    assert document["requests"] == 1
    assert document["countries"] == {"ZZ": 1}


def test_user_endpoints_return_one_report_shape(
    api: Flask, database: Any, user: Mock
) -> None:
    record(list_type=Analytics.TYPE_USER, username="sam", list_name="mine")
    record(list_type=Analytics.TYPE_USER, username="alex", list_name="theirs")
    client = signed_in(api, user)

    assert api.test_client().get("/api/analytics/user").status_code == 401
    overview = client.get("/api/analytics/user?days=7")
    assert overview.status_code == 200
    assert set(overview.json) == REPORT_KEYS
    assert overview.json["period_days"] == 7
    assert overview.json["totals"]["requests"] == 1
    assert set(overview.json["daily"][0]) == {
        "date",
        "requests",
        "unique_visitors",
        "bandwidth_bytes",
    }

    single = client.get("/api/analytics/user/mine")
    assert single.status_code == 200
    assert set(single.json) == REPORT_KEYS | {"list_name"}
    assert single.json["period_days"] == 30
    assert single.json["totals"]["requests"] == 1

    assert client.get("/api/analytics/user?days=5000").json["period_days"] == 90
    assert client.get("/api/analytics/user?days=-3").json["period_days"] == 1
    assert client.get("/api/analytics/user?days=x").json["period_days"] == 30

    user.get_list.return_value = None
    assert client.get("/api/analytics/user/absent").status_code == 404


def test_admin_and_public_report_endpoints(
    api: Flask, database: Any, user: Mock
) -> None:
    record(country="GB", city="Leeds", referrer="https://example.com/")
    record(list_type=Analytics.TYPE_USER, username="sam", list_name="mine")
    client = signed_in(api, user)

    user.is_admin = False
    assert client.get("/api/analytics/admin").status_code == 403
    user.is_admin = True
    admin = client.get("/api/analytics/admin").json
    assert set(admin) == {"period_days", "overall", "default_lists", "user_lists"}
    for section in ("overall", "default_lists", "user_lists"):
        assert set(admin[section]) == REPORT_KEYS
    assert admin["overall"]["totals"]["requests"] == 2
    assert admin["overall"]["totals"]["unique_visitors"] == 1
    assert admin["default_lists"]["top_referrers"] == [
        {"host": "example.com", "requests": 1}
    ]

    public: Any = api.test_client().get("/api/analytics/default").json
    assert set(public) == {"period_days", "totals", "daily", "formats"}
    assert public["totals"]["requests"] == 1


def test_public_report_is_cached_for_each_clamped_period(
    api: Flask, database: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    record()
    client = api.test_client()
    aggregations: list[str] = []
    for collection in (Analytics.COLLECTION, Analytics.VISITORS_COLLECTION):
        aggregate = database[collection].aggregate

        def counted(
            *args: Any, _run: Any = aggregate, _name: str = collection, **kwargs: Any
        ) -> Any:
            aggregations.append(_name)
            return _run(*args, **kwargs)

        monkeypatch.setattr(database[collection], "aggregate", counted)

    first: Any = client.get("/api/analytics/default?days=7").json
    first_run = len(aggregations)
    assert Analytics.VISITORS_COLLECTION in aggregations
    record()
    assert client.get("/api/analytics/default?days=7").json == first
    assert len(aggregations) == first_run
    assert first["totals"]["requests"] == 1

    over_the_maximum: Any = client.get("/api/analytics/default?days=5000").json
    after_clamped_run = len(aggregations)
    assert after_clamped_run > first_run
    assert over_the_maximum["period_days"] == Analytics.RETENTION_DAYS
    assert (
        client.get(f"/api/analytics/default?days={Analytics.RETENTION_DAYS}").json
        == over_the_maximum
    )
    assert len(aggregations) == after_clamped_run

    site_stats.clear_caches()
    refreshed: Any = client.get("/api/analytics/default?days=7").json
    assert refreshed["totals"]["requests"] == 2


def test_public_stats_come_from_build_metadata_and_are_cached(
    api: Flask, database: Any
) -> None:
    database.system_config.insert_one({"_id": "default_build", "total_domains": 123456})
    database.users.insert_many(
        [{"username": "sam", "is_enabled": True}, {"username": "alex"}]
    )
    record(size_bytes=50)
    client = api.test_client()

    expected = {
        "total_domains": 123456,
        "total_requests": 1,
        "total_bandwidth_bytes": 50,
        "user_count": 1,
        "period_days": 90,
    }
    assert client.get("/api/analytics/public/stats").json == expected

    database.system_config.update_one(
        {"_id": "default_build"}, {"$set": {"total_domains": 5}}
    )
    record()
    assert client.get("/api/analytics/public/stats").json == expected

    site_stats.clear_caches()
    refreshed: Any = client.get("/api/analytics/public/stats").json
    assert refreshed["total_domains"] == 5
    assert refreshed["total_requests"] == 2


def test_public_stats_without_a_build_report_zero_domains(
    api: Flask, database: Any
) -> None:
    assert api.test_client().get("/api/analytics/public/stats").json == {
        "total_domains": 0,
        "total_requests": 0,
        "total_bandwidth_bytes": 0,
        "user_count": 0,
        "period_days": 90,
    }


def test_admin_stats_keep_their_shape_and_cache_the_storage_walk(
    api: Flask, database: Any, user: Mock, tmp_path: Path
) -> None:
    user.is_admin = True
    client = signed_in(api, user)
    record(size_bytes=7)

    first = client.get("/api/admin/stats").json
    assert set(first) == {"users", "jobs", "storage", "analytics", "workers", "limits"}
    assert set(first["workers"]) == {"alive"}
    assert set(first["users"]) == {"total", "active"}
    assert set(first["jobs"]) == {"today", "processing", "queued"}
    assert set(first["storage"]) == {
        "cache_bytes",
        "total_bytes",
        "cache_mb",
        "total_mb",
    }
    assert first["analytics"] == {
        "total_requests": 1,
        "total_bandwidth": 7,
        "period_days": 90,
    }
    assert first["storage"]["total_bytes"] > 0

    (tmp_path / "extra.bin").write_bytes(b"x" * 4096)
    assert client.get("/api/admin/stats").json["storage"] == first["storage"]
    site_stats.clear_caches()
    assert (
        client.get("/api/admin/stats").json["storage"]["total_bytes"]
        == first["storage"]["total_bytes"] + 4096
    )


@pytest.fixture
def real_database(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    uri = os.environ.get("ANALYTICS_TEST_MONGO_URI")
    if not uri:
        pytest.skip("ANALYTICS_TEST_MONGO_URI is not set")
    client: MongoClient[dict[str, Any]] = MongoClient(
        uri, serverSelectionTimeoutMS=5000
    )
    name = f"analytics_test_{uuid4().hex}"
    db = client[name]
    monkeypatch.setattr(mongo, "db", db)
    reset_process_state()
    ensure_indexes(db)
    yield db
    client.drop_database(name)
    client.close()
    reset_process_state()


def test_concurrent_downloads_on_mongodb_count_exactly(
    real_database: Any, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    application = build_api(tmp_path)

    def download(index: int) -> int:
        response = application.test_client().get(
            "/lists/all_domains.txt",
            headers={"Referer": f"https://site{index % 7}.example.com/a$b.c"},
            environ_overrides={"REMOTE_ADDR": f"203.0.113.{index % 50 + 1}"},
        )
        return response.status_code

    with caplog.at_level(logging.WARNING):
        with ThreadPoolExecutor(max_workers=32) as pool:
            statuses = list(pool.map(download, range(200)))

    assert statuses == [200] * 200
    assert [entry.getMessage() for entry in caplog.records] == []
    document = day_document(real_database)
    assert document["requests"] == 200
    assert sum(document["referrers"].values()) == 200
    assert len(document["referrers_keys"]) == 7
    assert real_database[Analytics.VISITORS_COLLECTION].count_documents({}) == 50
    report = Analytics.report(1, list_type=Analytics.TYPE_DEFAULT)
    assert report["totals"]["requests"] == 200
    assert report["totals"]["unique_visitors"] == 50
    assert report["daily"][0]["unique_visitors"] == 50


def test_concurrent_caps_on_mongodb_are_exact(
    real_database: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Analytics, "MAX_CITIES_PER_DAY", 5)
    monkeypatch.setattr(Analytics, "MAX_REFERRERS_PER_DAY", 3)

    def write(index: int) -> None:
        record(
            visitor_hash=f"{index % 50:016x}",
            country="US",
            city=f"St. City ${index % 40}",
            referrer=f"https://host{index % 11}.example.com/",
        )

    with ThreadPoolExecutor(max_workers=32) as pool:
        list(pool.map(write, range(400)))

    document = day_document(real_database)
    assert document["requests"] == 400
    assert len(document["cities_keys"]) == 5
    assert set(document["cities"]) == set(document["cities_keys"])
    assert sum(document["cities"].values()) + document["cities_other"] == 400
    assert len(document["referrers_keys"]) == 3
    assert sum(document["referrers"].values()) + document["referrers_other"] == 400
    assert real_database[Analytics.VISITORS_COLLECTION].count_documents({}) == 50


def winning_stages(plan: dict[str, Any]) -> set[str]:
    stages = {plan.get("stage", "")}
    for key in ("inputStage", "inputStages"):
        child = plan.get(key)
        for nested in child if isinstance(child, list) else [child] if child else []:
            stages |= winning_stages(nested)
    return stages


def test_report_queries_on_mongodb_use_indexes(real_database: Any) -> None:
    record(list_type=Analytics.TYPE_USER, username="sam", list_name="mine")
    for scope in (
        {"list_type": "user", "username": "sam"},
        {"list_type": "user", "username": "sam", "list_name": "mine"},
        {"list_type": "default"},
        {},
    ):
        match = {**scope, "date": {"$gte": Analytics.today()}}
        for collection in (Analytics.COLLECTION, Analytics.VISITORS_COLLECTION):
            plan = real_database[collection].find(match).explain()
            stages = winning_stages(plan["queryPlanner"]["winningPlan"])
            assert "IXSCAN" in stages and "COLLSCAN" not in stages

    indexes = real_database[Analytics.COLLECTION].index_information()
    assert indexes["analytics_retention"]["expireAfterSeconds"] == 90 * 86400
