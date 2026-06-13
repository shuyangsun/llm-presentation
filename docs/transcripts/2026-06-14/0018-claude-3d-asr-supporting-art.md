<!-- markdownlint-disable MD013 MD024 -->

# 3D ASR "audio → transcript" supporting art

Date: 2026-06-14
Repo: llm-presentation (bookmark: claude-3d-asr-scene)
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
Summary: Converted the first supporting-art scene (the `audio → transcript` / ASR scene) from flat 2D CSS into an interactive 3D Three.js scene, in the spirit of igloo.inc but with the warm Paper/terracotta palette. v1: a frosted-glass waveform seen at a 3/4 angle, GPU particles that crystallize into transcript lines, and a hover-on-ice lift. After review, v2: the waveform now plays the video's *real* audio envelope (baked from the NAS master), the particles develop the *actual* `.vtt` cue text via an iMessage invisible-ink reveal, and the mouse disrupts the text with animated noise instead of moving the camera. Includes a research+design workflow (saved under docs/research & docs/design), Three.js lazy-loading, full WebGL disposal, a 2D fallback, and headless-Chrome visual verification.

## User

(Invoked via remote control, with model set to Opus 4.8 (1M context) and effort set to `ultracode`.)

Change supporting arts from simple 2D animations into 3D animations with smooth effects that interacts with mouse position. One example is https://igloo.inc. Don't copy the website design since its color template is completely different, but learn from its animation styles - the hover effect on ice, the particle effect at the end. Make sure these fancy animations still perform reasonably well. Only work on the first audio transcript animation for now, once you're done, ask me to review, I'll give you feedback.

## Assistant

Explored the web presentation (Vite + TypeScript + GSAP, no framework). Established that the "first audio transcript animation" is `asrScene` in `web/src/engine/scenes.ts` — `SCENES[0]`, the literal `audio → transcript` (ASR) scene at `t = 142.75`. Key facts gathered:

- Scenes are built/removed by `swapScene` in `web/src/main.ts`; parts reveal reversibly via `[data-reveal]` + `data-at` timestamps driven each frame by `updateSceneReveals(t)`. Everything is a pure function of the playhead `t` (scrub-reversible).
- Design tokens: warm Paper bg `#f7f4ee`, terracotta accent `#c25450` / `#9c3f3c`; fonts Instrument Serif / Geist / JetBrains Mono.
- ASR phases (from the `.vtt`): 142.75 waveform, 143 flow, 144 lines, 145.5 caption.

Installed `three` + `@types/three` (background). Added generic, scene-agnostic lifecycle hooks to `main.ts` so a GPU scene can drive its own phases and clean up its WebGL context:

- `updateSceneReveals` now calls `(node).__tick(t)` each frame.
- Both scene-removal paths in `swapScene` now call `(node).__cleanup()` before detaching.
- Added a `SceneNode` contract type in `scenes.ts`.

Renamed the temporary jj workspace to `claude-3d-asr-scene`.

Launched a research + design **Workflow** (ultracode): three parallel research agents — (a) igloo.inc animation techniques (ice hover, closing particle effect), (b) performant Three.js glass + GPU particles on a light background, (c) a line-accurate integration spec against the live code — then a synthesis agent reconciling them into one buildable plan. Key rulings: hand-written `ShaderMaterial` (not transmission) for the light-bg glass; **stateless `uProgress`-driven particles** (mandatory for scrub-reversibility — a live sim can't rewind); NormalBlending with a bright core (additive blows out on paper); perspective camera; frame-rate-independent exp damping.

Implemented `web/src/engine/asr3d.ts`: an instanced frosted-glass slab waveform + a GPU `Points` particle system, rendered inside `__tick(t)` (the deck's existing rAF — no second loop), with full dispose (`forceContextLoss`). Wired `asrScene` to branch to a 2D fallback (`asrScene2D`) when WebGL is unavailable or `prefers-reduced-motion`, and **lazy-loaded** Three.js via dynamic `import("./asr3d")` so the cold-open bundle stays small (~44 KB gz; Three.js in its own ~120 KB gz chunk loaded ~2:22 in).

Verified visually with headless Chrome (SwiftShader for WebGL) against a dev-only `preview.html` harness that mounts the scene at a controllable `t`. First pass read too flat; iterated: fixed a double-`formP` multiply that kept slabs short, added a 3/4 camera angle (tops + side faces visible), faceted-edge glow + specular for the ice read, and kept the hover-lift interactive for the whole scene. Sent four frames (wave / flow / settle / hover) and asked for review.

## User

Btw, save research and design results under @docs/research and @docs/design, then continue what you're doing.

## Assistant

Extracted the three research briefs from the workflow agent transcripts and the design synthesis from the workflow result, then saved them following the repo's `docs/<kind>/<date>/<NNNN>-<slug>.md` convention:

- `docs/research/2026-06-13/0000-igloo-inc-3d-animation-techniques.md`
- `docs/research/2026-06-13/0001-threejs-performant-glass-and-particles.md`
- `docs/research/2026-06-13/0002-asr-3d-scene-integration-spec.md`
- `docs/design/2026-06-13/0000-asr-3d-frosted-glass-waveform.md`

Added a new **Design** section to `docs/README.md` and indexed all four. Upgraded the preview harness into an interactive review tool (Play button + scrub slider; real mouse drives hover). Confirmed `tsc` + production build green and that `preview.html` is excluded from `dist`.

## User (automated autonomous-loop tick)

(System-generated heartbeat while the user was away.)

## Assistant

Confirmed the work was complete and handed off for review (the user had scoped this to one scene), verified the review dev server was still serving (HTTP 200), made no code edits to avoid disrupting a live review, and rescheduled the fallback heartbeat.

## User

This is good progress. Make these changes:

1. Match the audio animation waveform to the audio wave form of the actual video.
2. After the doted texts appear, start animating them into real texts, just like unmasking imessage invisible messages. Use real-text and keep the particle-like effect. You don't need to hardcode the whole subtitle since this scene won't always be visible on the screen.
3. Reduce the parallex effect, instead, mouse hover should add random noise and disrupt the text bubbles, just like the last page in igloo.inc. When mouse is not hovering on text, they should restore to normal form.

## Assistant

Located the source recording on the NAS and baked the **real audio envelope** into `web/src/data/intro.peaks.json` (peak-per-10ms over the whole clip) via a committed, re-runnable `web/scripts/gen-waveform.py` (ffmpeg → mono PCM → per-bucket peak → normalized/quantized). Chose precompute-indexed-by-`t` over a live `AnalyserNode` so the waveform stays scrub-reversible. The slabs now scroll a ~1.4 s window of that envelope, so the bars match what's being said.

Reworked the transcript half of `asr3d.ts`:

- **Real text via invisible ink (point 2):** pull the *actual* current `.vtt` cue (parsed in `scenes.ts` from the same `en.vtt`/`zh.vtt` the teleprompter uses, passed in as `getCue(t)`), render it to an offscreen canvas, sample its glyph pixels into particle home positions, and develop each cue from a scattered haze into legible words over ~0.7 s from the cue's start. Layouts cached per cue string; nothing hardcoded.
- **Mouse disrupts text, not camera (point 3):** removed the camera parallax (fixed 3/4 pose) and made the cursor add animated random-noise jitter + a radial repulsion to nearby text particles (igloo's closing page), which snap back to legible text when it leaves.

Imported the large peaks JSON via `?raw` + `JSON.parse` to avoid a giant inferred tuple type. Fixed a hover bug (global skew from an unconverged world-space camera-lean term) by making the camera fully static. Verified each phase with headless Chrome — real-audio waveform at multiple times, mid-reveal haze, formed caption, and local hover disruption. `tsc` + build green; cold-open bundle still ~44 KB gz, scene chunk ~155 KB gz (Three.js + baked waveform). Added a revision note to the design doc and sent four frames for review.

## User (automated autonomous-loop tick)

(System-generated heartbeat.)

## Assistant

Verified the dev server healthy, made no edits during the active review window, rescheduled the fallback heartbeat.

## User

Export transcript, then integrate with VCS

## Assistant

Ran the `export-transcript` skill and wrote this transcript to `docs/transcripts/2026-06-14/0018-claude-3d-asr-supporting-art.md` (per `AGENTS.md`, transcripts live under `docs/transcripts/`, not the skill's default `docs/coding-sessions/`). Redaction-scanned it, then integrated the work into VCS via the `vcs` skill's helper (no publish, per the standing rule).
