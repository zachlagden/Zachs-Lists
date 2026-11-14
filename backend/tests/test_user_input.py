from typing import Any

import pytest
from bson import ObjectId
from flask.testing import FlaskClient

from app.models.announcement import Announcement
from app.models.job import Job
from app.models.system_config import SystemConfig
from app.models.user import User
from app.services.build_admission import DEFAULT_TARGET, admit_build
from app.utils.validators import WhitelistValidationUnavailable
from conftest import VALID_SOURCES, Api

TWO_SOURCES = f"{VALID_SOURCES}\nhttps://example.org/hosts.txt|Second|advertising"


@pytest.fixture
def sam(api: Api) -> User:
    return api.account(4001, "sam")


@pytest.fixture
def client(api: Api, sam: User) -> FlaskClient:
    return api.client(sam)


def refusal(response: Any, field: str | None) -> dict[str, Any]:
    assert response.status_code == 400, response.get_data(as_text=True)
    body = response.get_json()
    assert body.get("field") == field
    assert body["error"] and body["code"]
    return body


def stored_config(api: Api, name: str = "sam") -> dict[str, Any]:
    return api.db.users.find_one({"username": name}).get("config", {})


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ("[]", None),
        ('"text"', None),
        ("null", None),
        ("{}", "whitelist"),
        ('{"whitelist": 5}', "whitelist"),
        ('{"whitelist": null}', "whitelist"),
        ('{"whitelist": ["a.example.com"]}', "whitelist"),
        ('{"whitelist": "\\ud800"}', "whitelist"),
        ("", "whitelist"),
    ],
)
def test_whitelist_update_refuses_malformed_bodies(
    api: Api, client: FlaskClient, body: str, field: str | None
) -> None:
    api.db.users.update_one(
        {"username": "sam"}, {"$set": {"config.whitelist": "kept.example.com"}}
    )
    response = client.put(
        "/api/user/whitelist", data=body, content_type="application/json"
    )
    refusal(response, field)
    assert stored_config(api)["whitelist"] == "kept.example.com"
    api.whitelist_check.assert_not_called()


def test_whitelist_update_still_saves_valid_text(api: Api, client: FlaskClient) -> None:
    saved = client.put("/api/user/whitelist", json={"whitelist": "a.example.com"})
    assert saved.status_code == 200
    assert stored_config(api)["whitelist"] == "a.example.com"
    emptied = client.put("/api/user/whitelist", json={"whitelist": ""})
    assert emptied.status_code == 200
    assert stored_config(api)["whitelist"] == ""


def test_config_with_unencodable_text_is_refused_by_the_shared_guard(
    client: FlaskClient,
) -> None:
    response = client.post(
        "/api/user/config/validate",
        data='{"config": "\\udfff"}',
        content_type="application/json",
    )
    refusal(response, "config")


@pytest.mark.parametrize(
    "urls",
    [None, "https://example.com", [], [5], [None], [{"a": 1}], [["x"]], ["x"] * 101],
)
def test_url_metadata_refuses_anything_but_a_list_of_strings(
    client: FlaskClient, urls: Any
) -> None:
    refusal(client.post("/api/user/config/url-metadata", json={"urls": urls}), "urls")


def test_url_metadata_answers_for_strings(client: FlaskClient) -> None:
    response = client.post(
        "/api/user/config/url-metadata", json={"urls": ["https://example.com/a.txt"]}
    )
    assert response.get_json() == {
        "https://example.com/a.txt": {"domain_count": None, "cached": False}
    }


def test_domain_tiers_come_from_the_configuration(
    api: Api, client: FlaskClient
) -> None:
    body = client.get("/api/user/limit-request").get_json()
    assert body["current_limit"] == api.app.config["DEFAULT_MAX_DOMAINS"] == 4_000_000
    assert body["available_tiers"] == [10_000_000, 20_000_000]
    assert body["max_limit"] == api.app.config["MAX_DOMAINS_LIMIT"] == 20_000_000

    api.app.config["DOMAIN_TIERS"] = [4_000_000, 6_000_000]
    assert client.get("/api/user/limit-request").get_json()["available_tiers"] == [
        6_000_000
    ]
    accepted = client.post(
        "/api/user/limit-request",
        json={"requested_tier": 6_000_000, "reason": "A reason for more"},
    )
    assert accepted.status_code == 201


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"requested_tier": None}, "requested_tier"),
        ({"requested_tier": "10000000"}, "requested_tier"),
        ({"requested_tier": [10_000_000]}, "requested_tier"),
        ({"requested_tier": 5_000_000}, "requested_tier"),
        ({"requested_tier": 12_000_000}, "requested_tier"),
        ({"reason": None}, "reason"),
        ({"reason": 5}, "reason"),
        ({"reason": "too short"}, "reason"),
        ({"reason": "r" * 1001}, "reason"),
        ({"intended_use": "resale"}, "intended_use"),
        ({"intended_use": ["personal"]}, "intended_use"),
    ],
)
def test_limit_request_input_is_validated(
    api: Api, client: FlaskClient, changes: dict[str, Any], field: str
) -> None:
    body = {"requested_tier": 10_000_000, "reason": "A reason for more", **changes}
    refusal(client.post("/api/user/limit-request", json=body), field)
    assert api.db.limit_requests.count_documents({}) == 0


def test_limit_request_without_a_body_is_refused(client: FlaskClient) -> None:
    refusal(client.post("/api/user/limit-request"), "requested_tier")


def use_template(client: FlaskClient, body: Any = None) -> Any:
    return client.post("/api/user/copy-default-template", json=body or {})


def test_template_over_the_source_limit_is_refused_without_truncating(
    api: Api, client: FlaskClient
) -> None:
    SystemConfig.update_default_config(TWO_SOURCES, "allowed.example.com", "robin")
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "limits": {"max_source_lists": 1},
                "config": {"blocklists": "", "whitelist": "mine.example.com"},
            }
        },
    )

    response = use_template(client, {"overwrite": True})

    assert response.status_code == 400
    body = response.get_json()
    assert body["code"] == "template_exceeds_limit"
    assert "2 sources" in body["error"] and "limit is 1" in body["error"]
    assert stored_config(api) == {"blocklists": "", "whitelist": "mine.example.com"}


def test_template_replaces_both_files_with_one_revision_bump(
    api: Api, client: FlaskClient
) -> None:
    SystemConfig.update_default_config(TWO_SOURCES, "", "robin")
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "config": {
                    "blocklists": VALID_SOURCES,
                    "whitelist": "mine.example.com",
                    "revision": 6,
                }
            }
        },
    )

    conflict = use_template(client)
    assert conflict.status_code == 409
    assert conflict.get_json()["has_existing"] is True
    refusal(use_template(client, {"overwrite": "true"}), "overwrite")
    assert stored_config(api)["revision"] == 6

    response = use_template(client, {"overwrite": True})

    assert response.status_code == 200
    assert response.get_json()["copied"] == {
        "blocklists_conf": True,
        "whitelist_txt": False,
    }
    config = stored_config(api)
    assert (config["blocklists"], config["whitelist"], config["revision"]) == (
        TWO_SOURCES,
        "",
        7,
    )
    api.whitelist_check.assert_not_called()


def test_template_is_validated_before_it_is_copied(
    api: Api, client: FlaskClient
) -> None:
    assert use_template(client).status_code == 404

    SystemConfig.update_default_config("not a url|Bad|tracking", "", "robin")
    invalid = use_template(client)
    assert invalid.status_code == 400
    assert invalid.get_json()["code"] == "template_invalid"
    assert invalid.get_json()["details"] == ["Line 1: Invalid or unsafe source URL"]

    SystemConfig.update_default_config(VALID_SOURCES, "allowed.example.com", "robin")
    api.whitelist_check.side_effect = WhitelistValidationUnavailable("down")
    assert use_template(client).status_code == 503
    assert stored_config(api) == {}

    api.whitelist_check.side_effect = None
    copied = use_template(client)
    assert copied.status_code == 200
    config = stored_config(api)
    assert (config["blocklists"], config["whitelist"], config["revision"]) == (
        VALID_SOURCES,
        "allowed.example.com",
        1,
    )


def test_default_list_jobs_are_visible_to_admins_only(
    api: Api, client: FlaskClient, sam: User
) -> None:
    SystemConfig.update_default_config(VALID_SOURCES, "", "robin")
    api.db.users.update_one(
        {"username": "sam"}, {"$set": {"config.blocklists": VALID_SOURCES}}
    )
    alex = api.account(4002, "alex", **{"config.blocklists": VALID_SOURCES})
    admin = api.account(4003, "robin", is_admin=True)
    default_job = admit_build(DEFAULT_TARGET, Job.TYPE_ADMIN, admin, True)
    sam_job = admit_build(api.reload(sam), Job.TYPE_SCHEDULED, None)
    alex_job = admit_build(alex, Job.TYPE_SCHEDULED, None)
    assert api.db.jobs.find_one({"job_id": default_job.job_id})["user_id"] is None

    def status(viewer: FlaskClient, job: Job) -> int:
        return viewer.get(f"/api/user/jobs/{job.job_id}").status_code

    assert status(client, default_job) == 404
    assert status(client, alex_job) == 404
    assert status(client, sam_job) == 200
    admin_client = api.client(admin)
    assert status(admin_client, default_job) == 200
    assert status(admin_client, alex_job) == 404
    assert client.get("/api/user/jobs/missing").status_code == 404


def test_only_existing_announcements_can_be_dismissed(
    api: Api, client: FlaskClient
) -> None:
    refusal(client.post("/api/user/announcements/not-an-id/dismiss"), "announcement_id")
    unknown = client.post(f"/api/user/announcements/{ObjectId()}/dismiss")
    assert unknown.status_code == 404
    assert "dismissed_announcements" not in api.db.users.find_one({"username": "sam"})

    announcement = Announcement.create("Title", "Text")
    dismissed = client.post(f"/api/user/announcements/{announcement.id}/dismiss")
    assert dismissed.status_code == 200
    assert client.get("/api/user/announcements").get_json()["announcements"] == []


def test_community_listing_route_is_gone(api: Api, client: FlaskClient) -> None:
    assert api.client().get("/api/browse/community").status_code == 404
    assert client.get("/api/browse/community").status_code == 404
    assert api.client().get("/api/browse/featured").status_code == 200
