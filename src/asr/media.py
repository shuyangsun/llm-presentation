"""Media preparation helpers for ASR backends."""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path


def extract_mono_16khz_wav(
    input_path: Path,
    *,
    output_dir: Path,
    ffmpeg: str = "ffmpeg",
    refresh: bool = False,
) -> Path:
    """Normalize the first audio stream from video or audio as mono 16 kHz PCM WAV."""

    output_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(str(input_path.resolve()).encode("utf-8")).hexdigest()[:16]
    output_path = output_dir / f"{input_path.stem}-{digest}.16k-mono.wav"
    if output_path.exists() and not refresh:
        return output_path

    temp_path = output_path.with_suffix(".tmp.wav")
    if temp_path.exists():
        temp_path.unlink()

    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(input_path),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(temp_path),
    ]
    subprocess.run(command, check=True)
    temp_path.replace(output_path)
    return output_path
