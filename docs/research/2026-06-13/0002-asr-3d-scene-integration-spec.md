# 3D ASR Scene — Integration Spec for the Presentation Engine

Date: 2026-06-13
Status: Current
Area: web/src integration, scene lifecycle, reveal mechanics, design tokens, fallbacks
Sources: web/src/main.ts, web/src/engine/scenes.ts, web/src/data/timeline.ts, web/src/style.css

`three` (^0.171.0) and `@types/three` are already dependencies. No install needed. I now have everything required.

---

# WebGL Scene Integration Spec — `asrScene` → `asr3d.ts`

Working dir (repo root): `/home/ssun/developer/llm-presentation-claude-pending-9d5bcd0f`
Target files: `web/src/main.ts`, `web/src/engine/scenes.ts`, new `web/src/engine/asr3d.ts`, `web/src/style.css`.
Dependency status: `three@^0.171.0` + `@types/three@^0.171.0` are ALREADY in `web/package.json`. No install required.

---

## 1. Scene node lifecycle — every code path that removes a scene DOM node

A scene node is created in exactly one place and removed in exactly **three** places. All three live inside `swapScene(i, force)` in `web/src/main.ts` (lines 265–290).

**Creation** (main.ts:285–286):
```ts
const node = SCENES[i].build(lang);
sceneStage.append(node);
```
`build(lang)` returns the scene's root `HTMLElement`. It is appended to `sceneStage` (the `<div class="scene-stage">` built at main.ts:78). `sceneStage.lastElementChild` is therefore always the live scene.

**The three removal paths** (all in `swapScene`, main.ts:271–282):

1. **Straggler loop** (main.ts:273–276) — every child except the most-recent outgoing node is removed synchronously:
   ```ts
   existing.forEach((c) => {
     gsap.killTweensOf(c);
     c.remove();
   });
   ```
2. **Crossfade tween** (main.ts:278–279) — the most-recent outgoing node `old` is faded; the tween itself does NOT remove the node, but it is the visual handoff:
   ```ts
   gsap.to(old, { autoAlpha: 0, y: -14, filter: "blur(6px)", duration: REDUCE_MOTION ? 0.001 : 0.36, ease: "power2.in" });
   ```
3. **Wall-clock removal** (main.ts:281) — `old` is actually detached here, on a `setTimeout`, decoupled from the (throttlable) tween:
   ```ts
   window.setTimeout(() => old.remove(), 420);
   ```

There is **no other** removal path. `sceneStage` is never `innerHTML = ""`'d, never replaced, and `swapScene(-1)` (called from `applyBeats` at main.ts:403 when `t < BEATS.deck`) routes through the same `old` path then early-returns at main.ts:284 (`if (i < 0) return;`). Language change (`applyLang`, main.ts:421–424) calls `swapScene(sceneIndex, true)` with `force=true`, which also routes through paths 1–3 to tear down the old-language node before rebuilding.

**Implication for WebGL:** a `three` `WebGLRenderer` holds a GPU context, geometries, materials, textures, and a rAF-driven internal loop. It MUST be disposed at every one of these three removal sites or contexts leak (browsers cap live WebGL contexts ~16, then evict). The generic fix below attaches `__cleanup` to the node and invokes it everywhere the node is detached (paths 1 and 3; path 2 is just the tween, cleanup pairs with the actual `.remove()` in path 3).

---

## 2. Generic hooks in main.ts — `__tick(t)` and `__cleanup()`

Two duck-typed, optional hooks on the scene root. DOM-only scenes never define them, so behavior is unchanged for the seven existing scenes.

### Edit A — drive per-frame time into the active scene (in `updateSceneReveals`)

`web/src/main.ts`, lines 245–248. The function already grabs the live node and the base time each tick — add the `__tick` call right after the guard.

OLD (main.ts:245–248):
```ts
function updateSceneReveals(t: number) {
  const node = sceneStage.lastElementChild as HTMLElement | null;
  if (!node || sceneIndex < 0) return;
  const base = SCENES[sceneIndex].t;
```
NEW:
```ts
function updateSceneReveals(t: number) {
  const node = sceneStage.lastElementChild as HTMLElement | null;
  if (!node || sceneIndex < 0) return;
  // WebGL/3D scenes drive their own GPU phases off the shared playhead.
  (node as any).__tick?.(t);
  const base = SCENES[sceneIndex].t;
```
`updateSceneReveals(t)` is called every frame from `applyBeats` (main.ts:404) which is called every frame from `tick` (main.ts:667). So `__tick(t)` receives the playhead every rAF — and because `t` is `video.currentTime`, it is identical under play AND scrub (fully reversible; see §3).

### Edit B — cleanup in the straggler loop

`web/src/main.ts`, lines 273–276.

OLD (main.ts:273–276):
```ts
  existing.forEach((c) => {
    gsap.killTweensOf(c);
    c.remove();
  });
```
NEW:
```ts
  existing.forEach((c) => {
    gsap.killTweensOf(c);
    (c as any).__cleanup?.();
    c.remove();
  });
```

### Edit C — cleanup on the wall-clock removal of the crossfaded node

`web/src/main.ts`, line 281. The crossfade tween (line 279) stays untouched; cleanup is paired with the actual detach.

OLD (main.ts:281):
```ts
    window.setTimeout(() => old.remove(), 420);
```
NEW:
```ts
    window.setTimeout(() => {
      (old as any).__cleanup?.();
      old.remove();
    }, 420);
```

That is the complete set of main.ts edits: **one `__tick` call (Edit A) and two `__cleanup` calls (Edits B, C)** — one cleanup at each of the two real removal sites. The crossfade tween (path 2) needs no edit because it doesn't detach the node.

**Edge note for the implementer (no code change required, but flag it):** during fast scrubbing two scenes can briefly coexist (`old` fading for up to 420 ms while the new node is live). The new WebGL controller should create its renderer in its own constructor and never assume it's the only canvas. The `__cleanup` on `old` fires after 420 ms regardless, so at most one stale renderer lingers, then is disposed. This matches the existing "robust against fast scrubbing" comment at main.ts:270.

---

## 3. Reveal system coexistence with GPU-driven phases (reversible under scrubbing)

The DOM reveal system (`primeReveals` sets `[data-reveal]` to `autoAlpha:0`+blur at main.ts:222–225; `updateSceneReveals` toggles `is-in` by comparing `t` to each part's `data-at`/base at main.ts:250–262) and the GPU phase system are **orthogonal**, and that is the design:

- **Keep exactly two DOM `[data-reveal]` targets** on the new scene root:
  1. The **canvas container** (`<div class="asr3d-canvas" data-reveal>`), with NO `data-at`, so it inherits the scene base time `142.75` (SCENES[0].t, scenes.ts:203). This gives the whole 3D surface the standard blur-in/`y:22→0` entrance the moment the ASR scene mounts — identical to every other scene's first part.
  2. The **`.scene-cap`** (`reveal(el("div","scene-cap", …), 145.5)` via the existing `cap()` helper, scenes.ts:37–39), pinned to `145.5`, matching the current `asrScene`'s caption time (scenes.ts:60).

- **Everything inside the canvas** (the waveform → flow → lines → burst phases) is NOT a `[data-reveal]`. `updateSceneReveals` will never see those — they live entirely in the shader/scene graph, advanced by `__tick(t)` against these thresholds, mapping 1:1 onto the original DOM beats:
  - `142.75` (SCENES[0].t / `.VTT file` words) → **waveform** appears (audio in)
  - `143` (old `asr-arrow` `data-at`, scenes.ts:58) → **flow** (audio → transcript transition)
  - `144` (old `asr-lines` `data-at`, scenes.ts:59) → **lines** (transcript draws in)
  - `145.5` (old caption `data-at`, scenes.ts:60) → **burst** (settle/accent flourish), coincident with the DOM `.scene-cap` reveal

- **Reversibility:** `__tick(t)` must be a **pure function of `t`** — it computes each phase's progress as `smoothstep`/`clamp(t − threshold)` and writes uniforms; it must NOT accumulate state or use wall-clock deltas for *phase position* (idle shimmer may use wall-clock, but the phase envelope is driven by `t`). Because `t = video.currentTime` (main.ts:664) is the same value forward and backward, scrubbing left re-derives an earlier phase and the visual rewinds — exactly like the DOM `is-in` toggle removing a class and calling `hideReveal` (main.ts:258–259). The canvas container's own blur-in (managed by GSAP via `primeReveals`/`showReveals`/`hideReveal`) is fully reversible already, so the container fades out if you scrub before `142.75`. Confirmed reversible.

One subtlety to honor: `primeReveals` (main.ts:224) sets `filter: blur(8px)` and GSAP animates `filter`/`autoAlpha` on the **canvas container div**, not the canvas pixels — so the entrance blur composites over the live GL canvas correctly without touching the renderer.

---

## 4. Container facts the WebGL scene must respect

From `style.css` and the deck layout:

- **`.scene-stage`** (style.css:387–391) is `position:relative; flex:1 1 auto; min-height:300px`. Mobile (`@media (max-width:819px), (orientation:portrait) and (max-width:1024px)`, the block starting style.css:1352) overrides `min-height:210px` (style.css:1365–1367). The canvas must size to *this* element's measured box, not the viewport — height is flex-driven and varies.
- **`.scene`** (style.css:392–400) is `position:absolute; inset:0; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:clamp(18px,3vh,34px)`. So the scene root is a flex column; the canvas container is one flex child and the `.scene-cap` is another beneath it. The canvas container needs an explicit size (e.g. `width:100%` + a height, or `flex:1`) because a raw `<canvas>` in a flex column has no intrinsic block size.
- **Deck position:** desktop the deck sits to the **right** of the video (`.deck { left: calc(var(--video-x) + var(--video-w) + 4.5vw); right:5vw }`, style.css:319–333). Mobile the deck is **below** the video (`top: calc(var(--video-y) + var(--video-h) + 16px); bottom:86px`, style.css:1353–1361) and `overflow-y:auto`. The scene-stage width therefore differs a lot between layouts and changes on resize/orientation and during the dock animation.
- **Sizing mechanism — `ResizeObserver` (required):** observe the canvas container (or `.scene-stage`) and on every callback set renderer size + camera aspect from the measured `clientWidth/clientHeight`, clamped to `devicePixelRatio` (cap at 2 for perf). Do NOT listen to `window.resize` alone — the box changes during the GSAP dock tween (main.ts:208) without a window resize event, and flex reflow from sibling reveals can change height. Disconnect the `ResizeObserver` in `__cleanup`.
- **Language (`lang`) effect — caption text ONLY.** The waveform/flow/lines/burst are language-agnostic; the only localized string is the caption (`"audio → transcript"` / `"语音 → 字幕"`, scenes.ts:60). 
- **Rebuild on language change:** `applyLang` (main.ts:421–424) calls `swapScene(sceneIndex, true)` then `updateSceneReveals(...)`. With `force=true`, `swapScene` runs the full teardown (straggler loop + crossfade + 420 ms removal) and `build(lang)` again. So a language flip = full **dispose + recreate** of the WebGL controller. This means dispose MUST be clean and idempotent (renderer.dispose + dispose all geometries/materials/textures + cancelAnimationFrame + ResizeObserver.disconnect + null the canvas), because it happens not just on scene change but on every EN↔中文 toggle while the ASR scene is on screen (including the scripted auto-flip at `BEATS.translate=165.5`, though by then ASR is no longer the active scene — still, a viewer scrubbed back to ~143 who taps the language picker triggers it).

---

## 5. Design tokens to feed the shader (exact `:root` hex values, style.css:10–53)

| Token | Value | Suggested shader use |
|---|---|---|
| `--bg` | `#f7f4ee` | clear color / fog / background plane |
| `--surface` | `#fbf9f4` | lighter panel / line fill |
| `--surface-2` | `#f1ede4` | secondary fill |
| `--accent` | `#c25450` | primary waveform / particle color |
| `--accent-ink` | `#9c3f3c` | darker accent, burst peaks, caption color |
| `--accent-soft` | `rgba(194,84,80,0.1)` | glow halo (note: rgba, not hex) |
| `--fg` | `#1a1614` | strongest ink (transcript lines) |
| `--fg-2` | `#3a3530` | secondary ink |
| `--fg-muted` | `#6b6660` | muted ink |
| `--fg-faint` | `#a8a299` | faint ink (arrow/flow ghost) |
| `--hairline` | `#e6e1d7` | hairline |
| `--hairline-strong` | `#d6cfc0` | line rails / inactive bars |
| `--green` | `#2f6b4c` | (loop scene only — not ASR) |

Fonts (style.css:11–14), if the shader rasterizes any glyphs/labels — prefer keeping all text in the DOM `.scene-cap` and *not* in WebGL:
- `--font-serif`: `"Instrument Serif", "Times New Roman", Georgia, serif`
- `--font-sans`: `"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`
- `--font-mono`: `"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace` (the caption uses mono)
- `--font-hand`: `"Caveat", cursive`

Recommendation: read these at controller construction via `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()` and parse to `THREE.Color`, rather than hardcoding — keeps the shader in lockstep if tokens change. Hardcoded fallbacks should be the values above.

---

## 6. New file `web/src/engine/asr3d.ts` + how `asrScene` calls it

**File location:** `/home/ssun/developer/llm-presentation-claude-pending-9d5bcd0f/web/src/engine/asr3d.ts` (sibling of `scenes.ts`, `vtt.ts`).

**Controller contract:**
```ts
// web/src/engine/asr3d.ts
import * as THREE from "three";

export interface Asr3DController {
  tick(t: number): void;   // pure function of playhead t — drives phases
  dispose(): void;         // renderer.dispose + dispose geo/mat/tex + cAF + RO.disconnect
}

const PHASE = { wave: 142.75, flow: 143, lines: 144, burst: 145.5 } as const;

function tokenColor(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/** Mounts a WebGL ASR visual into `container`. Caller owns the container's
 *  [data-reveal] entrance; this only renders inside it. */
export function mountAsr3D(container: HTMLElement, reduceMotion: boolean): Asr3DController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0); // transparent → paper bg shows through
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);

  // colors from :root tokens (see §5)
  const cAccent   = tokenColor("--accent", "#c25450");
  const cAccentIn = tokenColor("--accent-ink", "#9c3f3c");
  const cInk      = tokenColor("--fg", "#1a1614");
  const cHair     = tokenColor("--hairline-strong", "#d6cfc0");
  void cAccentIn; void cInk; void cHair; // wire into materials/uniforms

  // … build waveform / flow / lines / burst meshes + shader uniforms here …

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.left = -w / h; camera.right = w / h; camera.updateProjectionMatrix();
  });
  ro.observe(container);

  let raf = 0;
  let lastT = PHASE.wave;
  const start = performance.now();
  const render = () => {
    const idle = reduceMotion ? 0 : (performance.now() - start) / 1000; // shimmer only
    // phase envelopes are PURE functions of lastT (reversible under scrub):
    const p = (a: number, b: number) => Math.min(1, Math.max(0, (lastT - a) / (b - a)));
    void p(PHASE.wave, PHASE.flow);   // wave→flow
    void p(PHASE.flow, PHASE.lines);  // flow→lines
    void p(PHASE.lines, PHASE.burst); // lines→burst
    void idle;
    // … set uniforms from those, then: renderer.render(scene, camera) …
    renderer.render(scene, camera);
    raf = requestAnimationFrame(render);
  };
  raf = requestAnimationFrame(render);

  return {
    tick(t: number) { lastT = t; },   // store playhead; render() reads it (reversible)
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o: any) => { o.geometry?.dispose?.(); 
        (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m: any) => m.dispose?.()); });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

**Changed `asrScene` in `scenes.ts`** — build a root + canvas container, mount the controller, attach `__tick`/`__cleanup` to the root, keep the caption as a DOM `[data-reveal]`, and fall back to the 2D scene (see §7):
```ts
import { mountAsr3D } from "./asr3d";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function asrScene(lang: Lang): HTMLElement {
  // Fallback to the proven 2D DOM scene when WebGL is off or motion is reduced.
  if (REDUCE_MOTION || !webglAvailable()) return asrScene2D(lang);

  const root = el("div", "scene scene--asr scene--asr3d");
  const canvas = el("div", "asr3d-canvas");          // single [data-reveal], base time 142.75
  reveal(canvas);                                     // no data-at → inherits SCENES[0].t
  root.append(canvas);
  root.append(cap(lang, "audio → transcript", "语音 → 字幕", 145.5)); // DOM caption, reveals @145.5

  const ctrl = mountAsr3D(canvas, REDUCE_MOTION);
  (root as any).__tick = (t: number) => ctrl.tick(t);     // consumed by updateSceneReveals (Edit A)
  (root as any).__cleanup = () => ctrl.dispose();          // consumed by Edits B & C
  return root;
}
```
`__tick` and `__cleanup` are plain properties on the root `HTMLElement`; the duck-typed `(node as any).__tick?.()` / `__cleanup?.()` calls in main.ts pick them up automatically. The seven other scenes never set them, so they no-op.

`.asr3d-canvas` needs CSS so it fills the flex slot (add to style.css, near the `.scene--asr` block at style.css:469):
```css
.scene--asr3d .asr3d-canvas { width: 100%; flex: 1 1 auto; min-height: 120px; position: relative; }
.scene--asr3d .asr3d-canvas canvas { width: 100%; height: 100%; display: block; }
```

---

## 7. Fallback plan — preserve the existing 2D scene verbatim

If WebGL is unavailable OR `REDUCE_MOTION` is true, `asrScene` returns the existing DOM scene. Preserve the **current `asrScene` body verbatim**, renamed to `asrScene2D`. This is the exact current implementation (scenes.ts:49–62) — keep it byte-for-byte so the reduced-motion / no-GL path is the already-shipped, already-tested visual:

```ts
function asrScene2D(lang: Lang): HTMLElement {
  // "show this teleprompter ... the .VTT file that's transcribed from this
  // video" — audio becomes a transcript, drawn from the top down.
  const root = el("div", "scene scene--asr");
  let bars = "";
  for (let i = 0; i < 22; i++) bars += `<span style="--i:${i}"></span>`;
  root.append(reveal(el("div", "asr-wave", bars))); // base 142 ".VTT file"
  root.append(reveal(el("div", "asr-arrow", "↓"), 143));
  const lines = el("div", "asr-lines");
  lines.append(el("span", "ln w1"), el("span", "ln w2"), el("span", "ln w3"));
  root.append(reveal(lines, 144));
  root.append(cap(lang, "audio → transcript", "语音 → 字幕", 145.5));
  return root;
}
```
Rationale for routing `REDUCE_MOTION` here too: `primeReveals`/`showReveals`/`hideReveal` already special-case `REDUCE_MOTION` (main.ts:224, 228–230, 237–240), and the global `@media (prefers-reduced-motion: reduce)` rule (style.css:1410–1416) kills all CSS animation — so the 2D fallback degrades to a clean static diagram, which is the correct reduced-motion behavior. The fallback path keeps the original `scene--asr` class (no `scene--asr3d`), so all existing `.scene--asr .asr-wave/.asr-lines/...` CSS (style.css:469–530) applies unchanged. The 2D scene defines no `__tick`/`__cleanup`, so the hooks no-op and nothing needs disposal — `c.remove()` alone is correct for it.

---

## Edit summary (line-accurate, for the implementer)

- `web/src/main.ts`
  - Edit A — insert `(node as any).__tick?.(t);` after line 247 (the guard) in `updateSceneReveals`.
  - Edit B — add `(c as any).__cleanup?.();` before `c.remove();` in the straggler loop (lines 273–276).
  - Edit C — wrap line 281 `window.setTimeout(() => old.remove(), 420);` to call `(old as any).__cleanup?.();` before `old.remove()`.
- `web/src/engine/scenes.ts`
  - Add `import { mountAsr3D } from "./asr3d";`, a `webglAvailable()` helper, and a module-level `REDUCE_MOTION`.
  - Rename current `asrScene` (lines 49–62) to `asrScene2D` (verbatim, §7).
  - Add new `asrScene` (§6) that branches to `asrScene2D` on fallback, else builds the 3D root + container + caption and attaches `__tick`/`__cleanup`.
  - `SCENES[0]` (scenes.ts:203) still references `asrScene` by name — no change needed.
- `web/src/engine/asr3d.ts` — new file (§6), exports `mountAsr3D(container, reduceMotion): Asr3DController`. Uses already-installed `three@^0.171.0`.
- `web/src/style.css` — add `.scene--asr3d .asr3d-canvas { width:100%; flex:1 1 auto; min-height:120px; position:relative; }` and its `canvas { width:100%; height:100%; display:block; }`, near the `.scene--asr` block (style.css:469). Respect `.scene-stage` `min-height` 300/210 (style.css:391 / 1365–1367); the canvas sizes to its container via `ResizeObserver`, not the viewport.

No `package.json` change required (three.js already present).