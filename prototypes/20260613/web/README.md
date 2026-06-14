# Interactive Presentation — Open & Closed Loops

Date: 2026-06-13
Status: Prototype (superseded by [`web/`](../../../web/README.md))
Area: `prototypes/20260613/web`, first interactive talking-head prototype
Sources: `src/main.ts`, `src/timeline.ts`, `docs/subtitles/presentation_test.vtt`, [`../NOTES.md`](../NOTES.md), [`docs/transcripts/2026-06-13/0013-claude-interactive-presentation-prototype.md`](../../../docs/transcripts/2026-06-13/0013-claude-interactive-presentation-prototype.md)

## Summary

A talking-head presentation where **the video is the prompt**. The interface is
generated, beat by beat, from the video's transcript
([`docs/subtitles/presentation_test.vtt`](../../../docs/subtitles/presentation_test.vtt))
and driven by the video's playback position. Scrubbing the video scrubs the
whole deck — they are one timeline, not a video next to slides.

This prototype is preserved as a milestone snapshot. The production intro app in
[`../../../web/`](../../../web/README.md) implements the later review feedback:
Hollywood cold open, warm Paper palette, gradual word-synced reveals, subtle
YouTube-like controls, and Three.js supporting-art scenes.

## How it behaves

- Opens **full screen** on the talking head.
- As the transcript dictates, the video **narrows to a center vertical strip**,
  then **docks to the right** while generated UI animates in on the left.
- A **scrubber** appears (at the timestamp where the presenter asks for it) and
  controls video position *and* deck progress together, with chapter ticks.
- **Pause anytime** (`space`, click the video, or the play button) to explore;
  agenda items and chapter ticks are clickable to seek.
- Every transition is a smooth GSAP tween — it reads as one continuous film, not
  a page-by-page slideshow.

The beat list lives in [`src/timeline.ts`](src/timeline.ts); each scene is
anchored to a real transcript timestamp. The director that maps playback time to
scenes, stage layout, and the scrubber is [`src/main.ts`](src/main.ts).

## Run it

```sh
cd web
npm install
npm run dev      # → http://localhost:5173
```

Then click **Begin** (a user gesture is required to start video with sound).

`npm run build` produces a static bundle in `dist/`.

## The video asset

The talking head is **not** committed (it is large media). Transcode a
web-optimized copy from the original and symlink it into `public/`:

```sh
# most-efficient web format: AV1 video + Opus audio in WebM
ffmpeg -i ~/Downloads/presentation_test.mp4 -vf scale=-2:1080 \
  -c:v libsvtav1 -crf 32 -preset 5 -g 240 -pix_fmt yuv420p \
  -c:a libopus -b:a 96k ~/Downloads/presentation_test_web.webm

# H.264/MP4 fallback for Safari < 17
ffmpeg -i ~/Downloads/presentation_test.mp4 -vf scale=-2:1080 \
  -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart ~/Downloads/presentation_test_web.mp4

ln -sf ~/Downloads/presentation_test_web.webm public/presentation.webm
ln -sf ~/Downloads/presentation_test_web.mp4  public/presentation.mp4
```

`public/*.webm` and `public/*.mp4` are git-ignored.

## Stack

Vite + TypeScript + [GSAP](https://gsap.com) for cinematic timeline animation.
Fonts: Fraunces (display), Hanken Grotesk (body), JetBrains Mono (labels).
