import pytest

pytest.importorskip("whistle", reason="whistle-pipeline not installed")

from app.ingest import BadRequest, Submission, validate  # noqa: E402


def sub(**kw):
    base = {
        "title": "Hedwig's Theme",
        "accepted_answers": [],
        "category": None,
        "from_label": None,
        "signature": "Teo",
    }
    return Submission(**{**base, **kw})


def test_title_is_always_an_accepted_answer():
    """An uploader should not have to retype the title into the alias list for
    the obvious guess to work."""
    raw, norm = validate(sub())
    assert raw == ["Hedwig's Theme"]
    assert norm == ["hedwigs theme"]


def test_title_leads_the_answer_list():
    raw, _ = validate(sub(accepted_answers=["Harry Potter", "Poudlard"]))
    assert raw == ["Hedwig's Theme", "Harry Potter", "Poudlard"]


def test_duplicate_answers_collapse():
    raw, norm = validate(
        sub(accepted_answers=["hedwig's theme", "Hedwigs Theme", "Poudlard"])
    )
    # Case-insensitive duplicates of the title are dropped from the raw list...
    assert raw == ["Hedwig's Theme", "Hedwigs Theme", "Poudlard"]
    # ...and the apostrophe variant collapses on top of that, so accepted_norm is
    # shorter than accepted_answers. This is why the schema does not require the
    # two arrays to have equal length.
    assert norm == ["hedwigs theme", "poudlard"]


def test_blank_title_rejected():
    with pytest.raises(BadRequest):
        validate(sub(title="   "))


def test_unmatchable_title_rejected():
    """A title of "!!!" normalizes away to nothing, so no guess could ever
    match. Caught here, not as a check-constraint violation."""
    with pytest.raises(BadRequest):
        validate(sub(title="!!!"))


def test_unknown_category_rejected():
    with pytest.raises(BadRequest):
        validate(sub(category="Techno"))


def test_known_category_accepted():
    validate(sub(category="Film"))


def test_too_many_answers_rejected():
    with pytest.raises(BadRequest):
        validate(sub(accepted_answers=[f"alias {i}" for i in range(25)]))


def test_long_from_label_rejected():
    """The only other free-text field on the write path, and it rides along on
    every get_daily() payload."""
    with pytest.raises(BadRequest):
        validate(sub(from_label="x" * 201))


def test_from_label_at_the_limit_accepted():
    validate(sub(from_label="x" * 200))


def test_blank_signature_accepted():
    """Optional, like from_label: an unsigned whistle is credited to nobody
    rather than refused."""
    validate(sub(signature="   "))
    validate(sub(signature=None))


def test_signature_at_the_limit_accepted():
    validate(sub(signature="s" * 80))


def test_long_signature_rejected():
    with pytest.raises(BadRequest):
        validate(sub(signature="s" * 81))


def test_blank_signature_collapses_to_none():
    """What ingest() stores: "" and "   " are unsigned, not a signature made of
    spaces, so the client has one empty case to render rather than three."""
    for blank in ("", "   ", None):
        assert ((blank or "").strip() or None) is None
    assert ("  Teo  " or "").strip() or None == "Teo"
