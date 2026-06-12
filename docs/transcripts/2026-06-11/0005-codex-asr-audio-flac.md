<!-- markdownlint-disable MD013 MD024 -->

# Codex ASR Audio FLAC

Date: 2026-06-11
Repo: llm-presentation, jj bookmark `codex-asr-audio-flac`, change `qsnpxswy`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex (GPT-5.5, reasoning: xhigh)
Summary: Updated `src/asr` so every backend normalizes video or audio input, including `.flac`, through FFmpeg before transcription; confirmed the default remains WhisperX with the full `large-v3` model; validated WhisperX `large-v3`, Parakeet, and default-backend runs against the supplied FLAC sample; exported this transcript before jj integration.

## User

Make @src/asr/ work with both video and audio files, support `.flac` format.

## User

Make @src/asr/ work with both video and audio files, support `.flac` format, test with @[REDACTED_LOCAL_PATH]/test_audio.flac.

## Assistant

Loaded the repo-local `vcs` and `coding-style` skills, moved into the assigned jj workspace, and renamed the temporary workspace to `codex-asr-audio-flac`.

Inspected `src/asr/media.py`, `src/asr/transcribe_vtt.py`, `src/asr/README.md`, `pyproject.toml`, `README.md`, and related docs. The existing `extract_mono_16khz_wav()` helper already used FFmpeg to extract the first audio stream, and WhisperX/Parakeet already used it, but the `faster-whisper` path still received the original input directly.

Verified FFmpeg could read the supplied FLAC and normalize it to mono 16 kHz WAV. Then updated `transcribe_to_vtt()` so all three backends use the same prepared WAV path before inference. Updated `media.py` wording, root README, ASR README, project metadata, and the ASR research doc so they describe video and audio input plus `.flac` support.

The first `apply_patch` calls accidentally targeted the shared checkout instead of the owned jj workspace. Those edits were this session's own changes, so the same patch was applied to the owned workspace and the accidental shared-checkout edits were reverted. The shared checkout was verified clean afterward.

Validation included `uv run ruff check src/asr`, `uv run ruff format --check src/asr/media.py src/asr/transcribe_vtt.py`, `uv run python -m compileall src/asr`, a `faster-whisper` FLAC smoke test with `tiny.en`, a WhisperX FLAC smoke test with `tiny.en`, and a synthetic MP4 generated from the same FLAC to verify a video container also transcribed successfully. The broad `ruff format --check src/asr` still reported pre-existing formatting drift in untouched `src/asr/runtime_env.py`.

## User

While you're at it, set the default model to the most powerful model out of all if that's not already the case.

## Assistant

Checked the supported model aliases and current defaults. The CLI already defaulted to `whisperx` with `large-v3`, which is the strongest reliable subtitle default implemented in this package. Parakeet was briefly tried as the default because it is a strong ASR model, but an actual Parakeet run on the supplied 2.3 second FLAC produced zero cues, while WhisperX transcribed it correctly.

Kept the code default at `DEFAULT_BACKEND = "whisperx"` and `DEFAULT_MODELS["whisperx"] = "large-v3"`. Updated docs to explicitly state that the default is WhisperX with the full `large-v3` model, while Parakeet remains available as an opt-in backend.

## User

I forgot to mount my NAS. Try both parakeet and whisperx large-v3, but keeping the defaut model at whisperx large-v3 sounds good.

## Assistant

Confirmed the NAS model cache was available through the mounted home share and that both `faster-whisper-large-v3` and `parakeet-tdt-0.6b-v3` model directories looked complete.

Ran WhisperX with the actual NAS `large-v3` cache on the supplied FLAC. It succeeded and wrote one cue: "Test recording, test recording." Ran Parakeet from the NAS `.nemo` checkpoint on the same FLAC. It restored the model and completed inference, but wrote zero cues for this short sample. Ran a plain default command without `--backend` or `--model`; the output note confirmed `backend=whisperx` with the NAS `faster-whisper-large-v3` model and wrote one cue.

Re-ran `uv run ruff check src/asr` and `uv run python -m compileall src/asr`; both passed. Also checked that no ASR-related background processes remained.

## User

Export session transcript, then integrate with the $vcs skill.

## Assistant

Loaded `export-coding-session`, `updating-docs`, and `vcs`. Used the export helper to allocate this transcript as `docs/coding-sessions/2026-06-11/0005-codex-asr-audio-flac.md`, redacted local paths outside the repo, and prepared to run the transcript redaction scan before integrating the jj workspace with the repo helper.
