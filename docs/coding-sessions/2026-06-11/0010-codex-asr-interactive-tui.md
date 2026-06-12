<!-- markdownlint-disable MD013 MD024 -->

# Codex ASR Interactive TUI Session

Date: 2026-06-12
Repo: llm-presentation, jj workspace `codex-asr-interactive-tui`, change `xolvtnztsoownupxxtutrpvpznpylwxz`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex (GPT-5.5, reasoning: xhigh)
Summary: Implemented `uv run asr-tui` for interactive ASR subtitle tuning, refactored ASR backends into reusable live model sessions, documented the command, validated it with the sample brain-dump audio, and recorded the follow-up fix that resolves and displays the NAS model path before WhisperX loading.

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

When generating transcript with @src/asr/, I do not have a good sense of whether or not the max gap chosen is a good value. Build me an interactive terminal GUI under @src/asr/, where the GUI displays the audio wave (for both audio and video) with a slide bar at the bottom that's clickable. If clicking is not enabled, allow standard playback controls via keyboard. As the audio is being played, subtitles should be displayed under the audio. If I would like to change the max gap, there should be a keyboard shortcut to regenerate the transcript with another max gap input. Also display the model used. The default model should be loaded at program start with an animated progress bar, and current model lives throughout the lifetime of the session, don't kill it after the subtitle is generated, it will likely be needed later. In the end, I should be able to confirm and generate the VTT and TXT file, then the GUI exists. This should be a separate program that's built on top of existing functionalities.

You can test with [REDACTED_LOCAL_PATH]/brain_dump_20260611.flac.

When you're done, $updating-docs, $export-coding-session, then use the $vcs skill to integrate.

## User

The user provided full `$updating-docs`, `$export-coding-session`, and `$vcs` skill payloads. The canonical copies used during the session are tracked under `.agents/skills/`; this transcript records that they were provided and loaded without copying the full manuals again.

## Assistant

Loaded the repo VCS workflow, coding-style skill, root README, docs index, and presentation source references from the assigned isolated jj workspace. Renamed the temporary workspace from `codex-pending-cd6d58d3` to `codex-asr-interactive-tui` with the VCS helper.

Inspected `src/asr/transcribe_vtt.py`, `src/asr/media.py`, `src/asr/model_cache.py`, `src/asr/runtime_env.py`, `src/asr/speech_speed.py`, `src/asr/README.md`, `pyproject.toml`, and the existing docs. The key existing primitives were `Word`, `Cue`, `cues_from_words()`, `render_vtt()`, `render_txt()`, `transcript_output_path()`, and `extract_mono_16khz_wav()`.

Refactored `src/asr/transcribe_vtt.py` to add reusable live backend sessions:

- `FasterWhisperSession` keeps a loaded `faster_whisper.WhisperModel`.
- `WhisperXSession` keeps a loaded WhisperX model and caches alignment models by language.
- `ParakeetSession` keeps a restored NeMo ASR model.
- `load_transcription_session()` returns the selected session.
- `TranscriptionResult` carries cues, the WebVTT note, and word timestamps.

Kept the existing `asr-vtt` CLI behavior by making `transcribe_to_vtt()` load a session internally, write the requested `.vtt`, write the sibling `.txt`, and return cues as before.

Added `src/asr/interactive_tui.py` and registered `asr-tui = "asr.interactive_tui:main"` in `pyproject.toml`. The new command:

- starts through `restart_with_system_media_libraries()`;
- loads the selected model first with an animated curses progress bar;
- normalizes audio or video input through `extract_mono_16khz_wav()`;
- reads waveform peaks from the prepared mono 16 kHz WAV;
- draws a terminal waveform and bottom slider;
- uses `ffplay` for audio playback;
- supports mouse slider clicks when terminal mouse events work;
- supports keyboard playback controls with Space, Left/Right, Home/End, and `q`;
- displays the active subtitle under the waveform;
- displays the resolved backend/model label and current `max_gap`;
- uses `g` to enter a new `max_gap`;
- regroups existing word timestamps immediately when available, otherwise reruns transcription through the still-live model session;
- asks for confirmation and writes the final WebVTT plus sibling TXT before exiting.

Updated docs in place after loading `$updating-docs` and searching existing ASR/max-gap documentation. `src/asr/README.md` now documents `asr-tui`, model lifetime, waveform playback, max-gap tuning, source ownership, and cue rules. `src/README.md` and the root `README.md` now mention the interactive terminal UI, and `src/asr/__init__.py` describes the new tuning surface.

Validation performed:

- `uv run python -m compileall src/asr` passed.
- `uv run ruff check src/asr pyproject.toml` passed.
- `uv run asr-tui --help` showed the new command and options.
- The provided brain-dump FLAC was normalized to a mono 16 kHz WAV and waveform peaks loaded successfully; the sample duration was 1235.91 seconds.
- The default cached WhisperX `large-v3` model session loaded successfully on CUDA and reported the resolved model label.
- A 20-second trimmed sample transcription produced 33 word timestamps; regrouping from `max_gap=0.7` to `max_gap=1.5` changed the subtitle count from 5 cues to 3 cues without reloading the model.
- `uv run asr-vtt` still generated both VTT and TXT outputs on a 20-second smoke clip after the session refactor.
- A thread-load smoke test matched the TUI model-loading pattern: a WhisperX session loaded on a worker thread, then transcribed an 8-second sample from the main thread and produced 18 words in 2 cues.

Noted environment behavior: bare `ffplay` failed in the original shell because stale media library paths hid Ubuntu FFmpeg libraries, but `asr-tui` calls the same runtime restart helper as `asr-vtt`, so the `ffplay` child inherits the corrected `LD_LIBRARY_PATH`.

## User

I tried it, the TUI was stuck on the model loading screen for a while, and it wasn't loading from the NAS. Fix it.

## Assistant

Started a follow-up jj workspace named `codex-fix-asr-tui-nas-loading`, inspected the `asr-tui` startup path, and identified that the model-loading progress screen did not distinguish cache resolution from the expensive WhisperX pipeline construction. Added an explicit `ModelLoadPlan` in `src/asr/interactive_tui.py`: `asr-tui` now calls `ensure_model_cached()` before loading the backend session, displays the concrete cached path from `[REDACTED_NAS_MODEL_PATH]/...`, passes that resolved local path into `load_transcription_session()`, expands `--model-dir` / `--download-dir`, and shows elapsed time during progress screens.

Validated the cache-resolution helper directly. The default `large-v3` model resolved to `[REDACTED_NAS_MODEL_PATH]/huggingface/Systran/faster-whisper-large-v3` with cache label `model-dir` before any WhisperX import or model initialization.

## User

The model is only 2.88 G, and it's been loading for 80 seconds, I don't even see network traffic in my system.

## Assistant

Measured model-loading stages locally to separate cache lookup, CUDA library setup, faster-whisper model construction, and WhisperX pipeline/VAD initialization. Cache resolution completed in about 0.003 seconds, CUDA shared library setup in about 0.058 seconds, importing `faster_whisper` in about 1.586 seconds, direct `WhisperModel` construction in about 5.355 seconds, and direct `whisperx.load_model(...)` in about 11.211 seconds in the smoke test. Also observed that a direct WhisperX load can invoke Torch Hub/Silero VAD setup, which explains a local startup pause even when no Hugging Face model download or NAS read is active.

Temporarily changed the `asr-tui` default backend to `faster-whisper` and validated a 7.06-second default model load plus an 8-second sample transcription, but did not integrate that temporary default change after the user clarified the desired default.

## User

Change the default backend back to the larger whisperx. Update existing session transcript, then integrate.

## Assistant

Changed `asr-tui` back to default `whisperx` while keeping the follow-up fix that resolves and displays the NAS cache path before backend loading. Updated `src/asr/README.md` to document that `asr-vtt` and `asr-tui` both default to WhisperX `large-v3`, and that `asr-tui` now distinguishes NAS cache resolution from WhisperX pipeline initialization on its startup progress screens.
