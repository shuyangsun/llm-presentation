<!-- markdownlint-disable MD013 MD024 -->

# Presentation V3 — word-synced re-timing, gradual reveals, larger type

Date: 2026-06-13
Repo: llm-presentation (jj workspace `claude-0001-intro-animation-timing`, off `main`)
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + workflow orchestration)
Summary: Re-timed every UI/animation beat of the `web/` production intro so it
fires the instant the presenter says the matching words in `0001_intro.vtt`
(nothing ahead of audio), broke each illustrative scene into parts that reveal
gradually (skills pop in one-by-one, the model answer resolves last, the open
loop appears on "open the loop now"), and enlarged the type + illustrations while
keeping them mobile-safe. Added a reversible per-part timed-reveal engine
(`data-at` + prime/update/show/hide) and a slow "very smooth" crop. Verified with
`tsc + vite build`, a hardened multi-agent adversarial review (the first run was
invalid — it grepped the stale committed repo instead of the workspace), and a
transcript-alignment check confirming every threshold sits at/after its cue.
Then hosted it locally with the NAS media symlinked and 9 regenerated chapter
thumbnails.

## User

The last change introduced the V3 version of the production podcast / presentation. There are a few modifications I'd like to make. Read the last session transcript if you need more context.

Overall, text and illustration are too small, they are hard to read. Increase their size but also make sure they fit on mobile.

Most importantly, adjust the timing of each change to match precisely with the timing of my words. For example, the video should only be cropped when I say something like "cropping to the vertical aspect ratio"; links to skills should pop up one by one after I mention each one of them. Currently, there are too many animation timing that are played ahead of the video / audio content, causing confusion for viewers. Break down scenes into smaller parts, and show them gradually, don't show everything at once. Keep these core princples in your memory for future podcast / presentation changes.

## Assistant

Saved the requested principles to memory, then scouted the codebase before editing.

- _Write_ — memory `podcast-presentation-principles.md` (+ `MEMORY.md` pointer): sync-to-words / never-ahead / gradual reveal / big-but-mobile-safe.
- _Bash_/_Read_ — recon: `web/README.md`, `src/data/timeline.ts` (BEATS, CHAPTERS, STRINGS, SKILLS), `src/engine/scenes.ts` (7 scenes), `src/engine/vtt.ts`, `src/main.ts` (the director loop), `src/data/en.vtt` (the script — extracted cue start times per beat), `src/style.css` (sizing). Confirmed the talking-head video drives the whole UI via playback time.
- _Bash_ — `node`/`npm` present; `npm install` (web deps); media absent (git-ignored NAS symlinks); read the last session transcript `docs/transcripts/2026-06-13/0016-claude-production-intro-site.md` for design intent (warm Paper palette, less text, closed=orbiting / open=breathing loop).

## Assistant

Built a precise word→beat map from `en.vtt` and implemented across four files (task list tracked).

- _Edit_ — `src/data/timeline.ts`: re-timed `BEATS` to the cue starts (crop 120.3, dock 131.6, deck 137.05, translate 165.5, picker 176, progress 205.2) with cue-quoting comments; added `CROP_DURATION = 3.0` (the "very smooth animation").
- _Edit_ ×many — `src/engine/scenes.ts`: gave `reveal()`/`cap()` an optional `data-at` (seconds); added per-part reveal times so each scene unfolds gradually. Restructured the **RAG** scene (orbit + question first → the two skills pop in one-by-one at 313.25 / 316.0 as named → the WhisperX answer + note resolve at 329.65 on "show that on the screen"); the **loop** scene (closed at base, open at 349.95 on "I'm going to open the loop now"); **sync** (tracks at base, playhead at 195.5, "one timeline" caption at 202.75); plus asr/translate/responsive/director sub-beats. Updated `SCENES` base times to the cue starts.
- _Edit_ ×many — `src/main.ts`: replaced the all-at-once `revealIn` with a reversible timed-reveal engine — `primeReveals` (hide all parts on scene mount) → `updateSceneReveals(t)` each tick (fade a part in once `t >= data-at`, fade it back out when scrubbing before it) → `showReveals`/`hideReveal`; added a per-transition duration so only `full → center` uses the slow `CROP_DURATION`; wired `updateSceneReveals` into `applyBeats` and the `applyLang` rebuild (no flash on a paused language switch). Imported `CROP_DURATION`.
- _Edit_ ×many — `src/style.css`: enlarged the prompter (`clamp(19px,2.0vw,28px)`), captions, wordmark, and all seven illustrations (~+25–40%); added mobile `@media` caps so the device mock-up and translate row never overflow narrow phones; kept the live transcript readable.
- _Edit_ — `web/README.md`: rewrote the choreography table for the word-pinned, part-by-part reveal.
- _Bash_ — `npm run build` (`tsc --noEmit` + `vite build`) — clean.

## Assistant

Ran a multi-agent adversarial review (timing-vs-VTT, mobile fit, reveal-engine correctness), each finding verified by two diverse skeptics.

- _Workflow_ — first run returned 10 "confirmed" findings — but they described the *pre-change* code (`revealIn`, `t: 298`, "grep for data-at returns nothing").
- _Bash_ — diagnosed the cause: the subagents' shell defaulted to the **main repo checkout** (committed/stale) and grepped relative paths there, not the jj workspace where my edits live. Confirmed my edits are all present in the workspace and the build passes — the review was invalid.
- _Workflow_ — re-ran **hardened**: absolute workspace paths only, an explicit "ignore the stale repo" guard, and a mandatory self-check (`primeReveals` present, `data-at` present, `revealIn` absent) before any analysis. Result: reveal-engine dimension **0 findings** (reversibility, crossfade targeting, GSAP/CSS coexistence, reduced-motion all clean); mobile fine (prev/next context lines at 15px correctly dismissed); timing — 2 confirmed + 1 dismissed, all the same class: a few thresholds rounded *down* to fire 8–78ms before their cue.

## Assistant

Applied the precision nudges to **all** thresholds that sat before their cue (not just the two confirmed), and aligned the ASR illustration to ".VTT file that's transcribed".

- _Edit_ — `timeline.ts` `deck → 137.05`; `scenes.ts` scene bases (asr 142.75, sync 186.7, responsive 222.7, director 263.1, loop 343.4) and sub-reveals (sync cap 202.75, responsive desktop 234.6, skill0 313.25, rag answer 329.65, loop open 349.95).
- _Bash_ — `npm run build` clean; a Python VTT-parse gate confirming **every** threshold is now ≥ its cue start (each fires 9–90ms *after* the words begin; combined with the 0.6s fade, elements appear right as he speaks).
- Reported the summary; principles already in memory.

## User

Host it locally, I'll give it a try.

## Assistant

Wired up the git-ignored media and started the dev server.

- _Bash_ — found the source media on the NAS (`<NAS>/.../20260611-open-close-loop-llm-os/`): `0001_intro.webm` (AV1), `0001_intro.web.mp4` (H.264 fallback), `0001_intro.poster.jpg`. Created `web/public/media/` and symlinked `intro.webm` / `intro.mp4` / `intro.poster.jpg`.
- _Bash_ — `ffmpeg` regenerated the 9 square center-cropped chapter thumbnails (`thumbs/thumb_0..8.jpg`) at the `CHAPTERS` times from the H.264 fallback.
- _Bash_ — `npm run dev` (background); Vite served on **:5174** (5173 was in use). Verified over HTTP: page 200, poster 200, `thumb_3` 200, and `intro.webm` 206 `video/webm` with range support (scrubbing works).
- Reported the URL and a beat-by-beat list of what to watch for.

## User

/export-transcript — then integrate with /vcs.

## Assistant

- _Bash_ — reconciled the export location: AGENTS.md and prior exports use `docs/transcripts/`, not the skill default `docs/coding-sessions/`; computed the next global index (0017) and read the author identity from `jj`/`git` config.
- _Write_ — this transcript.
- _Skill_ — `/vcs` to integrate.
