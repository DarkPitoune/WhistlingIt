"""Contour cleanup and f0-contour segmentation into note events.

This is where all the real difficulty lives. Whistling has no attack transient,
so energy/spectral-flux onset detection cannot work; boundaries are found as
transitions between plateaus of stable pitch instead.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import median_filter

from .pitch import Frames


@dataclass
class Note:
    i0: int  # first frame index (inclusive)
    i1: int  # last frame index (inclusive)
    start_s: float
    end_s: float
    f0_hz: float
    cents: float  # relative to A440, informational
    purity: float
    level_db: float


def to_cents(f0: np.ndarray | float) -> np.ndarray | float:
    return 1200.0 * np.log2(np.asarray(f0, dtype=float) / 440.0)


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True runs of `mask` as [(start, stop_exclusive), ...]."""
    if not mask.any():
        return []
    d = np.diff(mask.astype(np.int8))
    starts = list(np.flatnonzero(d == 1) + 1)
    stops = list(np.flatnonzero(d == -1) + 1)
    if mask[0]:
        starts.insert(0, 0)
    if mask[-1]:
        stops.append(mask.size)
    return list(zip(starts, stops))


def clean_contour(frames: Frames, p) -> tuple[np.ndarray, np.ndarray]:
    """Return (cents, voiced) with octave errors, spikes, glitches removed.

    Order matters: bridge dropouts *before* pruning short islands, or a note
    split by a one-frame dropout gets deleted as two short islands.
    """
    cents = to_cents(np.maximum(frames.f0, 1e-6)).astype(float)
    voiced = frames.voiced.copy()

    if not voiced.any():
        return cents, voiced

    # 1. octave errors: compare against a locally-interpolated median
    vi = np.flatnonzero(voiced)
    filled = np.interp(np.arange(cents.size), vi, cents[vi])
    local = median_filter(filled, size=p.octave_window_frames, mode="nearest")
    dev = cents - local
    for shift in (-1200.0, 1200.0):
        cand = cents + shift
        better = voiced & (np.abs(dev) > 600.0) & (np.abs(cand - local) < np.abs(dev) - 300.0)
        cents = np.where(better, cand, cents)
        dev = cents - local

    # 2. de-spike, per voiced run so nothing bleeds across a gap
    for a, b in _runs(voiced):
        if b - a >= p.spike_median_frames:
            cents[a:b] = median_filter(cents[a:b], size=p.spike_median_frames, mode="nearest")

    # 3. bridge short dropouts (tracker glitches) but keep real gaps: a gap is
    #    the only evidence we ever get for two repeated notes at one pitch.
    max_gap = p.frames(p.bridge_gap_ms)
    runs = _runs(voiced)
    for (a0, b0), (a1, _) in zip(runs, runs[1:]):
        gap = a1 - b0
        if gap <= max_gap and abs(cents[a1] - cents[b0 - 1]) <= p.bridge_max_cents:
            cents[b0:a1] = np.linspace(cents[b0 - 1], cents[a1], gap + 2)[1:-1]
            voiced[b0:a1] = True

    # 4. drop voiced islands too short to be a note
    min_run = p.frames(p.min_voiced_ms)
    for a, b in _runs(voiced):
        if b - a < min_run:
            voiced[a:b] = False

    return cents, voiced


def _split_run(s: np.ndarray, p) -> list[int]:
    """Hysteresis state machine over one voiced run of the smoothed contour.

    Returns run-local boundary indices. A departure of more than `jump_cents`
    from the running median must *persist* for `hold_ms` to count - which is
    what makes it ignore vibrato (~5-7 Hz) without heavy smoothing.
    """
    hold = p.frames(p.hold_ms)
    bounds: list[int] = []
    start = 0
    ref = float(s[0])
    pending: int | None = None

    for i in range(1, s.size):
        if abs(s[i] - ref) > p.jump_cents:
            if pending is None:
                pending = i
            elif i - pending + 1 >= hold:
                # Place the boundary at the steepest point of the transition,
                # i.e. the middle of the glide rather than where it started.
                lo = max(start + 1, pending - 1)
                seg = s[lo - 1 : i + 1]
                b = lo + int(np.argmax(np.abs(np.diff(seg)))) if seg.size > 1 else pending
                b = min(max(b, start + 1), s.size - 1)
                bounds.append(b)
                start, pending = b, None
                ref = float(np.median(s[b : i + 1]))
        else:
            pending = None
            w = s[max(start, i - p.ref_window_frames + 1) : i + 1]
            ref = float(np.median(w))

    return bounds


def _measure(i0: int, i1: int, frames: Frames, cents: np.ndarray, p) -> Note:
    """Pitch is measured on the RAW contour over the segment interior, with the
    edges trimmed, so decision-time smoothing never contaminates the value.
    """
    trim = p.frames(p.edge_trim_ms)
    a, b = i0 + trim, i1 - trim + 1
    if b <= a:  # note shorter than 2x trim: fall back to its middle
        mid = (i0 + i1) // 2
        a, b = mid, mid + 1
    sl = slice(a, b)
    f0 = float(np.median(frames.f0[sl]))
    return Note(
        i0=i0,
        i1=i1,
        start_s=float(p.frame_time(i0)),
        end_s=float(p.frame_time(i1) + p.hop_s),
        f0_hz=f0,
        cents=float(np.median(cents[sl])),
        purity=float(np.mean(frames.purity[sl])),
        level_db=float(np.mean(frames.level_db[sl])),
    )


def _postprocess(notes: list[Note], frames: Frames, cents: np.ndarray, p) -> list[Note]:
    """Merge over-segmentation from glides, absorb sub-minimum notes.

    Only time-contiguous notes (no gap between them) are ever merged - notes
    separated by a real gap may be a genuine repeat at the same pitch.
    """
    min_frames = p.frames(p.min_note_ms)
    changed = True
    while changed and len(notes) > 1:
        changed = False
        for j in range(len(notes) - 1):
            x, y = notes[j], notes[j + 1]
            contiguous = y.i0 - x.i1 == 1
            if not contiguous:
                continue
            too_short = (x.i1 - x.i0 + 1) < min_frames or (y.i1 - y.i0 + 1) < min_frames
            close = abs(x.cents - y.cents) < p.merge_cents
            if too_short or close:
                notes[j : j + 2] = [_measure(x.i0, y.i1, frames, cents, p)]
                changed = True
                break

    # A still-too-short isolated note is a fragment, not a note.
    if len(notes) > 1:
        notes = [n for n in notes if (n.i1 - n.i0 + 1) >= min_frames]
    return notes


def _drop_artifacts(notes: list[Note], p) -> list[Note]:
    """Reject breath noise and whistle onset ramps.

    The tracker locks onto weak low-level resonances before the tone properly
    establishes; these read as stable pitch plateaus and would otherwise be
    emitted as notes. The reference level is the 75th percentile rather than the
    median, so a clip carrying many artifacts cannot drag the reference down
    between the two clusters.
    """
    if len(notes) < 2:
        return notes
    ref = float(np.percentile([n.level_db for n in notes], 75))
    floor = ref - p.note_level_drop_db
    kept = [n for n in notes
            if not (n.level_db < floor and n.purity < p.note_min_confidence)]
    return kept or notes  # never return nothing


def segment(frames: Frames, p) -> tuple[list[Note], np.ndarray, np.ndarray, np.ndarray]:
    """Full contour -> notes. Returns (notes, cents, voiced, smoothed)."""
    cents, voiced = clean_contour(frames, p)
    smoothed = cents.copy()
    k = p.frames(p.smooth_ms)
    for a, b in _runs(voiced):
        if b - a >= k:
            smoothed[a:b] = median_filter(cents[a:b], size=k, mode="nearest")

    notes: list[Note] = []
    for a, b in _runs(voiced):
        edges = [0, *_split_run(smoothed[a:b], p), b - a]
        for lo, hi in zip(edges, edges[1:]):
            notes.append(_measure(a + lo, a + hi - 1, frames, cents, p))

    notes = _postprocess(notes, frames, cents, p)
    notes = _drop_artifacts(notes, p)
    return notes, cents, voiced, smoothed
