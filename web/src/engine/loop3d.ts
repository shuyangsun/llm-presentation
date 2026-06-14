/* ============================================================================
   loop3d.ts — the finale: a closed loop that OPENS into a human.

   The closing image of the talk, "the open and close loop":

     CLOSED — a cracked, frosted GREEN ICE ring (a torus, no banding; faceted and
     refractive, not a perfect tube). A sparse blob of particles is trapped inside
     it, flowing CLOCKWISE forever: model → output → feedback → better model, the
     self-improving loop running. Green because this is the state we want. The
     closed ring takes no cursor input — the particles simply flow.

     OPEN — on "I'm going to open the loop now" the ring turns RED and a gap a
     quarter of the circumference wide dissolves at the TOP. The gap opens while
     the blob is just past the BOTTOM; the blob then SURGES up the ring to the
     opening and POURS OUT through it, the particles re-forming as a simple HUMAN.
     The particles that weren't trapped in the loop FLOOD in here (fading up as
     they pour out), so the full-density human forms from the stream. A particle
     only leaves once its own lap carries it into the gap, so the stream issues
     from the hole, not across the ring's middle. The closed circuit broke on
     purpose: the loop now waits for the human to add value.

     The human is a particle silhouette. Hovering it is no longer a magnet —
     instead a horizontal BAND under the cursor sharpens into a clear human
     outline, and over the head the eyes/mouth (negative-space holes) resolve.

   Everything narrative is a pure function of the playhead `t` (phase ramps + a
   deterministic, monotonic orbit), so scrubbing backward re-closes the ring,
   refills it and rewinds the blob's lap and pour-out exactly. The only idle
   (wall-clock) motion is the particles' floating jitter and the ice shimmer.
   The ring + human face the viewer head-on in both states (no tilt); the cursor
   only drives the human's band reveal.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, clamp01, TAU } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_APPEAR_A = 343.4; // ring + blob fade in (closed)
const T_APPEAR_B = 345.0;
const T_OPEN_A = 349.95; // "open the loop now" — gap starts dissolving at the top
const T_OPEN_B = 351.6; // gap fully open
const T_POUR_B = 353.2; // blob has surged up through the gap and re-formed the human

/* --- world layout ------------------------------------------------------- */
const RING_R = 1.0; // torus centre-line radius
const TUBE_R = 0.2; // tube radius
const TUBE_FILL = TUBE_R * 0.86; // how far into the tube the trapped particles fill
const GAP_CENTER = Math.PI / 2; // the gap opens at the TOP of the ring (local +Y)
const GAP_HALF = Math.PI / 4; // half-width of the dissolved run ≈ quarter circumference

/* --- blob / orbit / pour-out -------------------------------------------- */
const BLOB_ARC = 1.05; // angular width of the trapped blob (rad)
const CALM_RATE = 0.7; // calm closed lap speed (rad/s of playhead)
const ORBIT_DIR = -1; // clockwise flow (decreasing angle, viewed head-on)
const ORBIT_AT_OPEN = -Math.PI / 2 - 0.16; // the blob is "just past the bottom" (clockwise) at T_OPEN_A
const SURGE = 2.0; // extra sweep that rushes the blob UP to the top gap on open
// a particle pours out as its own (clockwise, decreasing) lap angle enters the
// top gap. Going clockwise the blob reaches the gap on its first top-crossing
// AFTER the open beat — one full turn below GAP_CENTER — so the calm lap never
// reaches it and release latches (the unwrapped angle only ever decreases).
const RELEASE_EDGE = GAP_CENTER - TAU + GAP_HALF * 0.7;
const RELEASE_SPAN = 0.7;
const LOOP_FRAC = 0.25; // fraction of particles trapped in the CLOSED loop; the rest flood in on open
const SCATTER = 0.06; // blur of the human silhouette where the cursor isn't (hides the small face)
const BAND_HALF = 0.27; // half-height of the sharpening band under the cursor (world)

/* --- human placement ---------------------------------------------------- */
const HUMAN_H = 2.55; // human height in world units
const HUMAN_Y = 0.02; // vertical centre of the human
const HUMAN_Z = 0.16; // pushed slightly toward the camera, in front of the ring
const GAP_PT = new THREE.Vector3(0, RING_R + 0.2, 0.12); // bezier control: the opening at the top

/* ---- shaders ----------------------------------------------------------- */

// Smooth frosted-ICE torus. The main-ring angle u is recovered in the shader
// from atan(y,x), so the top gap is a smooth alpha falloff — no per-segment
// banding, no geometry rebuilt per frame.
const RING_VERT = /* glsl */ `
  uniform float uAppear;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vWorld;
  varying vec3 vLocal;
  void main() {
    vLocal = position;                               // angle is derived per-fragment (no seam)
    vec3 p = position * mix(0.9, 1.0, uAppear);      // gentle scale-in about the centre
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const RING_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uBody, uRim, uHot;
  uniform float uAppear, uOpen, uGapCenter, uGapHalf, uDim, uTime;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vWorld;
  varying vec3 vLocal;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float a = 0.0, w = 0.5;
    for (int k = 0; k < 3; k++) { a += w * vnoise(p); p *= 2.03; w *= 0.5; }
    return a;
  }
  float angDist(float a, float b) {
    float d = abs(a - b);
    return min(d, 6.2831853 - d);
  }

  void main() {
    // ICE imperfections: perturb the normal with a noise gradient so the tube is
    // faceted/irregular — cracked, refractive ice rather than a perfect torus.
    vec3 nq = vWorld * 6.5;
    float n0 = fbm(nq);
    vec3 grad = vec3(fbm(nq + vec3(0.22, 0.0, 0.0)) - n0,
                     fbm(nq + vec3(0.0, 0.22, 0.0)) - n0,
                     fbm(nq + vec3(0.0, 0.0, 0.22)) - n0);
    vec3 N = normalize(vN + grad * 2.2);
    vec3 V = normalize(vV);

    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
    vec3 L = normalize(vec3(0.3, 0.85, 0.6));
    float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float spec = pow(clamp(dot(N, L), 0.0, 1.0), 24.0); // sharp, irregular ice glints

    // cloudy frost + a slowly drifting caustic (the "refraction" feel)
    float frost = fbm(vWorld * 2.6 + vec3(0.0, uTime * 0.05, uTime * 0.03));
    float caustic = pow(fbm(vWorld * 4.4 + vec3(uTime * 0.07, 0.0, -uTime * 0.05)), 2.2);
    // thin pale fracture lines (light catching cracks in the ice)
    float cr = abs(fbm(vWorld * 3.4 + 11.0) - 0.5);
    float crack = (1.0 - smoothstep(0.0, 0.035, cr)) * 0.5;

    vec3 body = uBody * (0.62 + 0.32 * wrap);
    body *= mix(0.8, 1.16, frost);                          // cloudy frost
    body *= mix(0.88, 1.18, caustic);                       // internal refraction streaks (modulated)
    body += uBody * pow(clamp(N.y * 0.5 + 0.5, 0.0, 1.0), 2.0) * 0.1;
    vec3 col = mix(body, uRim, fres * 0.6);
    col += vec3(0.93, 1.0, 0.96) * spec * 0.4;              // crisp icy glints
    col += vec3(0.9, 1.0, 0.95) * crack * 0.22;             // pale fractures
    col = mix(col, uPaper, 0.04);

    // the GAP at the top: dissolve segments within uGapHalf as uOpen rises.
    // angle derived per-fragment from the interpolated position so it wraps at
    // ±π and never sweeps through 0 (which would carve a false seam at 9 o'clock).
    float vTheta = atan(vLocal.y, vLocal.x);
    float gd = angDist(vTheta, uGapCenter);
    float inGap = 1.0 - smoothstep(uGapHalf * 0.62, uGapHalf, gd);
    float cut = inGap * uOpen;
    // the two broken rim ends flanking the opening glow hotter.
    float lip = smoothstep(uGapHalf * 1.5, uGapHalf, gd) * (1.0 - inGap) * uOpen;
    col = mix(col, uHot, lip * 0.7);

    float alpha = clamp(0.42 + fres * 0.38 + spec * 0.3 + crack * 0.2, 0.0, 0.96);
    alpha *= mix(0.85, 1.04, frost);                        // clearer / cloudier patches
    alpha = clamp(alpha, 0.0, 0.96) * uAppear * (1.0 - cut) * uDim;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Trapped particles → human. Soft round sprites; aGlow (a per-frame attribute)
// lifts a particle toward the hot colour where it is magnetised or band-revealed.
const PART_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize;
  attribute float aSize;
  attribute float aGlow;
  attribute float aReveal;          // band-sharpen: shrink the sprite so the face holes punch through
  attribute float aFade;            // per-particle visibility (loop subset vs flood-in)
  varying float vGlow;
  varying float vFade;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * aSize * mix(1.0, 0.46, aReveal) * (1.0 / max(0.1, -mv.z));
    vGlow = aGlow;
    vFade = aFade;
  }
`;

const PART_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  varying float vGlow;
  varying float vFade;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.0, d);
    float a = core * vFade * 0.92;
    if (a < 0.01) discard;
    vec3 col = mix(uColor, uHot, vGlow);
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- a simple human silhouette → normalised ink points ----------------- */
// Filled figure (head/torso/arms/legs) with the eyes and mouth ERASED to holes,
// so a sharpened head reads as a face (the holes) and a blurred head fills them
// in. The head is oversampled so it has enough particles to render the face.
function sampleHuman(max: number): { pos: Float32Array; count: number; aspect: number } {
  const CW = 440;
  const CH = 720;
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  const cx = CW / 2;

  const headR = 62;
  const headY = 110;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, TAU);
  ctx.fill();
  ctx.fillRect(cx - 21, headY + headR - 14, 42, 36); // neck
  // torso (shoulders → waist)
  ctx.beginPath();
  ctx.moveTo(cx - 100, 206);
  ctx.lineTo(cx + 100, 206);
  ctx.lineTo(cx + 68, 404);
  ctx.quadraticCurveTo(cx, 424, cx - 68, 404);
  ctx.closePath();
  ctx.fill();
  // arms
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineWidth = 42;
  ctx.beginPath();
  ctx.moveTo(cx - 90, 222);
  ctx.lineTo(cx - 140, 408);
  ctx.moveTo(cx + 90, 222);
  ctx.lineTo(cx + 140, 408);
  ctx.stroke();
  // legs
  ctx.lineWidth = 52;
  ctx.beginPath();
  ctx.moveTo(cx - 38, 412);
  ctx.lineTo(cx - 46, 668);
  ctx.moveTo(cx + 38, 412);
  ctx.lineTo(cx + 46, 668);
  ctx.stroke();

  // erase the face to holes (revealed when the head sharpens)
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx - 25, headY - 8, 18, 0, TAU); // left eye
  ctx.arc(cx + 25, headY - 8, 18, 0, TAU); // right eye
  ctx.fill();
  ctx.lineWidth = 13;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 24, headY + 32); // mouth
  ctx.quadraticCurveTo(cx, headY + 44, cx + 24, headY + 32);
  ctx.stroke();
  ctx.globalCompositeOperation = "source-over";

  const data = ctx.getImageData(0, 0, CW, CH).data;
  const ink = (px: number, py: number) => px >= 0 && py >= 0 && px < CW && py < CH && data[(py * CW + px) * 4 + 3] > 110;
  const xs: number[] = [];
  const ys: number[] = [];
  // whole figure at step 2
  for (let py = 0; py < CH; py += 2) {
    for (let px = 0; px < CW; px += 2) {
      if (ink(px, py)) {
        xs.push(px);
        ys.push(py);
      }
    }
  }
  // extra density over the head region (interleaved) so the face can resolve
  const headBottom = headY + headR + 28;
  for (let py = 1; py < headBottom; py += 2) {
    for (let px = 1; px < CW; px += 2) {
      if (ink(px, py)) {
        xs.push(px);
        ys.push(py);
      }
    }
  }
  // shuffle so a subsample stays uniform
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  const count = Math.min(max, xs.length);
  const pos = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos[i * 2] = xs[i] / CW;
    pos[i * 2 + 1] = ys[i] / CH;
  }
  return { pos, count, aspect: CH / CW };
}

/* ---- controller -------------------------------------------------------- */

export function mountLoop3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: 36 });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const clock = makeClock();
  const pointer = trackPointer(canvas, camera, 0); // cursor on the z=0 plane

  /* --- colours: green ice (closed) → terracotta red (open) -------------- */
  const white = new THREE.Color("#ffffff");
  const COL = {
    ringBodyG: new THREE.Color("#8fdcc0"),
    ringRimG: new THREE.Color("#2bb673"),
    ringHotG: new THREE.Color("#ecfff7"),
    ringBodyR: pal.accent.clone().lerp(pal.paper, 0.18), // mostly accent — stays assertive on paper
    ringRimR: pal.accent.clone(),
    ringHotR: pal.accent.clone().lerp(white, 0.4),
    partG: new THREE.Color("#157f3c"), // forest green — pops inside the pale-mint tube
    partR: pal.accentInk.clone(),
    hot: new THREE.Color("#fff6ef"),
  };

  /* --- ice ring (one smooth torus) -------------------------------------- */
  const ringGeo = new THREE.TorusGeometry(RING_R, TUBE_R, 24, small ? 150 : 230);
  const ringU = {
    uAppear: { value: 0 },
    uOpen: { value: 0 },
    uGapCenter: { value: GAP_CENTER },
    uGapHalf: { value: GAP_HALF },
    uDim: { value: 1 },
    uTime: { value: 0 },
    uPaper: { value: pal.paper.clone() },
    uBody: { value: COL.ringBodyG.clone() },
    uRim: { value: COL.ringRimG.clone() },
    uHot: { value: COL.ringHotG.clone() },
  };
  const ringMat = new THREE.ShaderMaterial({
    uniforms: ringU,
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.frustumCulled = false;
  scene.add(ring);

  /* --- particles (trapped blob → human) --------------------------------- */
  const human = sampleHuman(small ? 1500 : 3000);
  const N = human.count;
  const humanW = HUMAN_H / human.aspect;

  // static per-particle layout
  const pArc = new Float32Array(N); // arc offset within the blob
  const pRho = new Float32Array(N); // tube fill fraction [0..1]
  const pPsi = new Float32Array(N); // tube cross-section angle
  const pSeed = new Float32Array(N);
  const pInLoop = new Float32Array(N); // 1 = trapped & visible while closed; 0 = floods in on open
  const pHX = new Float32Array(N); // human target (world)
  const pHY = new Float32Array(N);
  const pHZ = new Float32Array(N);
  const pScX = new Float32Array(N); // scatter direction (blur of the soft human)
  const pScY = new Float32Array(N);
  const pScZ = new Float32Array(N);

  for (let i = 0; i < N; i++) {
    // gaussian-ish blob: average two uniforms so it is denser at the centre
    const g = Math.random() + Math.random() - 1; // [-1..1], triangular
    pArc[i] = g * (BLOB_ARC / 2);
    pRho[i] = Math.sqrt(Math.random()); // uniform across the tube disk
    pPsi[i] = Math.random() * TAU;
    pSeed[i] = Math.random();
    pInLoop[i] = Math.random() < LOOP_FRAC ? 1 : 0;
    // human target from the sampled silhouette
    const sx = human.pos[i * 2];
    const sy = human.pos[i * 2 + 1];
    pHX[i] = (sx - 0.5) * humanW;
    pHY[i] = (0.5 - sy) * HUMAN_H + HUMAN_Y; // canvas y is down → world y up
    pHZ[i] = HUMAN_Z + (Math.random() - 0.5) * 0.06;
    // scatter direction (a small random sphere offset, flattened in z)
    const a = Math.random() * TAU;
    const r = 0.4 + 0.6 * Math.random();
    pScX[i] = Math.cos(a) * r;
    pScY[i] = Math.sin(a) * r;
    pScZ[i] = (Math.random() - 0.5) * 0.5;
  }

  const partPos = new Float32Array(N * 3);
  const partSize = new Float32Array(N);
  const partGlow = new Float32Array(N);
  const partReveal = new Float32Array(N);
  const partFade = new Float32Array(N);
  for (let i = 0; i < N; i++) partSize[i] = 0.55 + Math.random() * 0.7;

  const partGeo = new THREE.BufferGeometry();
  const partPosAttr = new THREE.BufferAttribute(partPos, 3);
  partPosAttr.setUsage(THREE.DynamicDrawUsage);
  const partGlowAttr = new THREE.BufferAttribute(partGlow, 1);
  partGlowAttr.setUsage(THREE.DynamicDrawUsage);
  const partRevealAttr = new THREE.BufferAttribute(partReveal, 1);
  partRevealAttr.setUsage(THREE.DynamicDrawUsage);
  const partFadeAttr = new THREE.BufferAttribute(partFade, 1);
  partFadeAttr.setUsage(THREE.DynamicDrawUsage);
  partGeo.setAttribute("position", partPosAttr);
  partGeo.setAttribute("aSize", new THREE.BufferAttribute(partSize, 1));
  partGeo.setAttribute("aGlow", partGlowAttr);
  partGeo.setAttribute("aReveal", partRevealAttr);
  partGeo.setAttribute("aFade", partFadeAttr);

  const partU = {
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 72 : 98 },
    uColor: { value: COL.partG.clone() },
    uHot: { value: COL.hot.clone() },
  };
  const partMat = new THREE.ShaderMaterial({
    uniforms: partU,
    vertexShader: PART_VERT,
    fragmentShader: PART_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(partGeo, partMat);
  points.frustumCulled = false;
  scene.add(points);

  /* --- camera framing --------------------------------------------------- */
  const tanH = Math.tan((36 * Math.PI) / 360);
  let camDist = 6;
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const half = Math.max(RING_R + TUBE_R, HUMAN_H * 0.5) + 0.35; // fit ring + human
    const zH = half / tanH;
    const zW = half / (tanH * aspect);
    camDist = Math.max(zH, zW) * 1.14;
  });

  /* --- frame ------------------------------------------------------------ */
  let disposed = false;
  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();

    // narrative phases (pure functions of the playhead)
    const appear = phase(t, T_APPEAR_A, T_APPEAR_B);
    const openP = phase(t, T_OPEN_A, T_OPEN_B); // gap geometry + camera + dim
    // colour flips to red decisively (steeper/earlier than the geometry) so the
    // green→red crossfade never sits in a muddy grey midpoint.
    const colorP = smooth(clamp01((t - T_OPEN_A) / (0.5 * (T_OPEN_B - T_OPEN_A))));

    // the ring + human face the viewer head-on in both states — no tilt, no
    // mouse parallax. (Only the human's band reveal reacts to the cursor.)
    camera.position.set(0, 0, camDist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    pointer.update(dt);
    const hov = pointer.hover;
    const mwy = pointer.world.y;

    // ring: appear, open (gap), turn red, stay assertive (only a light dim).
    ringU.uAppear.value = appear;
    ringU.uOpen.value = openP;
    ringU.uDim.value = 1 - 0.25 * openP;
    ringU.uTime.value = idle;
    ringU.uBody.value.copy(COL.ringBodyG).lerp(COL.ringBodyR, colorP);
    ringU.uRim.value.copy(COL.ringRimG).lerp(COL.ringRimR, colorP);
    ringU.uHot.value.copy(COL.ringHotG).lerp(COL.ringHotR, colorP);

    partU.uColor.value.copy(COL.partG).lerp(COL.partR, colorP);

    // deterministic CLOCKWISE blob lap: a calm lap that lands "just past the
    // bottom" at T_OPEN_A, then a smooth SURGE that rushes the blob up to the
    // top gap. ORBIT_DIR=-1 makes the angle decrease (clockwise, head-on).
    const lap = CALM_RATE * (t - T_OPEN_A) + SURGE * smooth(phase(t, T_OPEN_A, T_POUR_B));
    const orbit = ORBIT_AT_OPEN + ORBIT_DIR * lap;
    const bandActive = hov * openP; // open-only band reveal (the only cursor interaction)

    for (let i = 0; i < N; i++) {
      const seed = pSeed[i];
      // trapped position: blob centreline + a floating offset inside the tube
      const ang = orbit + pArc[i] + 0.09 * Math.sin(idle * 0.9 + seed * TAU);
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const cxw = ca * RING_R;
      const cyw = sa * RING_R;
      const psi = pPsi[i] + idle * 0.9 * (0.5 + seed);
      const rho = pRho[i] * TUBE_FILL * (0.72 + 0.28 * Math.sin(idle * 1.6 + seed * TAU));
      const cp = Math.cos(psi) * rho;
      const sp = Math.sin(psi) * rho;
      let bx = cxw + cp * ca; // radial component (in-plane, along the ring radius)
      let by = cyw + cp * sa;
      let bz = sp; // z component (out of the ring plane)

      let glow = 0;
      let revealVal = 0;

      // closed: particles simply flow inside the tube (no cursor interaction).
      let px = bx;
      let py = by;
      let pz = bz;

      // POUR OUT: a particle is released only once its own lap angle (the
      // monotonic, decreasing unwrapped orbit) carries it DOWN into the top gap,
      // so the stream issues from the opening rather than across the ring's middle.
      const s = smooth(clamp01((RELEASE_EDGE - (orbit + pArc[i])) / RELEASE_SPAN));
      // loop particles are visible & trapped while closed; the rest stay hidden
      // and FLOOD in (fade up) as they release and pour out of the gap.
      partFade[i] = appear * (pInLoop[i] > 0.5 ? 1 : s);
      if (s > 0) {
        // band reveal: sharpen a horizontal slice under the cursor; elsewhere
        // the human stays a soft (scattered) silhouette that hides the small face.
        const reveal = bandActive * (1 - smooth(clamp01(Math.abs(pHY[i] - mwy) / BAND_HALF)));
        revealVal = reveal;
        const sc = SCATTER * (1 - reveal);
        const hx = pHX[i] + pScX[i] * sc;
        const hy = pHY[i] + pScY[i] * sc;
        const hz = pHZ[i] + pScZ[i] * sc;
        const u = 1 - s;
        const w0 = u * u;
        const w1 = 2 * u * s;
        const w2 = s * s;
        px = w0 * bx + w1 * GAP_PT.x + w2 * hx;
        py = w0 * by + w1 * GAP_PT.y + w2 * hy;
        pz = w0 * bz + w1 * GAP_PT.z + w2 * hz;
        if (reveal > glow) glow = reveal * 0.9;
      }

      partPos[i * 3] = px;
      partPos[i * 3 + 1] = py;
      partPos[i * 3 + 2] = pz;
      partGlow[i] = glow;
      partReveal[i] = revealVal;
    }
    partPosAttr.needsUpdate = true;
    partGlowAttr.needsUpdate = true;
    partRevealAttr.needsUpdate = true;
    partFadeAttr.needsUpdate = true;

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      ringGeo.dispose();
      ringMat.dispose();
      partGeo.dispose();
      partMat.dispose();
    });
  }

  return { tick, dispose };
}
