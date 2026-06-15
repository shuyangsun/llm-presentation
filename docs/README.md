# Documentation Index

Date: 2026-06-14
Status: Current
Area: repository documentation index, presentation source map, session memory

## Summary

`docs/` is the central project-memory tree for the LLMOS presentation: research,
design notes, canonical subtitle assets, archived source material, and exported
agent sessions. The live production website is documented in
[`web/README.md`](../web/README.md); the ASR tooling is documented in
[`src/asr/README.md`](../src/asr/README.md).

Session memory is split across two historical locations. `docs/transcripts/` is
the canonical archive named by [`AGENTS.md`](../AGENTS.md) and the repo-local
`export-transcript` skill for requested session exports. `docs/coding-sessions/`
contains later Claude Code exports written before the repo-local export helper
was realigned to `docs/transcripts/`; it is indexed here so retrieval can find
those implementation decisions. Use the full dated slug path when referring to a
session, because early exports include duplicate numeric prefixes.

## Repository Guides

- [Project README](../README.md) - project thesis, production presentation shape,
  source context, ASR quick start, and repository entry points.
- [Production web presentation](../web/README.md) - Vite + TypeScript + GSAP +
  Three.js app where the talking-head video drives the synchronized timeline.
- [Source guide](../src/README.md) - local package index, currently focused on
  the CUDA ASR subtitle and transcript pipeline.
- [Agent guide](../AGENTS.md) - jj workspace isolation, required references,
  skill usage, transcript-export convention, and docs-only verification.
- [June 13 prototype notes](../prototypes/20260613/NOTES.md) - v1 review
  feedback that shaped the production web presentation.

## Research

- [Open-source ASR models for WebVTT subtitles](research/2026-06-10/0000-open-source-asr-vtt-subtitles.md) - compares free open-source/open-weight ASR options for video transcription with timestamps, `.vtt` subtitle output, and timestamp-free `.txt` transcript output.
- [igloo.inc 3D animation techniques](research/2026-06-13/0000-igloo-inc-3d-animation-techniques.md) - concrete, reproducible techniques behind igloo.inc's frosted-ice hover effect and closing particle effect (fresnel/refraction, mouse damping, GPU particles), for warm-palette supporting art.
- [Performant Three.js glass + GPU particles on a light background](research/2026-06-13/0001-threejs-performant-glass-and-particles.md) - code-level patterns for instanced frosted-glass slabs, stateless `uProgress`-driven GPU particles, mouse damping, and full WebGL lifecycle/disposal in a no-framework Vite app.
- [3D ASR scene integration spec](research/2026-06-13/0002-asr-3d-scene-integration-spec.md) - line-accurate spec for wiring a WebGL scene into the presentation engine: scene lifecycle hooks (`__tick`/`__cleanup`), reveal mechanics, design tokens, container sizing, and fallbacks.

## Design

- [ASR scene → 3D frosted-glass waveform](design/2026-06-13/0000-asr-3d-frosted-glass-waveform.md) - the synthesized implementation plan that turns the 2D `audio → transcript` supporting art into an interactive 3D frosted-glass waveform that crystallizes into transcript lines; reconciles the three 2026-06-13 research briefs.
- [Six bespoke 3D supporting-art scenes](design/2026-06-14/0001-bespoke-3d-supporting-art-scenes.md) - the distinct interactive Three.js scenes for translate · sync · responsive · director · rag · loop, all on the shared `web/src/engine/scene3d.ts` scaffold (palette, pointer, reversible `phase(t,a,b)`), including later link-rain, mobile-fold, RAG-edge, and loop-human refinements; the **director scene was later recast as a standalone 2D pixel-art platformer** (no WebGL — see the transcript below).

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
- [VCS skill end-to-end test](transcripts/2026-06-11/0009-claude-vcs-skill-test.md) - records a Claude VCS skill test session and the historical export-path convention issue.
- [ASR interactive TUI session](transcripts/2026-06-11/0010-codex-asr-interactive-tui.md) - records the `asr-tui` waveform playback UI, live model-session refactor, max-gap tuning workflow, validation, documentation, and jj integration workflow.
- [ASR TUI runtime model staging session](transcripts/2026-06-11/0011-codex-asr-tui-runtime-model-staging.md) - records the `asr-tui` NAS model loading diagnosis, local runtime model staging fix, validation, transcript export, and jj integration workflow.
- [ASR TUI loading hang fix](transcripts/2026-06-13/0012-claude-fix-asr-tui-loading-hang.md) - records the `curses.napms()` GIL-starvation diagnosis and the `time.sleep(0.09)` loading-screen fix.
- [Interactive presentation prototype session](transcripts/2026-06-13/0013-claude-interactive-presentation-prototype.md) - records the first Vite + TypeScript + GSAP talking-head prototype, review feedback, and move under `prototypes/20260613/`.
- [Subtitle asset organization session](transcripts/2026-06-13/0014-codex-subtitle-asset-organization.md) - records the `docs/subtitles/` asset move, `0001_intro` copy, docs reference updates, transcript export, and jj integration workflow.
- [Regenerate intro subtitles session](transcripts/2026-06-13/0015-codex-regenerate-intro-subtitles.md) - records the WhisperX `large-v3` regeneration of `docs/subtitles/0001_intro.vtt` and `docs/subtitles/0001_intro.txt`, verification, transcript export, and jj integration workflow.
- [Production intro site session](transcripts/2026-06-13/0016-claude-production-intro-site.md) - records the first production `web/` app, Paper palette port, video-driven director loop, seven supporting scenes, and desktop/mobile verification.
- [Presentation retiming and sizing session](transcripts/2026-06-13/0017-claude-presentation-retiming-sizing.md) - records the word-synced reveal engine, gradual scene reveals, larger mobile-safe typography, and timing verification against `0001_intro.vtt`.
- [3D ASR supporting-art session](transcripts/2026-06-14/0018-claude-3d-asr-supporting-art.md) - records the first Three.js `audio -> transcript` scene, waveform/particle design, real cue text, pointer disruption, and WebGL fallback work.
- [Six bespoke 3D scenes session](transcripts/2026-06-14/0019-claude-more-3d-supporting-art-scenes.md) - records the shared `scene3d.ts` scaffold and the translate, sync, responsive, director, rag, and loop Three.js scene implementations.
- [Repository documentation pass session](transcripts/2026-06-14/0020-codex-repository-doc-pass.md) - records the whole-repo documentation audit, session-memory indexing, export-transcript path realignment, retrieval-skill link fix, verification, and VCS integration request.
- [Director's Dash pixel-art game session](transcripts/2026-06-14/0021-claude-director-dash-pixel-game.md) - records recasting the director scene (`web/src/engine/director3d.ts`) from a 3D spotlight stage into a 2D pixel-art platformer: J/K controls, necktie corporate-employee turtles, collectible open-source GitHub file links with facts about the talk, and a 3-lives death mechanic with cute "X X" eyes and Enter restart.
- [Director Dash game controls session](transcripts/2026-06-14/0022-codex-director-game-controls.md) - records the J/K video-shortcut isolation, start overlay, five-document win condition, progress-square collection status, clickable win-screen docs list, visual/browser verification, transcript export, and VCS integration request.

## Coding Sessions

These historical Claude Code session exports live under `docs/coding-sessions/`.
They document follow-up production refinements that were exported before the
repo-local `export-transcript` helper was realigned to `docs/transcripts/`.

- [Relax VCS hooks for Claude](coding-sessions/2026-06-14/0000-claude-relax-vcs-hooks.md) - records the `.claude/settings.local.json` `additionalDirectories` fix that keeps Claude shells in the isolated jj workspace.
- [3D ASR scene staged entrance and live waveform](coding-sessions/2026-06-14/0001-claude-3d-audio-appear.md) - records the `asr3d.ts` staged entrance, Web Audio analyser path, live waveform sync, and per-cue particle evaporate/re-drop behavior.
- [3D loop finale rework](coding-sessions/2026-06-14/0001-claude-3d-loop.md) - records the green closed loop, red open loop, particle flood into a human silhouette, and face-on ice shader fixes.
- [3D English-to-Chinese translation scene](coding-sessions/2026-06-14/0002-claude-3d-translation-scene.md) - records the `Text`/`文` transmutation scene, cursor-controlled language binding, and in-place `__setLang` update path.
- [Pause/play overlay and paused progress bar](coding-sessions/2026-06-14/0002-claude-pause-overlay.md) - records the center play overlay shown after the cold open and the explicit paused-state chrome visibility rule.
- [RAG 3D skill edges and open-source links](coding-sessions/2026-06-14/0003-claude-rag3d-skill-edges-and-open-source-links.md) - records the graph-edge skill links, open-source corpus node links, and stable-size RAG point cloud.
- [3D in-sync progress-bar scene](coding-sessions/2026-06-14/0004-claude-3d-in-sync-progress-bar.md) - records the head-on link-rain progress-bar scene with section dots and mouse-hover section titles.
- [Progress bar reveal gating](coding-sessions/2026-06-14/0005-claude-progress-bar-reveal-gating.md) - records the `BEATS.progress` seek-bar conceal/reveal behavior and `scrub-locked` / `scrub-reveal` body flags.
- [Responsive 3D mobile scene](coding-sessions/2026-06-14/0006-claude-responsive3d-mobile.md) - records the vertical mobile layout beats, top-dock transition, content reveal, and cursor-driven fold interaction.
