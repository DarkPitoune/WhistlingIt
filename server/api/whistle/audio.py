"""Decoding and writing audio. ffmpeg does all container/codec work."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import numpy as np


class AudioError(RuntimeError):
    pass


def _require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise AudioError("ffmpeg not found on PATH (brew install ffmpeg)")
    return exe


def decode(path: str | Path, sample_rate: int) -> np.ndarray:
    """Decode any container ffmpeg understands to mono float32 at `sample_rate`.

    Browser MediaRecorder output (webm/opus on Chrome, mp4/aac on Safari) goes
    through here unchanged, which is the whole point of shelling out.
    """
    path = Path(path)
    if not path.exists():
        raise AudioError(f"no such file: {path}")
    cmd = [
        _require_ffmpeg(), "-v", "error", "-i", str(path),
        "-f", "f32le", "-acodec", "pcm_f32le",
        "-ac", "1", "-ar", str(sample_rate), "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise AudioError(f"ffmpeg failed on {path.name}: {proc.stderr.decode()[:400]}")
    x = np.frombuffer(proc.stdout, dtype="<f4").astype(np.float64)
    if x.size == 0:
        raise AudioError(f"decoded 0 samples from {path.name}")
    return x


def write_wav(path: str | Path, x: np.ndarray, sample_rate: int) -> None:
    """16-bit PCM wav, for listening to slices."""
    from scipy.io import wavfile

    peak = float(np.max(np.abs(x))) or 1.0
    pcm = np.clip(x / peak * 0.95, -1.0, 1.0)
    wavfile.write(str(path), sample_rate, (pcm * 32767).astype(np.int16))


def clip_ratio(x: np.ndarray) -> float:
    """Fraction of samples at or beyond full scale (measured before filtering)."""
    return float(np.mean(np.abs(x) >= 0.999))


def bandpass(x: np.ndarray, p) -> np.ndarray:
    """Zero-phase band-pass. Kills rumble, hum and most of a speaking voice's
    fundamental; zero-phase so note timestamps are not shifted by group delay.
    """
    from scipy.signal import butter, sosfiltfilt

    nyq = p.sample_rate / 2.0
    hi = min(p.lowpass_hz, nyq * 0.98)
    sos = butter(p.filter_order, [p.highpass_hz, hi], btype="band",
                 fs=p.sample_rate, output="sos")
    # sosfiltfilt needs a few periods of signal to work with
    if x.size < 3 * p.filter_order * 2 + 1:
        return x
    return sosfiltfilt(sos, x)
