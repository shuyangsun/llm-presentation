# Open & Closed Loops — interactive presentation (production v1: intro)

The talking-head video **is the prompt**. Its playback position drives a
synchronized interface generated from the transcript: the teleprompter, the
reveal, the language picker, the progress bar, and the model card all appear on
the exact beat the presenter asks for them — nothing before. Scrubbing the bar
scrubs the video *and* the site; they are one timeline.

Built with **Vite + TypeScript + GSAP** (no framework), plus **Three.js** for
the 3D supporting-art scenes (lazy-loaded on demand, so the cold open stays
light). The look ports the warm "Paper" design system from
[shuyangsun.com](https://github.com/shuyangsun/website) with a terracotta
signature accent. Light mode only for now.

## The choreography (from `docs/subtitles/0001_intro.vtt`)

Every beat is pinned to the **moment the presenter says the words** in
`0001_intro.vtt`, and scenes reveal *part by part* — nothing appears before he
asks for it.

| time | beat |
| ---- | ---- |
| 0:00 | **Cold open** — just the first frame + a play button. Zero GUI. |
| ~2:00 | **Reveal, step 1** — on "you should start cropping", the 16:9 video eases over a slow, smooth crop to a centered vertical portrait. |
| ~2:11 | **Reveal, step 2** — on "place the frame at the left side", the portrait slides left (top strip on mobile). |
| ~2:17 | **Deck** — on "show this teleprompter", the compact transcript fades in; the first **3D supporting-art scene** joins at "the .VTT file that's transcribed" (~2:22) — see *Supporting art* below. |
| ~2:45 | **Auto-translate** — at "Mandarin Chinese", the whole UI + transcript flip to 中文. |
| ~2:56 | **Language picker** — EN / 中文, defaulting to 中文 (near the playhead). |
| ~3:25 | **Progress bar** — on-demand, thin, with section dots + frame thumbnails on hover. |
| ~4:58 | **The model** — RAG poses "who transcribed this?"; the two skills pop in one at a time as he names them (~5:13 / ~5:16); the answer **WhisperX · large-v3** resolves only on "show that on the screen" (~5:30). |
| ~5:43 | **Open & closed loops** — a closed loop (a dot iterating) appears; the open loop (breathing, awaiting a human) joins on "I'm going to open the loop now" (~5:50). |

The interface is **time-driven and fully reversible**: scrubbing backward
re-hides every element *and every sub-part*. Each scene part carries an optional
`data-at` timestamp (see `src/engine/scenes.ts`); the director loop in
`src/main.ts` fades it in only once its words have been spoken. Beat thresholds
live in `src/data/timeline.ts`. Mobile docks the video to the top with content
below; desktop docks it left with content beside it.

## Supporting art (3D)

Each beat swaps in an *illustrative scene* (`src/engine/scenes.ts`). The first —
**audio → transcript** — is a 3D WebGL scene (`src/engine/asr3d.ts`, Three.js,
lazy-loaded, in the spirit of [igloo.inc](https://igloo.inc) but warm
Paper/terracotta, never icy blue):

- A **frosted-glass waveform** of slabs seen at a 3/4 angle, playing the video's
  *real* audio envelope — precomputed from the recording into
  `src/data/intro.peaks.json` (via `scripts/gen-waveform.py`) and scrolled by the
  playhead, so the bars match what's being said.
- **Transcript particles** that develop the *actual* current `.vtt` cue into
  legible words, iMessage invisible-ink style (nothing hardcoded; the cue is read
  live from the same VTT the teleprompter uses).
- **Mouse hover disrupts the text** with animated noise + repulsion; it restores
  to clean text when the cursor leaves.

Like everything else it is a pure function of the playhead `t` (fully
scrub-reversible — the waveform and the words rewind). It falls back to the
original 2D CSS scene when WebGL is unavailable or `prefers-reduced-motion` is
set. The remaining scenes are still 2D CSS for now.

## Controls (YouTube-like behavior, warm palette)

The controls are **hidden by default** — even during the cold open — and appear
when you move to the bottom edge (desktop) or tap (mobile), then auto-hide while
playing. Keys: `space`/`k` play-pause · `←`/`→` ±5s · `j`/`l` ±10s · `0`–`9`
jump to 0–90% · `↑`/`↓` volume · `m` mute · `f` fullscreen · `?` shortcuts.
Hovering the bar previews each bookmark with a square frame thumbnail.

## Run

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build
```

## Media

The video is **not committed**. `public/media/` holds git-ignored symlinks to
the transcoded derivatives stored beside the source on the NAS:

- `intro.webm` — AV1 + Opus, ~36 MB (primary)
- `intro.mp4` — H.264 + AAC, ~37 MB (Safari fallback)
- `intro.poster.jpg` — first frame (cold-open poster)

Transcript data lives in `src/data/en.vtt` and `src/data/zh.vtt` (same cue
timings; the Mandarin file is the on-the-fly translation the video asks for).
The 3D ASR scene's `src/data/intro.peaks.json` (the audio amplitude envelope) is
**committed** — it carries no media content, only per-10ms loudness numbers, and
is regenerated from the master with `scripts/gen-waveform.py` when the recording
changes.
