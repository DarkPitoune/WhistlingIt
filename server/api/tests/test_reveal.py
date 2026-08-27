import pytest

from app.reveal import build_reveal


def notes(*spans):
    return [
        {"index": i, "start_s": a, "end_s": b, "duration_s": round(b - a, 3)}
        for i, (a, b) in enumerate(spans)
    ]


def test_ladder_is_one_rung_per_note():
    r = build_reveal(notes((0.30, 0.90), (0.95, 1.60), (1.70, 2.30)))
    assert r["starts"] == [0.30, 0.95, 1.70]
    assert r["ends"] == [0.90, 1.60, 2.30]
    assert r["lead_s"] == 0.15
    assert r["t0"] == 0.15


def test_starts_and_ends_are_the_same_length():
    """The client asserts this: noteStarts.length defines the note count and the
    ladder is derived from it."""
    r = build_reveal(notes((0.1, 0.5), (0.6, 1.0), (1.2, 1.9), (2.0, 2.4)))
    assert len(r["starts"]) == len(r["ends"]) == 4


def test_t0_never_goes_negative():
    """A recording that starts on the note must not seek before zero."""
    assert build_reveal(notes((0.05, 0.60)))["t0"] == 0.0


def test_leading_silence_is_skipped():
    """Recordings routinely carry a second of dead air, which would otherwise be
    most of an early reveal."""
    r = build_reveal(notes((1.80, 2.40), (2.50, 3.00)))
    assert r["t0"] == 1.65


def test_zero_notes_is_a_programming_error():
    with pytest.raises(ValueError):
        build_reveal([])
