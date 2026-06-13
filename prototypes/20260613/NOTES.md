# Prototype — 2026-06-13

Date: 2026-06-13
Status: Prototype (v1)
Area: interactive talking-head presentation, "Open & Closed Loops: The Economics of the LLMOS"

## What this is

The first working prototype of the website presentation, in
[`web/`](web/README.md). The talking-head video is the prompt; the interface is
generated from the transcript
([`docs/subtitles/presentation_test.vtt`](../../docs/subtitles/presentation_test.vtt))
and driven by video playback position. Built with Vite + TypeScript + GSAP.
Verified end-to-end in a headless browser across every transcript beat.

This is a milestone snapshot. Future versions will be built part-by-part, each
dated under `prototypes/`, with the user reviewing before the next step.

## Review feedback for the next iteration (v2)

Captured verbatim-in-spirit from the 2026-06-13 review. Not yet acted on — these
guide the next pass. The full review is preserved in the exported session
transcript under [`docs/transcripts/`](../../docs/transcripts).

1. **Hollywood cold open.** Open as if it were just a pre-recorded video — first
   frame + play button only, zero hint of a GUI. Reveal the interactive power
   gradually, bit by bit, starting only when the content (or an explicit "show
   the closed-loop concept" cue) begins. Aim for a surprise "wow".
2. **Warm light theme.** Match the color theme of the `website` project (warm
   tone). Light mode only for now; dark mode can come later.
3. **Less on-screen text.** The talking head carries the words, and subtitles
   will be added later. Visuals should *support* the verbal content — prefer
   smooth, interactive animations that illustrate a concept over text blocks.
4. **Minimal timeline, YouTube-style controls.** While playing, show only a thin
   line with bookmark dots + the playhead. Surface labels/details on hover, or
   briefly after a control action (play/pause/seek). Match YouTube keyboard
   shortcuts. NOTE: spacebar play/pause was not working in v1 — fix it.
5. **Awwwards-level, not standard.** Push design further: simple and minimal yet
   interactive and fun. Iterative, part-by-part, with feedback gates.
6. **Use `/retrieving-context`.** The local RAG should already index the
   referenced projects — use it instead of grinding ripgrep. Flag issues to the
   user to fix.
7. **Differentiate from static video/slides.** When the talk mentions a session
   transcript, markdown file, or code, show a short high-level summary of that
   thing, then link to its open-source GitHub URL (user will say which are OSS).
8. **Chunk the video.** Segment the video so the client does not load it all at
   once (e.g. HLS/DASH or byte-range segments).
