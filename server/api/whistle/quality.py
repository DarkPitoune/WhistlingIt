"""Upload quality gate.

Doubles as the anti-cheat: whistle-likeness is low for singing, humming, and
very low for someone uploading the actual studio recording of the song.

Every threshold here is a PLACEHOLDER until calibrated against real uploads,
so the gate always reports the measured values alongside the verdict.
"""

from __future__ import annotations


def evaluate(metrics: dict, n_notes: int, p) -> dict:
    reasons: list[str] = []

    if metrics["duration_s"] < p.q_min_duration_s:
        reasons.append("too_short")
    if metrics["duration_s"] > p.q_max_duration_s:
        reasons.append("too_long")
    if metrics["clip_ratio"] > p.q_max_clip_ratio:
        reasons.append("clipping")
    if metrics["voiced_ratio"] < p.q_min_voiced_ratio:
        reasons.append("not_enough_voiced_audio")
    if metrics["whistle_likeness"] < p.q_min_whistle_likeness:
        reasons.append("not_whistle_like")
    if n_notes < p.q_min_notes:
        reasons.append("too_few_notes")
    if n_notes > p.q_max_notes:
        reasons.append("too_many_notes")

    return {"ok": not reasons, "reasons": reasons}
