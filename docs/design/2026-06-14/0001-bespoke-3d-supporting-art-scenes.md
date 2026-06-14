# Six bespoke 3D supporting-art scenes (translate · sync · responsive · director · rag · loop)

Date: 2026-06-14
Status: Current baseline with follow-up refinements
Area: presentation supporting art, 3D scenes, shaders, shared WebGL scaffold, phase timeline, mouse interaction
Sources: `web/src/engine/scene3d.ts`, `web/src/engine/{translate3d,sync3d,responsive3d,director3d,rag3d,loop3d}.ts`, `web/src/engine/scenes.ts`, `web/src/engine/asr3d.ts`, `web/src/style.css`, `web/src/preview.ts`; transcript [docs/transcripts/2026-06-14/0019-claude-more-3d-supporting-art-scenes.md](../../transcripts/2026-06-14/0019-claude-more-3d-supporting-art-scenes.md), and the later director recast [docs/transcripts/2026-06-14/0021-claude-director-dash-pixel-game.md](../../transcripts/2026-06-14/0021-claude-director-dash-pixel-game.md); builds on [the ASR 3D design](../2026-06-13/0000-asr-3d-frosted-glass-waveform.md)

## Summary

After the **audio → transcript** scene shipped as 3D WebGL (`web/src/engine/asr3d.ts`),
the remaining six illustrative scenes were each rebuilt as a **distinct** interactive
Three.js scene — no shared visual motif, one bespoke metaphor per beat — all on a new
shared scaffold, `web/src/engine/scene3d.ts`. Every scene is a pure function of the
video playhead `t` (so scrubbing rewinds it exactly), reads the warm Paper palette from
the CSS `:root` tokens, reacts to the mouse, falls back to the original 2D CSS scene
when WebGL is unavailable or `prefers-reduced-motion` is set, and lazy-loads its module
(each scene is a separate ≤12 KB chunk sharing one `three` chunk).

| scene | file · export | base beat | the metaphor |
|---|---|---|---|
| translate | `translate3d.ts` · `mountTranslate3D` | 165.5 | `Text` particles stream through a refracting **glass membrane** and re-form as `文`; cursor side later controls the actual site language |
| sync | `sync3d.ts` · `mountSync3D` | 186.7 | a head-on **3D progress bar** where warm particle links rain from VIDEO to WEB and section dots/title hovers mirror the real scrubber |
| responsive | `responsive3d.ts` · `mountResponsive3D` | 222.7 | one **vertical mobile device** whose video fills the phone, docks to the top, then reveals content below; cursor height folds between the states |
| director | `director3d.ts` · `mountDirector3D` | 263.1 | **recast as a 2D pixel-art platformer** ("Director's Dash"): the director hops corporate-employee **turtles**, ducks office-memo planes, and collects real open-source file links (see the director note below) |
| rag | `rag3d.ts` · `mountRag3D` | 298.5 | a stable **embedding-space constellation** with real open-source file links; the two named skills draw graph edges to corpus nodes |
| loop | `loop3d.ts` · `mountLoop3D` | 343.4 | a green ice **closed loop** with sparse trapped particles that opens red at the top and floods particles into a human silhouette |

The design directive (from the recording, and the project memory): "make it FUN" is the
number-one requirement, sync every change to the spoken word, reveal gradually, and use
big-but-mobile-safe type. The previous "remaining scenes are still 2D CSS" note in
`web/README.md` is now obsolete — six of the seven scenes are 3D Three.js with 2D
fallbacks; the **director scene was later recast as a standalone 2D pixel-art platformer**
(plain 2D canvas, no WebGL — see the director note below). The
scene table above reflects follow-up refinements recorded after the first
six-scene implementation transcript; those detailed session notes are indexed
under [`docs/coding-sessions/2026-06-14/`](../../coding-sessions/2026-06-14/).

## The shared scaffold — `web/src/engine/scene3d.ts`

`asr3d.ts` was self-contained; the six new scenes share their skeleton, so it lives in
`scene3d.ts` once. It exports:

- `createStage(container, {fov?})` → `{ renderer, scene, camera, canvas, dpr, small, size, onResize(cb), render(), dispose(extra?) }`.
  A transparent (`setClearColor(0,0)`) DPR-capped (≤1.5) `WebGLRenderer` over the paper
  bg, a `PerspectiveCamera` the scene frames itself inside `onResize`, a `ResizeObserver`
  that re-frames on container resize, and a `dispose(extra)` that runs the scene's
  geometry/material teardown then `renderer.dispose()` + `forceContextLoss()` (browsers
  cap live GL contexts, so disposal on scene-swap is mandatory).
- `palette()` → the Paper tokens as `THREE.Color`s read from `:root`
  (`--bg`, `--accent` `#c25450`, `--accent-ink` `#9c3f3c`, `--fg` `#1a1614`, …) plus a
  derived `glass` (terracotta lightened toward paper). `THREE.ColorManagement` is OFF
  globally, so colours are authored and emitted in sRGB to match the DOM captions.
- `trackPointer(canvas, camera, planeZ)` → a damped cursor position on a world plane
  (`world`), a damped normalised `ndc` (eased back to 0 when the cursor leaves — scenes
  use `ndc.x` for rotation), and a 0..1 `hover` presence. Window-level listeners with
  bounds checks; `dispose()` removes them.
- `makeClock()` → a clamped wall-clock delta, used **only** for non-narrative idle motion
  (shimmer, spin, drift), never for a narrative beat.
- `phase(t,a,b)` — the reversibility primitive: a smoothstep ramp 0 at playhead `a`, 1 at
  `b`. Every entrance/reveal/transition is built from these, so a backward scrub rewinds
  it. `smooth`, `clamp01`, `damp`, `TAU` round out the math vocabulary.
- `sampleGlyphs(text, {max, aspect?, lines?})` → rasterises word-wrapped text to an
  offscreen canvas and samples its ink pixels into normalised points — the asr3d
  technique, exposed so `translate3d` can morph "translate" → "翻译". Sample only after
  `document.fonts.ready`.

## Original Per-scene Notes

The notes below record the first six-scene implementation from transcript
`0019`. Later scene-specific sessions refined translate, sync, responsive, rag,
and loop behavior; the current behavior is summarized in the table above and in
[`web/README.md`](../../../web/README.md).

Each scene's narrative beats are pinned to the words in `web/src/data/en.vtt` (the same
cues the teleprompter uses), matching the `data-at` reveal times the old 2D scenes used.

- **translate** (165.5): a vertical frosted-glass **membrane** (a subdivided plane with a
  terracotta fresnel rim, animated caustic ripples, mouse-driven ripple) at x≈0. ~4200
  terracotta particles sampled from "translate" (left homes) and "翻译" (right homes)
  cross left→right, staggered, with a refraction wobble as they pass the pane. `formP`
  166.0; `cross` 166.2→169.0. 2 draw calls.
- **sync** (186.7): two `InstancedMesh` ribbons — top = film-frame tiles (VIDEO), bottom =
  UI-block tiles (SITE) — and one glowing vertical playhead plane + connector spanning
  both. Tiles brighten by gaussian proximity to `uPlayheadX`. The playhead auto-sweeps,
  then on "scrub" (`scrubEnable` 195.5→197.2) becomes **mouse-controlled** so the viewer
  scrubs both ribbons in lockstep; a `lockPulse` (202.6) flashes the connector. ~5 draw calls.
- **responsive** (222.7): one `RoundedBoxGeometry` glass slab whose half-extents lerp from
  portrait (tall) to landscape (wide) by `reflow` (234.6→237.0); four inner instanced
  tiles lerp between a stacked layout (video on top) and a side layout (video docked
  left, content beside). The device does a **flip-and-settle** flourish that returns
  face-on at both ends — a full 90° turn was rejected because it goes edge-on (a sliver)
  mid-reflow. Mouse `ndc.x` adds parallax spin. 3 draw calls.
- **director** (263.1) — **recast 2026-06-14 as a 2D pixel-art platformer** ("Director's
  Dash"); the original 3D vignette + `ConeGeometry` spotlight + clapperboard scene is
  **superseded** (see [transcript 0021](../../transcripts/2026-06-14/0021-claude-director-dash-pixel-game.md)).
  `director3d.ts` no longer uses Three.js or `scene3d.ts`: it is a standalone low-resolution
  **2D canvas** upscaled nearest-neighbour (`image-rendering: pixelated`), so the chunk
  carries no `three` (~13 KB). A clapperboard **director** runs a grassy stage, **jumps**
  necktie-wearing corporate-employee **turtles** (stomp for a bonus), **ducks** office-memo
  paper planes, and **collects real open-source file tokens** that drop clickable
  `github.com/shuyangsun/<repo>/blob/main/<path>` links (with facts about this talk, sourced
  from the [brain dump](../../archive/20260611/brain_dump_20260611_distilled.txt)) into a DOM
  panel. Controls: **click / `J`** = jump, **`K`** = duck (Space stays free for the video);
  a **3-lives** death mechanic keels the director over with cute "X X" eyes and **Enter**
  restarts (collected links stay clickable). Story beats stay pure functions of `t` (`intro`
  263.1→264.5; `fun` 278.5→280.8 washes muted corporate → vivid colour; `retake`
  282.6→284.3); the game loop runs on the wall-clock with an attract-mode AI, and only
  `prefers-reduced-motion` falls back to the static CSS clapper. The DOM still carries the
  "Take 01" slate tag (reveal 264.5).
- **rag** (298.5): an ambient **galaxy** of ~2600 faint corpus points + ~30 brighter
  document nodes in a flattened disk. A **query probe** (mouse on z=0, else a slow
  auto-orbit) runs per-frame k-NN against the document nodes and lights terracotta
  **beams** (one `LineSegments`) to its nearest few. On `converge` (322→329.65) the beams
  aim at one answer node lower-left and a crystal glow blooms there — under the DOM answer
  card (`.rag-answer`, shared with the 2D scene, with the real `/retrieving-context` and
  `/export-transcript` links and the resolved `WhisperX · large-v3`). ~4 draw calls.
- **loop** (343.4): a frosted-glass **torus** of ~140 instanced segments (terracotta
  fresnel) with a bright **comet** + trail orbiting it = the closed, iterating loop. On
  "I'm going to open the loop now" (`openP` 349.95→351.6) a contiguous run of segments
  fades to a **gap**, the ring tilts about X so the gap faces the **viewer**, and the
  comet parks at the gap pulsing toward the camera = the open loop, awaiting you. Mouse
  `ndc.x` spins the ring. 2 draw calls. This is the finale and ties back to the talk.

## Integration, fallback, verification

- **Wiring** (`web/src/engine/scenes.ts`): each builder branches
  `if (REDUCE_MOTION || !webglAvailable()) return <scene>2D(lang)` (the original CSS scenes,
  kept byte-for-byte as fallbacks), else builds a `.scene--<key>3d` root with a single
  `[data-reveal]` canvas container + DOM caption, and calls the shared `attach3D` helper —
  which lazy-imports the module, forwards the director's per-frame `__tick(t)`, and
  releases the GL context on `__cleanup`. This mirrors `asrScene` exactly. The rag answer
  card was extracted to `ragAnswer(lang)` so the 2D orbit and the 3D constellation share it.
- **CSS** (`web/src/style.css`, "3D scene shells"): `.scene--<key>3d` stretches the canvas
  to fill the hero area; rag is special-cased so the galaxy fills the scene and the answer
  card floats as a blurred HUD over it.
- **Verification**: the dev-only `web/src/preview.ts` harness mounts any scene by
  `?scene=<key>&t=<sec>&mx&my` and force-reveals its parts, so each phase can be
  screenshotted headless (`google-chrome --headless --use-angle=swiftshader`) without the
  uncommitted video. All six were screenshot-verified at their key beats; `npm run build`
  (tsc strict — `noUnusedLocals`/`noUnusedParameters` — + vite) is green.
