<!-- markdownlint-disable MD013 MD024 -->

# 3D ASR scene: staged entrance, live-audio waveform sync, evaporate/re-drop transcript

- **Date:** 2026-06-14
- **Repo:** llm-presentation — jj workspace `claude-pending-34c01f3f` (off `main` @ `wqxommkm` "feat(web): six bespoke interactive 3D supporting-art scenes")
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
- **Summary:** Reworked the 3D "audio → transcript" scene (`web/src/engine/asr3d.ts`): bars now rise in before text rains down, the waveform is driven by a live Web Audio analyser tap on the `<video>` (precomputed envelope as fallback), and the transcript particles evaporate up into the bars and re-drop on each caption change; verified with an adversarial multi-lens review and a local preview server.

---

Session began with `/model` → Opus 4.8 (1M context), `/effort ultracode`, and `/remote-control 3d-audio-appear`.

## User

I like the current 3D scene for the audio to text transcription. Make the following improvements:

1. It should not just suddenly appear on the screen. Audio wavebars should animate in, then text particles should flow down from audio bars.
2. Fix the audio waveform not syncing with the actual audio problem. Use the audio waveforms from the video and make it the actual audio of the video.
3. Each time the transcribed text changes, previous particles should evaporate, and new text particles should drop from the audio wave. Keep the mouse interaction animation.

Once you're done, start a local preview server, I'll give you feedback.

## Assistant

Explored the scene and its surrounding system to understand the data flow before changing anything:

- `web/src/engine/asr3d.ts` — the 3D scene: frosted-glass waveform slabs (driven by a precomputed amplitude envelope, `intro.peaks.json`, indexed by playhead) + terracotta transcript particles that develop from a haze cloud per `.vtt` cue.
- `web/src/engine/scenes.ts` / `main.ts` / `vtt.ts` — `main.ts` owns the single rAF and calls `__tick(t)` with `t = video.currentTime`; `getCue(t)` returns the active cue text/start.
- `web/scripts/gen-waveform.py` — bakes the envelope from the **NAS FLAC master** (`0001_intro.flac`), not from the shipped `intro.{webm,mp4}` — a likely source of the perceived desync.
- Media (`/media/intro.{webm,mp4}`) is git-ignored, served **same-origin** by Vite → a Web Audio `AnalyserNode` tap on the `<video>` is viable with no CORS taint.

Restated the plan: (1) staged entrance — bars rise left→right first, then text pours down; (2) drive the waveform from the **live** audio via an analyser, with the precomputed envelope as the paused/scrubbing/muted fallback; (3) per-cue evaporate-then-drop.

Implemented across three files:

- **New `web/src/engine/audio.ts`** — a singleton live tap: `AudioContext` → `MediaElementAudioSourceNode` → `AnalyserNode` → `destination`, wired so the video never goes silent (falls back to `source → destination` if the analyser build fails; idempotent per element). Exposes `attachAudioAnalyser`, `resumeAudio`, `audioLevel()` (broadband RMS from time-domain data). Fixed a TS 5.9 typed-array generic error by typing the buffer `Uint8Array<ArrayBuffer>`.
- **`web/src/main.ts`** — attach + resume the analyser inside the `begin()` play gesture (AudioContext needs a user gesture), and `resumeAudio()` on every `play` (browsers suspend the context across pauses/backgrounding).
- **`web/src/engine/asr3d.ts`** —
  - *Entrance:* `SLAB_VERT` grows bars in with a left→right stagger (`aOrder` + `uFormP`); transcript gated to start ~0.9s after the bars (`TEXT_START`).
  - *Waveform:* `updateWave()` scrolls live RMS across a ring buffer (rightmost = now) while playing, and falls back to the precomputed window at `t` when paused/scrubbing/muted. A decaying `liveEnergy` peak distinguishes real speech from muted/silent so muted viewers still see a dancing waveform.
  - *Transcript:* a wall-clock state machine (`empty`/`enter`/`settled`/`exit`); `TEXT_VERT` drops particles from the bar line (`uBarY`) down to glyph homes (`uEnter`) and evaporates them back up (`uExit`); mouse-hover scatter/snap-back preserved.

Set up the workspace for preview (node_modules + git-ignored media symlinked from the canonical repo), `tsc --noEmit` clean, started Vite (port 5175), verified it serves the page, both modules, range-enabled media (206), and the peaks JSON. Confirmed cue timing: bars rise at 142.75, the cue *"…the .VTT file that's transcribed from this video"* drops in ~143.65 while still spoken, re-drops on the next line at 148.7.

Ran a 3-lens adversarial review via a background Workflow (audio-graph / state-machine / shader-visual, `Explore` agents, structured findings). Adjudicated the findings:

- **Rejected** the "reset `uEnter=0` on exit" and "remove the exit→enter reset" fixes — both would introduce a one-frame flash/pop (the common `settled→exit` path needs `uEnter=1` so particles evaporate *from the text*, and the new batch must start at the bar line, not flash at home). Several "stuck state" findings were false positives: the phase-transition and phase-dispatch blocks run in the *same* frame, and the non-advancing branch already reseeds the ring every paused frame.
- **Fixed a real bug** the review circled: `video.currentTime` updates at the media rate (~30fps) while rAF runs at ~60fps, so `dpt == 0` on ~half the frames mid-playback — the old `advancing = dpt > 0` test would flicker the waveform between live and precomputed every frame. Latched `advancing` over a 0.18s window (`sinceAdvance`) and reset `liveEnergy` when truly stopped.

Re-ran `tsc --noEmit` (clean) and confirmed HMR reloaded. Handed over the preview at `http://localhost:5175/` (seek to ~2:22) and listed the easy tuning knobs (`WAVE_GAIN`/`WAVE_GAMMA`, `ENTER_DUR`/`EXIT_DUR`, `WAVE_IN`/`TEXT_START`). Nothing committed (isolated jj workspace). Saved a memory on previewing `web/` from a jj workspace (symlink node_modules + media).

## User

Great! Export session transcript, integrate with /vcs

## Assistant

Exported this transcript under `docs/coding-sessions/2026-06-14/` (via the `export-transcript` skill), then ran the `vcs` skill to describe the change and integrate the work from the isolated workspace.
