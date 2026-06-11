# ASR WebVTT Pipeline

Date: 2026-06-11
Status: Current
Area: `src/asr`, local CUDA ASR, WebVTT subtitles
Sources: `transcribe_vtt.py`, `model_cache.py`, `media.py`, `cuda_env.py`, `runtime_env.py`, `pyproject.toml`

## Summary

`src/asr` implements the repo's local CUDA speech-to-subtitle pipeline. The user-facing commands are `uv run asr-vtt` for transcribing video or audio into `.vtt` subtitles and `uv run asr-download-model` for staging Hugging Face model downloads through `/tmp/asr-model-downloads` before storing completed snapshots under `/mnt/nas/home/ml/model`.

`uv run asr-vtt` defaults to the `whisperx` backend with `large-v3` because WhisperX adds wav2vec2 alignment for stronger word-level subtitle timing. The same CLI also supports `--backend faster-whisper` for direct CTranslate2 Whisper transcription and `--backend parakeet` for NVIDIA Parakeet TDT 0.6B v3 through NeMo.

## Command Surface

Run the default high-quality WhisperX subtitle path:

```sh
uv run asr-vtt input.mp4 --output output.vtt --language en --device cuda
```

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

The default model aliases are `large-v3` for `whisperx`, `large-v3` for `faster-whisper`, and `parakeet` for `parakeet`.

## Source Map

`transcribe_vtt.py` owns the `asr-vtt` CLI, backend selection, word-to-cue grouping, timestamp formatting, and WebVTT rendering.

`model_cache.py` owns the `asr-download-model` CLI, model aliases, Hugging Face snapshot downloads, NAS destination paths, and `.nemo` checkpoint discovery for Parakeet.

`media.py` extracts the first audio stream as mono 16 kHz PCM WAV with `ffmpeg`. The WhisperX and Parakeet paths normalize input through this helper before model inference.

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

`render_vtt()` always writes `WEBVTT`, formats timestamps as `HH:MM:SS.mmm`, guarantees each cue lasts at least 0.5 seconds, and wraps subtitle text without breaking long words.

## Related Documentation

See [Open-source ASR models for WebVTT subtitles](../../docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md) for the model comparison, backend rationale, and recorded end-to-end validation results for `faster-whisper`, WhisperX, and Parakeet.
