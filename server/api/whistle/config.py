"""Tunable parameters for the whistle -> note-events pipeline.

Every threshold that could plausibly need calibration lives here, in one frozen
dataclass, so that a result can be stored alongside the exact params that
produced it. See README for which knobs actually matter.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass

PIPELINE_VERSION = "0.1.0"


@dataclass(frozen=True)
class Params:
    # --- ingest -------------------------------------------------------------
    sample_rate: int = 22050
    highpass_hz: float = 350.0
    lowpass_hz: float = 5000.0
    filter_order: int = 4

    # --- f0 tracking (FFT peak + parabolic interpolation) -------------------
    frame_size: int = 1024  # 46 ms @ 22050
    hop_size: int = 110  # 5 ms  @ 22050
    fmin_hz: float = 500.0
    fmax_hz: float = 3500.0
    purity_bins: int = 3  # +/- bins treated as "the peak" (Hann main lobe ~4 bins)

    # --- voicing decision ---------------------------------------------------
    level_floor_db: float = -38.0  # relative to the loudest frame in the clip
    purity_min: float = 0.50

    # --- contour cleanup ----------------------------------------------------
    octave_window_frames: int = 15
    spike_median_frames: int = 5
    # Short dropouts are tracker glitches -> bridge them. Longer gaps are real
    # re-articulation and are the ONLY cue we have for repeated same-pitch
    # notes, so they must survive as boundaries.
    bridge_gap_ms: float = 25.0
    bridge_max_cents: float = 200.0
    min_voiced_ms: float = 60.0

    # --- segmentation -------------------------------------------------------
    smooth_ms: float = 60.0  # decision-only smoothing (vibrato rejection)
    jump_cents: float = 70.0  # departure that counts as leaving the note
    hold_ms: float = 50.0  # ...and how long it must persist
    # Trailing median window for "the pitch we are currently on". MUST span
    # several vibrato cycles (whistle vibrato is ~5-7 Hz, i.e. 140-200 ms) or
    # the reference tracks the vibrato instead of the note centre, and a
    # semitone step with +/-25 cents vibrato stops being detectable. 200 frames
    # = 1 s. Bounded so cost stays linear on long held notes.
    ref_window_frames: int = 200
    min_note_ms: float = 70.0
    # Artifact rejection. Breath noise and the whistle's onset ramp track as
    # stable-but-quiet tones: measured 13-22 dB below the real notes at purity
    # 0.61-0.85, against 0.93-1.00 for real notes. Both conditions must hold to
    # drop, so a genuinely soft note or a loud noisy one survives.
    note_level_drop_db: float = 12.0
    note_min_confidence: float = 0.90
    merge_cents: float = 35.0  # merge time-contiguous notes closer than this
    edge_trim_ms: float = 30.0  # excluded from pitch measurement (glide)

    # --- quality gate (PLACEHOLDERS - calibrate on real uploads) ------------
    q_min_notes: int = 3
    q_max_notes: int = 60
    q_min_voiced_ratio: float = 0.25
    q_min_whistle_likeness: float = 0.55
    q_max_clip_ratio: float = 0.01
    q_min_duration_s: float = 1.5
    q_max_duration_s: float = 40.0

    # --- derived ------------------------------------------------------------
    @property
    def hop_s(self) -> float:
        return self.hop_size / self.sample_rate

    @property
    def hop_ms(self) -> float:
        return 1000.0 * self.hop_size / self.sample_rate

    def frames(self, ms: float) -> int:
        """Number of hops spanning `ms` milliseconds (at least 1)."""
        return max(1, int(math.ceil(ms / self.hop_ms)))

    def frame_time(self, index):
        """Centre time of analysis frame `index`, in seconds.

        Frames are centred (not left-aligned) so reported timestamps line up
        with the audio. The band-pass is zero-phase for the same reason.
        """
        return (index * self.hop_size + self.frame_size / 2.0) / self.sample_rate

    def as_dict(self) -> dict:
        return asdict(self)

    def fingerprint(self) -> str:
        """Short hash of the params, stored with every result."""
        blob = json.dumps(self.as_dict(), sort_keys=True).encode()
        return hashlib.sha256(blob).hexdigest()[:12]
