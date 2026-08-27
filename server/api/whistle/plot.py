"""Debug plot: the fastest way to see why a segmentation went wrong."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def save(result, out_path: str | Path) -> Path:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    f = result.frames
    p = result.params
    voiced = result.voiced
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fig, (ax0, ax1) = plt.subplots(
        2, 1, figsize=(max(10, result.duration_s * 1.4), 7),
        sharex=True, height_ratios=[3, 1], constrained_layout=True,
    )

    # Shade unvoiced regions - on real recordings this is where most of the
    # diagnosis happens (dropouts, breath gaps, noise).
    from .segment import _runs

    for a, b in _runs(~voiced):
        ax0.axvspan(f.t[a], f.t[min(b, f.t.size - 1)], color="#f1f3f5", zorder=0)

    midi = 69.0 + result.cents / 100.0
    raw = np.where(voiced, midi, np.nan)
    sm = np.where(voiced, 69.0 + result.smoothed / 100.0, np.nan)
    ax0.plot(f.t, raw, ".", ms=2.0, color="#9aa5b1", label="f0 (cleaned)")
    ax0.plot(f.t, sm, "-", lw=1.0, color="#4b7bec", label="smoothed (decision)")

    for i, n in enumerate(result.notes):
        y = 69.0 + n.cents / 100.0
        ax0.hlines(y, n.start_s, n.end_s, color="#e8590c", lw=3.0, zorder=3)
        ax0.axvline(n.start_s, color="#e8590c", lw=0.7, ls="--", alpha=0.6)
        ax0.annotate(f"{i}", (n.start_s, y), textcoords="offset points",
                     xytext=(2, 6), fontsize=8, color="#e8590c")
    if result.notes:
        ax0.axvline(result.notes[-1].end_s, color="#e8590c", lw=0.7, ls="--", alpha=0.6)

    q = result.to_dict()["quality"]
    verdict = "PASS" if q["ok"] else "REJECT: " + ",".join(q["reasons"])
    m = result.metrics
    ax0.set_title(
        f"{result.path.name} - {len(result.notes)} notes - {verdict}\n"
        f"whistle_likeness={m['whistle_likeness']} voiced={m['voiced_ratio']} "
        f"median_f0={m['median_f0_hz']} Hz",
        fontsize=10,
    )
    ax0.set_ylabel("MIDI note (informational)")
    ax0.grid(alpha=0.25)
    ax0.legend(loc="upper right", fontsize=8)

    ax1.plot(f.t, f.level_db, lw=0.8, color="#495057", label="level dB")
    ax1.axhline(p.level_floor_db, color="#adb5bd", ls=":", lw=0.8)
    ax1.set_ylim(-70, 2)
    ax1.set_ylabel("dB")
    ax1.grid(alpha=0.25)

    ax2 = ax1.twinx()
    ax2.plot(f.t, f.purity, lw=0.8, color="#37b24d", label="purity")
    ax2.axhline(p.purity_min, color="#8ce99a", ls=":", lw=0.8)
    ax2.set_ylim(0, 1.05)
    ax2.set_ylabel("purity")
    ax1.set_xlabel("time (s)")

    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    return out_path
