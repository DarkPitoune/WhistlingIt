"""Synthetic whistle generator - a known-answer signal for testing the pipeline
before (and alongside) real recordings.
"""

from __future__ import annotations

import numpy as np

# Human whistling lives roughly two octaves above singing: comfortable range is
# ~800-2500 Hz (MIDI 80-98). Test material must sit in that register or it falls
# outside the tracker's search band and nothing is detected.
WHISTLE_REGISTER = 24  # semitones above the written (vocal) pitch

# (midi, duration_s) - "Happy Birthday" opening, incl. a repeated same-pitch
# pair which the pipeline can only split if there is a real gap.
DEFAULT_MELODY = [
    (67 + WHISTLE_REGISTER, 0.35), (67 + WHISTLE_REGISTER, 0.25),
    (69 + WHISTLE_REGISTER, 0.55), (67 + WHISTLE_REGISTER, 0.55),
    (72 + WHISTLE_REGISTER, 0.55), (71 + WHISTLE_REGISTER, 0.9),
]


def whistle(melody=None, sample_rate=22050, gap_s=0.05, noise_db=-40.0,
            vibrato_hz=5.5, vibrato_cents=25.0, seed=0):
    """Render a melody as a whistle-like tone: near-pure sine, weak 2nd
    harmonic, vibrato, soft attack/release, a little broadband noise.
    """
    rng = np.random.default_rng(seed)
    melody = melody or DEFAULT_MELODY
    out = [np.zeros(int(0.15 * sample_rate))]
    truth = []
    t_cursor = 0.15

    for midi, dur in melody:
        n = int(dur * sample_rate)
        t = np.arange(n) / sample_rate
        f0 = 440.0 * 2 ** ((midi - 69) / 12.0)
        cents = vibrato_cents * np.sin(2 * np.pi * vibrato_hz * t)
        inst = f0 * 2 ** (cents / 1200.0)
        phase = 2 * np.pi * np.cumsum(inst) / sample_rate
        tone = np.sin(phase) + 0.03 * np.sin(2 * phase)
        env = np.ones(n)
        k = max(1, int(0.02 * sample_rate))
        env[:k] = np.linspace(0, 1, k)
        env[-k:] = np.linspace(1, 0, k)
        out.append(0.5 * tone * env)
        truth.append({"midi": midi, "start_s": round(t_cursor, 3),
                      "end_s": round(t_cursor + dur, 3), "f0_hz": round(f0, 1)})
        t_cursor += dur
        if gap_s > 0:
            out.append(np.zeros(int(gap_s * sample_rate)))
            t_cursor += gap_s

    out.append(np.zeros(int(0.15 * sample_rate)))
    x = np.concatenate(out)
    if noise_db is not None:
        x += rng.normal(0, 10 ** (noise_db / 20.0), x.size)
    return x / max(np.max(np.abs(x)), 1e-9) * 0.9, truth
