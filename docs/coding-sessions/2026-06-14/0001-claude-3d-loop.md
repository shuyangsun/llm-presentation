<!-- markdownlint-disable MD013 MD024 -->

# 3D loop finale: green ice closed loop → red open loop that floods into a human

- **Date:** 2026-06-14
- **Repo:** llm-presentation (jj workspace `claude-3d-loop`, integrating onto `main`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: ultracode / xhigh + dynamic workflow orchestration)
- **Summary:** Reworked the `loop3d.ts` supporting-art scene from a comet-orbits-a-glass-torus animation into a frosted-green ice ring holding a churning particle blob that, on "open the loop," turns red, dissolves a quarter-circumference gap at the top, and pours its particles out into a simple human. Iterated over three rounds of feedback: face-on framing + cracked-ice shader + magnet removal; clockwise flow + sparser loop that floods to a full-density human. Verified every state with headless-Chrome screenshots and a 3-lens adversarial review workflow.

---

## Session setup

- `/model` → Opus 4.8 (1M context)
- `/effort ultracode` → xhigh + dynamic workflow orchestration
- `/remote-control 3d-loop`

## User

The current 3D loop animation loops wierd. Remove the parallax effect on the ring, and make the following change:

1. For the closed loop, it should be green since this is the state we want. There should be a blob of particles trapped inside of the loop, they just keeps floating around the ring. Remove the banding on the loop, I want the loop feel like ice surface (but green).
2. For the closed loop, when the mouse hovers on it, the mouse should almost act like a magnet attracting particles to the mouse, but they are still trapped inside of the loop, trying to break out but can't. Particles continue to run, just impacted by the position of the mouse.
3. For the open loop, it should be red color (similar to now). The loop open should be centered at top, being about 1/4 of the ring circumference. Particles then flow out of the loop, forming a simple shape of a human.
4. For the simple shape of human particles, they are no longer attracted by mouse hover. Instead, then the user hovers their mouse on the particles, a horizontal band of these particles (not the whole person) start to have more clear shapes and outlines of a human. If the mouse is hovered on top of the face, show simple shapes representing faces.
5. The loop should only open right before the closed-loop particles flow to the openning part. For example, the loop starts to open when particles are just past the bottom part of the closed loop.

After you're done making changes, start a local server for me to preview the change and give you feedback.

## Assistant

Explored the codebase: the scene lives in `./web/src/engine/loop3d.ts` (Three.js, lazily mounted from `./web/src/engine/scenes.ts`, shared scaffold in `./web/src/engine/scene3d.ts`), driven by the video playhead `t` so every narrative beat is a pure function of time and stays scrub-reversible. Dev server is `npm run dev` (Vite); the dev-only `preview.html?scene=loop&t=<sec>&mx=&my=` harness mounts just this scene and drives `__tick(t)`.

Rewrote `loop3d.ts` against the six requirements:

- **No parallax** — removed the cursor-driven ring spin; camera eased 3/4 → front on open (narrative, not mouse).
- **Closed = green ice** — replaced the banded instanced box-segments with a smooth `TorusGeometry` + a frosted-ice green shader (fresnel + soft highlights, no banding). The main-ring angle is recovered in the shader so the top gap is a smooth alpha falloff.
- **Trapped blob** — `N` particles (Points cloud) confined to the tube cross-section, the whole blob lapping the ring.
- **Closed magnet** — on hover, particles tugged toward the cursor then hard-clamped inside the tube radius ("trying to break out but can't"), orbit continuing.
- **Open = red, top gap ~¼** — the top quarter dissolves, colors lerp green→red, particles bezier-arc out through the gap and re-form a human sampled from a canvas-rasterized silhouette (eyes/mouth cut as negative-space holes).
- **Human band/face reveal** — no magnet; a horizontal band under the cursor reduces per-particle scatter so the silhouette/face sharpen locally.
- **Open synced to blob** — a deterministic playhead orbit lands the blob "just past the bottom" at the open beat.

Started the Vite dev server (port 5174, since 5173 was taken), captured every state with headless Chrome + SwiftShader (closed, opening, open, face-hover, band-hover), and confirmed the states render.

Then ran a 3-lens adversarial review **workflow** (spec-conformance · Three.js/perf correctness · visual-design). It surfaced one **major** issue, flagged independently by two lenses: the pour-out was *time-keyed* (released the instant `openP>0`) while the blob was still at the bottom, so particles bezier'd diagonally across the ring interior to a gap they never reached.

Fixed it with a **position-keyed pour-out**: the blob calm-laps to just-past-bottom at the open beat, then *surges up to the top gap*, and each particle is released only once its own monotonic unwrapped lap angle crosses the opening (so it latches and stays scrub-reversible). Also applied the high-confidence design fixes: frosted-ice shader (broad highlight + drifting frost noise) instead of glossy jade; keep the open red ring assertive (no double desaturate+dim); crisper default human with a readable negative-space face (sprites shrink inside the reveal band so the eye/mouth holes punch through); decisive green→red flip; more granular/contrasty blob. Verified the surge/pour, the formed human, the face reveal (cropped + zoomed the head), and the magnet (no-hover vs cursor-pull comparison). `tsc` and `vite build` both passed.

## User

Make both the closed and open loop ring facing viewer directly, without any tile. There is a small gap on the left side of the closed loop, fix it. The ring tubes shapes are too smooth and regular, I want them to look like ice with refractions and imperfections. Remove the closed loop particle impacted by mouse position effect, they should just flow inside of the tube.

## Assistant

- **Face-on both states** — fixed the camera head-on (dropped the 3/4 azimuth/elevation and the open-ease).
- **Left-side gap** — this was a real shader bug, not the viewing angle: `vTheta` was computed per-vertex and interpolated, so the triangle straddling 9 o'clock swept the angle +π → 0 → −π, falsely passing through the gap center (π/2) and carving a dissolve+glow seam. Moved the angle derivation **per-fragment** (`atan(vLocal.y, vLocal.x)` from the interpolated position), which wraps correctly at ±π and never through 0. Seam gone.
- **Ice with refractions/imperfections** — richer shader: noise-perturbed normals (facets/irregular highlights), pale fracture lines, a slowly-drifting caustic for the refraction feel, cloudy frosted translucency. Dialed back a first pass that looked like neon Tron veins to land on frosted ice.
- **Removed the closed magnet** — deleted the magnet block and `uHover`; closed particles now just flow in the tube. Only the open-state band/face reveal reacts to the cursor.

Verified face-on closed (continuous, no left seam), zoomed the open ring's left side to confirm the seam was eliminated, and re-checked the human. `tsc` and `vite build` passed.

## User

The closed loop should be clock-wise, and reduce the number of particles in there, but keep the human particle the same then it's animated and floods out.

## Assistant

- **Clockwise** — reversed the orbit (`ORBIT_DIR = -1`, decreasing angle head-on) and flipped the release gate accordingly (the blob now reaches the top gap on its first *clockwise* top-crossing after the open beat, one turn below the gap center; still monotonic and scrub-reversible). Confirmed the blob travels top → right → bottom.
- **Fewer particles in the closed loop** — only ~25% (`LOOP_FRAC`) are trapped/visible while closed (a `pInLoop` flag + per-particle `aFade` attribute), so the blob is a sparse cluster.
- **Full-density human + flood** — the hidden ~75% stay invisible while closed and fade up exactly as they release and pour out of the gap, so the human re-forms at the original full particle count from a dramatic flood out the opening.

Verified the clockwise montage, the flood-out, and the full human; `tsc` and `vite build` passed.

## User

Rebase onto main, export session transcript and integrate with /vcs

## Assistant

Exported this transcript via the `export-transcript` skill, then rebased the `claude-3d-loop` work onto `main` and integrated it with the `vcs` skill (see the closing turns of the session for the final commit/integration details).
