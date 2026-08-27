"""Upload -> transcode -> analyze -> gate -> store -> insert.

Blocking, no queue, no pending status. The song joins the pool for *future*
days, so nothing needs it to be fast — and the uploader's wait is what buys them
the verdict on their whistle.

The step order matters and is not negotiable:

1. Transcode first, then analyze **the transcoded file**. Encoder priming shifts
   playback by 20-50 ms against `start_s`; analysing the artifact you will
   actually serve is the only way the timestamps stay honest.
2. Gate before uploading anything. A rejected whistle leaves no bytes behind.
3. Upload before inserting, and clean up the object if the insert fails, so
   there is never a row pointing at a missing file.
"""

import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from whistle import analyze
from whistle.audio import AudioError

from . import supa, transcode
from .config import CATEGORIES, MAX_DURATION_S
from .normalize import normalize_all
from .reveal import build_reveal


class BadAudio(Exception):
    """Undecodable or unreadable. A 400 — nothing the uploader can fix by
    whistling better."""


class Rejected(Exception):
    """The quality gate said no. A 422, with machine-readable reasons the UI
    renders as plain language."""

    def __init__(self, reasons: list[str], metrics: dict | None = None):
        super().__init__(", ".join(reasons))
        self.reasons = reasons
        self.metrics = metrics or {}


class BadRequest(Exception):
    """Malformed metadata. A 400."""


@dataclass(frozen=True)
class Submission:
    title: str
    accepted_answers: list[str]
    category: str | None
    from_label: str | None


def validate(sub: Submission) -> tuple[list[str], list[str]]:
    """Returns (raw answers, normalized answers). Raises BadRequest."""
    title = sub.title.strip()
    if not title:
        raise BadRequest("title is required")
    if len(title) > 200:
        raise BadRequest("title is too long")

    if sub.category is not None and sub.category not in CATEGORIES:
        raise BadRequest(f"category must be one of {', '.join(CATEGORIES)}")

    # The only other free-text field on the write path. The column is
    # unconstrained `text` and every get_daily() payload carries it, so an
    # unbounded paste would ride along on every player's request.
    if sub.from_label is not None and len(sub.from_label.strip()) > 200:
        raise BadRequest("that 'from' line is too long")

    # The title is always an accepted answer — an uploader should not have to
    # retype it into the alias list for the obvious guess to work.
    raw = [title] + [a.strip() for a in sub.accepted_answers if a.strip()]

    seen: set[str] = set()
    deduped = [a for a in raw if not (a.lower() in seen or seen.add(a.lower()))]
    if len(deduped) > 20:
        raise BadRequest("at most 20 accepted answers")

    norm = normalize_all(deduped)
    if not norm:
        # e.g. a title of "!!!" — every answer normalized away to nothing, so no
        # guess could ever match. Catch it here rather than as a check-constraint
        # violation.
        raise BadRequest(
            "none of the accepted answers contain matchable characters"
        )

    return deduped, norm


def ingest(upload: Path, sub: Submission) -> dict:
    """Returns {"id", "n_notes"}. Raises BadRequest / BadAudio / Rejected."""
    raw_answers, norm_answers = validate(sub)

    with tempfile.TemporaryDirectory() as tmp:
        served = Path(tmp) / "served.m4a"

        try:
            transcode.to_m4a(upload, served)
        except transcode.TranscodeError as exc:
            raise BadAudio(str(exc)) from exc

        # Cheap check before the expensive one. The gate re-checks it anyway.
        duration = transcode.duration_s(served)
        if duration > MAX_DURATION_S:
            raise Rejected(["too_long"], {"duration_s": round(duration, 3)})

        try:
            result = analyze(served)
        except AudioError as exc:
            raise BadAudio(str(exc)) from exc

        payload = result.to_dict()
        if not payload["quality"]["ok"]:
            raise Rejected(payload["quality"]["reasons"], payload["metrics"])

        song_id = str(uuid.uuid4())
        audio_path = f"{song_id}.m4a"
        supa.upload_audio(served, audio_path)

        row = {
            "id": song_id,
            "audio_path": audio_path,
            "title": raw_answers[0],
            "from_label": (sub.from_label or "").strip() or None,
            "category": sub.category,
            "accepted_answers": raw_answers,
            "accepted_norm": norm_answers,
            "notes": payload["notes"],
            "n_notes": payload["n_notes"],
            "pipeline_version": payload["pipeline_version"],
            "params_fingerprint": payload["params_fingerprint"],
            "metrics": payload["metrics"],
            "reveal": build_reveal(payload["notes"]),
            # Container duration, not the last note's end: the timeline draws
            # the whole track and hatches the locked tail.
            "duration_s": round(duration, 3),
        }

        try:
            inserted = supa.insert_song(row)
        except Exception:
            supa.remove_audio(audio_path)
            raise

        return {"id": inserted["id"], "n_notes": inserted["n_notes"]}
