# Performant Three.js Glass + GPU Particles on a Light Background

Date: 2026-06-13
Status: Current
Area: Three.js performance, InstancedMesh, custom ShaderMaterial, GPU particles, lifecycle/disposal, DPR
Sources: Three.js r0.171 API, ShaderMaterial/InstancedBufferAttribute, THREE.Points, ColorManagement, WebGLRenderer lifecycle

Confirmed the key specifics: `instanceMatrix` is a built-in vertex attribute for `InstancedMesh` (works with raw `ShaderMaterial`), and r171 defaults to `SRGBColorSpace` output + `ColorManagement.enabled = true`. That matters for the warm palette (set sRGB-authored colors via `.setRGB(...,SRGBColorSpace)` or `convertSRGBToLinear`). Here is the brief.

---

# Frosted-Glass Audio Waveform — Three.js Techniques Brief

Target: ~500×500 to 600×900 canvas, Vite + TS, plain three.js r0.171, light/paper background. Everything below assumes a single `InstancedMesh` for slabs + one `THREE.Points` for particles, both driven by uniforms so the **CPU per-frame cost is essentially two uniform writes**.

---

## Object graph + draw-call budget

```
Scene
├─ InstancedMesh (slabs)         1 draw call   ~20–28 instances, BoxGeometry (or rounded box)
│    geometry: shared BoxGeometry (1×1×1, ~12 tris, or rounded ~200 tris)
│    material : RawShaderMaterial (frosted glass), transparent, depthWrite:false
│    per-instance: instanceMatrix (built-in) + aSeed/aIndex (InstancedBufferAttribute)
├─ Points (particles)            1 draw call   ~3k–8k points
│    geometry: BufferGeometry with aSeed, aTargetLine, aBirth, aLane
│    material : ShaderMaterial, transparent, blending: custom (see §3), depthWrite:false
└─ (optional) 3 line "rails" as a thin InstancedMesh or a single quad shader  +0–1 draw call
```

**Budget:** 2 (–3) draw calls total. No shadows, no postprocessing, no env map render target. Triangle count dominated by particles-as-points (0 tris) and slabs (≤6k tris). This will run at 60fps on integrated GPUs at this canvas size; the whole point of the architecture is that **adding more slabs/particles costs vertices, not draw calls or JS**.

The single biggest perf lever at this canvas size is **fragment overdraw from transparency**, not vertex count. Translucent slabs + additive particles + `depthWrite:false` means every covered pixel is shaded multiple times. Keep DPR capped (§5) and keep the glass fragment shader cheap (§1). At 600×900×(1.5 DPR)² ≈ 1.2M fragments, a 30-instruction glass shader is fine; a transmission shader that re-samples the framebuffer is not.

---

## 1. Frosted glass for many instances — fake it, don't transmit it

**Recommendation: custom `RawShaderMaterial`, not `MeshPhysicalMaterial.transmission`.**

Why transmission is the wrong tool here:

- `transmission > 0` forces three.js into a **separate transmission render pass**: it renders the opaque scene into a `WebGLRenderTarget`, then the transmissive material samples that buffer. That's an extra full-scene pass + a texture sample with mip blur (`roughness`-driven) **per transmissive object**. For 20–28 instances in one `InstancedMesh` it's one pass (good), but you pay the offscreen target + you must enable the backbuffer copy, and IBL/`envMap` is effectively mandatory for it to look like anything. That's a lot of machinery for a 500px panel.
- On a **light background** transmission largely just shows... the light background through the glass — low contrast, reads as "slightly grey box." The frosted-ice look you want is dominated by the **fresnel rim**, a **view-dependent edge tint**, and a **soft vertical internal gradient** — all of which are cheap to author directly and give you precise art-direction control to make glass pop against paper.
- Physical transmission is hard to make **reversible/scrubbable** and to drive entirely from uniforms; a hand-written shader is trivial to scrub.

So: hand-write the glass. The look = **fresnel rim (terracotta-tinted) + soft internal vertical gradient + frosted micro-noise + a faint fake-refraction offset tint**, composited with low base alpha so paper shows through.

### Instancing a custom shader (the r171 facts)

- For an `InstancedMesh` with a **`RawShaderMaterial`**, you must declare everything yourself, but `instanceMatrix` is still injected as a built-in `mat4` attribute — you don't add it manually, you just declare it and multiply. (Confirmed current.) With `ShaderMaterial` (non-raw), `#include <begin_vertex>` / `<project_vertex>` chunks fold `instanceMatrix` in automatically; with `RawShaderMaterial` you write the multiply by hand, which is what we want for full control.
- Per-instance data goes in via `InstancedBufferAttribute` on the geometry (e.g. `aSeed`, `aIndex`). These appear as plain `attribute` in the vertex shader, one value per instance.

```ts
const COUNT = 24;
const geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1); // unit box; height comes from instanceMatrix + shader
const aIndex = new Float32Array(COUNT);
const aSeed  = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) { aIndex[i] = i; aSeed[i] = Math.random(); }
geo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(aIndex, 1));
geo.setAttribute('aSeed',  new THREE.InstancedBufferAttribute(aSeed, 1));

const mesh = new THREE.InstancedMesh(geo, glassMaterial, COUNT);
mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage); // we DON'T update matrices per frame; see §2
// lay out the row once:
const m = new THREE.Matrix4();
const spacing = 0.55, w = 0.32, baseH = 1.0, d = 0.5;
for (let i = 0; i < COUNT; i++) {
  const x = (i - (COUNT - 1) / 2) * spacing;
  m.makeScale(w, baseH, d);          // base scale; height ANIMATED in shader, not here
  m.setPosition(x, 0, 0);
  mesh.setMatrixAt(i, m);
}
mesh.instanceMatrix.needsUpdate = true;
```

### Glass vertex shader (RawShaderMaterial)

Note RawShaderMaterial gets **none** of three.js's auto uniforms/attributes, so declare `projectionMatrix`, `modelViewMatrix`, `modelMatrix`, `viewMatrix`, `normalMatrix`, `position`, `normal`, `instanceMatrix` yourself.

```glsl
precision highp float;

uniform mat4 projectionMatrix, modelViewMatrix, modelMatrix, viewMatrix;
uniform mat3 normalMatrix;
uniform float uTime;
uniform vec2  uMouse;      // mouse in field-plane local space (see §4)
uniform float uHoverK;     // 0..1 global hover energy
uniform float uWaveAmp, uWaveFreq, uWaveSpeed;

attribute vec3  position;
attribute vec3  normal;
attribute mat4  instanceMatrix; // built-in for InstancedMesh
attribute float aIndex;
attribute float aSeed;

varying vec3  vNormalW;
varying vec3  vViewDirW;
varying vec2  vLocalUV;   // -0.5..0.5 across, 0..1 up the slab
varying float vLift;      // per-instance lift for glow
varying float vSeed;

void main() {
  // instance world-space center (column position) from instanceMatrix translation
  vec3 instPos = instanceMatrix[3].xyz;

  // travelling sine wave along the row (x drives phase) -> height multiplier
  float phase  = instPos.x * uWaveFreq - uTime * uWaveSpeed;
  float wave   = sin(phase) * 0.5 + 0.5;                 // 0..1
  float audio  = mix(0.25, 1.0, wave) * uWaveAmp;

  // hover: brighten/lift columns near projected cursor (gaussian falloff in X)
  float dx     = instPos.x - uMouse.x;
  float hover  = exp(-dx * dx * 6.0) * uHoverK;
  float lift   = hover * 0.35;

  // build local position: scale Y by audio height, keep box centered on its base
  vec3 p = position;
  float h = audio + lift;
  p.y = (p.y + 0.5) * h;          // grow upward from base (y in [-0.5,0.5] -> [0,h])

  vLocalUV = vec2(position.x, position.y + 0.5);
  vLift    = hover;
  vSeed    = aSeed;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(p, 1.0);

  // subtle parallax tilt toward mouse (lean the whole slab)
  worldPos.xz += vec2(uMouse.x, 0.0) * 0.04 * (p.y);

  vec3 nW   = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vNormalW  = nW;
  vViewDirW = normalize(cameraPositionFromView() - worldPos.xyz); // see note
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
```

For `cameraPositionFromView()` just pass `cameraPosition` as a uniform (RawShaderMaterial doesn't auto-provide it): `uniform vec3 uCameraPos;` and `vViewDirW = normalize(uCameraPos - worldPos.xyz);`. Set it once per frame from `camera.position` (constant if camera is static).

### Glass fragment shader — the ice look on warm paper

```glsl
precision highp float;

uniform float uTime;
uniform vec3  uPaper;     // background color (linear) so edges blend into paper
uniform vec3  uGlassTint; // cool aqua-white core
uniform vec3  uRimColor;  // terracotta accent rim
uniform float uBaseAlpha; // ~0.18 — lets paper show through

varying vec3  vNormalW;
varying vec3  vViewDirW;
varying vec2  vLocalUV;
varying float vLift;
varying float vSeed;

// cheap hash noise for frosting
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(vViewDirW);

  // FRESNEL rim — the workhorse for "glass against light bg"
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);

  // soft internal vertical gradient: brighter core near base, airy at top
  float grad = smoothstep(1.0, 0.0, vLocalUV.y) * 0.6 + 0.2;

  // frosted micro-noise (view-stable-ish, tied to local uv + seed)
  float frost = hash(floor(vLocalUV * 40.0) + vSeed * 17.0);
  frost = mix(0.85, 1.0, frost);

  // FAKE refraction: tint shift along the normal's screen-x — reads as thickness
  float refr = N.x * 0.5 + 0.5;
  vec3 core  = mix(uGlassTint, uGlassTint * vec3(0.92,0.97,1.04), refr);

  // composite: core gradient + terracotta fresnel rim + hover brighten
  vec3 col = core * grad * frost;
  col = mix(col, uRimColor, fres * 0.8);
  col += uRimColor * vLift * 0.6;          // hover glow
  col = mix(col, uPaper, 0.10);            // sit it into the paper, avoid harsh edges

  // alpha: base translucency + stronger at rim so silhouette stays crisp on light bg
  float alpha = clamp(uBaseAlpha + fres * 0.55 + vLift * 0.25, 0.0, 0.95);

  gl_FragColor = vec4(col, alpha);
}
```

Material config for a light background:

```ts
const glassMaterial = new THREE.RawShaderMaterial({
  uniforms: { /* uTime, uMouse, uHoverK, uWaveAmp/Freq/Speed, uPaper, uGlassTint, uRimColor, uBaseAlpha, uCameraPos */ },
  vertexShader, fragmentShader,
  transparent: true,
  depthWrite: false,        // critical: translucent, don't occlude siblings
  depthTest: true,
  side: THREE.DoubleSide,   // see back faces through the glass -> reads thicker
  blending: THREE.NormalBlending, // NOT additive — additive blows out on white paper
});
```

**Light-bg specific decisions:** on paper you do **NormalBlending with sub-1 alpha**, not additive (additive → white-on-white mush). The fresnel rim does the "glassy edge" work; tint it terracotta so the silhouette reads as a colored edge against paper. Keep `uBaseAlpha` low (~0.15–0.2) so you see *through* the slabs and they look like ice, not plastic. `DoubleSide` + low alpha gives a cheap fake internal-volume look without any second pass.

Color management (r171): output is `SRGBColorSpace` and `ColorManagement.enabled` is true by default. Your shader outputs **linear** color and three.js encodes to sRGB on write. So author palette colors as linear: `new THREE.Color('#e07a5f').convertSRGBToLinear()` (or `getRGB(target, SRGBColorSpace)`), then feed `.r/.g/.b` into the uniforms. If you skip this, the terracotta will look muddy/dark.

---

## 2. Per-slab height/lift/glow entirely on the GPU

Already shown in §1's vertex shader — the key principle: **the only things that change per frame are `uTime` and `uMouse` (+`uHoverK`)**, and the wave/hover/lift are all derived in the shader from the instance's static `instanceMatrix[3].xyz` (its X position) and `aSeed`. No `setMatrixAt` loop, no `needsUpdate` on instanceMatrix per frame.

```ts
function update(t: number, dt: number) {
  glassMaterial.uniforms.uTime.value = t;
  // uMouse is lerped in §4; written once here
  glassMaterial.uniforms.uMouse.value.copy(mouseDamped);
}
```

That's the whole per-frame slab cost: 2 vec/float uniform uploads, regardless of slab count. The travelling wave is `sin(x * freq - t * speed)`; per-column hover is a gaussian on `instPos.x - uMouse.x`. To brighten near the **projected** cursor specifically (not just X), pass the cursor's field-plane (x,y) and do `exp(-dot(d,d)*k)` with `d = instPos.xy - uMouse.xy` — but for a horizontal row, X-distance alone reads correctly and is cheaper.

---

## 3. GPU particles: `THREE.Points` + `ShaderMaterial`, fully scrubbable

Particles spawn from slab tops, stream down, and settle onto **3 horizontal transcript lines**, with an end burst — all parameterized by a single `uProgress` (0→1) so dragging it backwards perfectly reverses the animation (no stateful simulation).

### Geometry / attributes (static, uploaded once)

```ts
const P = 6000;
const aSeed       = new Float32Array(P);      // 0..1 randomness
const aBirth      = new Float32Array(P);      // 0..1 when this particle activates along progress
const aTargetLine = new Float32Array(P);      // 0,1,2 -> which transcript line
const aLane       = new Float32Array(P * 2);  // target XY along its line (x spread, y = line height)
const aStart      = new Float32Array(P * 3);  // emission origin (a slab top)

for (let i = 0; i < P; i++) {
  aSeed[i]  = Math.random();
  aBirth[i] = Math.random();                       // staggered reveal
  const line = i % 3; aTargetLine[i] = line;
  const xs = (Math.random() * 2 - 1) * 0.9;        // along the line
  const ly = (line - 1) * 0.18 - 0.35;             // 3 stacked lines below the waveform
  aLane[i*2] = xs; aLane[i*2+1] = ly + (Math.random()-0.5)*0.012; // slight thickness
  const col = Math.floor(Math.random() * 24);
  const sx = (col - 11.5) * 0.55;
  aStart[i*3] = sx; aStart[i*3+1] = 0.2 + Math.random()*0.4; aStart[i*3+2] = (Math.random()-0.5)*0.4;
}
const g = new THREE.BufferGeometry();
g.setAttribute('position', new THREE.BufferAttribute(aStart, 3)); // position = start; we displace in shader
g.setAttribute('aSeed',       new THREE.BufferAttribute(aSeed, 1));
g.setAttribute('aBirth',      new THREE.BufferAttribute(aBirth, 1));
g.setAttribute('aTargetLine', new THREE.BufferAttribute(aTargetLine, 1));
g.setAttribute('aLane',       new THREE.BufferAttribute(aLane, 2));
```

### Vertex shader — time/progress-driven motion, no CPU simulation

```glsl
uniform float uProgress;   // 0..1 master scrub
uniform float uPhase;      // optional discrete phase weights if you prefer
uniform float uTime;       // for idle shimmer + burst
uniform float uPixelRatio;
uniform float uSize;

attribute float aSeed, aBirth, aTargetLine;
attribute vec2  aLane;

varying float vAlpha;
varying float vSeed;

void main() {
  vSeed = aSeed;

  // local progress for this particle: born at aBirth, eases to 1 over a window
  float local = clamp((uProgress - aBirth) / 0.35, 0.0, 1.0);
  float ease  = local * local * (3.0 - 2.0 * local); // smoothstep

  vec3 startPos  = position;                       // slab-top origin
  vec3 targetPos = vec3(aLane.x, aLane.y, 0.0);    // settle on transcript line

  // arc: fall down with a little horizontal drift + gravity-ish curve
  vec3 pos = mix(startPos, targetPos, ease);
  pos.y   -= sin(ease * 3.14159) * 0.15;           // dip below then settle (arc)
  pos.x   += (aSeed - 0.5) * (1.0 - ease) * 0.3;   // drift, collapses as it settles

  // idle shimmer once settled
  pos.x += sin(uTime * 2.0 + aSeed * 30.0) * 0.004 * ease;

  // END BURST: when uProgress crosses ~0.9, push outward briefly
  float burst = smoothstep(0.9, 1.0, uProgress) * (1.0 - smoothstep(0.97, 1.0, uProgress));
  vec2 dir = normalize(vec2(aSeed - 0.5, fract(aSeed*7.3) - 0.5) + 1e-4);
  pos.xy += dir * burst * 0.25;

  // fade in as born, never fully gone (so reverse-scrub looks right)
  vAlpha = ease * (0.4 + 0.6 * (1.0 - burst));

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  // sizeAttenuation: shrink with distance
  gl_PointSize = uSize * uPixelRatio * (1.0 / -mv.z);
}
```

### Fragment shader — soft round sprites that work on light bg

```glsl
uniform vec3 uParticleColor; // terracotta-ish, linear
varying float vAlpha;
varying float vSeed;

void main() {
  // soft round sprite from point coord
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d  = dot(uv, uv);
  float mask = smoothstep(1.0, 0.0, d);   // round, soft edge
  float core = smoothstep(0.4, 0.0, d);   // bright center

  vec3 col = mix(uParticleColor, vec3(1.0,0.96,0.9), core * 0.5);
  float a  = mask * vAlpha;

  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}
```

### Blending on a LIGHT bg — the important bit

Pure `AdditiveBlending` makes warm particles wash out to white on paper (adding to an already-bright background). Two options that read as "glowing" on light:

1. **Premultiplied-ish normal blend with a bright core** (default above with `NormalBlending`, `depthWrite:false`) — safe, the bright `core` reads as glow without blowing out.
2. **Custom subtractive-then-add ("darken-to-glow")** when you want luminous warmth on paper:

```ts
const particleMaterial = new THREE.ShaderMaterial({
  uniforms, vertexShader, fragmentShader,
  transparent: true,
  depthWrite: false,
  depthTest: false,            // particles always over slabs
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor, // = normal alpha blend, predictable on white
});
```

If you truly want additive sparkle, use `blendDst: THREE.OneFactor` **only for the burst frames** and tint the particle darker than paper so the add lands as warm glow rather than white. In practice, normal-blend + bright warm core is the most reliable "glow on paper."

**Reversibility:** everything is a pure function of `uProgress` (+ `uTime` only for non-narrative shimmer). Set `uProgress` from your presentation scrubber and the entire reveal/settle/burst plays forward or backward deterministically. `setPhase(p)` just writes `uProgress`.

```ts
function setPhase(progress: number) {
  particleMaterial.uniforms.uProgress.value = progress;
  // optionally couple hover energy / wave amp to phase too:
  glassMaterial.uniforms.uHoverK.value = 1.0 - smoothstep(0.6, 1.0, progress); // calm down as transcript forms
}
```

---

## 4. Mouse follow with damping + camera parallax

Map pointer → NDC → a point on the **field's local plane** (z=0 where the slabs live), then lerp toward it each frame. Drive both the glass `uMouse` and a subtle camera offset.

```ts
const ndc = new THREE.Vector2();
const mouseTarget = new THREE.Vector2();   // in field-plane local units
const mouseDamped = new THREE.Vector2();   // smoothed, fed to shader
const raycasterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z=0
const ray = new THREE.Raycaster();
const hit = new THREE.Vector3();

renderer.domElement.addEventListener('pointermove', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width)  * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  if (ray.ray.intersectPlane(raycasterPlane, hit)) {
    mouseTarget.set(hit.x, hit.y); // local plane coords -> matches instPos.x space
  }
});
renderer.domElement.addEventListener('pointerleave', () => mouseTarget.set(0, 0));

// in update(t, dt): frame-rate-independent damping
function dampVec(cur: THREE.Vector2, tgt: THREE.Vector2, lambda: number, dt: number) {
  const k = 1 - Math.exp(-lambda * dt);    // exponential smoothing, dt-correct
  cur.x += (tgt.x - cur.x) * k;
  cur.y += (tgt.y - cur.y) * k;
}
```

```ts
function update(t: number, dt: number) {
  dampVec(mouseDamped, mouseTarget, 8.0, dt);
  glassMaterial.uniforms.uMouse.value.copy(mouseDamped);
  glassMaterial.uniforms.uTime.value = t;

  // subtle CAMERA parallax — small offset, look at center
  const px = mouseDamped.x * 0.15, py = mouseDamped.y * 0.10;
  camera.position.x += (px - camera.position.x) * (1 - Math.exp(-4 * dt));
  camera.position.y += (py - camera.position.y) * (1 - Math.exp(-4 * dt));
  camera.lookAt(0, 0, 0);
  glassMaterial.uniforms.uCameraPos.value.copy(camera.position);

  renderer.render(scene, camera);
}
```

Use `1 - exp(-lambda*dt)` rather than a fixed `lerp(0.1)` so damping is identical at 30/60/120fps. `lambda ≈ 8` for the mouse glow (snappy), `≈ 4` for camera (lazier, more parallax feel).

---

## 5. Lifecycle & perf in a no-framework app

### Renderer setup

```ts
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,          // cheap at this size; helps glass edges on paper
  alpha: true,              // transparent bg so paper/DOM shows through
  premultipliedAlpha: true,
  powerPreference: 'high-performance',
  stencil: false,
  depth: true,
});
renderer.setClearColor(0x000000, 0); // fully transparent; CSS paper bg behind canvas
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap DPR
// r171: outputColorSpace defaults to SRGBColorSpace, ColorManagement on — leave defaults.
```

DPR cap is the single biggest perf knob for a transparency-heavy scene: **1.5 is the sweet spot** (2.0 doubles fragment work for marginal visual gain on a 500px panel; 1.0 if you see frame drops on mobile).

### Resize via ResizeObserver (not window resize)

The canvas is an embedded panel, so observe the *container*, not the window:

```ts
const ro = new ResizeObserver((entries) => {
  const { width, height } = entries[0].contentRect;
  if (width === 0 || height === 0) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(width, height, false); // false: don't touch canvas CSS size
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  particleMaterial.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  if (!running) renderOneFrame(); // keep a fresh frame when paused
});
ro.observe(container);
```

### Pause the loop when offscreen / tab hidden

```ts
let running = false, rafId = 0, last = 0, clockT = 0;

function loop(now: number) {
  rafId = requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05); // clamp dt after stalls
  last = now; clockT += dt;
  update(clockT, dt);
}
function start() { if (running) return; running = true; last = performance.now(); rafId = requestAnimationFrame(loop); }
function stop()  { running = false; cancelAnimationFrame(rafId); }

// Only animate when the panel is actually visible:
const io = new IntersectionObserver(([e]) => { e.isIntersecting ? start() : stop(); }, { threshold: 0.01 });
io.observe(container);

// And not when the tab is backgrounded:
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (isOnscreen) start();
});
```

Both guards matter: IntersectionObserver kills cost when scrolled away; visibilitychange kills it when the tab is hidden (rAF already throttles, but stopping is cleaner and resets dt).

### Full disposal (the leak-killer for swapped panels)

GPU resources are **not** GC'd — you must dispose explicitly, especially since this panel gets created/destroyed repeatedly.

```ts
function dispose() {
  stop();
  ro.disconnect(); io.disconnect();
  renderer.domElement.removeEventListener('pointermove', onMove);
  renderer.domElement.removeEventListener('pointerleave', onLeave);

  scene.traverse((o: any) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k in m.uniforms ?? {}) {        // dispose any DataTextures in uniforms
          const v = m.uniforms[k]?.value;
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
  // InstancedMesh: geometry/material covered above; nothing extra.

  renderer.dispose();                 // frees programs, render targets, internal caches
  renderer.forceContextLoss();        // tells the driver to release the GL context now
  renderer.domElement.width = renderer.domElement.height = 0;
  canvas.parentNode?.removeChild(canvas); // remove from DOM last
  // null out references so JS GC can reclaim the rest
}
```

`renderer.dispose()` + `forceContextLoss()` together are what actually release the WebGL context; without `forceContextLoss`, browsers cap you at ~16 live contexts and the 17th panel silently fails. Removing the canvas node and nulling refs lets the rest GC.

---

## 6. Graceful fallbacks

### WebGL context creation failure

Probe before building anything; never throw into a blank panel.

```ts
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function mount(container: HTMLElement) {
  if (!hasWebGL()) { renderStaticFallback(container); return; }
  try {
    const scene = createScene(container); // may still throw on context loss mid-init
    return scene;
  } catch (err) {
    console.warn('[glass] WebGL init failed, static fallback', err);
    renderStaticFallback(container);
  }
}
```

`renderStaticFallback` = a CSS/SVG paper-and-terracotta still of the waveform (e.g. an inline SVG of bars + 3 lines), so the panel still communicates the concept with zero GPU.

Also handle **runtime** context loss (driver reset, tab in background too long):

```ts
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); }, false);
canvas.addEventListener('webglcontextrestored', () => { rebuildGPUResources(); start(); }, false);
```

### prefers-reduced-motion

Render a **single static frame** — no rAF loop, no particles streaming, no shimmer. Show the end state (transcript formed) since that's the informative frame.

```ts
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

function applyMotionPref() {
  if (reduce.matches) {
    stop();
    setPhase(1.0);                                   // transcript settled
    glassMaterial.uniforms.uHoverK.value = 0.0;      // no hover energy
    glassMaterial.uniforms.uTime.value  = 0.0;       // frozen wave
    // optionally hide particles entirely: points.visible = false;
    renderOneFrame();
  } else {
    start();
  }
}
reduce.addEventListener('change', applyMotionPref); // respond if user toggles
applyMotionPref();
```

Key: under reduced-motion you still get the **frosted glass look and the parallax-free static composition** — you just remove the animation loop, the travelling wave, hover, and particle motion. One render call, then nothing runs.

---

## Recommended file/module shape

A single self-contained class with the canonical `init / update / setPhase / resize / dispose` surface, framework-agnostic so the host (presentation runtime) just news it up and feeds it phase.

```ts
// glassWaveform.ts
export interface GlassWaveformOptions {
  count?: number;          // slabs, default 24
  particleCount?: number;  // default 6000
  palette?: { paper: string; glass: string; rim: string; particle: string };
}

export class GlassWaveform {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private slabs!: THREE.InstancedMesh;
  private points!: THREE.Points;
  private ro!: ResizeObserver;
  private io!: IntersectionObserver;
  private running = false;
  private rafId = 0;
  private last = 0;
  private clockT = 0;
  private reduced = false;

  constructor(private container: HTMLElement, private opts: GlassWaveformOptions = {}) {}

  /** Build renderer/scene/materials. Returns false if WebGL unavailable (caller shows static fallback). */
  init(): boolean { /* hasWebGL guard, renderer/camera/scene, build slabs + points, attach observers/listeners, applyMotionPref */ return true; }

  /** Per-frame; called by internal rAF. t = seconds, dt = clamped delta. */
  private update(t: number, dt: number): void { /* damp mouse+camera, write uTime/uMouse/uCameraPos, renderer.render */ }

  /** Scrub the narrative: 0=idle waveform, ->1 = particles settled + burst. Reversible. */
  setPhase(progress: number): void { /* write uProgress; couple uHoverK/uWaveAmp; if paused, renderOneFrame() */ }

  /** Container size changed (driven by ResizeObserver, but exposed for manual calls). */
  resize(w?: number, h?: number): void { /* setSize/setPixelRatio, camera.aspect, uPixelRatio; renderOneFrame if paused */ }

  /** Tear down everything (geometry/material/textures/renderer/context/canvas/listeners). */
  dispose(): void { /* §5 disposal */ }

  // internals: start(), stop(), loop(), renderOneFrame(), renderStaticFallback(), applyMotionPref()
}
```

Host usage:

```ts
const viz = new GlassWaveform(panelEl, { count: 24, particleCount: 6000,
  palette: { paper: '#f4f1de', glass: '#dbeaf0', rim: '#e07a5f', particle: '#e07a5f' } });
if (!viz.init()) showStaticSVGFallback(panelEl);   // §6
// presentation scrubber drives it:
scrubber.on('progress', (p) => viz.setPhase(p));
// when the slide is swapped out:
viz.dispose();
```

**Design contract that makes it scrub-safe and cheap:** `init` allocates all GPU buffers once; `update` writes ~4 uniforms and renders; `setPhase` writes 1–2 uniforms and (if paused) renders exactly one frame; `resize`/`dispose` are idempotent. Visual state is a pure function of `(uTime, uMouse, uProgress)` — no per-frame CPU simulation, no `needsUpdate` churn, so 24 slabs or 240 slabs cost the same JS.

---

### Palette note (warm, light-bg)

- paper `#f4f1de` (CSS bg behind transparent canvas; also `uPaper` linear for edge blend)
- glass core `#dbeaf0` (cool aqua-white so ice reads against warm paper — complementary contrast)
- rim/accent `#e07a5f` terracotta (fresnel rim + particles)
- Convert all three to linear before uploading (`.convertSRGBToLinear()`), since r171 outputs sRGB and your shader emits linear.

Sources:
- [InstancedMesh + custom shader, instanceMatrix as built-in attribute (three.js forum)](https://discourse.threejs.org/t/how-to-edit-the-vertex-shader-for-shadermaterial-to-rotate-instancedmesh/42937)
- [r152+ color management: outputColorSpace defaults to SRGBColorSpace, ColorManagement.enabled true (three.js forum)](https://discourse.threejs.org/t/updates-to-color-management-in-three-js-r152/50791)
- [WebGLRenderer.outputColorSpace docs](https://threejs.org/docs/#api/en/renderers/WebGLRenderer.outputColorSpace)