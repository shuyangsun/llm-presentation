# Source Documentation

Date: 2026-06-11
Status: Current
Area: `src`

## Summary

`src` contains the repo's local implementation code. The current package is `src/asr`, which provides CUDA ASR commands for generating WebVTT subtitles and timestamp-free plain text transcripts from video or audio files.

## Packages

- [ASR WebVTT and transcript pipeline](asr/README.md) - documents `uv run asr-vtt`, `uv run asr-download-model`, the WhisperX, faster-whisper, and Parakeet backends, model cache paths, `.vtt` and `.txt` outputs, and source files under `src/asr`.
