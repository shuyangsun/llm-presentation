#!/usr/bin/env python3
"""Bake the intro's real audio envelope into a compact peaks file.

The 3D "audio -> transcript" scene (src/engine/asr3d.ts) shows a scrolling
waveform of the *actual* video audio. Rather than analyse audio live (which can't
be scrubbed backward), we precompute a peak-amplitude envelope here and index it
by playhead time at runtime — a pure function of t, fully reversible.

Usage:
    python3 web/scripts/gen-waveform.py [SOURCE_AUDIO] [--hz 100]

SOURCE_AUDIO defaults to the NAS master. Writes web/src/data/intro.peaks.json.
Re-run whenever the recording changes. Requires ffmpeg on PATH.
"""
import argparse
import json
import os
import struct
import subprocess
import sys

DEFAULT_SRC = "/mnt/nas/home/documents/presentations/20260611-open-close-loop-llm-os/0001_intro.flac"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "intro.peaks.json")
SR = 8000  # decode rate; plenty for an amplitude envelope


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", nargs="?", default=DEFAULT_SRC)
    ap.add_argument("--hz", type=int, default=100, help="peaks per second")
    ap.add_argument("--gamma", type=float, default=0.62, help="<1 lifts quiet speech")
    args = ap.parse_args()

    if not os.path.exists(args.source):
        print(f"source audio not found: {args.source}", file=sys.stderr)
        return 1

    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", args.source, "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
        return proc.returncode

    raw = proc.stdout
    n = len(raw) // 2
    samples = struct.unpack("<%dh" % n, raw[: n * 2])
    bucket = max(1, SR // args.hz)

    peaks = []
    for i in range(0, n, bucket):
        seg = samples[i : i + bucket]
        if not seg:
            break
        peaks.append(max(abs(s) for s in seg) / 32768.0)

    mx = max(peaks) or 1.0
    out = [max(0, min(255, round(((p / mx) ** args.gamma) * 255))) for p in peaks]

    obj = {"hz": args.hz, "duration": round(n / SR, 2), "n": len(out), "peaks": out}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(obj, f, separators=(",", ":"))

    print(f"wrote {os.path.relpath(OUT)}: {len(out)} peaks @ {args.hz}Hz, {obj['duration']}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
