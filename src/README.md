# Source Documentation

Date: 2026-06-11
Status: Current
Area: `src`

## Summary

`src` contains the repo's local implementation code. The current package is `src/asr`, which provides CUDA ASR commands for generating WebVTT subtitles from video or audio files and estimating speech speed from WebVTT transcripts.

## Packages

- [ASR WebVTT pipeline](asr/README.md) - documents `uv run asr-vtt`, `uv run asr-speech-speed`, `uv run asr-download-model`, the WhisperX, faster-whisper, and Parakeet backends, model cache paths, and source files under `src/asr`.
