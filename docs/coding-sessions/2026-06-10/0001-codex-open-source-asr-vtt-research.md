<!-- markdownlint-disable MD013 MD024 -->

# Codex Open-source ASR VTT Research

Date: 2026-06-10
Repo: llm-presentation, jj bookmark `codex-open-source-asr-vtt-research`, change `nxulnxtporqmrulynwmquszzltpwxwtt`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex (GPT-5.5, reasoning: xhigh)
Summary: Fixed stale VCS PreToolUse hook paths, researched open-source ASR models for WebVTT subtitles, added a source-linked research doc, and prepared a local jj commit.

## User

I want to transcribe the audio from a video file **with timestamp**, so I can add it as .VTT subtitles. What are the free open source models that can help me achieve this? I already have some localhost LLM or VLM models downloaded at `[REDACTED_LOCAL_PATH]`, not sure if they can help with this. Search the internet for the SOTA open source solutions, then add the research doc under @docs/ using the $updating-docs skill. Finally, export session transcript, then integrate with the $vcs skill, just commit, don't push.

## Assistant

Loaded the requested `$vcs`, `$updating-docs`, and export-coding-session instructions. Started by creating an isolated jj workspace for `codex-open-source-asr-vtt-research` so edits would not occur in the shared checkout.

Tool summary:

- Verified the repository uses jj.
- Ran the VCS isolate helper, which created the `codex-open-source-asr-vtt-research` workspace.

## User

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## User

Fix the PreToolUse hook issue first, then continue with the original prompt.

## Assistant

Investigated the PreToolUse hook issue first. Found that Codex, Claude, Cursor, and Gemini hook configs referenced `.agents/agents/vcs/...`, while the installed helper scripts live at `.agents/skills/vcs/...`.

Patched these files:

- `.codex/hooks.json`
- `.claude/settings.json`
- `.cursor/hooks.json`
- `.gemini/settings.json`

Verification summary:

- Parsed all hook JSON files successfully.
- Confirmed no stale `.agents/agents/vcs` references remained.
- Ran a synthetic Codex PreToolUse payload from the owned workspace and confirmed it returned status 0.
- Ran a synthetic shared-checkout write payload and confirmed the guard blocked it with exit status 2.

## Assistant

Continued the original research task. Searched existing docs for ASR, subtitle, Whisper, WebVTT, and timestamp notes. The repo only had one prior coding-session transcript and no ASR/subtitle research doc. The referenced `retrieving-context` skill was not installed, so direct `find` and `rg` searches were used as the fallback search-before-writing step required by `$updating-docs`.

Inspected the user's local NAS LLM model cache without committing the absolute path. The visible model families were general LLM/VLM/evaluation/image-classification assets, including `gemma4`, `nemotron_h`, `qwen3_5_moe`, `llava`, `vit`, and evaluation classifier configs. No Whisper, Parakeet, Canary, Granite Speech, Vosk, wav2vec, HuBERT, NeMo ASR, Moonshine, SenseVoice, FunASR, or related ASR model families were present.

Internet research sources included:

- OpenAI Whisper GitHub repo and `transcribe.py`
- SYSTRAN `faster-whisper`
- WhisperX
- `whisper.cpp`
- NVIDIA Parakeet TDT and NeMo timestamp docs
- IBM Granite Speech docs and model cards
- Hugging Face Open ASR Leaderboard paper
- Vosk API and model pages

Added:

- `docs/README.md`
- `docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md`

The research doc recommends WhisperX for best practical subtitle alignment, `whisper.cpp` for simple direct `.vtt` output, `faster-whisper` for Python pipelines, and Parakeet/Granite Speech for accuracy-first timestamp experiments.

## Assistant

Exported this transcript to `docs/coding-sessions/2026-06-10/0001-codex-open-source-asr-vtt-research.md`. Redacted local absolute paths from the human prompt and summarized bulky injected skill content rather than copying path-heavy boilerplate into the committed transcript.
