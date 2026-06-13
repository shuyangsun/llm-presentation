<!-- markdownlint-disable MD013 MD024 -->

# Fix asr-tui Loading-Screen Hang (curses.napms GIL starvation)

Date: 2026-06-13
Repo: llm-presentation, jj bookmark `claude-fix-asr-tui-loading`, change `orsomkkmknql`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context, thinking: high)
Summary: Diagnosed and fixed the `asr-tui` interactive subtitle TUI hanging forever on its loading screen. Root cause was `curses.napms()` in `run_with_progress` holding the GIL while the worker thread did GIL-bound import/model-load work, starving it. Reproduced headless vs. curses, captured a `faulthandler` thread dump pinning the hang to the import cascade (numpy → ctranslate2 → torch), confirmed the fix (swap `curses.napms(90)` → `time.sleep(0.09)`) drops model load from >60 s hang to ~2.8 s, and verified the real TUI now progresses through all loading stages into playback.

## User

The terminal GUI to tweak audio transcript in @src/asr/ is not working, it ALWAYS get stuck on the loading screen. You can test with ~/Downloads/brain_dump_20260611.flac, let me if you need screenshots, I can provide them.

## Assistant

Investigated and located the ASR code. Noted `src/asr/` doesn't exist in the repo this session was opened in (`coding-agent-skills`); the ASR TUI actually lives in a separate repo, `llm-presentation`. Read `src/asr/interactive_tui.py`, `model_cache.py`, `runtime_env.py`, `media.py`, and the README to understand the loading flow: `run_tui` drives a sequence of `run_with_progress(...)` "loading" screens — resolve model cache → stage model locally → load model → prepare audio → read waveform → generate transcript — each running its work in a daemon thread while the main thread animates a progress bar.

Created an isolated jj workspace in `llm-presentation` for the fix (the session's auto-isolation was for the wrong repo). Confirmed the NAS model cache is mounted and the default `large-v3` model is complete.

## User

It was not working even when I'm not running models on my GPUs. Try a smaller model, you'll see.

## Assistant

Acknowledged that CUDA OOM (the GPU was ~85 GB occupied by the gemma-4 serving stack) was a red herring. Reproduced with `--model small.en --backend faster-whisper` under a pseudo-tty harness: the TUI got stuck on **"Loading ASR model"** at ~1 s and never advanced through 150 s, while the progress bar kept animating (so the main thread was alive; the worker never finished).

Key contrast: loading `faster-whisper small.en` on CUDA in a worker thread *headless* completed in ~4 s, but the same load *under curses* hung indefinitely — so the bug was curses-specific.

Captured a `faulthandler` thread dump of the hung process (after working around an injection bug — `all_threads` is not a valid `dump_traceback_later` kwarg). The worker thread was stuck deep in pure-Python `importlib` machinery: importing numpy at 15 s, then torch via ctranslate2 at 30 s, triggered by `from faster_whisper import WhisperModel` (`transcribe_vtt.py:76`). It was crawling, not deadlocked.

Root cause: the main thread's wait loop in `run_with_progress` used `curses.napms(90)`, which sleeps **without releasing the GIL**. The worker's import/model-load work is GIL-bound pure-Python, so each 90 ms nap starved it — turning a ~3 s load into an effectively infinite one. Headless it was fast because `time.sleep` releases the GIL.

Confirmed by swapping `curses.napms(90)` for `time.sleep(0.09)` in a repro: model load went from a >60 s hang to **2.8 s**, with an empty fault dump (no hang).

Applied the one-line fix (plus an explanatory comment) to `src/asr/interactive_tui.py` `run_with_progress`. Verified the real `uv run asr-tui` now progresses: Loading model (3.3 s) → Preparing audio waveform → Reading waveform peaks → Generating transcript → playback.

Also noted a separate, non-blocking issue: the interactive playback loop busy-spins on `stdscr.getch()` with `nodelay(True)` and no sleep, pinning a CPU core during playback.

## User

It's a long audio file, I can hear it now, don't finish the whole thing.

## Assistant

Confirmed the fix works end-to-end (audio playback means the TUI reached the interactive player) and killed the background verification run so it wouldn't transcribe the whole file. Verified no stray `asr-tui`/`ffplay` processes remained.

## User

Export transcript, then integrate with /vcs

## Assistant

Exported this transcript and integrated the work via the `vcs` skill.
