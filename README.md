# llm-presentation

Context, source material, and local tooling for building the presentation
"Open and Closed Loops: The Economics of the LLMOS."

The presentation argues that LLMs are more useful as an operating-system layer
for work than as isolated tools bolted onto old workflows. The repo is meant to
demonstrate that idea directly: raw thoughts, transcripts, outlines, coding
sessions, and implementation work are preserved as context that later agents can
retrieve and build on.

## Presentation Shape

The target artifact is a polished five-to-seven-minute website-based
presentation, not a static slide deck. The planned demo pairs a talking-head
video with a synchronized website timeline: scrubbing the video also moves the
site through matching visual states, examples, and transitions.

The main source context is:

- [Distilled brain dump](docs/archive/20260611/brain_dump_20260611_distilled.txt)
  - core thesis, open-loop/closed-loop framing, comparative-advantage economics,
  LLMOS workflow notes, and example projects.
- [Five-minute outline](docs/archive/20260611/llmos_5_minute_outline.md) -
  compressed talking-head reference with key concepts and marked examples.
- [Coding-session transcripts](docs/README.md#coding-sessions) - durable context
  for prior agent decisions, workflows, and implementation changes.

## Local Tooling

`src/asr` provides CUDA ASR commands for turning video or audio into WebVTT
subtitles and timestamp-free plain text transcripts, plus an interactive
terminal UI for tuning subtitle pause gaps against a playable waveform. This
supports the presentation workflow by converting recorded brain dumps and
talking-head video into durable context.

## Quick Start

```sh
uv sync
uv run asr-vtt input.mp4 --output output.vtt --language en --device cuda
uv run asr-vtt input.flac --output output.vtt --language en --device cuda
uv run asr-tui input.flac --output output.vtt --language en --device cuda
uv run asr-speech-speed output.vtt
uv run asr-download-model large-v3
```

Each `asr-vtt` run writes the requested `.vtt` file plus a sibling
timestamp-free `.txt` transcript.
Use `asr-tui` when you want to view the waveform, play the audio, adjust
`max_gap`, and confirm the final `.vtt` and `.txt` outputs interactively.

## Documentation

- [Documentation index](docs/README.md) - archive, research notes, and
  coding-session transcripts.
- [Source guide](src/README.md) - local package and ASR pipeline documentation.
- [Agent guide](AGENTS.md) - repository workflow for coding agents.
