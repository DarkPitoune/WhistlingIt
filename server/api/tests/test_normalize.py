import json
from pathlib import Path

import pytest

from app.normalize import normalize, normalize_all

FIXTURES = json.loads((Path(__file__).parent / "normalize_fixtures.json").read_text())


@pytest.mark.parametrize("raw,expected", [tuple(c) for c in FIXTURES["cases"]])
def test_fixture(raw, expected):
    assert normalize(raw) == expected


def test_idempotent():
    """normalize(normalize(x)) == normalize(x) — the client may normalize a
    stored value again without changing it."""
    for raw, _ in FIXTURES["cases"]:
        once = normalize(raw)
        assert normalize(once) == once


def test_dedupes_and_drops_empties():
    """Two spellings of the same answer collapse, which is why accepted_norm may
    be shorter than accepted_answers."""
    assert normalize_all(
        ["Hedwig's Theme", "Hedwigs Theme", "", "!!!", "Le Parrain"]
    ) == ["hedwigs theme", "le parrain"]


def test_all_empty_yields_empty_list():
    assert normalize_all(["!!!", "  ", "…"]) == []
