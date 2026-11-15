import json
from pathlib import Path

from app.utils.validators import parse_config_lines, validate_config_syntax


def test_shared_source_contract() -> None:
    path = Path(__file__).resolve().parents[2] / "tests/fixtures/source-configs.json"
    for fixture in json.loads(path.read_text()):
        result = validate_config_syntax(fixture["config"], 40)
        assert (not result.has_errors) == fixture["valid"], fixture


def test_fourth_field_sets_the_abp_flag_on_that_source_only() -> None:
    lines = parse_config_lines(
        "https://example.com/one|First|tracking| abp \n"
        "https://example.com/two|Second|tracking"
    )
    assert [line.abp for line in lines] == [True, False]
    assert [line.error for line in lines] == [None, None]
