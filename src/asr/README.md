# ASR WebVTT and Transcript Pipeline

Date: 2026-06-11
Status: Current
Area: `src/asr`, local CUDA ASR, WebVTT subtitles
Sources: `transcribe_vtt.py`, `speech_speed.py`, `model_cache.py`, `media.py`, `cuda_env.py`, `runtime_env.py`, `pyproject.toml`
Area: `src/asr`, local CUDA ASR, WebVTT subtitles, plain text transcripts
 Sources: `transcribe_vtt.py`, `model_cache.py`, `media.py`, `cuda_env.py`, `runtime_env.py`, `pyproject.toml`

## Summary

`src/asr` implements the repo's local CUDA speech-to-subtitle pipeline. The user-facing commands are `uv run asr-vtt` for transcribing video or audio, including `.flac` audio files, into `.vtt` subtitles, `uv run asr-speech-speed` for estimating words-per-minute speech speed from `.vtt` transcripts, and `uv run asr-download-model` for staging Hugging Face model downloads through `/tmp/asr-model-downloads` before storing completed snapshots under `/mnt/nas/home/ml/model`.
`src/asr` implements the repo's local CUDA speech-to-subtitle pipeline. The user-facing commands are `uv run asr-vtt` for transcribing video or audio, including `.flac` audio files, into `.vtt` subtitles plus a sibling timestamp-free `.txt` transcript, and `uv run asr-download-model` for staging Hugging Face model downloads through `/tmp/asr-model-downloads` before storing completed snapshots under `/mnt/nas/home/ml/model`.

`uv run asr-vtt` defaults to the `whisperx` backend with the full `large-v3` model because it is the strongest reliable subtitle default currently implemented in this package. The same CLI also supports `--backend faster-whisper --model large-v3` for direct CTranslate2 Whisper transcription and `--backend parakeet` for NVIDIA Parakeet TDT 0.6B v3 through NeMo.

## Command Surface

Run the default high-quality WhisperX subtitle path:

```sh
uv run asr-vtt input.mp4 --output output.vtt --language en --device cuda
uv run asr-vtt input.flac --output output.vtt --language en --device cuda
```

Each `asr-vtt` run writes the requested `.vtt` file and a plain transcript beside it by replacing the output suffix with `.txt`, such as `output.txt`.

Select a backend explicitly:

```sh
uv run asr-vtt input.mp4 --output output.whisperx.vtt --backend whisperx
uv run asr-vtt input.mp4 --output output.faster-whisper.vtt --backend faster-whisper
uv run asr-vtt input.mp4 --output output.parakeet.vtt --backend parakeet
```

Warm a model cache without running transcription:

```sh
uv run asr-download-model large-v3
uv run asr-download-model parakeet
```

Estimate speech speed from a WebVTT transcript:

```sh
uv run asr-speech-speed docs/archive/20260611/brain_dump_20260611.vtt
uv run asr-speech-speed transcript.vtt --max-gap 1.5 --long-break-gap 8.0
```

The CLI default backend/model is `whisperx` with `large-v3`. Backend model aliases are `large-v3` for `whisperx`, `large-v3` for `faster-whisper`, and `parakeet` for `parakeet`.

## Source Map

`transcribe_vtt.py` owns the `asr-vtt` CLI, backend selection, word-to-cue grouping, timestamp formatting, WebVTT rendering, and timestamp-free `.txt` transcript rendering.

`speech_speed.py` owns the `asr-speech-speed` CLI, WebVTT cue parsing, word counting, pause-bounded speech-run grouping, long-break reporting, and auto comparison of gap profiles.

`model_cache.py` owns the `asr-download-model` CLI, model aliases, Hugging Face snapshot downloads, NAS destination paths, and `.nemo` checkpoint discovery for Parakeet.

`media.py` normalizes the first audio stream from either a video container or an audio-only file as mono 16 kHz PCM WAV with `ffmpeg`. All transcription backends use this helper before model inference, so formats such as `.mp4`, `.mkv`, `.wav`, `.mp3`, and `.flac` follow the same prepared-audio path.

`cuda_env.py` exposes `uv`-installed `nvidia-cublas-cu12` and `nvidia-cudnn-cu12` shared libraries before importing CTranslate2-backed Whisper code.

`runtime_env.py` restarts `asr-vtt` once with `/lib/x86_64-linux-gnu` and `/usr/lib/x86_64-linux-gnu` first in `LD_LIBRARY_PATH`, so Python media libraries prefer Ubuntu FFmpeg libraries over stale `/usr/local/lib` copies.

## Backend Behavior

WhisperX uses the cached CTranslate2 Whisper model, Silero VAD by default, wav2vec2 alignment, and word segments when available. It writes a `WEBVTT` file with a `NOTE` line recording `backend=whisperx`, the resolved model path, and the detected language.

`faster-whisper` runs direct Whisper transcription with `word_timestamps=True`, optional VAD, and the selected beam size. It is the simpler baseline when alignment overhead is not needed.

Parakeet restores the cached `.nemo` checkpoint with NeMo, calls `transcribe(..., timestamps=True)`, and prefers word timestamps before falling back to segment timestamps.

## Cache Layout

Completed Hugging Face model snapshots live under:

```text
/mnt/nas/home/ml/model/huggingface/<org>/<repo>
```

Downloads are staged under:

```text
/tmp/asr-model-downloads
```

`ensure_model_cached()` reuses a model directory when it contains `config.json` plus a recognized weight file or `.nemo` checkpoint. If a destination exists but does not look complete, pass `--refresh` to replace it.

WhisperX auxiliary caches use `model_dir / "torch"` when populated, with download-directory staging for first-time alignment and Torch Hub assets.

## Cue Rules

`cues_from_words()` groups word timestamps into subtitle cues by maximum text length, maximum cue duration, pause gaps, and sentence punctuation. The CLI defaults are `--max-line-width 42`, `--max-cue-chars 84`, `--max-cue-duration 6.0`, and `--max-gap 0.7`.

`render_vtt()` always writes `WEBVTT`, formats timestamps as `HH:MM:SS.mmm`, guarantees each cue lasts at least 0.5 seconds, and wraps subtitle text without breaking long words. `render_txt()` writes the same cue text without timestamps, one cue per line.

## Speech Speed Rules

`asr-speech-speed` reports words per minute over pause-bounded speech runs. The key tuning flag is `--max-gap`: cue gaps at or below this many seconds count inside the same speech run, while larger gaps split runs and are excluded from the main speech-speed denominator. `--long-break-gap` controls which pauses are listed as long breaks, and `--min-run-words` / `--min-run-seconds` can ignore very small runs.

When no tuning flag is passed, `asr-speech-speed` runs three default candidate profiles: `strict-pauses` (`--max-gap 0.75 --long-break-gap 4.0`), `balanced` (`--max-gap 1.5 --long-break-gap 8.0`), and `lenient-pauses` (`--max-gap 3.0 --long-break-gap 12.0`). If the candidates disagree materially, the CLI displays each parameter set and asks for a profile when running interactively; otherwise it defaults to `balanced` and prints how to rerun with explicit parameters.

## Related Documentation

See [Open-source ASR models for WebVTT subtitles](../../docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md) for the model comparison, backend rationale, and recorded end-to-end validation results for `faster-whisper`, WhisperX, and Parakeet.
