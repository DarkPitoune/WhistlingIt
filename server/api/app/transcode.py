"""ffmpeg: everything becomes mono AAC in an m4a container.

Two reasons this is not optional:

- iOS Safari has been unreliable on Opus-in-WebM. AAC/m4a is the safe target,
  and browsers hand us whatever MediaRecorder felt like producing.
- The pipeline's invariant is that timestamps do not shift, and encoder priming
  shifts playback by 20-50 ms against `start_s`. So the analysis must run on the
  exact artifact that will be served, not on the uploaded original.

Render's native Python runtime has no ffmpeg, which is why the service ships as
a Docker image.
"""

import json
import shutil
import subprocess
from pathlib import Path


class TranscodeError(RuntimeError):
    """ffmpeg could not read or convert the upload. A 400 to the client."""


def _require_ffmpeg() -> None:
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise RuntimeError(f"{binary} is not on PATH")


def to_m4a(src: Path, dst: Path) -> None:
    """Mono AAC 96k at 48 kHz. Video streams (MediaRecorder sometimes attaches
    one) are dropped."""
    _require_ffmpeg()
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(src),
            "-vn", "-map_metadata", "-1",
            "-ac", "1", "-ar", "48000",
            "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart",
            str(dst),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not dst.exists() or dst.stat().st_size == 0:
        raise TranscodeError(proc.stderr.strip()[:500] or "ffmpeg produced no output")


def duration_s(path: Path) -> float:
    """Container duration of the transcoded file."""
    _require_ffmpeg()
    proc = subprocess.run(
        [
            "ffprobe", "-hide_banner", "-loglevel", "error",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise TranscodeError(proc.stderr.strip()[:500] or "ffprobe failed")
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise TranscodeError(f"could not read duration: {exc}") from exc
