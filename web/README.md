# Open & Closed Loops — interactive presentation (production v1: intro)

Date: 2026-06-14
Status: Current
Area: `web`, video-driven presentation, synchronized timeline, Three.js supporting art
Sources: `src/main.ts`, `src/data/timeline.ts`, `src/engine/scenes.ts`, `src/engine/scene3d.ts`, `src/engine/{asr3d,translate3d,sync3d,responsive3d,director3d,rag3d,loop3d}.ts`, `src/engine/audio.ts`, `src/data/en.vtt`, `src/data/zh.vtt`, `src/data/intro.peaks.json`

## Summary

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

The current app includes the June 14 refinements from the indexed coding
sessions: a post-cold-open pause/play overlay, a seek bar hidden until
`BEATS.progress`, a live-audio analyser for the ASR waveform while the video is
playing, source-linked RAG graph nodes, and a mobile-specific responsive scene
whose cursor fold controls whether the video fills the phone or docks to the top.

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

Each beat swaps in an *illustrative scene* (`src/engine/scenes.ts`). **Six of the seven
are 3D WebGL** (Three.js, lazy-loaded per scene, in the spirit of
[igloo.inc](https://igloo.inc) but warm Paper/terracotta, never icy blue); the **director
scene was recast as a 2D pixel-art platformer** (plain 2D canvas, no WebGL). Each is a
**distinct** metaphor for what's being said, never the same look twice:

| beat | scene | the 3D metaphor |
| ---- | ----- | --------------- |
| ~2:22 | **audio -> transcript** (`asr3d.ts`) | frosted-glass wavebars rise in, then live `.vtt` cue particles drop from the waveform; while playing the bars use a Web Audio analyser, and while paused/scrubbing they fall back to the baked envelope |
| ~2:45 | **translate** (`translate3d.ts`) | `Text` particles transmute through a glass membrane into `文`; after the scripted reveal, the cursor side controls the actual site language (left EN, right 中文) without rebuilding the WebGL scene |
| ~3:06 | **sync** (`sync3d.ts`) | a head-on 3D progress bar where warm particle links rain from VIDEO to WEB, section dots sit at their true timeline positions, and cursor hover shows the section title |
| ~3:42 | **responsive** (`responsive3d.ts`) | a vertical mobile layout: video fills the phone, docks to the top on the spoken cue, then reveals content below; cursor height folds between full-video and docked states |
| ~4:23 | **director** (`director3d.ts`) | a **2D pixel-art platformer** ("Director's Dash"): the clapperboard director hops necktie corporate-employee **turtles**, ducks office-memo planes, and collects real open-source GitHub file links (with facts about the talk); **click/`J`** jump, **`K`** duck, 3 lives then **Enter** to restart |
| ~4:58 | **rag** (`rag3d.ts`) | a stable embedding-space constellation with real open-source file links; the two named skills appear as graph edges that lock onto corpus nodes one by one |
| ~5:43 | **loop** (`loop3d.ts`) | the finale: a green ice closed loop with sparse trapped particles, then a red top opening where particles flood out into a human silhouette |

The ASR waveform uses `src/engine/audio.ts` for live RMS data while playback is
advancing. `src/data/intro.peaks.json` (generated with `scripts/gen-waveform.py`)
is still committed as the scrub-reversible fallback for pause, seek, mute, and no
Web Audio. The six 3D scenes share the scaffold in **`src/engine/scene3d.ts`**
(transparent DPR-capped stage, Paper palette from the CSS `:root` tokens, a
damped pointer, and the reversible `phase(t,a,b)` ramp); the director scene is a
standalone 2D canvas off that scaffold. Like everything else, each narrative reveal
is driven by the playhead `t` and falls back to the original 2D CSS scene when WebGL
is unavailable or `prefers-reduced-motion` is set (the director, needing no WebGL,
only falls back under `prefers-reduced-motion`). Baseline design notes plus links to
the later scene refinements:
[docs/design/.../0001-bespoke-3d-supporting-art-scenes.md](../docs/design/2026-06-14/0001-bespoke-3d-supporting-art-scenes.md).

Dev preview: `src/preview.ts` mounts any scene via `preview.html?scene=<key>&t=<sec>`
(keys: `asr` · `translate` · `sync` · `responsive` · `director` · `rag` · `loop`) so each
phase can be inspected/screenshotted without the video.

## Controls (YouTube-like behavior, warm palette)

The controls are **hidden by default** — even during the cold open — and appear
when you move to the bottom edge (desktop) or tap (mobile), then auto-hide while
playing. Keys: `space`/`k` play-pause · `←`/`→` ±5s · `j`/`l` ±10s · `0`–`9`
jump to 0–90% · `↑`/`↓` volume · `m` mute · `f` fullscreen · `?` shortcuts.
Hovering the bar previews each bookmark with a square frame thumbnail.

Before the presenter says "So display that progress bar" (`BEATS.progress`,
205.2s), the seek bar is concealed and only appears on a deliberate bottom-edge
hover or active scrub. From `BEATS.progress` through the end of the `sync3d.ts`
scene, the bar stays visible for the "one timeline" explanation. After the cold
open has begun, pausing shows a centered play overlay on the video and keeps the
chrome visible.

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
