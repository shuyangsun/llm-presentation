# Open & Closed Loops — interactive presentation (production v1: intro)

The talking-head video **is the prompt**. Its playback position drives a
synchronized interface generated from the transcript: the teleprompter, the
reveal, the language picker, the progress bar, and the model card all appear on
the exact beat the presenter asks for them — nothing before. Scrubbing the bar
scrubs the video *and* the site; they are one timeline.

Built with **Vite + TypeScript + GSAP** (no framework). The look ports the
warm "Paper" design system from [shuyangsun.com](https://github.com/shuyangsun/website)
with a terracotta signature accent. Light mode only for now.

## The choreography (from `docs/subtitles/0001_intro.vtt`)

| time | beat |
| ---- | ---- |
| 0:00 | **Cold open** — just the first frame + a play button. Zero GUI. |
| ~2:00 | **Reveal, step 1** — the 16:9 video center-crops to a vertical portrait, centered. |
| ~2:12 | **Reveal, step 2** — the portrait slides to the left (top strip on mobile); the deck fades in. |
| ~2:14 | **Deck** — a compact teleprompter beside an illustrative *scene* that changes with the talk. |
| ~2:45 | **Auto-translate** — at "Mandarin Chinese", the whole UI + transcript flip to 中文. |
| ~2:56 | **Language picker** — EN / 中文, defaulting to 中文 (near the playhead). |
| ~3:25 | **Progress bar** — on-demand, thin, with section dots + frame thumbnails on hover. |
| ~4:58 | **The model** — "who transcribed this?" answered via RAG: **WhisperX · large-v3**, with the two open-source skills linked. |
| ~5:35 | **Open & closed loops** — a side illustration: a closed loop (a dot iterating) and an open loop (breathing, awaiting a human). |

The interface is **time-driven and fully reversible**: scrubbing backward
re-hides every element. The illustrative scenes live in `src/engine/scenes.ts`;
the beat timings in `src/data/timeline.ts`. Mobile docks the video to the top
with content below; desktop docks it left with content beside it.

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
