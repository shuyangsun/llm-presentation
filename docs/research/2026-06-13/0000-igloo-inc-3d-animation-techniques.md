# igloo.inc — 3D Animation Techniques for Supporting Art

Date: 2026-06-13
Status: Current
Area: WebGL, Three.js, frosted-glass/ice shading, mouse interaction, particle effects, motion design
Sources: igloo.inc (Awwwards), Three.js / React-Three-Fiber idioms, fresnel/refraction shading practice, GPU particle techniques

I have enough; the fresnel formula is standard and well-established. I'll write the canonical GLSL from established knowledge plus the verified R3F damping idiom. I have all the concrete, cited specifics needed. Synthesizing the brief now.

---

# igloo.inc — Implementable WebGL technique brief

Scope note: igloo.inc's own case study (Awwwards/Abeto) confirms the *stack and high-level approach* but deliberately withholds numeric parameters. So this brief pairs their confirmed techniques with concrete, battle-tested values from the same family of Three.js/Codrops/R3F implementations so an engineer can build it from these notes alone. **Stack confirmed by their case study: Three.js, three-mesh-bvh, Svelte, GSAP, Vite, vanilla JS; assets authored in Houdini + Blender; ice geometry/volumes exported from Houdini VDB via a custom browser format.** (Note: they use Svelte, not R3F — but the GLSL/material concepts port 1:1 to plain Three.js, which is your target.)

Color note (contrast only, do NOT copy): they run a near-monochrome icy cyan-white palette on near-black. Your panel should use your own palette; everything below is palette-agnostic.

---

## Ice/glass material — how

The igloo "ice" look is **physically-based transmission, not a hand-rolled glass shader**. The confirmed recipe is `MeshPhysicalMaterial` with transmission + a frost layer, plus a chromatic-aberration/displacement pass on transitions. Concretely, for a small panel canvas use either stock `MeshPhysicalMaterial` (cheapest) or drei's `MeshTransmissionMaterial` (extends `MeshPhysicalMaterial`, adds multi-sample refraction + chromatic aberration + distortion uniforms — port the GLSL if you're not in R3F).

Base PBR transmission (works in plain Three.js):
- `transmission: 1.0` — the master switch for see-through refraction.
- `thickness: 0.5–1.0` — volume that bends background; **this is what makes it read as a solid block of ice, not a soap bubble**. Drive thickness up slightly near the cursor for a "frost thickening" feel.
- `roughness: 0.0–0.15` for clear glass; **`0.6–0.75` for frosted ice**. Avoid the 0.3–0.5 middle band — it shows noticeably pixelated transmission. Modulate roughness *down* near the cursor so the spot under the mouse "clears"/sharpens.
- `ior: 1.31` (real ice IOR; animate 1.07→1.5 for a dispersive shimmer on transitions).
- `metalness: 0`, `clearcoat: 1.0`, `clearcoatRoughness: 0.1–0.4` — the lacquer layer gives the wet, polished highlight on top of frost.
- `attenuationColor` + `attenuationDistance` — subtle internal tint with depth (keep it your palette's hue, faint).
- **`normalMap` (a frost/crystal normal) is the single biggest quality lever**: it adds micro-surface and *greatly reduces the pixelation* of transmitted content. Author a tiling crystalline normal in Houdini/Blender or use a frost texture; also feed it to `clearcoatNormalMap`.
- **Always set an `envMap`** (a small HDRI / pmrem-prefiltered cube). Transmission and clearcoat both sample it; without it the ice looks flat. For a tiny panel a 256–512px env is plenty.

If using `MeshTransmissionMaterial`-style uniforms (or porting them): `samples: 6–10`, `resolution: 128–256` (lower = cheaper *and* gives a tasteful pixelated refraction), `chromaticAberration: 0.03–0.2`, `anisotropicBlur: 0.1`, `distortion: 0.1–0.4`, `distortionScale: 0.3`, `temporalDistortion: 0.1`, `backside: true` for thick double-refraction (doubles cost — skip on a small panel).

**Fresnel rim glow** (the icy edge halo) is a separate additive layer, computed in a custom shader or `onBeforeCompile` injection — this is the cheap signature touch:
```glsl
// vertex: pass world-space normal + view dir
vWorldNormal = normalize(mat3(modelMatrix) * normal);
vViewDir = normalize(cameraPosition - (modelMatrix * vec4(position,1.0)).xyz);
// fragment:
float fres = pow(1.0 - clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0), uFresnelPower);
vec3 rim = uRimColor * fres * uRimIntensity;
gl_FragColor.rgb += rim;             // additive rim on top of transmission
```
Typical: `uFresnelPower 2.5–4.0`, `uRimIntensity 0.6–1.2`. **Make the rim brighten toward the cursor** by feeding mouse proximity into `uRimIntensity`.

Authoring note: igloo grew their crystals with "a custom algorithm that mimics ice-crystal growth inside a container," baked in Houdini, exported as VDB→custom compressed format. For your panel you don't need volumetrics — a Blender ice mesh (boolean-fractured block + subtle displacement) with the material above gets 95% of the read at a fraction of the cost.

---

## Mouse interaction — how (with lerp/damping specifics)

The whole motion language is **critically-damped follow, never 1:1**. The cursor sets a *target*; the object/camera *chases* it with exponential smoothing every frame. This is what gives the "heavy, glassy inertia."

1. Normalize pointer to `[-1, 1]`: `mx = (e.clientX/w)*2 - 1; my = -((e.clientY/h)*2 - 1);` (use the *panel's* bounding rect, not window, since it's a small canvas).
2. Keep a `target` and a `current`; lerp `current` toward `target` each frame:
```js
const damp = 0.08;            // smaller = heavier/slower; 0.05–0.12 is the igloo-ish range
current.x += (target.x - current.x) * damp;
current.y += (target.y - current.y) * damp;
```
For frame-rate independence prefer exponential damping: `current += (target-current) * (1 - exp(-k*dt))` with `k ≈ 6–10` (equivalent to drei's `easing.damp`).

3. **Parallax tilt** of the ice (the dominant effect): map smoothed pointer to a small rotation, not position.
```js
mesh.rotation.y = current.x * 0.25;   // ~±14°
mesh.rotation.x = -current.y * 0.18;  // ~±10°
```
Keep amplitudes small (≤0.3 rad) — restraint is the point. Optionally add a tiny idle drift (`+ Math.sin(t*0.3)*0.02`) so it breathes when the mouse is still.

4. **Refraction/frost follows the cursor**: pass the smoothed pointer into the material as `uMouse`, plus a world-space hit point if you raycast. In the ice shader, compute distance from fragment to `uMouse` and use it to (a) lower roughness / raise clarity, (b) boost fresnel rim, (c) nudge `thickness` or a frost normal-map blend so frost "blooms" around the cursor:
```glsl
float d = distance(vUv, uMouse);            // or world-space
float clear = smoothstep(0.0, 0.25, d);     // near cursor -> 0 (clear)
float localRough = mix(0.1, 0.7, clear);    // sharp under cursor, frosted away
float frost = 1.0 - clear;                  // drive emissive/normal blend
```
5. **Cursor distortion**: offset the screen-space UV used for the refraction/background sample by a falloff bump centered on `uMouse` (a cheap "lens" under the pointer):
```glsl
vec2 dir = vUv - uMouse;
float bump = exp(-dot(dir,dir) * uLensTightness);   // ~ uLensTightness 30–80
vec2 refractUv = vUv + normalize(dir) * bump * uLensStrength; // uLensStrength ~0.02
```

Damping cheat sheet: pointer-follow `0.05–0.12`; camera follow even heavier `0.02–0.05`; scroll-driven values via GSAP (they use GSAP) with `ease: "power2.out"` / `power3.inOut` and ScrollTrigger scrub `0.5–1.0` for the same lag feel.

---

## Particle effect — how

igloo's closing/links scene is a **GPGPU (FBO) particle simulation that morphs between baked target shapes**, colored by velocity and glowing as it reshapes. Confirmed by case study: "interactive particle simulation that forms different models," particles "change colour based on their speed, and glow as they shift into new shapes."

Architecture (the implementable version):
- **Store positions in a float texture, simulate on the GPU.** Particle count = texture² (must be power-of-two). Desktop **16,384 particles = 128×128 texture**; mobile drop to ~56×56 (~3,136). For a *small presentation panel*, 64×64 (4,096) or 96×96 (9,216) is ample and cheap.
- Texture/RT config: `RGBAFormat`, `FloatType`, `NearestFilter` for min+mag, `stencilBuffer:false`. XYZ in rgb (w spare for life/seed).
- **Target shapes are baked DataTextures**: sample your ice mesh / logo / sphere into a Float32 position array → `createDataTextureFromPositions(positions, size)`. Have 2+ targets (e.g. scattered cloud, sphere, ring, your wordmark).
- **Simulation fragment shader** reads previous positions and `mix()`es toward the active target by a `uProgress`/per-shape amount uniform, then adds curl-noise turbulence:
```glsl
vec3 pos = texture2D(uPositions, vUv).xyz;
pos = mix(pos, texture2D(uSpherePositions, vUv).xyz, uSphereAmount);
pos = mix(pos, texture2D(uRingPositions,  vUv).xyz, uRingAmount);
vec3 flow = curlNoise(pos * 0.5 + uTime * 0.3);
float strength = 0.05 + 0.15 * (sin(uTime)*0.5 + 0.5);
pos += flow * strength;
gl_FragColor = vec4(pos, 1.0);
```
- **Curl noise** (divergence-free → particles swirl without clumping), `CURL_NOISE_SCALE ≈ 1.2`:
```glsl
vec3 snoiseVec3(vec3 x){
  float s  = snoise(x);
  float s1 = snoise(vec3(x.y-19.1, x.z+33.4, x.x+47.2));
  float s2 = snoise(vec3(x.z+74.2, x.x-124.5, x.y+99.4));
  return vec3(s,s1,s2);
}
vec3 curlNoise(vec3 p){ /* finite-diff the above on dx,dy,dz, *1/(2*scale), normalize */ }
```
- **Render pass**: a `THREE.Points` whose vertex shader looks up its position from the simulation RT by its UV, then projects it and sets `gl_PointSize`. Color by velocity (store prev pos or compute `length(pos - prevPos)`), and add glow during transitions.
```glsl
vec3 p = texture2D(uPositions, ref).xyz;
gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0);
gl_PointSize = uSize * (1.0 / -viewPosition.z);  // size attenuation
```
- **Render material**: `blending: AdditiveBlending`, `depthWrite:false`, `transparent:true`. Soft round sprite in the fragment shader:
```glsl
float s = 1.0 - distance(gl_PointCoord, vec2(0.5));
s = pow(clamp(s,0.0,1.0), 3.0);          // soft falloff
gl_FragColor = vec4(uColor * vSpeedGlow, s);
```
- **In/out animation = tween the blend amounts**, not the geometry. GSAP `to(uniforms.uSphereAmount,{value:1, duration:1.6, ease:"power3.inOut"})` while ramping the previous target to 0. For a burst-in, start all from the scattered DataTexture and ease into shape; for dissolve-out, ramp `uScatteredAmount→1` and fade `uColor`/size.
- Note: the loopspeed reference skips classic ping-pong — it renders the sim RT once per frame and reads it the same frame. Fine for morph-between-targets; if you want true persistent velocity integration you'll need two RTs and swap.

Alternative cheaper closing effect (dissolve, if you skip GPGPU): noise-threshold discard on a mesh + edge glow, driven by one `uProgress` tween:
```glsl
float n = cnoise(vPos * uFreq) * uAmp;
if(n < uProgress) discard;                                  // dissolve
if(n > uProgress && n < uProgress + uEdge)                  // glowing edge
  gl_FragColor = vec4(uEdgeColor, n);
```
Spawn particles only in the same edge band (`if(vNoise < uProgress || vNoise > uProgress+uEdge) discard;`) so they appear to peel off the surface. GSAP-tween `uProgress` ~-1→1 over `1.5–2.5s`, `ease:"power2.inOut"`.

---

## Motion & camera language

- **Everything is damped/lerped, nothing snaps.** Pointer → 0.05–0.12, camera → 0.02–0.05, scroll → GSAP ScrollTrigger scrub 0.5–1.0.
- **Camera barely moves** — small dolly/orbit offsets driven by smoothed pointer (`cam.position.x += (mx*0.3 - cam.position.x)*0.04`), plus `lookAt` a target that itself lerps. The object's parallax tilt does most of the perceived 3D, not big camera motion.
- **Scene transitions** combine chromatic aberration + a "tech displacement" + a frost wipe (their words). Implement as a fullscreen post pass or per-material uniform ramp; tween with GSAP eases (`power2/3.inOut`).
- Idle life: subtle continuous rotation (`uTime*0.2`) on particles and a tiny sinusoidal breathe on the ice so a still mouse never looks frozen.
- Text effects (if you have any in-canvas type): SDF-texture offset for scramble (cheap), simple WebGL glitch shader for flicker — both noted as perf-safe in their case study.

---

## Performance tactics (critical for a small in-panel canvas)

- **Cap DPR**: `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))` — 2 only if you measure headroom. Biggest single win on transmission.
- **On-demand rendering**: don't run `requestAnimationFrame` continuously. Render only when something changes — pointer move, active tween, or live particle sim. In R3F that's `frameloop="demand"` + `invalidate()`; in plain Three.js, gate your loop with a `needsRender` flag (set true on pointermove and while GSAP tweens are active). For a presentation panel this matters a lot — you don't want the GPU pinned when the slide is idle.
- **Transmission cost control**: keep `samples` 6–10, `resolution` 128–256 (low res doubles as a stylistic pixelated-refraction look), avoid `backside` on the panel, and don't stack many transmissive objects.
- **three-mesh-bvh** (they use it): accelerates raycasting against the ice for mouse hit-testing / particle sampling — use it if you raycast the mesh per-frame.
- **Particles**: pick texture size to taste (64²–128²); curl noise + additive points are cheap; the expense is overdraw — keep point size modest and `depthWrite:false`.
- **Asset/load strategy** (their explicit approach): custom compressed geometry export, and **compile shaders / upload textures during initial load and in the background** so first interaction is smooth. For you: `renderer.compile(scene, camera)` before reveal, and pre-warm the transmission render target.
- Use a prefiltered (PMREM) low-res env map, not a big HDRI.
- Postprocessing budget: keep it tiny on a panel — at most one bloom pass (threshold high, small radius) for the rim/particle glow, optional faint film grain. Skip DOF on a small canvas (cost ≫ benefit at that size). Bloom is what makes the additive particles and fresnel rim "pop"; everything else is optional.

---

## Direct snippets / uniforms to use

Material (plain Three.js ice):
```js
new THREE.MeshPhysicalMaterial({
  transmission: 1.0, thickness: 0.8, ior: 1.31,
  roughness: 0.65, metalness: 0.0,
  clearcoat: 1.0, clearcoatRoughness: 0.25,
  attenuationColor: PALETTE_ICE, attenuationDistance: 1.5,
  normalMap: frostNormal, clearcoatNormalMap: frostNormal,
  envMap: pmremEnv, envMapIntensity: 1.0,
});
```
Custom uniforms to inject (via `onBeforeCompile` or a custom ShaderMaterial layer): `uMouse(vec2)`, `uMouseWorld(vec3)`, `uTime(float)`, `uRimColor(vec3)`, `uRimIntensity(float ~0.9)`, `uFresnelPower(float ~3.0)`, `uLensStrength(0.02)`, `uLensTightness(50.0)`, `uFrost(float)`.

Damped follow (per frame, frame-rate independent):
```js
function damp(cur, tgt, k, dt){ return cur + (tgt - cur) * (1 - Math.exp(-k*dt)); }
// pointer k≈8, camera k≈4
```

Particle render material:
```js
new THREE.ShaderMaterial({
  uniforms:{ uPositions:{value:simRT.texture}, uTime:{value:0},
             uSize:{value:1.5}, uColor:{value:PALETTE_PARTICLE} },
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
});
```
Soft-point fragment: `float s=pow(1.0-distance(gl_PointCoord,vec2(0.5)),3.0); gl_FragColor=vec4(uColor*vSpeedGlow,s);`

Transition tween (GSAP, their easing dialect):
```js
gsap.to(simUniforms.uShapeAmount, { value:1, duration:1.6, ease:"power3.inOut" });
gsap.to(iceUniforms.uFrost,        { value:1, duration:1.2, ease:"power2.out" });
```

Renderer setup:
```js
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
renderer.compile(scene,camera);     // pre-warm
// loop: render only if (pointerMoved || gsap.isActive || simRunning)
```

---

Sources:
- [Igloo Inc: Case Study — Awwwards/Abeto](https://www.awwwards.com/igloo-inc-case-study.html) (confirms stack: Three.js, three-mesh-bvh, Svelte, GSAP, Vite; Houdini/Blender; VDB exporter; velocity-colored glowing particle sim; chromatic aberration + displacement + frost transitions; SDF text scramble; background shader compile)
- [Landing Site — Igloo Inc — three.js forum](https://discourse.threejs.org/t/landing-site-igloo-inc/67249) (showcase thread, no technical detail)
- [Creating the Effect of Transparent Glass and Plastic in Three.js — Codrops](https://tympanus.net/codrops/2021/10/27/creating-the-effect-of-transparent-glass-and-plastic-in-three-js/) (transmission/thickness/roughness/clearcoat/normalMap/envMap values)
- [Warping 3D Text Inside a Glass Torus — Codrops](https://tympanus.net/codrops/2025/03/13/warping-3d-text-inside-a-glass-torus/) (MeshTransmissionMaterial samples/resolution/ior/chromaticAberration ranges)
- [The Magical World of Particles with R3F and Shaders — Maxime Heckel](https://blog.maximeheckel.com/posts/the-magical-world-of-particles-with-react-three-fiber-and-shaders/) (Points geometry, vertex/fragment shaders, additive blending, gl_PointSize, soft points)
- [Advanced scroll-based particle transitions / FBO simulation — Loopspeed](https://blog.loopspeed.co.uk/fbo-particles-simulation) (16,384 particles=128² texture, FBO/DataTexture, curl noise GLSL, mix() shape morphing, blend-amount uniforms)
- [Implementing a Dissolve Effect with Shaders and Particles — Codrops](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/) (noise-threshold discard, uProgress, edge-glow band, edge particle spawning)
- [Fresnel rim lighting references — threejsroadmap / threejsresources / OtanoStudio Fresnel-Shader-Material](https://threejsroadmap.com/blog/rim-lighting-shader) (fresnel = pow(1.0 - dot(normal, viewDir), power))