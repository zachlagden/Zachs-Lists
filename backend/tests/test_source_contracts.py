import json
from pathlib import Path

from app.utils.validators import validate_config_syntax


def test_shared_source_contract() -> None:
    path = Path(__file__).resolve().parents[2] / "tests/fixtures/source-configs.json"
    for fixture in json.loads(path.read_text()):
        result = validate_config_syntax(fixture["config"], 40)
        assert (not result.has_errors) == fixture["valid"], fixture
