# ASR Scene → 3D Frosted-Glass Waveform (Design Synthesis)

Date: 2026-06-13
Status: Current
Area: supporting-art redesign, 3D scene design, shaders, phase timeline, mouse interaction, performance budget
Sources: Reconciles the three 2026-06-13 research briefs (igloo techniques, three.js performance, integration spec)

## Revision — 2026-06-13 (post-review feedback)

After the first interactive review, three changes refined the plan (implemented in
`web/src/engine/asr3d.ts`):

1. **Real waveform.** The slabs no longer animate on a synthetic sine. We bake the
   recording's actual amplitude envelope (`web/scripts/gen-waveform.py` →
   `web/src/data/intro.peaks.json`, peak-per-10ms) and scroll a ~1.4s window of it
   across the slabs, indexed by the playhead — so the bars match what's being said,
   and it stays a pure function of `t` (a live `AnalyserNode` was rejected because it
   can't be scrubbed backward).
2. **Real transcript text via invisible ink.** The three generic "dotted lines" are
   replaced by the *actual* current `.vtt` cue, rendered to an offscreen canvas, its
   glyph pixels sampled into particle home positions. Each cue's particles develop
   from a scattered haze into legible words (iMessage invisible-ink) over `REVEAL`
   seconds from the cue's start. Cue layouts are cached; nothing is hardcoded.
3. **Mouse disrupts the text, not the camera.** Parallax is removed — the camera is a
   fixed 3/4 pose. The cursor now adds animated random-noise jitter + a radial
   repulsion to nearby text particles (igloo's closing page), which snap back to
   legible text when it leaves.

The original synthesis below remains the architectural baseline (object graph,
shaders, lifecycle, perf budget, main.ts hooks, fallbacks).

---

All of Brief C's line references and tokens are confirmed accurate against the live repo, with one critical exception: **three.js is not installed** (Brief C and Brief B both wrongly assumed it was present). Every other integration fact — main.ts:245-248/271-282, SCENES[0] at t=142.75, the `--accent #c25450` / `--accent-ink #9c3f3c` / `--bg #f7f4ee` tokens, the `.scene-stage min-height 300/210` — is correct. I have everything needed to write the reconciled plan.

---

# ASR Scene → Frosted-Glass 3D Waveform: Final Implementation Plan

## Reconciliation summary (where the briefs conflict, and my rulings)

| Conflict | Briefs | Ruling | Why |
|---|---|---|---|
| **Glass material** | A: `MeshPhysicalMaterial.transmission` + envMap. B: hand-written `RawShaderMaterial` fresnel, *no* transmission. | **B wins — hand-written `RawShaderMaterial`.** | On a ~500px **light/paper** bg, transmission mostly refracts the bright paper (low contrast, "grey box"), forces an extra full-scene render pass + mandatory envMap, and is hard to make scrub-reversible from a single uniform. The igloo *read* on warm paper comes from the **terracotta fresnel rim + internal gradient + frost noise**, which B authors directly for ~30 fragment instructions. I keep A's *fresnel formula* and *mouse-proximity frost* ideas, implemented in B's cheap shader. |
| **Closing effect** | A: GPGPU/FBO ping-pong particle sim (curl noise, DataTexture targets). B: stateless `THREE.Points` driven purely by `uProgress`. | **B wins — stateless `Points`.** | The presentation is **scrubbable**: `t = video.currentTime` runs forward AND backward (Brief C §3). A GPGPU sim integrates state per-frame and **cannot rewind**. B's "everything is a pure function of `uProgress`" is mandatory here. I drop curl-noise FBO entirely. |
| **Blending** | A: `AdditiveBlending` for particle glow. B: `NormalBlending`/`CustomBlending` SrcAlpha·OneMinusSrcAlpha with a bright core. | **B wins — NormalBlending + bright warm core.** | Additive on `#f7f4ee` paper washes warm particles to white. A's additive assumes igloo's near-black bg. |
| **Camera** | A: perspective, small dolly. B: implies perspective (`gl_PointSize` size attenuation, parallax). C: `OrthographicCamera`. | **Perspective (fov 35), overriding C.** | Parallax tilt + point-size attenuation (the depth cue that sells "3D") need perspective. C's ortho stub is a placeholder; I replace it. Camera barely moves (A's "object tilt does the 3D work"). |
| **Damping factor** | A: `0.05–0.12` fixed lerp. B: `1 - exp(-λdt)`, λ≈8 pointer / λ≈4 camera. | **B — frame-rate-independent exp damping.** | Deck runs at variable rAF under scrub; fixed lerp drifts with fps. |
| **three.js installed?** | B & C: "already a dependency, no install." | **WRONG — must install.** Verified: only `gsap` is in `web/package.json`; `web/node_modules/three` absent. | See step 0 below. |
| **Loop strategy** | A: on-demand `invalidate()`. B: always-on rAF gated by IntersectionObserver. C: bare `requestAnimationFrame` in `render()`. | **B's gated rAF**, but also honor C's `tick(t)` contract (the deck already calls per-frame). Pause via IntersectionObserver + visibilitychange. | A's pure on-demand conflicts with the deck's existing per-frame `updateSceneReveals` drive; B's gating is the right middle ground. |

---

## 1. VISUAL CONCEPT

A row of **frosted-glass slabs** stands on the paper like a graphic-equalizer carved from ice — each slab a column of the speaker's voice, breathing with a travelling sine wave, edges glowing terracotta where the light catches them (fresnel rim against warm paper). As the playhead crosses "transcribed," the sound **crystallizes**: warm motes lift off the slab tops, arc downward, and **settle into three glowing transcript lines** — the voice literally freezing into text. A final accent burst puffs the motes outward as the caption "audio → transcript" lands. The whole surface has glassy inertia: it tilts toward your cursor, and frost *clears/sharpens* under the pointer while staying milky elsewhere. Palette is igloo's spirit (frosted volume, fresnel halo, particle glow) but inverted to **warm paper `#f7f4ee` + terracotta `#c25450` rim/particles + dark-ink `#1a1614` transcript** — no icy blue anywhere; the only "cool" is a faint aqua-white glass core (`#dbeaf0`, optional) for complementary pop, kept subtle.

---

## 2. THREE.JS OBJECT GRAPH

```
Scene  (clearColor 0x000000 alpha 0 — paper bg shows through canvas)
├─ InstancedMesh  "slabs"            1 draw call
│    geometry : RoundedBoxGeometry(1,1,1, 2, 0.18)  ~200 tris  (or BoxGeometry if RoundedBox import unwanted)
│    material : RawShaderMaterial (glass)  transparent, depthWrite:false, depthTest:true, side:DoubleSide, NormalBlending
│    count    : COUNT = 22 desktop / 14 mobile      (matches the 22 bars in the 2D scene)
│    per-instance attrs: instanceMatrix (built-in mat4) + aIndex(float) + aSeed(float)
│    instanceMatrix.setUsage(StaticDrawUsage)  — laid out ONCE, never per-frame
├─ Points  "particles"               1 draw call
│    geometry : BufferGeometry — aStart(vec3, =position), aSeed, aBirth, aTargetLine, aLane(vec2)
│    count    : P = 5000 desktop / 1800 mobile
│    material : ShaderMaterial transparent, depthWrite:false, depthTest:false, NormalBlending, bright core
├─ (transcript lines): NOT separate meshes — the 3 lines are the *settle targets* of the
│    particles (aLane.y ∈ {line0,line1,line2}). The "line draws in" beat = particles converging
│    onto each lane. (Saves a draw call; the line IS the particle density.)  +0 draw calls
└─ no lights, no env map, no shadows, no post-processing.
```

**Draw-call budget: 2 total.** Triangles: slabs ≤ ~4.4k (22×200) or 264 (BoxGeometry), particles 0. Per-frame CPU cost: ~5 uniform writes (`uTime`, `uMouse`, `uHoverK`, `uPhase`-derived, `uCameraPos`) — **independent of slab/particle count**. No `setMatrixAt` loop, no `needsUpdate` churn, no FBO, no render target.

**Camera:** `PerspectiveCamera(fov 35, aspect, 0.1, 100)`, positioned `(0, 0, 4.2)` looking at origin. Slab row spans x∈[-2.9, 2.9] (spacing 0.27, width 0.18). Transcript lanes at y ∈ {-0.55, -0.78, -1.0} (below the waveform baseline y=-0.2). Decide framing so the full row + 3 lanes fit the tall mobile box and the wide desktop box (camera z and fov tuned in `resize()` if aspect < 1, nudge z out).

**Lights/env:** none. The glass look is fully shader-authored (fresnel + gradient + frost), so no `MeshPhysicalMaterial`, no PMREM, no HDRI — eliminates A's biggest cost on a small panel.

---

## 3. SHADERS

### (a) Glass slab — `RawShaderMaterial`

RawShaderMaterial provides **no** auto uniforms/attributes — declare everything. `instanceMatrix` is still injected as a built-in `mat4` attribute for InstancedMesh.

**Vertex (key lines):**
```glsl
precision highp float;
uniform mat4 projectionMatrix, viewMatrix, modelMatrix;
uniform vec3 uCameraPos;
uniform float uTime, uHoverK, uWaveAmp, uWaveFreq, uWaveSpeed, uFormP; // uFormP: 0..1 "wave has formed"
uniform vec2 uMouse;                 // cursor in field-plane local coords (z=0)
attribute vec3 position, normal;
attribute mat4 instanceMatrix;       // built-in for InstancedMesh
attribute float aIndex, aSeed;
varying vec3 vNW, vVW; varying vec2 vLUV; varying float vLift, vSeed;

void main(){
  vec3 instPos = instanceMatrix[3].xyz;                  // column X from the static matrix
  float phase  = instPos.x * uWaveFreq - uTime * uWaveSpeed;
  float wave   = sin(phase) * 0.5 + 0.5;                 // 0..1 travelling wave
  float audio  = mix(0.20, 1.0, wave) * uWaveAmp * uFormP; // height; uFormP grows slab in on the 142.75 beat
  float dx     = instPos.x - uMouse.x;
  float hover  = exp(-dx*dx*6.0) * uHoverK;              // gaussian column proximity
  float h = audio + hover * 0.35;                        // hover LIFT
  vec3 p = position;  p.y = (p.y + 0.5) * h;             // grow upward from base
  vLUV = vec2(position.x, position.y + 0.5);  vLift = hover;  vSeed = aSeed;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p,1.0);
  wp.xz += vec2(uMouse.x, 0.0) * 0.04 * p.y;             // subtle parallax lean
  vNW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vVW = normalize(uCameraPos - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
```

**Fragment (key lines — terracotta fresnel on warm paper, frost clears near cursor):**
```glsl
precision highp float;
uniform vec3 uPaper, uGlassTint, uRim; uniform float uBaseAlpha, uTime;
varying vec3 vNW, vVW; varying vec2 vLUV; varying float vLift, vSeed;
float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }

void main(){
  vec3 N=normalize(vNW), V=normalize(vVW);
  float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 3.0);          // fresnel rim (A's formula)
  float grad = smoothstep(1.0,0.0,vLUV.y)*0.6 + 0.2;            // bright core near base
  float frost = mix(0.85,1.0, hash(floor(vLUV*40.0)+vSeed*17.0));// frosted micro-noise
  frost = mix(frost, 1.0, vLift);                               // hover CLEARS frost (sharpens)
  float refr = N.x*0.5+0.5;                                     // fake-thickness tint shift
  vec3 core  = mix(uGlassTint, uGlassTint*vec3(0.92,0.97,1.04), refr) * grad * frost;
  vec3 col   = mix(core, uRim, fres*0.8);                       // terracotta edge
  col += uRim * vLift * 0.6;                                    // hover glow
  col = mix(col, uPaper, 0.10);                                 // seat into paper, no harsh edge
  float alpha = clamp(uBaseAlpha + fres*0.55 + vLift*0.25, 0.0, 0.95);
  gl_FragColor = vec4(col, alpha);                              // three.js encodes linear→sRGB
}
```
Material: `transparent:true, depthWrite:false, side:DoubleSide, blending:NormalBlending` (additive blows out on white). `uBaseAlpha ≈ 0.18`. **Color management (r171):** output is sRGB, `ColorManagement.enabled` default true, shader emits **linear** — author every uniform color as `new THREE.Color(hex).convertSRGBToLinear()` before upload, or terracotta reads muddy.

### (b) Particles — `ShaderMaterial`, pure `uProgress`

**Vertex (key lines — stateless, reversible):**
```glsl
uniform float uProgress, uTime, uPixelRatio, uSize;
attribute float aSeed, aBirth, aTargetLine; attribute vec2 aLane;
varying float vAlpha, vSeed;
void main(){
  vSeed=aSeed;
  float local = clamp((uProgress - aBirth)/0.35, 0.0, 1.0);
  float e = local*local*(3.0-2.0*local);                   // smoothstep ease
  vec3 startPos = position;                                 // slab-top origin
  vec3 target   = vec3(aLane.x, aLane.y, 0.0);             // settle on transcript lane
  vec3 pos = mix(startPos, target, e);
  pos.y   -= sin(e*3.14159)*0.15;                          // gravity arc (dip then settle)
  pos.x   += (aSeed-0.5)*(1.0-e)*0.3;                      // drift collapses as it settles
  pos.x   += sin(uTime*2.0 + aSeed*30.0)*0.004*e;          // idle shimmer (wall-clock OK; non-narrative)
  float burst = smoothstep(0.9,1.0,uProgress)*(1.0 - smoothstep(0.97,1.0,uProgress));
  vec2 dir = normalize(vec2(aSeed-0.5, fract(aSeed*7.3)-0.5)+1e-4);
  pos.xy += dir * burst * 0.25;                            // end accent puff
  vAlpha = e * (0.4 + 0.6*(1.0-burst));
  vec4 mv = modelViewMatrix * vec4(pos,1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixelRatio * (1.0 / -mv.z);      // size attenuation (needs perspective)
}
```

**Fragment (soft round, light-bg-safe glow):**
```glsl
uniform vec3 uParticle; varying float vAlpha, vSeed;
void main(){
  vec2 uv = gl_PointCoord*2.0-1.0; float d=dot(uv,uv);
  float mask=smoothstep(1.0,0.0,d), core=smoothstep(0.4,0.0,d);
  vec3 col = mix(uParticle, vec3(1.0,0.96,0.9), core*0.5);   // hot warm center = "glow" without additive
  float a = mask*vAlpha; if(a<0.01) discard;
  gl_FragColor = vec4(col, a);
}
```
Material: `transparent:true, depthWrite:false, depthTest:false, blending:NormalBlending`. `uParticle = --accent #c25450` linearized. Reverse-scrub re-derives an earlier `uProgress` → particles fly back to the slabs. Fully reversible.

---

## 4. PHASE TIMELINE (driven by `tick(t)`, pure function of `t`)

`tick(t)` only stores `lastT = t`; the rAF `render()` derives all envelopes from `lastT` each frame so play and scrub are identical. Helper: `p(a,b) = clamp((lastT-a)/(b-a), 0, 1)`, then `ease = smoothstep` (`x*x*(3-2x)`).

| Playhead `t` | Beat (matches 2D `data-at`) | Uniform | Value |
|---|---|---|---|
| **142.75** (SCENES[0].t, ".VTT file") | **Waveform forms** | `uFormP` | `smoothstep(p(142.75, 143.0))` — slabs grow from 0 height, wave starts |
| **143** (old `asr-arrow`) | **Particles lift & stream** | `uProgress` ramp begins | `uProgress = smoothstep(p(143.0, 145.5))` mapped so motes lift here |
| **144** (old `asr-lines`) | **Lines coalesce** | (same `uProgress`) | by `t=144`, `uProgress≈0.45` → most particles mid-arc/landing on lanes |
| **145.5** (old caption) | **Burst + caption** | `uProgress → 1`, burst window | `uProgress` reaches ~0.9–1.0 → `smoothstep(0.9,1.0,uProgress)` fires the puff; DOM `.scene-cap` reveals in parallel |

Concretely in `render()`:
```ts
const sm = (x:number)=>{x=Math.min(1,Math.max(0,x)); return x*x*(3-2*x);};
const formP  = sm((lastT - 142.75) / 0.35);                 // wave grows in
const prog   = sm((lastT - 143.0) / (145.5 - 143.0));       // 143→145.5 reveal arc
slabU.uFormP.value  = formP;
slabU.uWaveAmp.value = 0.55 * formP + 0.45;                 // wave amplitude eases in
partU.uProgress.value = prog;
slabU.uHoverK.value  = baseHover * (1 - sm((lastT-144.5)/1.0)); // calm hover as transcript forms
```
- **Easing**: all phase envelopes use `smoothstep` (C¹, no velocity pop on scrub). Mouse/camera use exp-damp (§5) but that's idle motion, not phase.
- **Reversibility guarantee**: phase position never reads `performance.now()`. Only `uTime` (idle shimmer/wave breathe) uses wall-clock, and that's non-narrative — scrubbing left still rewinds the heights, the arc, the lines, and the burst exactly.

---

## 5. MOUSE INTERACTION

```ts
// pointer → NDC (panel rect, not window) → field plane z=0
const r = renderer.domElement.getBoundingClientRect();
ndc.x = ((e.clientX-r.left)/r.width)*2-1;
ndc.y = -((e.clientY-r.top)/r.height)*2+1;
ray.setFromCamera(ndc, camera);
ray.ray.intersectPlane(planeZ0, hit);          // planeZ0 = new THREE.Plane(0,0,1, 0)
mouseTarget.set(hit.x, hit.y);                  // local coords == instPos.x space
// pointerleave → mouseTarget.set(0,0)
```
Per frame, frame-rate-independent damping `cur += (tgt-cur)*(1-exp(-λ*dt))`:
- **Pointer glow** `λ = 8` (snappy) → `uMouse`.
- **Camera parallax** `λ = 4` (lazier inertia): `camera.position.x += (mouseDamped.x*0.15 - camera.position.x)*(1-exp(-4dt))`, same for y×0.10, then `camera.lookAt(0,0,0)` and update `uCameraPos`.

Effects:
- **Parallax tilt range**: slab lean via `wp.xz += uMouse.x*0.04*p.y` ≈ visually ±8–10° at slab tops; camera offset adds a few more degrees of perceived rotation. Kept ≤0.3 rad (restraint = the igloo read).
- **Per-slab hover lift/glow**: gaussian `exp(-(instPos.x-uMouse.x)²·6.0)·uHoverK` — falloff radius ≈ ±0.4 world units (~3 columns). Drives `+0.35` height lift and `+0.6·rim` glow.
- **Frost intensifies/clears near cursor**: `frost = mix(frost, 1.0, vLift)` — under the pointer frost → clear/sharp; away it stays milky (A's "clears under mouse" idea, B's cheap impl). Optional: nudge `uBaseAlpha` down near cursor for a "thinning" feel.
- Idle breathe: `uWaveAmp += sin(uTime*0.3)*0.02` so a still mouse never looks frozen.

---

## 6. PERF BUDGET & LIFECYCLE

- **DPR cap `Math.min(devicePixelRatio, 2)`** per Brief C §4; B argues 1.5 is the sweet spot — **use 1.5 as the working cap, 2 only if measured headroom.** Biggest knob for a transparency-heavy panel (overdraw, not vertices, dominates at 500px). Mobile / small container → drop to 1.0 if frames slip.
- **`antialias: true`** — cheap at this canvas size, helps glass edges read crisply on paper.
- **`alpha: true`, `setClearColor(0x000000, 0)`** — transparent canvas so CSS paper bg + the GSAP entrance-blur on the container div composite over the live GL correctly.
- **Adaptive complexity by container size** (measured in `resize`): `COUNT = w < 360 ? 14 : 22`; `P = w < 360 ? 1800 : 5000`. Rebuild geometry only if the tier crosses (debounced), not every resize tick.
- **Loop gating**: `IntersectionObserver(threshold 0.01)` start/stop rAF when the panel scrolls in/out (mobile deck is `overflow-y:auto`); `visibilitychange` stop on hidden tab; clamp `dt ≤ 0.05` after stalls. `tick(t)` from the deck only stores `lastT` (so the deck's per-frame call is ~free); the internal rAF renders.
- **`ResizeObserver` on the canvas container** (NOT `window.resize`): the box changes during the GSAP dock tween (main.ts:208) and on flex reflow with no window event. On callback: `renderer.setSize(w,h,false)`, `camera.aspect=w/h`, `updateProjectionMatrix()`, `uPixelRatio` update, nudge camera z out if `aspect<1` (tall mobile). Render one frame if paused.
- **Pre-warm**: `renderer.compile(scene, camera)` before first reveal so first interaction doesn't hitch.
- **Full dispose** (the leak-killer — fires at every removal site, see §7): `cancelAnimationFrame`; `ro.disconnect()`; `io.disconnect()`; remove pointer listeners; `webglcontextlost/restored` listeners; `scene.traverse` → `geometry.dispose()` + each `material.dispose()` (+ any texture uniforms, though we have none); `renderer.dispose()`; **`renderer.forceContextLoss()`** (without it, browsers cap ~16 live contexts and the Nth panel silently fails — and this scene rebuilds on every EN↔中文 toggle); `renderer.domElement.remove()`; null refs. Idempotent.
- **Target**: 60fps on a laptop iGPU at 500×500–600×900; degrades to fewer particles/slabs + DPR 1.0 on small mobile containers.

---

## 7. EXACT main.ts EDITS

Three edits, verified line-accurate against the live file.

**Edit A — `updateSceneReveals`, after the guard (currently line 247):**
```ts
function updateSceneReveals(t: number) {
  const node = sceneStage.lastElementChild as HTMLElement | null;
  if (!node || sceneIndex < 0) return;
  (node as any).__tick?.(t);          // ← ADD: WebGL scenes drive GPU phases off the shared playhead
  const base = SCENES[sceneIndex].t;
```

**Edit B — straggler-removal loop (currently lines 273–276):**
```ts
  existing.forEach((c) => {
    gsap.killTweensOf(c);
    (c as any).__cleanup?.();          // ← ADD
    c.remove();
  });
```

**Edit C — wall-clock removal of the crossfaded node (currently line 281):**
```ts
    window.setTimeout(() => {
      (old as any).__cleanup?.();      // ← ADD
      old.remove();
    }, 420);
```
That's all. DOM-only scenes never set `__tick`/`__cleanup`, so the duck-typed `?.()` calls no-op for the other 7 scenes — zero behavior change for them. (Note: during fast scrub two scenes can coexist for ≤420ms; the controller creates its own canvas and never assumes it's alone, and `__cleanup` on `old` always fires after 420ms, so at most one stale renderer lingers then is disposed.)

---

## 8. FILE PLAN

### Step 0 — install three.js (briefs were wrong; it is NOT present)
```bash
cd web && npm i three@^0.171.0 && npm i -D @types/three@^0.171.0
```

### `web/src/engine/asr3d.ts` (new) — module shape
Self-contained controller; framework-agnostic; visual state is a pure function of `(uTime, uMouse, uProgress)`.
```ts
import * as THREE from "three";
export interface Asr3DController { tick(t:number):void; resize?():void; dispose():void; }

const PHASE = { wave:142.75, flow:143, lines:144, burst:145.5 } as const;
function tokenColor(name:string, fb:string){               // read :root tokens, linearize
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v||fb).convertSRGBToLinear();
}
export function mountAsr3D(container:HTMLElement, reduceMotion:boolean): Asr3DController {
  // init:  hasWebGL guard already done by caller; build renderer(alpha,aa,DPR≤1.5),
  //        PerspectiveCamera(fov35, z4.2), Scene, InstancedMesh slabs + Points particles,
  //        read colors via tokenColor('--accent'|'--accent-ink'|'--fg'|'--hairline-strong'|'--bg'),
  //        compile, attach pointer + ResizeObserver + IntersectionObserver + visibility + ctx-loss.
  // update(): damp mouse+camera, derive formP/prog (§4) from lastT, write ~5 uniforms, render.
  // setPhase: folded into tick (lastT) — no separate scrubber API needed; deck drives via __tick.
  // resize(): setSize/aspect/uPixelRatio + adaptive COUNT/P tier.
  // dispose(): §6 full teardown (forceContextLoss included).
  return { tick(t){ /* lastT = t */ }, resize(){/*...*/}, dispose(){/*...*/} };
}
```
Internal surface maps to the brief's `init/update/setPhase/resize/dispose + mouse`, but **collapses `setPhase` into `tick(t)`** because the deck already pushes the playhead every frame — there is no separate scrubber; `t` *is* the scrub position. The internal `render()` (gated rAF) reads `lastT`.

### `web/src/engine/scenes.ts` — changed `asrScene`
- Add `import { mountAsr3D } from "./asr3d";`, a `webglAvailable()` helper, module-level `REDUCE_MOTION`.
- **Rename current `asrScene` (lines 49–62) → `asrScene2D`, byte-for-byte** (the shipped/tested fallback).
- New `asrScene`:
```ts
function asrScene(lang: Lang): HTMLElement {
  if (REDUCE_MOTION || !webglAvailable()) return asrScene2D(lang);   // fallback
  const root = el("div", "scene scene--asr scene--asr3d");
  const canvas = el("div", "asr3d-canvas");
  reveal(canvas);                                    // single [data-reveal], NO data-at → base 142.75
  root.append(canvas);
  root.append(cap(lang, "audio → transcript", "语音 → 字幕", 145.5)); // DOM caption stays, reveals @145.5
  const ctrl = mountAsr3D(canvas, REDUCE_MOTION);
  (root as any).__tick = (t:number) => ctrl.tick(t);  // consumed by Edit A
  (root as any).__cleanup = () => ctrl.dispose();      // consumed by Edits B & C
  return root;
}
```
`SCENES[0]` at scenes.ts:203 already references `asrScene` by name — no change. Caption stays in the DOM (not rasterized in WebGL), keeping the existing reveal/blur entrance and bilingual strings. The canvas container is the **only** WebGL `[data-reveal]`, so it inherits the standard blur-in/`y:22→0` entrance at base 142.75, fully reversible via GSAP — fade-out if scrubbed before 142.75. Everything *inside* the canvas is shader-driven and never seen by `updateSceneReveals`.

### `web/src/style.css` — additions near the `.scene--asr` block (line 469)
```css
.scene--asr3d .asr3d-canvas { width: 100%; flex: 1 1 auto; min-height: 120px; position: relative; }
.scene--asr3d .asr3d-canvas canvas { width: 100%; height: 100%; display: block; }
```
Canvas sizes to its flex container via ResizeObserver, honoring `.scene-stage` `min-height` 300 (desktop) / 210 (mobile, line 1366). The `.scene--asr3d` variant class means the existing `.scene--asr .asr-wave/.asr-lines/...` rules don't apply to the 3D root, and the 2D fallback (plain `scene--asr`) keeps them unchanged.

### Token wiring (exact hex, verified in `:root`)
`--bg #f7f4ee` → `uPaper`; `--accent #c25450` → `uRim` + `uParticle`; `--accent-ink #9c3f3c` → burst peak tint; `--fg #1a1614` → could deepen transcript-lane particle color as they settle; `--hairline-strong #d6cfc0` → inactive/baseline tone. Glass core `uGlassTint`: faint aqua-white `#dbeaf0` (complementary pop) **or** a warm `--surface #fbf9f4` if you want zero cool — designer's call; default to the subtle aqua for the "ice" read, all linearized via `tokenColor`.

---

## 9. FALLBACK

`asrScene` branches **before** touching WebGL:
- **WebGL missing** (`webglAvailable()` = `!!(canvas.getContext('webgl2') || getContext('webgl'))`, in try/catch) → return `asrScene2D(lang)`: the exact shipped 2D DOM scene (22 CSS bars, ↓ arrow, 3 transcript lines, caption), with its existing `.scene--asr` CSS and `data-at` reveals at 143/144/145.5. No GPU, no `__tick`/`__cleanup` (hooks no-op; plain `c.remove()` suffices).
- **`prefers-reduced-motion: reduce`** → same `asrScene2D` path. The global `@media (prefers-reduced-motion)` rule (style.css:~1410) plus `primeReveals/showReveals/hideReveal`'s existing `REDUCE_MOTION` special-casing degrade it to a clean static diagram showing the informative end state — correct reduced-motion behavior, zero animation loop.
- **Runtime context loss** (driver reset / long-backgrounded tab): `webglcontextlost` → `preventDefault()` + stop rAF; `webglcontextrestored` → rebuild GPU resources + restart. Never throws into a blank panel.
- **Defense in depth**: `mountAsr3D` itself is wrapped so a mid-init throw (context lost during build) is caught by `asrScene` and falls back to `asrScene2D`.

---

**Net deliverable for the implementer:** install three (step 0), create `web/src/engine/asr3d.ts` (~2 draw calls, 2 hand-written shaders, stateless `uProgress`-reversible particles, perspective camera, exp-damped mouse, IO/RO/visibility lifecycle, forceContextLoss dispose), rename `asrScene`→`asrScene2D` + add the new branching `asrScene` in `scenes.ts`, add 2 CSS rules, and apply the 3 line-accurate `main.ts` hooks (Edits A/B/C). All integration facts verified against the live repo; the only brief error corrected is that **three.js must be installed** (it is not currently a dependency).