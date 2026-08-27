"""The reveal ladder — computed once at ingest, stored on the row.

The client plays `t0 -> ends[level - 1]` and pauses. It does no DSP-adjacent
arithmetic, so it can never drift from the Python.

`t0` starts at the first note minus a short lead rather than at 0.0: recordings
routinely carry a second of silence up front, which would otherwise be most of
an early reveal.

`starts` is carried alongside `ends` so the whole ladder is one object and
get_daily() never has to return the full `notes` array. The client needs both
(`noteStarts` places the bar's tick marks, `noteEnds` the unlock boundaries) and
needs none of the f0 / midi / confidence / level_db that `notes` also holds.
"""

LEAD_S = 0.15


def build_reveal(notes: list[dict], lead_s: float = LEAD_S) -> dict:
    """notes is whistle-pipeline's `to_dict()["notes"]`, already sorted."""
    if not notes:
        raise ValueError("cannot build a reveal ladder from zero notes")

    starts = [round(float(n["start_s"]), 3) for n in notes]
    ends = [round(float(n["end_s"]), 3) for n in notes]

    # This is where the uneven-note-currency rule goes, if it ever lands: three
    # notes may be 1.86 s while note 4 buys only 0.62 s more, so a level could
    # become "the next note *or* +1.5 s, whichever is longer". It belongs here,
    # at ingest — not in the pipeline's segment.py and not in the client.
    # Deferred: the ladder is currently one note per level.

    return {
        "lead_s": round(float(lead_s), 3),
        "t0": round(max(0.0, float(notes[0]["start_s"]) - lead_s), 3),
        "starts": starts,
        "ends": ends,
    }
