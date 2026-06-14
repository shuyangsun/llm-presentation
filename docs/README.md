# Documentation Index

## Research

- [Open-source ASR models for WebVTT subtitles](research/2026-06-10/0000-open-source-asr-vtt-subtitles.md) - compares free open-source/open-weight ASR options for video transcription with timestamps, `.vtt` subtitle output, and timestamp-free `.txt` transcript output.
- [igloo.inc 3D animation techniques](research/2026-06-13/0000-igloo-inc-3d-animation-techniques.md) - concrete, reproducible techniques behind igloo.inc's frosted-ice hover effect and closing particle effect (fresnel/refraction, mouse damping, GPU particles), for warm-palette supporting art.
- [Performant Three.js glass + GPU particles on a light background](research/2026-06-13/0001-threejs-performant-glass-and-particles.md) - code-level patterns for instanced frosted-glass slabs, stateless `uProgress`-driven GPU particles, mouse damping, and full WebGL lifecycle/disposal in a no-framework Vite app.
- [3D ASR scene integration spec](research/2026-06-13/0002-asr-3d-scene-integration-spec.md) - line-accurate spec for wiring a WebGL scene into the presentation engine: scene lifecycle hooks (`__tick`/`__cleanup`), reveal mechanics, design tokens, container sizing, and fallbacks.

## Design

- [ASR scene → 3D frosted-glass waveform](design/2026-06-13/0000-asr-3d-frosted-glass-waveform.md) - the synthesized implementation plan that turns the 2D `audio → transcript` supporting art into an interactive 3D frosted-glass waveform that crystallizes into transcript lines; reconciles the three 2026-06-13 research briefs.
- [Six bespoke 3D supporting-art scenes](design/2026-06-14/0001-bespoke-3d-supporting-art-scenes.md) - the distinct interactive Three.js scenes for translate · sync · responsive · director · rag · loop, all on the shared `web/src/engine/scene3d.ts` scaffold (palette, pointer, reversible `phase(t,a,b)`), each a pure function of the playhead with a 2D fallback.

## Subtitles

- [Subtitle assets](subtitles/README.md) - canonical WebVTT and timestamp-free transcript files, including `0001_intro.vtt`, `0001_intro.txt`, the June 11 brain-dump VTT, and the June 13 presentation test VTT.

## Archive

- [June 11, 2026 presentation brain dump](archive/20260611/brain_dump_20260611_distilled.txt) - distilled context for "Open and Closed Loops: The Economics of the LLMOS"; the raw WebVTT lives under [subtitle assets](subtitles/README.md).
- [Five-minute LLMOS presentation outline](archive/20260611/llmos_5_minute_outline.md) - talking-head reference outline with WPM budget, key concepts, and marked examples for the compressed presentation.

## Transcripts

- [VCS guardrails session](transcripts/2026-06-10/0000-codex-vcs-guardrails.md) - records the setup of local VCS guardrail hooks and jj workflow checks.
- [Open-source ASR VTT research session](transcripts/2026-06-10/0001-codex-open-source-asr-vtt-research.md) - records the hook fix, ASR research, documentation, and local commit workflow.
- [ASR VTT pipeline session](transcripts/2026-06-11/0002-codex-asr-vtt-pipeline.md) - records the CUDA ASR implementation, WhisperX and Parakeet backend validation, ffmpeg wrapper fix, and local commit workflow.
- [Source ASR docs session](transcripts/2026-06-11/0003-codex-src-asr-docs.md) - records the co-located `src/asr` documentation update, transcript export, and local commit workflow.
- [Repository docs and skill symlink session](transcripts/2026-06-11/0004-codex-docs-session-export.md) - records the root `README.md`, `AGENTS.md`, and `CLAUDE.md` docs, the Claude skills symlink, transcript export, and local jj integration workflow.
- [ASR audio and FLAC session](transcripts/2026-06-11/0005-codex-asr-audio-flac.md) - records the ASR media normalization update, `.flac` validation, WhisperX `large-v3` default check, Parakeet comparison, transcript export, and jj integration workflow.
- [Presentation brain dump archive session](transcripts/2026-06-11/0006-codex-brain-dump-archive.md) - records the June 11, 2026 brain-dump VTT archive, distilled LLM context file, transcript export, and jj integration workflow.
- [ASR speech speed session](transcripts/2026-06-11/0007-codex-asr-speech-speed.md) - records the `asr-speech-speed` CLI, WebVTT gap-profile analysis, sample transcript validation, transcript export, and jj integration workflow.
- [ASR TXT transcript session](transcripts/2026-06-11/0007-codex-asr-txt-transcript.md) - records the ASR `.txt` transcript output update, documentation refresh, transcript export, and jj integration workflow.
- [Five-minute LLMOS outline session](transcripts/2026-06-11/0008-codex-five-minute-llmos-outline.md) - records the archived five-minute presentation outline, WPM measurement, transcript export, and jj integration workflow.
- [ASR interactive TUI session](transcripts/2026-06-11/0010-codex-asr-interactive-tui.md) - records the `asr-tui` waveform playback UI, live model-session refactor, max-gap tuning workflow, validation, documentation, and jj integration workflow.
- [ASR TUI runtime model staging session](transcripts/2026-06-11/0011-codex-asr-tui-runtime-model-staging.md) - records the `asr-tui` NAS model loading diagnosis, local runtime model staging fix, validation, transcript export, and jj integration workflow.
- [Subtitle asset organization session](transcripts/2026-06-13/0014-codex-subtitle-asset-organization.md) - records the `docs/subtitles/` asset move, `0001_intro` copy, docs reference updates, transcript export, and jj integration workflow.
- [Regenerate intro subtitles session](transcripts/2026-06-13/0015-codex-regenerate-intro-subtitles.md) - records the WhisperX `large-v3` regeneration of `docs/subtitles/0001_intro.vtt` and `docs/subtitles/0001_intro.txt`, verification, transcript export, and jj integration workflow.
