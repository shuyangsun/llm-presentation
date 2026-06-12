<!-- markdownlint-disable MD013 MD024 -->

# Codex ASR VTT Pipeline

Date: 2026-06-11
Repo: llm-presentation, jj change `llvkrmypyklvkknkuouylnukkumopryt`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex CLI 0.139.0 (GPT-5, reasoning: default)
Summary: Implemented and validated a CUDA ASR-to-WebVTT pipeline under `src/asr`, added selectable `faster-whisper`, WhisperX, and NVIDIA Parakeet backends, fixed the user's active `ffmpeg` command path with user-level wrappers, updated the ASR research doc, and prepared a local jj commit without pushing.

## User

Work on @docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md, put source code under @src/asr/. You are running on Ubuntu workstation with two NVIDIA RTX Pro 6000 GPUs, so use CUDA. Download models to [REDACTED_TMP_PATH], then move to [REDACTED_NAS_MODEL_PATH], which is a mounted volume from my NAS, so reduce write frequency. Use `uv` instead of `pip` whenever possible. You can use video [REDACTED_NAS_VIDEO_PATH] as an example, make sure the whole pipeline works end-to-end.

## Assistant

Loaded the repo VCS, coding-style, and docs-update instructions, then renamed the assigned jj workspace from the temporary pending name to `codex-asr-vtt-pipeline`. Inspected the existing ASR research doc and repo layout, confirmed CUDA visibility on two RTX Pro 6000 GPUs, and found the system `ffmpeg` command failing with `libnppig.so.11`.

Tool summary:

- Read `./docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md`, `./docs/README.md`, repo files, local skill instructions, and VCS status.
- Checked `uv`, CUDA GPUs, `ffmpeg`/`ffprobe`, the sample MP4 metadata, and existing ASR model cache state.
- Added initial project files with `uv` metadata and a Python package under `./src/asr`.
- Corrected an accidental first patch in the shared checkout by copying those agent-authored files into the isolated workspace and removing the misplaced copies from the shared checkout.

Implemented the first working backend:

- `./pyproject.toml`, `./uv.lock`, and `./.python-version`.
- `./src/asr/model_cache.py` for Hugging Face model snapshots staged through `[REDACTED_TMP_PATH]` and moved to `[REDACTED_NAS_MODEL_PATH]`.
- `./src/asr/cuda_env.py` for CTranslate2 CUDA library loading.
- `./src/asr/transcribe_vtt.py` for direct `faster-whisper` transcription, word grouping, and WebVTT writing.
- `.gitignore` updates for `.venv`, Python bytecode, and cache files.

Validation summary:

- `uv lock` resolved dependencies.
- `uv run ruff check src/asr` passed after style fixes.
- `uv run asr-download-model small.en ...` downloaded through the temp cache and stored `faster-whisper-small.en` on the NAS model volume.
- `uv run asr-vtt ... --model small.en --device cuda --compute-type float16` generated a WebVTT file from the sample MP4 with 10 cues.
- Re-running `asr-download-model small.en` returned immediately from the NAS cache.
- Updated the research doc with the first implementation and validation notes.

## User

Did you also install whisperX? I would like to have the strongest performance, GPU memory shouldn't be an issue. Fix the broken ffmpeg and libnppig.so.11 issue.

## Assistant

Clarified that WhisperX had not been installed in the first pass, then installed and wired it in as the high-quality path.

Tool summary:

- Inspected `ffmpeg` and `ffprobe` binaries, package ownership, dynamic linker output, CUDA/NPP libraries, and linker search configuration.
- Confirmed the root cause: stale FFmpeg libraries in `/usr/local/lib` were shadowing Ubuntu package libraries and required old `libnpp*.so.11` and `libx264.so.163`.
- Verified passwordless sudo was unavailable, so root-owned stale libraries could not be removed.
- Installed user-level wrappers at `[REDACTED_HOME_PATH]/.local/bin/ffmpeg` and `[REDACTED_HOME_PATH]/.local/bin/ffprobe` that execute Ubuntu's `/usr/bin/ffmpeg` and `/usr/bin/ffprobe` with `/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu` first in the dynamic loader path.
- Verified `ffmpeg -version`, `ffprobe`, and 16 kHz mono WAV extraction worked from the normal PATH.
- Added `whisperx` to the `uv` environment.

## User

Once you're done with your current tasks, I also want to try NVIDIA Parakeet TDT 0.6B v3. Make the code work with all 3, the user can select which model to use.

## Assistant

Folded Parakeet into the same CLI surface instead of leaving separate ad hoc commands. Installed `nemo-toolkit[asr]`, checked that the Parakeet Hugging Face repo includes a `.nemo` checkpoint, and refactored `asr-vtt` to support `--backend faster-whisper`, `--backend whisperx`, and `--backend parakeet`.

Tool summary:

- Added `./src/asr/media.py` to extract mono 16 kHz WAV through fixed `ffmpeg`.
- Added `./src/asr/runtime_env.py` to restart `asr-vtt` once with Ubuntu media libraries first in `LD_LIBRARY_PATH`.
- Extended `./src/asr/model_cache.py` with aliases for Parakeet and `.nemo` checkpoint detection.
- Extended `./src/asr/transcribe_vtt.py` with backend selection, WhisperX alignment, Parakeet/NeMo transcription, shared cue rendering, and cache handling.
- Downloaded `large-v3` and Parakeet through the temp cache before moving completed snapshots to the NAS model volume.
- Routed WhisperX Silero VAD and English wav2vec2 alignment caches to the NAS model volume.

Validation summary:

- `uv run ruff check src/asr` passed.
- `uv run asr-download-model large-v3 ...` reused the NAS cache after download.
- `uv run asr-download-model parakeet ...` reused the NAS cache after download.
- `uv run asr-vtt ... --backend faster-whisper --model large-v3 ...` produced 10 cues.
- `uv run asr-vtt ... --backend whisperx --model large-v3 ...` produced 17 aligned cues.
- `uv run asr-vtt ... --backend parakeet ...` produced 14 cues.
- The default `uv run asr-vtt ... --language en --device cuda ...` also worked and used WhisperX plus `large-v3`.
- Updated `./docs/research/2026-06-10/0000-open-source-asr-vtt-subtitles.md` with the three-backend workflow, cache locations, ffmpeg fix, and local validation results.

## User

Continue, I accidentally interrupted you.

## Assistant

Resumed after the interrupted Parakeet download. Checked that the original download process was still running, waited for it to finish, confirmed the final NAS cache contained the Parakeet `.nemo` checkpoint, and continued backend validation without starting a duplicate download.

## User

Export session transcript, then commit, don't push.

## Assistant

Loaded the `export-coding-session` and `vcs` skills, got the next transcript index from the helper, located the current Codex session JSONL, extracted the five user turns, and wrote this transcript under `./docs/coding-sessions/2026-06-11/0002-codex-asr-vtt-pipeline.md`. The next steps were to run the transcript redaction scan and create a local jj commit without pushing.
