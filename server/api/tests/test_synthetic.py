"""Known-answer tests on synthetic whistles.

These are not a substitute for real recordings - they only prove the machinery
works end to end and that the documented limitations behave as documented.
"""

from __future__ import annotations

import numpy as np
import pytest

from whistle.config import Params
from whistle.pitch import track, whistle_likeness
from whistle.segment import segment
from whistle.synth import WHISTLE_REGISTER, whistle
from whistle import audio


def run(x, p=None):
    p = p or Params()
    y = audio.bandpass(x, p)
    frames = track(y, p)
    notes, *_ = segment(frames, p)
    return frames, notes


def test_f0_accuracy_on_steady_tone():
    p = Params()
    t = np.arange(int(1.0 * p.sample_rate)) / p.sample_rate
    x = 0.6 * np.sin(2 * np.pi * 1234.0 * t)
    frames, _ = run(x, p)
    est = np.median(frames.f0[frames.voiced])
    cents_err = abs(1200 * np.log2(est / 1234.0))
    assert cents_err < 10.0, f"{est:.2f} Hz, {cents_err:.1f} cents off"


def test_purity_separates_whistle_from_harmonic_rich_tone():
    p = Params()
    t = np.arange(int(1.0 * p.sample_rate)) / p.sample_rate
    pure = 0.6 * np.sin(2 * np.pi * 1200.0 * t)
    rich = sum(0.6 / (h + 1) * np.sin(2 * np.pi * 1200.0 * (h + 1) * t) for h in range(6))
    fp, _ = run(pure, p)
    fr, _ = run(rich, p)
    assert whistle_likeness(fp) > 0.85
    assert whistle_likeness(fp) > whistle_likeness(fr) + 0.2


def test_note_count_and_pitch_with_gaps():
    """With audible gaps between notes, every note including the repeated
    same-pitch pair must be recovered."""
    p = Params()
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=0.06)
    _, notes = run(x, p)
    assert len(notes) == len(truth), [round(n.f0_hz, 1) for n in notes]
    for note, want in zip(notes, truth):
        err = abs(1200 * np.log2(note.f0_hz / want["f0_hz"]))
        assert err < 40.0, f"{note.f0_hz:.1f} vs {want['f0_hz']} ({err:.0f} cents)"


def test_onsets_within_tolerance():
    p = Params()
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=0.06)
    _, notes = run(x, p)
    assert len(notes) == len(truth)
    for note, want in zip(notes, truth):
        assert abs(note.start_s - want["start_s"]) < 0.05, (note.start_s, want["start_s"])


def test_legato_merges_repeated_same_pitch():
    """DOCUMENTED LIMITATION: with no gap, two consecutive notes at the same
    pitch are acoustically one note and must merge."""
    p = Params()
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=0.0)
    _, notes = run(x, p)
    assert len(notes) == len(truth) - 1, [round(n.f0_hz, 1) for n in notes]


def test_semitone_step_survives_vibrato():
    """The marginal case: a 100-cent step with +/-35 cents vibrato leaves only
    30 cents of clearance. Regression guard for ref_window_frames - if the
    pitch reference is shorter than a vibrato cycle this silently merges.
    """
    p = Params()
    x, _ = whistle(melody=[(88 + 24 - 24, 0.5), (89 + 24 - 24, 0.5)],
                   sample_rate=p.sample_rate, gap_s=0.0, vibrato_cents=35.0)
    _, notes = run(x, p)
    assert len(notes) == 2, [(round(n.start_s, 2), round(n.f0_hz, 1)) for n in notes]


def test_vibrato_does_not_split_a_note():
    p = Params()
    x, _ = whistle(melody=[(69 + WHISTLE_REGISTER, 1.2)], sample_rate=p.sample_rate, gap_s=0.0,
                   vibrato_cents=55.0, vibrato_hz=6.0)
    _, notes = run(x, p)
    assert len(notes) == 1, [(round(n.start_s, 2), round(n.f0_hz, 1)) for n in notes]


def test_silence_yields_no_notes():
    p = Params()
    x = np.zeros(p.sample_rate)
    _, notes = run(x, p)
    assert notes == []


@pytest.mark.parametrize("gap", [0.03, 0.06, 0.12])
def test_reveal_range_is_monotonic(gap):
    from whistle.pipeline import Result, reveal_range

    p = Params()
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=gap)
    y = audio.bandpass(x, p)
    frames = track(y, p)
    notes, cents, voiced, smoothed = segment(frames, p)
    from pathlib import Path

    r = Result(Path("synth.wav"), p, x, frames, notes, cents, voiced, smoothed, 0.0)
    ends = [reveal_range(r, n)[1] for n in range(1, len(notes) + 1)]
    assert ends == sorted(ends)


# --- artifact rejection ----------------------------------------------------

def _inject(x, sr, at_s, dur_s, f_hz, amp, noise_amp, seed=3):
    """Splice a quiet, noisy tone into `x` - stands in for breath noise / the
    whistle onset ramp seen on real recordings."""
    rng = np.random.default_rng(seed)
    n = int(dur_s * sr)
    t = np.arange(n) / sr
    blip = amp * np.sin(2 * np.pi * f_hz * t) + rng.normal(0, noise_amp, n)
    env = np.ones(n)
    k = max(1, int(0.01 * sr))
    env[:k], env[-k:] = np.linspace(0, 1, k), np.linspace(1, 0, k)
    y = x.copy()
    a = int(at_s * sr)
    y[a : a + n] += blip * env
    return y


def test_quiet_impure_fragment_is_dropped():
    """A stable-pitch but quiet and noisy plateau is breath noise, not a note.

    Fragment is tuned to -28 dB / 0.78 purity, matching what real recordings
    produce (-22 to -30 dB at 0.61-0.85 purity, against 0.93-1.00 for notes).

    Asserts the fragment DOES leak through with the gate disabled, so this test
    cannot silently become vacuous if the fragment stops registering at all.
    """
    from dataclasses import replace

    p = Params()
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=0.25)
    dirty = _inject(x, p.sample_rate, at_s=truth[1]["end_s"] + 0.05, dur_s=0.15,
                    f_hz=700.0, amp=0.03, noise_amp=0.008)

    _, clean_notes = run(x, p)
    assert len(clean_notes) == len(truth)

    gate_off = replace(p, note_level_drop_db=999.0)
    _, leaked = run(dirty, gate_off)
    assert len(leaked) == len(truth) + 1, (
        "fragment never became a note - test would be vacuous, retune _inject")

    _, dirty_notes = run(dirty, p)
    assert len(dirty_notes) == len(truth), (
        f"fragment survived the gate: {[round(n.f0_hz, 1) for n in dirty_notes]}")


def test_soft_but_clean_note_survives():
    """Guards the AND in the artifact gate: quiet alone must not disqualify a
    note, or softly-whistled phrase endings get deleted."""
    p = Params()
    melody = [(91, 0.4), (93, 0.4), (91, 0.4)]
    x, truth = whistle(melody=melody, sample_rate=p.sample_rate, gap_s=0.08)
    # attenuate the final note by ~14 dB but keep it clean
    sr = p.sample_rate
    last = int((0.15 + 2 * (0.4 + 0.08)) * sr)
    x[last:] *= 0.2
    _, notes = run(x, p)
    assert len(notes) == len(truth), [round(n.level_db, 1) for n in notes]


def test_reveal_range_skips_leading_silence():
    from pathlib import Path

    from whistle.pipeline import Result, reveal_range

    p = Params()
    x, _ = whistle(sample_rate=p.sample_rate, gap_s=0.08)
    x = np.concatenate([np.zeros(int(1.5 * p.sample_rate)), x])  # 1.5 s of silence
    frames = track(audio.bandpass(x, p), p)
    notes, cents, voiced, smoothed = segment(frames, p)
    r = Result(Path("s.wav"), p, x, frames, notes, cents, voiced, smoothed, 0.0)
    t0, t1 = reveal_range(r, 2, lead_s=0.15)
    assert notes[0].start_s > 1.5
    assert abs(t0 - (notes[0].start_s - 0.15)) < 1e-6, t0
    assert t1 > t0
