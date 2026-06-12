# llm-presentation ASR

Local CUDA ASR tooling for generating WebVTT subtitles from video or audio files.
The package exposes `uv run asr-vtt` for transcription and
`uv run asr-download-model` for warming model caches, plus
`uv run asr-speech-speed` for estimating speech speed from `.vtt` transcripts.

## Quick Start

```sh
uv sync
uv run asr-vtt input.mp4 --output output.vtt --language en --device cuda
uv run asr-vtt input.flac --output output.vtt --language en --device cuda
uv run asr-speech-speed output.vtt
uv run asr-download-model large-v3
```

## Documentation

- [Documentation index](docs/README.md) - research notes and coding-session transcripts.
- [Source guide](src/README.md) - local package and ASR pipeline documentation.
- [Agent guide](AGENTS.md) - repository workflow for coding agents.
