<!-- markdownlint-disable MD013 MD024 -->

# Six more bespoke 3D supporting-art scenes (translate · sync · responsive · director · rag · loop)

Date: 2026-06-14
Repo: llm-presentation (bookmark: claude-more-3d-animations)
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
Summary: Converted the remaining six illustrative presentation scenes (translate, sync, responsive, director, rag, loop) from flat 2D CSS into distinct, interactive 3D Three.js scenes — one bespoke metaphor per beat, never reusing a look. Built a shared WebGL scaffold (`web/src/engine/scene3d.ts`: transparent DPR-capped stage, Paper palette from CSS tokens, damped pointer, reversible `phase(t,a,b)`, glyph→points sampler), wired each scene in `scenes.ts` with lazy-load + `__tick`/`__cleanup` + a 2D fallback, and generalized the preview harness to mount any scene for headless screenshots. Implemented the six modules with a dynamic Workflow (six implement→adversarial-review chains in parallel; reviewers fixed real bugs — a reversibility regression, a collapsed landscape layout, dead varyings/attributes, a dispose-before-fonts guard, and a torus gap that didn't face the viewer). Screenshot-verified every scene at its key beats; fixed the responsive reflow (was rotating edge-on) and enriched the rag constellation. `npm run build` green; docs updated.

## User

(Invoked via remote control. Model set to Opus 4.8 (1M context); effort set to `ultracode` — xhigh + dynamic workflow orchestration.)

Like what we just did with the audio to transcript 3D animation, do the same for the reset of the scene animations. Make them fun and interactive, but don't reuse the same design every time, that gets boring very quick. Design something specifically for the content being talked about. Once you're done, /updating-docs, then /export-transcript and integrate with /vcs

## Assistant

Explored the production presentation (`web/`, Vite + TypeScript + GSAP + Three.js, no framework) and the shipped 3D ASR scene as the template. Established the architecture: the talking-head video's playhead drives everything; `web/src/engine/scenes.ts` swaps an illustrative scene per transcript beat; the ASR scene (`web/src/engine/asr3d.ts`) is a WebGL scene mounted with `__tick(t)`/`__cleanup` lifecycle hooks, lazy-loaded, with a 2D CSS fallback for `prefers-reduced-motion` / no-WebGL. Read the palette tokens (`--bg #f7f4ee`, `--accent #c25450`, `--accent-ink #9c3f3c`, …), the reveal/`data-at` timing system, the `en.vtt` transcript to pin each scene's beats to the spoken words, the existing 2D scene CSS, and the dev-only `preview.ts` harness. Confirmed the six remaining scenes were still 2D: translate (165.5), sync (186.7), responsive (222.7), director (263.1), rag (298.5), loop (343.4).

Designed a **distinct** metaphor per scene (no shared motif): translate = EN→中文 particles through a refracting glass membrane; sync = two parallel filmstrip ribbons on one scrub-able playhead; responsive = a glass device that morphs portrait→landscape and reflows its tiles; director = a cinematic stage with a steerable volumetric spotlight + clapper snap + spark burst; rag = an embedding-space retrieval constellation with a mouse-steered query probe; loop = a glowing torus with an orbiting comet that breaks open toward the viewer.

Renamed the jj work to `claude-more-3d-animations`, ran `npm install` (three.js was absent in the fresh workspace), and confirmed a green baseline build.

Wrote the shared scaffold `web/src/engine/scene3d.ts`: `createStage()` (transparent renderer, DPR≤1.5, ResizeObserver framing, `dispose` with `forceContextLoss`), `palette()` (Paper tokens as `THREE.Color`, ColorManagement off), `trackPointer()` (damped world-plane cursor + `ndc` + `hover`), `makeClock()` (idle-only wall clock), the reversibility primitive `phase(t,a,b)` plus `smooth`/`clamp01`/`damp`/`TAU`, and `sampleGlyphs()` (text→normalised points). Typechecked green.

Wired `scenes.ts`: each scene now branches to `<scene>2D(lang)` when WebGL/reduced-motion, else builds a `.scene--<key>3d` root with a single `[data-reveal]` canvas + DOM caption and a shared `attach3D()` helper (lazy import + forward `__tick` + release GL on `__cleanup`), mirroring `asrScene`. Extracted `ragAnswer(lang)` so the 2D orbit and the 3D constellation share the answer card (with the real `/retrieving-context` and `/export-transcript` links). Added the `.scene--<key>3d` CSS shells (rag special-cased: galaxy fills the scene, the answer card is a blurred HUD). Generalized `preview.ts` to `?scene=<key>&t=<sec>` for any scene. Validated the headless-Chrome + SwiftShader WebGL screenshot path end-to-end against the asr scene.

Ran a dynamic **Workflow**: six implement→adversarial-review pipeline chains in parallel (each agent wrote one `*3d.ts` module on the shared helper, then a reviewer adversarially checked three.js r0.171 correctness, GLSL validity, scrub-reversibility, full dispose, NormalBlending on the light paper bg, and perf — fixing in place). Reviewers caught and fixed real bugs: sync's entrance was not reversible (tile alpha ignored `uFormP`); responsive's landscape content column collapsed to slivers (an algebra error in `colW`); translate had a dead varying and could run `buildHomes()` after dispose when fonts resolved late; rag declared a dead `aHome` attribute; loop's gap rotated about Y (never facing the viewer) — refixed to tilt about X so the opening faces the camera and the comet pulses forward.

Ran the integrated `npm run build` (tsc strict with `noUnusedLocals`/`noUnusedParameters` + vite) — green; each scene code-split into a ≤12 KB lazy chunk sharing one `three` chunk. Restarted the dev server and screenshot-verified all six scenes at their key beats via the preview harness. Found one defect: **responsive** rotated a full 90° about Y, so mid-reflow it went edge-on to a sliver — fixed it to a flip-and-settle flourish (`Math.sin(reflow·π)·0.42`) that returns face-on while the aspect morph carries portrait→landscape; re-verified (clean wide landscape, video docked left, content stacked right). Enriched the **rag** constellation (more/larger/warmer points, brighter beams during the idle auto-orbit) so retrieval reads in the oversized preview. Re-ran typecheck + final build — green.

Ran `/updating-docs`: added the centralized design doc `docs/design/2026-06-14/0001-bespoke-3d-supporting-art-scenes.md` (covering the shared scaffold and all six scenes with file paths, export names, and beat timings), linked it from `docs/README.md`, and corrected the stale "remaining scenes are still 2D CSS" claim in `web/README.md` with a per-scene 3D table. Then `/export-transcript` (this file) and `/vcs` integration.

## User

(Closing steps requested in the original turn: `/updating-docs`, `/export-transcript`, integrate with `/vcs`.)

## Assistant

Updated the docs, exported this transcript under `docs/transcripts/2026-06-14/`, and integrated the change via the `vcs` skill (no publish — local integration only, per the repo's workflow). Final state: seven 3D supporting-art scenes, all pure functions of the playhead with 2D fallbacks, `npm run build` green.
