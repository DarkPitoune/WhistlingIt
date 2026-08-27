"""CLI for testing the pipeline against real recordings.

    whistle analyze samples/foo.m4a --plot
    whistle batch samples/
    whistle slice samples/foo.m4a -n 2
    whistle synth --out samples/synthetic.wav
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import audio
from .config import Params
from .pipeline import analyze, extract_range, reveal_range

AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".webm", ".flac", ".mp4", ".caf", ".aif", ".aiff"}
OUT_DIR = Path("out")

NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _name(midi: float) -> str:
    m = int(round(midi))
    return f"{NAMES[m % 12]}{m // 12 - 1}"


def _param_overrides(parser: argparse.ArgumentParser) -> None:
    """Expose every Params field as --flag so thresholds can be swept."""
    for field, value in Params().as_dict().items():
        parser.add_argument(f"--{field.replace('_', '-')}", type=type(value),
                            default=None, help=f"default {value}")


def _build_params(args) -> Params:
    overrides = {k: v for k, v in vars(args).items()
                 if k in Params().as_dict() and v is not None}
    return Params(**overrides)


def _print_table(data: dict) -> None:
    q = data["quality"]
    m = data["metrics"]
    verdict = "PASS" if q["ok"] else "REJECT " + ",".join(q["reasons"])
    print(f"\n{data['source']}  [{verdict}]")
    print(f"  {m['duration_s']}s  notes={data['n_notes']}  "
          f"whistle_likeness={m['whistle_likeness']}  voiced={m['voiced_ratio']}  "
          f"median_f0={m['median_f0_hz']}Hz")
    if not data["notes"]:
        return
    print(f"  {'#':>3} {'start':>7} {'end':>7} {'dur':>6} {'f0 Hz':>8} "
          f"{'note':>5} {'semi':>6} {'conf':>5}")
    prev = None
    for n in data["notes"]:
        step = "" if prev is None else f"{(n['midi'] - prev):+.1f}"
        print(f"  {n['index']:>3} {n['start_s']:>7.3f} {n['end_s']:>7.3f} "
              f"{n['duration_s']:>6.3f} {n['f0_hz']:>8.1f} {_name(n['midi']):>5} "
              f"{step:>6} {n['confidence']:>5.2f}")
        prev = n["midi"]


def cmd_analyze(args) -> int:
    p = _build_params(args)
    result = analyze(args.file, p)
    data = result.to_dict()
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        _print_table(data)
    if args.plot:
        from . import plot

        out = OUT_DIR / (Path(args.file).stem + ".png")
        print(f"  plot -> {plot.save(result, out)}")
    return 0


def cmd_batch(args) -> int:
    p = _build_params(args)
    root = Path(args.dir)
    files = sorted(f for f in root.rglob("*") if f.suffix.lower() in AUDIO_EXT)
    if not files:
        print(f"no audio files under {root}", file=sys.stderr)
        return 1
    rows = []
    for f in files:
        try:
            result = analyze(f, p)
        except Exception as exc:  # keep going through a whole folder
            print(f"{f.name}: ERROR {exc}", file=sys.stderr)
            continue
        data = result.to_dict()
        rows.append(data)
        _print_table(data)
        if args.plot:
            from . import plot

            plot.save(result, OUT_DIR / (f.stem + ".png"))
    if args.plot:
        print(f"\nplots -> {OUT_DIR}/")
    if args.json:
        OUT_DIR.mkdir(exist_ok=True)
        dest = OUT_DIR / "batch.json"
        dest.write_text(json.dumps(rows, indent=2))
        print(f"json -> {dest}")
    print(f"\n{len(rows)}/{len(files)} analysed, "
          f"{sum(r['quality']['ok'] for r in rows)} passing the gate")
    return 0


def cmd_slice(args) -> int:
    p = _build_params(args)
    result = analyze(args.file, p)
    if not result.notes:
        print("no notes detected", file=sys.stderr)
        return 1
    t0, t1 = reveal_range(result, args.notes, tail_s=args.tail, lead_s=args.lead)
    seg = extract_range(result, t0, t1)
    OUT_DIR.mkdir(exist_ok=True)
    out = Path(args.out) if args.out else OUT_DIR / f"{Path(args.file).stem}_first{args.notes}.wav"
    audio.write_wav(out, seg, p.sample_rate)
    print(f"first {args.notes} of {len(result.notes)} notes -> {t0:.3f}..{t1:.3f}s -> {out}")
    return 0


def cmd_synth(args) -> int:
    from .synth import whistle

    p = _build_params(args)
    x, truth = whistle(sample_rate=p.sample_rate, gap_s=args.gap)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    audio.write_wav(out, x, p.sample_rate)
    print(f"{out}  ({len(truth)} notes, gap={args.gap}s)")
    print(json.dumps(truth, indent=2))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="whistle", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("analyze", help="analyse one file")
    a.add_argument("file")
    a.add_argument("--json", action="store_true")
    a.add_argument("--plot", action="store_true")
    _param_overrides(a)
    a.set_defaults(func=cmd_analyze)

    b = sub.add_parser("batch", help="analyse every audio file in a folder")
    b.add_argument("dir", nargs="?", default="samples")
    b.add_argument("--json", action="store_true")
    b.add_argument("--plot", action="store_true")
    _param_overrides(b)
    b.set_defaults(func=cmd_batch)

    s = sub.add_parser("slice", help="export the 'first N notes' reveal range")
    s.add_argument("file")
    s.add_argument("-n", "--notes", type=int, default=2)
    s.add_argument("-o", "--out")
    s.add_argument("--lead", type=float, default=0.15, help="run-in kept before the first note")
    s.add_argument("--tail", type=float, default=0.08, help="tail kept after the last revealed note")
    _param_overrides(s)
    s.set_defaults(func=cmd_slice)

    y = sub.add_parser("synth", help="render a synthetic whistle with known answers")
    y.add_argument("--out", default="samples/synthetic.wav")
    y.add_argument("--gap", type=float, default=0.05)
    _param_overrides(y)
    y.set_defaults(func=cmd_synth)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
