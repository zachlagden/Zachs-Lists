from datetime import datetime, timedelta
from typing import Any

import pytest
from bson import ObjectId
from flask.testing import FlaskClient

from app.db_indexes import INDEXES, prepare_pending_limit_requests
from app.models.limit_request import LimitRequest, PendingRequestExists
from app.models.user import User
from app.utils.validators import WhitelistValidationUnavailable
from conftest import ROOT_GITHUB_ID, VALID_SOURCES, Api


@pytest.fixture
def admin(api: Api) -> User:
    return api.account(3001, "robin", is_admin=True)


@pytest.fixture
def sam(api: Api) -> User:
    return api.account(
        3002,
        "sam",
        email="sam@example.com",
        lists=[{"name": "all_domains", "domain_count": 5}],
    )


@pytest.fixture
def admin_client(api: Api, admin: User) -> FlaskClient:
    return api.client(admin)


def refusal(response: Any, field: str | None) -> dict[str, Any]:
    assert response.status_code == 400, response.get_data(as_text=True)
    body = response.get_json()
    assert body["field"] == field
    assert body["error"] and body["code"]
    return body


def test_featured_removal_rejects_a_malformed_id(admin_client: FlaskClient) -> None:
    refusal(admin_client.delete("/api/admin/featured/undefined"), "featured_id")
    missing = admin_client.delete(f"/api/admin/featured/{ObjectId()}")
    assert missing.status_code == 404


def test_featured_add_returns_the_item_and_refuses_bad_input(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    refusal(admin_client.post("/api/admin/featured", json={}), "username")
    refusal(
        admin_client.post(
            "/api/admin/featured", json={"username": "sam", "list_name": 7}
        ),
        "list_name",
    )
    refusal(
        admin_client.post(
            "/api/admin/featured",
            json={"username": "sam", "list_name": "all_domains", "description": []},
        ),
        "description",
    )

    added = admin_client.post(
        "/api/admin/featured",
        json={"username": "sam", "list_name": "all_domains", "description": "Good"},
    )
    assert added.status_code == 200
    item = added.get_json()["featured"]
    assert item == {
        "id": added.get_json()["id"],
        "username": "sam",
        "list_name": "all_domains",
        "description": "Good",
        "order": 1,
    }
    assert admin_client.get("/api/admin/featured").get_json()["featured"] == [item]

    again = admin_client.post(
        "/api/admin/featured", json={"username": "sam", "list_name": "all_domains"}
    )
    assert again.status_code == 409
    assert admin_client.delete(f"/api/admin/featured/{item['id']}").status_code == 200
    assert api.db.featured_lists.count_documents({}) == 0


def test_public_featured_lists_follow_the_admin_order(api: Api, sam: User) -> None:
    api.db.users.update_one(
        {"username": "sam"},
        {
            "$set": {
                "lists": [
                    {"name": name, "domain_count": 1}
                    for name in ("first", "second", "third", "legacy")
                ]
            }
        },
    )
    api.db.featured_lists.insert_many(
        [
            {"username": "sam", "list_name": "third", "order": 3},
            {"username": "sam", "list_name": "first", "order": 1},
            {"username": "sam", "list_name": "legacy", "display_order": 9},
            {"username": "sam", "list_name": "second", "order": 2},
        ]
    )

    featured = api.client().get("/api/browse/featured").get_json()

    assert [entry["list_name"] for entry in featured] == [
        "legacy",
        "first",
        "second",
        "third",
    ]
    assert [entry["order"] for entry in featured] == [0, 1, 2, 3]
    assert "display_order" not in featured[0]


def test_featured_lists_hide_banned_owners(api: Api, sam: User) -> None:
    api.db.featured_lists.insert_one(
        {"username": "sam", "list_name": "all_domains", "order": 1}
    )
    assert len(api.client().get("/api/browse/featured").get_json()) == 1
    sam.ban(datetime.utcnow() + timedelta(days=1), "example")
    assert api.client().get("/api/browse/featured").get_json() == []


def test_admin_library_listing_uses_the_library_key(admin_client: FlaskClient) -> None:
    body = admin_client.get("/api/admin/library").get_json()
    assert body["library"] == []
    assert "entries" not in body


@pytest.mark.parametrize(
    ("limits", "field"),
    [
        ({"max_domains": 0}, "limits.max_domains"),
        ({"max_domains": -5}, "limits.max_domains"),
        ({"max_domains": "4000000"}, "limits.max_domains"),
        ({"max_domains": 1.5}, "limits.max_domains"),
        ({"max_domains": True}, "limits.max_domains"),
        ({"max_domains": 20_000_001}, "limits.max_domains"),
        ({"max_source_lists": 1001}, "limits.max_source_lists"),
        ({"max_config_size_mb": 11}, "limits.max_config_size_mb"),
        ({"manual_updates_per_week": 101}, "limits.manual_updates_per_week"),
        ({"unknown": 5}, "limits.unknown"),
        ([1, 2], "limits"),
        ("many", "limits"),
    ],
)
def test_invalid_limits_are_refused_by_field(
    api: Api, admin_client: FlaskClient, sam: User, limits: Any, field: str
) -> None:
    refusal(
        admin_client.put(f"/api/admin/users/{sam.id}", json={"limits": limits}), field
    )
    assert api.db.users.find_one({"username": "sam"})["limits"] == {}


def test_a_not_a_number_limit_is_refused(admin_client: FlaskClient, sam: User) -> None:
    response = admin_client.put(
        f"/api/admin/users/{sam.id}",
        data='{"limits": {"max_domains": NaN}}',
        content_type="application/json",
    )
    refusal(response, "limits.max_domains")


def test_limits_are_stored_as_overrides_of_the_defaults(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    defaults = User.default_limits()
    assert defaults == {
        "max_source_lists": 50,
        "max_domains": 4_000_000,
        "max_config_size_mb": 10,
        "manual_updates_per_week": 3,
    }
    saved = admin_client.put(
        f"/api/admin/users/{sam.id}",
        json={"limits": {**defaults, "max_domains": 10_000_000}},
    )
    assert saved.status_code == 200
    body = saved.get_json()
    assert body["limits"] == {**defaults, "max_domains": 10_000_000}
    assert body["default_limits"] == defaults
    assert body["limit_maximums"]["max_domains"] == 20_000_000
    assert api.db.users.find_one({"username": "sam"})["limits"] == {
        "max_domains": 10_000_000
    }

    partial = admin_client.put(
        f"/api/admin/users/{sam.id}", json={"limits": {"max_source_lists": 80}}
    )
    assert partial.status_code == 200
    assert api.db.users.find_one({"username": "sam"})["limits"] == {
        "max_domains": 10_000_000,
        "max_source_lists": 80,
    }

    reset = admin_client.put(f"/api/admin/users/{sam.id}", json={"limits": defaults})
    assert reset.status_code == 200
    assert api.db.users.find_one({"username": "sam"})["limits"] == {}


def test_enabled_and_admin_flags_must_be_booleans(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    not_booleans: list[Any] = ["false", 0, 1, [], {}]
    for value in not_booleans:
        refusal(
            admin_client.put(f"/api/admin/users/{sam.id}", json={"is_enabled": value}),
            "is_enabled",
        )
    assert api.reload(sam).is_enabled is True
    disabled = admin_client.put(
        f"/api/admin/users/{sam.id}", json={"is_enabled": False}
    )
    assert disabled.status_code == 200
    assert api.reload(sam).is_enabled is False

    root = api.account(ROOT_GITHUB_ID, "root")
    root_client = api.client(root)
    for body in ({}, {"is_admin": "true"}, {"is_admin": 1}, {"is_admin": None}):
        refusal(
            root_client.put(f"/api/admin/users/{sam.id}/admin", json=body), "is_admin"
        )
    assert api.reload(sam).is_admin is False
    promoted = root_client.put(
        f"/api/admin/users/{sam.id}/admin", json={"is_admin": True}
    )
    assert promoted.status_code == 200
    assert api.reload(sam).is_admin is True


def test_ban_input_is_validated(admin_client: FlaskClient, sam: User) -> None:
    refusal(admin_client.post(f"/api/admin/users/{sam.id}/ban"), "duration")
    refusal(
        admin_client.post(f"/api/admin/users/{sam.id}/ban", json={"duration": ["1d"]}),
        "duration",
    )
    refusal(
        admin_client.post(
            f"/api/admin/users/{sam.id}/ban", json={"duration": "1d", "reason": 5}
        ),
        "reason",
    )
    banned = admin_client.post(
        f"/api/admin/users/{sam.id}/ban", json={"duration": "1d", "reason": "example"}
    )
    assert banned.status_code == 200


def test_user_search_treats_input_as_literal_text(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    api.account(3003, "abc")
    api.account(3004, "a-c", email="dot.name@example.com")

    for pattern in ("(", "[a-", "(?P<x", "*", "\\", "a{1,999999}{1,999999}"):
        response = admin_client.get(
            "/api/admin/users", query_string={"search": pattern}
        )
        assert response.status_code == 200
        assert response.get_json()["users"] == []

    wildcard = admin_client.get("/api/admin/users", query_string={"search": "a.c"})
    assert wildcard.get_json()["users"] == []
    literal = admin_client.get("/api/admin/users", query_string={"search": "t.NAME@"})
    assert [user["username"] for user in literal.get_json()["users"]] == ["a-c"]
    long_search = admin_client.get(
        "/api/admin/users", query_string={"search": "s" * 5000}
    )
    assert long_search.status_code == 200


@pytest.mark.parametrize(
    ("query", "page", "per_page"),
    [
        ({"page": 0}, 1, 25),
        ({"page": -3, "per_page": 0}, 1, 1),
        ({"page": "abc", "per_page": "abc"}, 1, 25),
        ({"page": 2, "per_page": 100000}, 2, 100),
        ({"page": 10**30, "per_page": -10}, 100_000, 1),
    ],
)
def test_user_listing_clamps_pagination(
    admin_client: FlaskClient,
    sam: User,
    query: dict[str, Any],
    page: int,
    per_page: int,
) -> None:
    response = admin_client.get("/api/admin/users", query_string=query)
    assert response.status_code == 200
    body = response.get_json()
    assert (body["page"], body["per_page"]) == (page, per_page)
    assert body["total"] == 1


@pytest.mark.parametrize(
    "path",
    [
        "/api/admin/jobs?limit=-1",
        "/api/admin/jobs?limit=0",
        "/api/admin/jobs?limit=99999999999999999999",
        "/api/admin/stats/jobs-per-day?days=-5",
        "/api/admin/stats/jobs-per-day?days=99999999999",
        "/api/admin/stats/user-growth?days=0",
        "/api/admin/stats/user-growth?days=99999999999",
        "/api/admin/announcements?limit=-1",
        "/api/user/jobs?limit=-1",
        "/api/user/jobs?limit=99999999999999999999",
    ],
)
def test_numeric_query_parameters_are_clamped(
    admin_client: FlaskClient, path: str
) -> None:
    assert admin_client.get(path).status_code == 200


def test_role_filter_finds_root_without_a_stored_flag(api: Api, sam: User) -> None:
    root = api.account(ROOT_GITHUB_ID, "zed-root")
    api.account(3005, "amy-admin", is_admin=True)
    api.account(3006, "bob", is_admin=False)
    assert "is_root" not in api.db.users.find_one({"username": "zed-root"})
    viewer = api.client(api.account(3007, "viewer", is_admin=True))

    def names(**filters: bool) -> list[str]:
        query = {
            "show_admins": True,
            "show_regular": True,
            "show_enabled": True,
            "show_disabled": True,
            **filters,
        }
        response = viewer.get(
            "/api/admin/users",
            query_string={key: str(value).lower() for key, value in query.items()},
        )
        assert response.status_code == 200
        return [user["username"] for user in response.get_json()["users"]]

    assert names() == ["zed-root", "amy-admin", "bob", "sam"]
    assert names(show_regular=False) == ["zed-root", "amy-admin"]
    assert names(show_admins=False) == ["bob", "sam"]
    assert names(show_admins=False, show_regular=False) == []
    root.set_enabled(False)
    assert names(show_enabled=False) == ["zed-root"]
    assert names(show_disabled=False) == ["amy-admin", "bob", "sam"]
    assert names(show_enabled=False, show_disabled=False) == []


def test_announcement_text_is_required_on_create_and_update(
    api: Api, admin_client: FlaskClient
) -> None:
    refusal(admin_client.post("/api/admin/announcements"), "title")
    refusal(
        admin_client.post(
            "/api/admin/announcements", json={"title": 5, "message": "Text"}
        ),
        "title",
    )
    refusal(
        admin_client.post(
            "/api/admin/announcements", json={"title": "Title", "message": "   "}
        ),
        "message",
    )
    refusal(
        admin_client.post(
            "/api/admin/announcements",
            json={"title": "Title", "message": "Text", "type": "loud"},
        ),
        "type",
    )
    created = admin_client.post(
        "/api/admin/announcements", json={"title": " Title ", "message": "Text"}
    )
    assert created.status_code == 201
    announcement = created.get_json()["announcement"]
    assert announcement["title"] == "Title"
    path = f"/api/admin/announcements/{announcement['id']}"

    refusal(admin_client.put(path, json={"title": "  "}), "title")
    refusal(admin_client.put(path, json={"title": None}), "title")
    refusal(admin_client.put(path, json={"message": ["x"]}), "message")
    refusal(admin_client.put(path, json={"message": ""}), "message")
    refusal(admin_client.put(path, json={"is_active": "no"}), "is_active")
    refusal(admin_client.put(path, json={"type": 3}), "type")
    stored = api.db.announcements.find_one()
    assert (stored["title"], stored["message"], stored["is_active"]) == (
        "Title",
        "Text",
        True,
    )


def test_announcement_expiry_is_stored_in_utc_and_can_be_cleared(
    api: Api, admin_client: FlaskClient
) -> None:
    for invalid in ("soon", "2026-12-01T10:00", 5, ["2026-12-01T10:00:00Z"]):
        refusal(
            admin_client.post(
                "/api/admin/announcements",
                json={"title": "Title", "message": "Text", "expires_at": invalid},
            ),
            "expires_at",
        )
    created = admin_client.post(
        "/api/admin/announcements",
        json={
            "title": "Title",
            "message": "Text",
            "expires_at": "2026-12-01T10:00:00+02:00",
        },
    )
    announcement = created.get_json()["announcement"]
    assert announcement["expires_at"] == "2026-12-01T08:00:00.000Z"
    assert api.db.announcements.find_one()["expires_at"] == datetime(2026, 12, 1, 8)
    path = f"/api/admin/announcements/{announcement['id']}"

    untouched = admin_client.put(path, json={"message": "Edited"})
    assert untouched.get_json()["announcement"]["expires_at"] == (
        "2026-12-01T08:00:00.000Z"
    )
    moved = admin_client.put(path, json={"expires_at": "2026-12-02T09:30:00.000Z"})
    assert moved.get_json()["announcement"]["expires_at"] == "2026-12-02T09:30:00.000Z"
    refusal(
        admin_client.put(path, json={"expires_at": "2026-12-02T09:30"}), "expires_at"
    )

    cleared = admin_client.put(path, json={"expires_at": None})
    assert cleared.status_code == 200
    assert cleared.get_json()["announcement"]["expires_at"] is None
    assert api.db.announcements.find_one()["expires_at"] is None


LIBRARY_ENTRY = {
    "url": "https://example.com/list.txt",
    "name": "Example",
    "category": "tracking",
}


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"url": None}, "url"),
        ({"url": 5}, "url"),
        ({"url": "ftp://example.com/list.txt"}, "url"),
        ({"url": "http://localhost/list.txt"}, "url"),
        ({"url": "https://user:secret@example.com/list.txt"}, "url"),
        ({"name": None}, "name"),
        ({"name": ["x"]}, "name"),
        ({"name": "n" * 101}, "name"),
        ({"category": None}, "category"),
        ({"category": "games"}, "category"),
        ({"category": ["tracking"]}, "category"),
        ({"description": 5}, "description"),
        ({"recommended": "yes"}, "recommended"),
        ({"aggressiveness": "3"}, "aggressiveness"),
        ({"aggressiveness": 0}, "aggressiveness"),
        ({"aggressiveness": 6}, "aggressiveness"),
        ({"aggressiveness": 2.5}, "aggressiveness"),
        ({"domain_count": "many"}, "domain_count"),
        ({"domain_count": -1}, "domain_count"),
        ({"domain_count": 10**12}, "domain_count"),
    ],
)
def test_library_entries_are_validated_on_create_and_update(
    api: Api, admin_client: FlaskClient, changes: dict[str, Any], field: str
) -> None:
    refusal(
        admin_client.post("/api/admin/library", json={**LIBRARY_ENTRY, **changes}),
        field,
    )
    assert api.db.blocklist_library.count_documents({}) == 0

    created = admin_client.post("/api/admin/library", json=LIBRARY_ENTRY)
    assert created.status_code == 201
    entry = created.get_json()["entry"]
    assert (entry["aggressiveness"], entry["domain_count"]) == (3, 0)
    if changes[next(iter(changes))] is not None:
        refusal(
            admin_client.put(f"/api/admin/library/{entry['id']}", json=changes), field
        )
    assert api.db.blocklist_library.find_one()["name"] == "Example"


def test_library_entry_accepts_valid_fields_and_refuses_duplicates(
    admin_client: FlaskClient,
) -> None:
    refusal(admin_client.post("/api/admin/library"), "url")
    created = admin_client.post(
        "/api/admin/library",
        json={
            **LIBRARY_ENTRY,
            "description": None,
            "recommended": True,
            "aggressiveness": 5,
            "domain_count": 1200,
        },
    )
    assert created.status_code == 201
    entry = created.get_json()["entry"]
    assert (entry["recommended"], entry["aggressiveness"], entry["domain_count"]) == (
        True,
        5,
        1200,
    )
    assert (
        admin_client.post("/api/admin/library", json=LIBRARY_ENTRY).status_code == 409
    )
    updated = admin_client.put(
        f"/api/admin/library/{entry['id']}",
        json={"aggressiveness": 1, "description": "Short"},
    )
    assert updated.status_code == 200
    assert updated.get_json()["entry"]["aggressiveness"] == 1
    assert updated.get_json()["entry"]["name"] == "Example"


def pending_request(api: Api, account: User) -> LimitRequest:
    return LimitRequest.create(account, 10_000_000, "A reason for more", "personal")


def test_two_admins_cannot_both_act_on_a_limit_request(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    created = pending_request(api, sam)
    first_view = LimitRequest.get_by_id(str(created.id))
    second_view = LimitRequest.get_by_id(str(created.id))
    assert first_view is not None and second_view is not None

    assert first_view.approve("robin") is True
    assert second_view.approve("alex", approved_limit=20_000_000) is False
    assert second_view.deny("alex") is False

    stored = api.db.limit_requests.find_one()
    assert (stored["status"], stored["approved_limit"], stored["reviewed_by"]) == (
        "approved",
        10_000_000,
        "robin",
    )
    account = api.reload(sam)
    assert account.limits["max_domains"] == 10_000_000
    assert len(account.notifications) == 1


def test_limit_request_routes_return_conflict_once_handled(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    created = pending_request(api, sam)
    approve = f"/api/admin/limit-requests/{created.id}/approve"
    deny = f"/api/admin/limit-requests/{created.id}/deny"

    for invalid in ("5000000", 1.5, True, 3_999_999, 20_000_001):
        refusal(
            admin_client.post(approve, json={"custom_limit": invalid}), "custom_limit"
        )
    refusal(admin_client.post(approve, json={"response": 5}), "response")
    refusal(admin_client.post(deny, json={"response": ["no"]}), "response")
    assert api.db.limit_requests.find_one()["status"] == "pending"

    approved = admin_client.post(approve, json={"custom_limit": 5_000_000})
    assert approved.status_code == 200
    assert approved.get_json()["request"]["approved_limit"] == 5_000_000
    assert api.db.users.find_one({"username": "sam"})["limits"] == {
        "max_domains": 5_000_000
    }
    for path in (approve, deny):
        repeated = admin_client.post(path)
        assert repeated.status_code == 409
        assert repeated.get_json()["code"] == "already_handled"
    missing = admin_client.post(f"/api/admin/limit-requests/{ObjectId()}/approve")
    assert missing.status_code == 404
    assert admin_client.post("/api/admin/limit-requests/nope/deny").status_code == 404


def test_denying_a_request_notifies_the_user_once(
    api: Api, admin_client: FlaskClient, sam: User
) -> None:
    created = pending_request(api, sam)
    deny = f"/api/admin/limit-requests/{created.id}/deny"
    assert admin_client.post(deny, json={"response": "Not now"}).status_code == 200
    assert admin_client.post(deny, json={"response": "Not now"}).status_code == 409
    notifications = api.reload(sam).notifications
    assert [note["type"] for note in notifications] == ["limit_request_denied"]


def test_a_second_pending_request_is_refused_by_the_index(api: Api, sam: User) -> None:
    pending_request(api, sam)
    with pytest.raises(PendingRequestExists):
        pending_request(api, sam)
    assert api.db.limit_requests.count_documents({}) == 1

    client = api.client(sam)
    body = {"requested_tier": 10_000_000, "reason": "A reason for more"}
    refused = client.post("/api/user/limit-request", json=body)
    assert refused.status_code == 409
    assert refused.get_json()["code"] == "pending_request_exists"


def test_index_preparation_keeps_the_newest_pending_request(api: Api) -> None:
    index = api.db.limit_requests.index_information()["one_pending_request_per_user"]
    assert index["unique"] is True
    assert index["partialFilterExpression"] == {"status": "pending"}
    spec = next(spec for spec in INDEXES if spec.name == "one_pending_request_per_user")
    assert spec.prepare is prepare_pending_limit_requests
    api.db.limit_requests.drop_indexes()
    sam_id, alex_id = ObjectId(), ObjectId()
    now = datetime.utcnow()
    api.db.limit_requests.insert_many(
        [
            {"user_id": sam_id, "status": "pending", "created_at": now, "tag": "new"},
            {
                "user_id": sam_id,
                "status": "pending",
                "created_at": now - timedelta(days=2),
                "tag": "oldest",
            },
            {
                "user_id": sam_id,
                "status": "pending",
                "created_at": now - timedelta(days=1),
                "tag": "older",
            },
            {
                "user_id": sam_id,
                "status": "denied",
                "created_at": now - timedelta(days=3),
                "tag": "denied",
            },
            {"user_id": alex_id, "status": "pending", "created_at": now, "tag": "alex"},
        ]
    )

    prepare_pending_limit_requests(api.db)
    prepare_pending_limit_requests(api.db)

    statuses = {
        request["tag"]: request["status"] for request in api.db.limit_requests.find()
    }
    assert statuses == {
        "new": "pending",
        "oldest": "superseded",
        "older": "superseded",
        "denied": "denied",
        "alex": "pending",
    }


def test_default_config_is_validated_before_saving(
    api: Api, admin_client: FlaskClient
) -> None:
    invalid = admin_client.put(
        "/api/admin/default/config",
        json={"config": f"{VALID_SOURCES}\nnot a url|Bad|tracking", "whitelist": ""},
    )
    body = refusal(invalid, "config")
    assert body["code"] == "invalid_config"
    assert body["details"] == ["Line 2: Invalid or unsafe source URL"]
    assert api.db.system_config.count_documents({}) == 0

    refusal(admin_client.put("/api/admin/default/config", json={"config": 5}), "config")

    too_many = "\n".join(f"https://example.com/{number}.txt" for number in range(1001))
    assert refusal(
        admin_client.put("/api/admin/default/config", json={"config": too_many}),
        "config",
    )["details"] == ["Too many sources (1001). Maximum allowed: 1000"]

    api.whitelist_check.return_value = {
        "valid": False,
        "errors": [{"line": 3, "message": "Not a domain", "code": "bad"}],
        "error_counts": {"bad": 1},
    }
    bad_whitelist = admin_client.put(
        "/api/admin/default/config",
        json={"config": VALID_SOURCES, "whitelist": "a\nb\n???"},
    )
    body = refusal(bad_whitelist, "whitelist")
    assert body["details"] == ["Line 3: Not a domain"]
    assert api.db.system_config.count_documents({}) == 0

    api.whitelist_check.side_effect = WhitelistValidationUnavailable("down")
    unavailable = admin_client.put(
        "/api/admin/default/config",
        json={"config": VALID_SOURCES, "whitelist": "allowed.example.com"},
    )
    assert unavailable.status_code == 503
    assert api.db.system_config.count_documents({}) == 0


def test_valid_default_config_is_saved_in_one_document(
    api: Api, admin_client: FlaskClient
) -> None:
    saved = admin_client.put(
        "/api/admin/default/config",
        json={"config": VALID_SOURCES, "whitelist": "allowed.example.com"},
    )
    assert saved.status_code == 200
    assert admin_client.get("/api/admin/default/config").get_json() == {
        "config": VALID_SOURCES,
        "whitelist": "allowed.example.com",
        "sync_enabled": False,
        "source": None,
    }
    only_whitelist = admin_client.put(
        "/api/admin/default/config", json={"whitelist": ""}
    )
    assert only_whitelist.status_code == 200
    stored = api.db.system_config.find_one({"_id": "default_config"})
    assert (stored["blocklists"], stored["whitelist"], stored["updated_by"]) == (
        VALID_SOURCES,
        "",
        "robin",
    )
