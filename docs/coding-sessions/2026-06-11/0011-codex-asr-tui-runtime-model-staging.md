<!-- markdownlint-disable MD013 MD024 -->

# Codex ASR TUI Runtime Model Staging Session

Date: 2026-06-12
Repo: llm-presentation, jj workspace `codex-fix-asr-tui-network`, change `wxomqqolsnrkworxsyrxsoyopyvrtkpu`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex CLI 0.139.0 (OpenAI GPT-5, reasoning effort not exposed by session log)
Summary: Fixed `asr-tui` startup by staging NAS-backed ASR model snapshots into a local runtime mirror before loading WhisperX, documented the behavior, verified the staging path and checks, and prepared the work for jj integration.

## User

# AGENTS.md instructions for ./

<INSTRUCTIONS>
# Agent Guide

Date: 2026-06-12
Status: Current
Area: repository workflow, agent skills, jj workspaces

## Summary

Work from the assigned isolated workspace. This repo uses Jujutsu (`jj`),
repo-local skills, and durable documentation as project memory.

## Required References

- Project context: [README.md](README.md) and [docs/README.md](docs/README.md).
- Presentation source material:
  [brain dump](docs/archive/20260611/brain_dump_20260611_distilled.txt) and
  [five-minute outline](docs/archive/20260611/llmos_5_minute_outline.md).
- VCS workflow: load `.agents/skills/vcs/SKILL.md` before edits, commits,
  integration, cleanup, or publishing. Use the helper scripts; do not publish
  unless the user explicitly asks.
- Documentation workflow: load `.agents/skills/updating-docs/SKILL.md` before
  writing docs. Search first and keep docs linked from an index.
- Session exports: use `.agents/skills/export-coding-session/SKILL.md` only when
  requested; write transcripts under `docs/coding-sessions/`.
- Skills source of truth: edit `.agents/skills`, not `.claude/skills`.
- Docs-only verification: check linked files and `jj status`.

</INSTRUCTIONS>
<environment_context>
  <cwd>./</cwd>
  <shell>zsh</shell>
  <current_date>2026-06-11</current_date>
  <timezone>America/New_York</timezone>
  <filesystem><workspace_roots><root>./</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>

## User

@src/asr/ TUI is still not working: [REDACTED_LOCAL_SCREENSHOT_PATH]
[REDACTED_LOCAL_SCREENSHOT_PATH]

My network receiving traffic never raised to more than 1MB/s. It should be more given it's reading from the NAS.

Fix it, then export session transcript, and integrate.

## Assistant

Loaded `.agents/skills/vcs/SKILL.md` and `.agents/skills/coding-style/SKILL.md`, then renamed the temporary jj workspace from `codex-pending-0f3dc3b4` to `codex-fix-asr-tui-network` with the VCS helper. Read the required repo context from `README.md`, `docs/README.md`, `docs/archive/20260611/brain_dump_20260611_distilled.txt`, and `docs/archive/20260611/llmos_5_minute_outline.md`.

Inspected `src/asr/interactive_tui.py`, `src/asr/transcribe_vtt.py`, `src/asr/media.py`, `src/asr/model_cache.py`, `src/asr/README.md`, and `pyproject.toml`. The current TUI startup order resolved the model cache, loaded the ASR model from `[REDACTED_NAS_MODEL_PATH]/huggingface/Systran/faster-whisper-large-v3`, then prepared the input audio and waveform after model loading. Both screenshots showed the TUI on the `Loading ASR model` screen for the NAS-backed `large-v3` model path, so the observed low network receive traffic corresponded to model initialization rather than the later media-file read.

Loaded `.agents/skills/updating-docs/SKILL.md` before updating docs. The referenced `retrieving-context` skill was not present in this repo, so the search-before-writing step used the existing docs index and `rg` searches for ASR TUI, runtime, model-dir, and staging concepts.

Implemented a local runtime model mirror:

- Added `DEFAULT_RUNTIME_MODEL_DIR = [REDACTED_TMP_PATH]/runtime-models` in `src/asr/model_cache.py`.
- Added `runtime_model_destination()` to create deterministic local mirror directories with a hash of the resolved source model path.
- Added `stage_model_for_runtime()` to copy a complete cached model directory into the local runtime mirror and reuse the mirror on later launches.
- Left non-directory paths, already-staged paths, and local explicit model paths untouched.

Changed `src/asr/interactive_tui.py` so `asr-tui` now:

- exposes `--runtime-model-dir`, defaulting to `[REDACTED_TMP_PATH]/runtime-models`;
- exposes `--no-stage-model` for direct NAS loading when desired;
- resolves the selected model through `ensure_model_cached()`;
- checks whether the resolved model path is under `--model-dir`;
- displays a new `Staging ASR model locally` progress screen for NAS-backed models;
- loads WhisperX/faster-whisper from the local runtime mirror after staging.

Updated `src/asr/README.md` to document that `asr-tui` mirrors NAS-backed model snapshots into the local runtime model directory before loading, that this avoids slow demand-loaded NAS reads during interactive startup, and that `--no-stage-model` opts out.

Validation performed:

- `uv run ruff format src/asr/model_cache.py src/asr/interactive_tui.py src/asr/README.md` reformatted the two Python files and refused Markdown formatting because Ruff Markdown formatting requires preview mode; the Markdown doc was left as manually edited.
- `uv run ruff format --check src/asr/model_cache.py src/asr/interactive_tui.py` passed.
- `uv run ruff check src/asr/model_cache.py src/asr/interactive_tui.py` passed.
- `uv run python -m compileall src/asr` passed.
- `uv run asr-tui --help` showed `--runtime-model-dir` and `--no-stage-model`.
- A synthetic model-cache smoke test created a minimal complete model directory, staged it into a temporary runtime mirror, verified the copy contents, verified reuse on the second call, and verified that already-staged paths and `--no-stage-model` skip staging.
- `uv run ruff check src/asr` passed.
- A real default-model resolution check resolved `large-v3` to `[REDACTED_NAS_MODEL_PATH]/huggingface/Systran/faster-whisper-large-v3`, reported `cache_label=model-dir`, reported `will_stage=True`, and computed the runtime mirror destination `[REDACTED_TMP_PATH]/runtime-models/faster-whisper-large-v3-871104a68a31f40c`.

Loaded `.agents/skills/export-coding-session/SKILL.md`, ran its `next-index.sh` helper, and selected this file as `docs/coding-sessions/2026-06-11/0011-codex-asr-tui-runtime-model-staging.md`. The raw Codex log contained large instruction payloads and encrypted reasoning blobs, so this transcript reconstructs the human-visible session from current context, preserves user turns with required redactions, and summarizes tool activity instead of pasting raw tool logs.
