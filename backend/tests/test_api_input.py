import pytest
from flask import Flask, jsonify, request

from app.utils.api_input import register_input_checks


@pytest.fixture
def guarded_app() -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=True, MAX_CONTENT_LENGTH=1024)
    register_input_checks(app)

    @app.post("/api/config")
    def config():
        return jsonify(request.get_json())

    @app.post("/api/build")
    def build():
        return jsonify({"success": True})

    return app


@pytest.mark.parametrize("body", [42, None, [], "example"])
def test_json_object_is_required(guarded_app: Flask, body: object) -> None:
    import json

    response = guarded_app.test_client().post(
        "/api/config", data=json.dumps(body), content_type="application/json"
    )
    assert response.status_code == 400
    assert response.is_json


def test_config_field_is_a_string(guarded_app: Flask) -> None:
    response = guarded_app.test_client().post("/api/config", json={"config": 42})
    assert response.status_code == 400


def test_malformed_and_oversized_json_returns_safe_errors(guarded_app: Flask) -> None:
    client = guarded_app.test_client()
    assert (
        client.post(
            "/api/config", data="{", content_type="application/json"
        ).status_code
        == 400
    )
    response = client.post("/api/config", json={"config": "x" * 2048})
    assert response.status_code == 413
    assert response.is_json


def test_empty_action_request_stays_supported(guarded_app: Flask) -> None:
    client = guarded_app.test_client()
    assert client.post("/api/build").status_code == 200
    assert (
        client.post(
            "/api/build", headers={"Content-Type": "application/json"}
        ).status_code
        == 200
    )
