"""Frame-level f0 tracking.

A whistle is very nearly a pure sine tone (second partial typically 25-40 dB
down), so an FFT magnitude peak with parabolic interpolation is genuinely
competitive with YIN/pYIN/CREPE here - and it keeps numba/torch out of the
deployment image. numpy + scipy only.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EPS = 1e-20


@dataclass
class Frames:
    """Per-frame analysis results. All arrays are the same length."""

    t: np.ndarray  # centre time, seconds
    f0: np.ndarray  # Hz (meaningless where voiced is False)
    purity: np.ndarray  # 0..1 share of in-band energy sitting at f0
    level_db: np.ndarray  # dB relative to the loudest frame
    voiced: np.ndarray  # bool

    def __len__(self) -> int:
        return int(self.t.size)


def track(x: np.ndarray, p) -> Frames:
    n, hop = p.frame_size, p.hop_size
    if x.size < n:
        x = np.pad(x, (0, n - x.size))

    from scipy.signal import windows

    win = windows.hann(n, sym=False)
    count = 1 + (x.size - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(count)[:, None]
    blocks = x[idx]

    # Level from the un-windowed block, relative to the loudest frame.
    rms = np.sqrt(np.mean(blocks**2, axis=1) + EPS)
    level_db = 20.0 * np.log10(rms + EPS)
    level_db -= level_db.max()

    spec = np.fft.rfft(blocks * win, axis=1)
    mag2 = spec.real**2 + spec.imag**2
    n_bins = mag2.shape[1]
    freqs = np.fft.rfftfreq(n, 1.0 / p.sample_rate)

    # --- peak pick inside the whistle band ---------------------------------
    lo = int(np.searchsorted(freqs, p.fmin_hz))
    hi = int(np.searchsorted(freqs, p.fmax_hz))
    lo, hi = max(lo, 1), min(hi, n_bins - 1)
    k = lo + np.argmax(mag2[:, lo:hi], axis=1)
    k = np.clip(k, 1, n_bins - 2)

    # --- parabolic interpolation on the log magnitude ----------------------
    logmag = 10.0 * np.log10(mag2 + EPS)
    rows = np.arange(count)
    a, b, c = logmag[rows, k - 1], logmag[rows, k], logmag[rows, k + 1]
    denom = a - 2.0 * b + c
    delta = np.where(np.abs(denom) > EPS, 0.5 * (a - c) / np.where(denom == 0, 1.0, denom), 0.0)
    delta = np.clip(delta, -0.5, 0.5)
    f0 = (k + delta) * p.sample_rate / n

    # --- purity / whistle-likeness -----------------------------------------
    # Share of band-limited energy concentrated at f0. ~1 for a whistle,
    # markedly lower for singing/humming (rich harmonics) and very low for a
    # full music mix. This is both the voicing confidence and the anti-cheat.
    off = np.arange(-p.purity_bins, p.purity_bins + 1)
    peak_bins = np.clip(k[:, None] + off[None, :], 0, n_bins - 1)
    peak_e = np.take_along_axis(mag2, peak_bins, axis=1).sum(axis=1)
    # Denominator is the whole filter pass-band, not just the whistle band, so
    # that energy elsewhere (a voice, a backing track) counts against purity.
    blo = max(int(np.searchsorted(freqs, p.highpass_hz)), 0)
    bhi = min(int(np.searchsorted(freqs, p.lowpass_hz)), n_bins)
    band_e = mag2[:, blo:bhi].sum(axis=1) + EPS
    purity = np.clip(peak_e / band_e, 0.0, 1.0)

    voiced = (level_db > p.level_floor_db) & (purity > p.purity_min)
    t = p.frame_time(np.arange(count))
    return Frames(t=t, f0=f0, purity=purity, level_db=level_db, voiced=voiced)


def whistle_likeness(frames: Frames) -> float:
    """Track-level purity: median purity over voiced frames."""
    if not frames.voiced.any():
        return 0.0
    return float(np.median(frames.purity[frames.voiced]))
