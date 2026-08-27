"""Orchestration: audio file in, note events out."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from . import audio, quality
from .config import PIPELINE_VERSION, Params
from .pitch import Frames, track, whistle_likeness
from .segment import Note, segment


class Result:
    """Analysis result. `.to_dict()` is the pipeline's contract."""

    def __init__(self, path: Path, p: Params, x: np.ndarray, frames: Frames,
                 notes: list[Note], cents, voiced, smoothed, clip_ratio: float):
        self.path = path
        self.params = p
        self.signal = x
        self.frames = frames
        self.notes = notes
        self.cents = cents
        self.voiced = voiced
        self.smoothed = smoothed
        self.duration_s = x.size / p.sample_rate
        self.clip_ratio = clip_ratio

    @property
    def metrics(self) -> dict:
        return {
            "duration_s": round(self.duration_s, 3),
            "voiced_ratio": round(float(np.mean(self.voiced)), 3),
            "whistle_likeness": round(whistle_likeness(self.frames), 3),
            "clip_ratio": round(self.clip_ratio, 5),
            "median_f0_hz": round(float(np.median(self.frames.f0[self.voiced])), 1)
            if self.voiced.any() else 0.0,
        }

    def to_dict(self) -> dict:
        m = self.metrics
        notes = [
            {
                "index": i,
                "start_s": round(n.start_s, 3),
                "end_s": round(n.end_s, 3),
                "duration_s": round(n.end_s - n.start_s, 3),
                "f0_hz": round(n.f0_hz, 1),
                # log transform of f0 only - no key or tuning decision is made
                "midi": round(69.0 + n.cents / 100.0, 2),
                "confidence": round(n.purity, 3),
                "level_db": round(n.level_db, 1),
            }
            for i, n in enumerate(self.notes)
        ]
        return {
            "source": self.path.name,
            "pipeline_version": PIPELINE_VERSION,
            "params_fingerprint": self.params.fingerprint(),
            "sample_rate": self.params.sample_rate,
            "metrics": m,
            "quality": quality.evaluate(m, len(notes), self.params),
            "n_notes": len(notes),
            "notes": notes,
        }


def analyze(path: str | Path, p: Params | None = None) -> Result:
    p = p or Params()
    path = Path(path)
    raw = audio.decode(path, p.sample_rate)
    clipping = audio.clip_ratio(raw)
    x = audio.bandpass(raw, p)
    frames = track(x, p)
    notes, cents, voiced, smoothed = segment(frames, p)
    return Result(path, p, raw, frames, notes, cents, voiced, smoothed, clipping)


def reveal_range(result: Result, n_notes: int, tail_s: float = 0.08,
                 lead_s: float = 0.15) -> tuple[float, float]:
    """Audio range for the game's "first N notes" reveal.

    Deliberately a *range of the original audio*, not a re-cut file: play
    first-note -> end-of-note-N with a short fade. No clicks, no storage
    multiplication.

    Starts at the first note rather than at 0.0, keeping `lead_s` of run-in.
    Recordings routinely carry a second of silence before the whistling starts,
    which would otherwise be most of an early reveal.
    """
    if not result.notes:
        return 0.0, 0.0
    n = max(1, min(n_notes, len(result.notes)))
    t0 = max(0.0, result.notes[0].start_s - lead_s)
    t1 = min(result.notes[n - 1].end_s + tail_s, result.duration_s)
    return t0, t1


def extract_range(result: Result, t0: float, t1: float, fade_s: float = 0.03) -> np.ndarray:
    sr = result.params.sample_rate
    a, b = int(t0 * sr), min(int(t1 * sr), result.signal.size)
    seg = result.signal[a:b].copy()
    k = min(int(fade_s * sr), seg.size // 2)
    if k > 0:
        seg[:k] *= np.linspace(0.0, 1.0, k)
        seg[-k:] *= np.linspace(1.0, 0.0, k)
    return seg
