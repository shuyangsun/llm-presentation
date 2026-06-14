<!-- markdownlint-disable MD013 MD024 -->

# responsive3d — mobile beats + cursor-driven fold

- **Date:** 2026-06-14
- **Repo:** llm-presentation (jj bookmark `claude-responsive3d-mobile`, change `knvwysmqpquq`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: max)
- **Summary:** Recast the `responsive3d` supporting-art scene to follow the mobile monologue beats (full-screen video → docked to top → content below), removed the desktop/landscape morph, and added a cursor-driven fold that drags the video's bottom edge. Then reversed the fold direction and flipped the phone's facing toward the desktop video, per feedback. Verified each step against a live Vite preview.

---

## User

> (session set to `/effort max`; remote-control target `3d-responsive`)

Change @web/src/engine/responsive3d.ts to match the content of talking-head video, and make it more interactive.

1. When the scene is first shown, it should display the vertical layout with the red box (video) taking up most of the screen realestate, indicating the full-screen video. This should appear at around 3:50, when I said "a vertical layout aspect ratio". Reference @docs/subtitles/0001_intro.vtt if you need the precise timestamp.
2. When I say "instead of putting it..." at 3:57, the red box should transition to the top part of the screen, without showing art to illustrate content yet.
3. When I say "should be below ..." at 4:01, the art illustrating content below the video should show up.
4. Remove the transitioning to Desktop layout animation, since the desktop layout is not being discussed in this part of the video.
5. Add an interactive element to this scene. Based on the mouse hover's vertical position, either show the full video covering the screen, or the video at top and content at the bottom. The cutoff threshold should be y-axis coordinate of the video's bottom border - if the mouse's y-axis position crosses that boundary, trigger this animation.
6. You don't need to add particle effects to this.

When you're done, spin up a local preview server, I'll give you feedback.

## Assistant

Explored before touching code:

- **`web/src/engine/scene3d.ts`** — shared scaffold. Key helpers: `phase(t,a,b)` (reversible smoothstep ramp pinned to two playhead timestamps), `smooth`, `damp` (frame-rate-independent easing), and `trackPointer` (exposes `ndc` in [-1,1] y-up, plus a damped `hover` 0..1; listens on `window`).
- **`web/src/engine/scenes.ts`** — the scene is scheduled `{ t: 222.7, key: "responsive" }`, on screen until the director scene at `263.1`. `__tick(t)` receives the global playhead seconds. A 2D reduced-motion fallback (`responsiveScene2D`) and a caption `"mobile · desktop"` at t=240 also live here.
- **`docs/subtitles/0001_intro.vtt`** — pinned the beats:
  - `03:48.4` "a vertical" → `03:50.7` "layout aspect ratio with me in the center"
  - `03:54.5` "instead of putting it ... make it horizontal and put it" → `03:58.8` "on the top"
  - `03:58.8` "The main content should be below" → `04:01.5` "the video"

Set up the jj isolation workspace: renamed the work to `claude-responsive3d-mobile`, and (per prior project notes) symlinked `web/node_modules` and the git-ignored `web/public/` media into the workspace so the preview could run.

Rewrote `web/src/engine/responsive3d.ts`:

- **Three narrative beats**, each a pure `phase(t,…)` of the playhead so scrubbing rewinds exactly:
  - `T_APPEAR` 228.4–230.7 — full-screen red video tile fades/scales in (fills the entire inner face of a portrait phone).
  - `T_DOCK` 237.0–240.0 — video lerps `VIDEO_FULL → VIDEO_DOCK` (top ~42%); content still hidden.
  - `T_CONTENT` 241.0–243.3 — three content blocks fade in, stacked below the video.
- **Removed the landscape/desktop morph entirely** — no `layoutLandscape`, no portrait→landscape flip, fixed-aspect portrait device, camera frames only the portrait envelope (so the phone reads larger).
- **Per-instance reveal**: generalized the shared glass frag to take a `revealExpr`; added an `aReveal` instanced attribute so the video tile stays lit (driven by `appear`) while the content blocks fade independently — content gated on `smooth((dock-0.5)/0.5)` so video and content never overlap mid-fold.
- **Interactive fold**: each frame, project the docked video's bottom border (`VIDEO_DOCK_BOTTOM`, on the device's center axis) to NDC y as a stable threshold; compare `pointer.ndc.y`; damp a `fold` scalar toward the target; blend story↔cursor by `pointer.hover`. When the pointer leaves, `fold` parks on the narrative value for a seamless handoff. No particles.

`npm run typecheck` (tsc --noEmit) passed; confirmed Vite served the transformed module with no transform errors. Started the dev server (`npm run dev`) and handed over per-beat preview URLs (`/preview.html?scene=responsive&t=…`, plus pinned-cursor `mx`/`my` demos). Flagged that the `"mobile · desktop"` caption and the 2D fallback in `scenes.ts` are now slightly off-message (left untouched, since the request was scoped to `responsive3d.ts`).

## User

The mouse hover animation is reversed. When the mouse is at top, the video should be at the top; if the mouse is at the bottom, the video should be full screen.

## Assistant

The fold direction was inverted. Flipped the threshold comparison in the tick loop:

```diff
- const want = pointer.ndc.y < thresholdNdcY ? 1 : 0; // cursor below the fold → split
+ const want = pointer.ndc.y > thresholdNdcY ? 1 : 0; // cursor above the fold → video docked top
```

Now cursor **above** the video's bottom border → docked at top with content below; cursor **below** → full-screen. Reads as dragging the video's bottom edge (pull down to fill, lift up to dock). Updated the header and inline comments to match, and verified the new operator was served by Vite with no errors.

## User

Make the phone tilt to the left instead of right, facing the video on the desktop.

## Assistant

On desktop the video docks to the **left**, so the phone should turn its face left toward it. The resting 3/4 view comes from the camera azimuth; the camera was front-left (`BASE_AZ = -0.24`), which turns the phone's face right (away from the video). Flipped the camera to the right side so the face turns left:

```diff
- const BASE_AZ = -0.24; // resting azimuth (rad) — subtle, keeps the fold line level-ish
+ const BASE_AZ = 0.24;  // camera to the right, so the phone's face turns LEFT toward the desktop video
```

Only the camera's x flips (z = `cos` is unchanged), so it's a clean horizontal mirror; the fold-line projection is on the device's center axis (x=0), so the interaction is unaffected. Verified the new value served cleanly.

## User

Export transcript, then integrate with /vcs

## Assistant

Exported this transcript via the `export-transcript` skill (this file), then proceeded to integrate the work with the `vcs` skill.
