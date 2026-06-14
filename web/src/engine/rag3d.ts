/* ============================================================================
   rag3d.ts — the 3D "retrieval-augmented generation" supporting art.

   The beat: "I don't know what model I'll use to transcribe this ... use the
   RAG, don't just search for the string ... find out which model ... and show
   that on the screen." So this scene IS retrieval — in embedding space, not as
   string match:

   1. GALAXY — a soft warm constellation of faint document points (the whole
      chat-history corpus) floating in a rough disk/sphere. It fades + expands
      in on the scene's base beat.

   2. PROBE — one bright query point you steer with the mouse (it auto-orbits
      slowly when the cursor is away). Each frame we find its k NEAREST document
      nodes in 3D and light thin terracotta BEAMS from the probe to them, and
      brighten those nodes — the felt experience of k-NN retrieval. Move the
      mouse and a different neighbourhood lights up: that is "use the RAG".

   3. CONVERGE — as the narration reaches "show that on screen", the beams stop
      following the cursor and all aim at ONE answer node down in the lower-left
      (where the DOM answer card resolves the model name); the cloud swirls
      inward and a glow crystallises there. The card sits over that glow.

   Igloo.inc is the spirit (frosted volume, terracotta fresnel halo, warm
   particle glow) — palette warm Paper + terracotta, never icy blue. Glow is a
   bright warm core on NormalBlending (additive blows out to white on paper).

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing backward rewinds the galaxy, the converge and the crystal glow
   exactly; makeClock() drives ONLY the idle twinkle/drift and the auto-orbit.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, clamp01, damp, TAU } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_FORM_A = 298.5; // galaxy begins to fade/expand in
const T_FORM_B = 300.2;
const T_CONV_A = 322.0; // beams start aiming at the one answer node
const T_CONV_B = 329.65; // fully crystallised under the DOM card ("show on screen")

/* --- world layout -------------------------------------------------------- */
const FOV = 34;
const BASE_AZ = -0.22; // resting 3/4 azimuth (rad)
const BASE_EL = 0.16; // resting elevation (rad)
const R_DISK = 1.5; // embedding-space radius (xy)
const R_THICK = 0.5; // embedding-space half-thickness (z)
const K_NN = 5; // nearest neighbours lit per frame
const MAX_LIT = K_NN; // beam segment budget = neighbours

// The answer node + crystal glow live lower-left so they tuck under the DOM
// answer card (CSS: .rag-answer pinned left/bottom). World y is up, x is right.
const ANSWER = new THREE.Vector3(-0.92, -0.86, 0.12);

/* ---- shaders ------------------------------------------------------------ */

// Ambient corpus cloud + the brighter document nodes share this point shader:
// a soft round warm sprite whose brightness/size is driven per-point by aLit
// (0 = faint corpus, up to 1 = a lit neighbour) and globally by uForm/uConv.
const PTS_VERT = /* glsl */ `
  uniform float uPixelRatio, uForm, uTime, uConv;
  uniform float uSizeBase, uSizeLit;
  attribute float aSeed;     // stable 0..1 per point (twinkle phase)
  attribute float aBright;   // base brightness class (corpus vs document)
  attribute float aLit;      // 0..1 retrieval highlight (documents only)
  varying float vGlow;
  varying float vSeed;

  void main() {
    // converge: the whole cloud eases a little toward the answer as it crystallises.
    vec3 p = mix(position, mix(position, vec3(${ANSWER.x.toFixed(3)}, ${ANSWER.y.toFixed(3)}, ${ANSWER.z.toFixed(3)}), 0.34), uConv);

    // entrance: galaxy expands outward from the centre as it fades in.
    p = mix(p * 0.55, p, uForm);

    float tw = 0.6 + 0.4 * sin(uTime * 1.3 + aSeed * ${TAU.toFixed(5)});  // idle twinkle
    vGlow = aBright * (0.5 + 0.5 * tw) + aLit;
    vSeed = aSeed;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(uSizeBase, uSizeLit, clamp(aLit, 0.0, 1.0));
    gl_PointSize = size * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.35 + 0.65 * uForm);
  }
`;

const PTS_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCorpus, uDoc, uHot;
  varying float vGlow;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);       // soft round falloff
    float core = smoothstep(0.45, 0.0, d);      // bright centre
    // faint corpus → warm document → hot lit neighbour, by brightness.
    vec3 col = mix(uCorpus, uDoc, clamp(vGlow, 0.0, 1.0));
    col = mix(col, uHot, clamp(vGlow - 1.0, 0.0, 1.0) + core * 0.35 * clamp(vGlow, 0.0, 1.0));
    float a = mask * clamp(0.18 + vGlow * 0.85, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// k-NN beams: thin terracotta lines from probe → lit neighbours. Alpha rides a
// per-vertex aFade so a beam glows hottest near the probe and tapers out.
const BEAM_VERT = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  void main() {
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    vec3 col = mix(uColor, uHot, vFade * 0.6);
    gl_FragColor = vec4(col, uAlpha * (0.25 + 0.75 * vFade));
  }
`;

// The probe itself + the crystallising answer glow: a soft halo billboard.
const GLOW_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z));
  }
`;
const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  uniform float uAlpha;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv);
    if (d > 1.0) discard;
    float halo = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.4, 0.0, d);
    vec3 col = mix(uColor, uHot, core);
    float a = (halo * 0.4 + core * 0.85) * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller --------------------------------------------------------- */

export function mountRag3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: FOV });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const pointer = trackPointer(canvas, camera, 0); // probe rides the z=0 plane
  const clock = makeClock();
  const tanH = Math.tan((FOV * Math.PI) / 360);

  const P = small ? 1400 : 2600; // ambient corpus points
  const DOCS = small ? 22 : 30; // candidate "document" nodes

  /* --- build the point field: corpus + documents in one THREE.Points ------ */
  const N = P + DOCS;
  const positions = new Float32Array(N * 3);
  const homes = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  const bright = new Float32Array(N);
  const lit = new Float32Array(N);

  // a rough flattened disk/sphere — denser toward the centre (a galaxy core).
  function placeInDisk(i: number, rScale: number) {
    const u = Math.random();
    const r = Math.pow(u, 0.6) * R_DISK * rScale;
    const a = Math.random() * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.82; // slightly flattened in y
    const z = (Math.random() * 2 - 1) * R_THICK * (1 - 0.4 * (r / R_DISK));
    homes[i * 3] = x;
    homes[i * 3 + 1] = y;
    homes[i * 3 + 2] = z;
  }

  for (let i = 0; i < P; i++) {
    placeInDisk(i, 1);
    seeds[i] = Math.random();
    bright[i] = 0.24 + Math.random() * 0.16; // faint corpus (warm, just present)
    lit[i] = 0;
  }
  // Document nodes: scattered through the same space, brighter. Keep their
  // world positions so we can run k-NN against the probe each frame.
  const docIndex: number[] = [];
  const docPos: THREE.Vector3[] = [];
  for (let d = 0; d < DOCS; d++) {
    const i = P + d;
    placeInDisk(i, 0.92);
    seeds[i] = Math.random();
    bright[i] = 0.5; // a clear "document"
    lit[i] = 0;
    docIndex.push(i);
    docPos.push(new THREE.Vector3(homes[i * 3], homes[i * 3 + 1], homes[i * 3 + 2]));
  }
  // The answer node is one specific document, parked at the lower-left target.
  const answerDoc = P + (DOCS - 1);
  homes[answerDoc * 3] = ANSWER.x;
  homes[answerDoc * 3 + 1] = ANSWER.y;
  homes[answerDoc * 3 + 2] = ANSWER.z;
  docPos[DOCS - 1].copy(ANSWER);

  positions.set(homes); // start at rest; the shader does the form/converge motion

  const ptsGeo = new THREE.BufferGeometry();
  ptsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  ptsGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  ptsGeo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  const litAttr = new THREE.BufferAttribute(lit, 1);
  litAttr.setUsage(THREE.DynamicDrawUsage);
  ptsGeo.setAttribute("aLit", litAttr);

  const hot = pal.accent.clone().lerp(new THREE.Color("#ffffff"), 0.3);
  const ptsU = {
    uPixelRatio: { value: dpr },
    uForm: { value: 0 },
    uConv: { value: 0 },
    uTime: { value: 0 },
    uSizeBase: { value: small ? 9 : 12 },
    uSizeLit: { value: small ? 20 : 26 },
    uCorpus: { value: pal.fgFaint.clone().lerp(pal.accent, 0.4) },
    uDoc: { value: pal.accent.clone().lerp(pal.paper, 0.18) },
    uHot: { value: hot },
  };
  const ptsMat = new THREE.ShaderMaterial({
    uniforms: ptsU,
    vertexShader: PTS_VERT,
    fragmentShader: PTS_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(ptsGeo, ptsMat);
  points.frustumCulled = false;
  scene.add(points);

  /* --- k-NN beams (1 draw call; rewrite only the lit edges) --------------- */
  const beamPos = new Float32Array(MAX_LIT * 2 * 3); // 2 verts per beam
  const beamFade = new Float32Array(MAX_LIT * 2); // 1 (probe end) → 0 (node end)
  const beamGeo = new THREE.BufferGeometry();
  const beamPosAttr = new THREE.BufferAttribute(beamPos, 3);
  beamPosAttr.setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute("position", beamPosAttr);
  beamGeo.setAttribute("aFade", new THREE.BufferAttribute(beamFade, 1));
  for (let k = 0; k < MAX_LIT; k++) {
    beamFade[k * 2] = 1; // probe end (hot)
    beamFade[k * 2 + 1] = 0; // node end (cool)
  }
  beamGeo.setDrawRange(0, 0);
  const beamU = {
    uColor: { value: pal.accentInk.clone() },
    uHot: { value: hot },
    uAlpha: { value: 0 },
  };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamU,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const beams = new THREE.LineSegments(beamGeo, beamMat);
  beams.frustumCulled = false;
  scene.add(beams);

  /* --- probe + crystal glow (2 tiny THREE.Points, 1 vert each) ------------ */
  function makeGlow(size: number, color: THREE.Color): { mesh: THREE.Points; u: { uAlpha: { value: number } } } {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const u = {
      uPixelRatio: { value: dpr },
      uSize: { value: size },
      uColor: { value: color },
      uHot: { value: hot },
      uAlpha: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Points(g, m);
    mesh.frustumCulled = false;
    return { mesh, u };
  }
  const probe = makeGlow(small ? 34 : 44, pal.accent.clone());
  const crystal = makeGlow(small ? 90 : 130, pal.accent.clone());
  crystal.mesh.position.copy(ANSWER);
  scene.add(probe.mesh, crystal.mesh);

  /* --- camera framing (fixed 3/4 pose; fits tall mobile + wide desktop) --- */
  function frame(w: number, h: number) {
    const aspect = w / h || 1;
    const halfH = R_DISK * 1.18; // content half-extents
    const halfW = R_DISK * 1.18;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.2 + R_THICK;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
  }
  stage.onResize(frame);

  /* --- per-frame retrieval state ------------------------------------------ */
  const probeWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  // (distance, docArrayIndex) pairs, reused each frame to avoid allocations.
  const dist = new Float32Array(DOCS);
  const order: number[] = [];
  for (let d = 0; d < DOCS; d++) order.push(d);
  const litTarget = new Float32Array(N); // desired aLit, eased toward each frame

  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: clk } = clock();
    pointer.update(dt, 7);

    // --- narrative phases (pure functions of the playhead) ---
    const form = phase(t, T_FORM_A, T_FORM_B);
    const conv = phase(t, T_CONV_A, T_CONV_B);
    ptsU.uForm.value = form;
    ptsU.uConv.value = conv;
    ptsU.uTime.value = clk;

    // --- probe position: mouse on z=0, else a slow auto-orbit ---
    const orbitR = R_DISK * 0.62;
    const oa = clk * 0.32;
    const auto = tmp.set(Math.cos(oa) * orbitR, Math.sin(oa * 0.9) * orbitR * 0.7, Math.sin(oa * 1.3) * R_THICK * 0.6);
    const hover = pointer.hover;
    // blend cursor (when present, already damped by trackPointer) with the idle
    // orbit; on converge, steer the probe itself toward the answer node so the
    // retrieval visibly "lands" there.
    probeWorld.set(
      hover * pointer.world.x + (1 - hover) * auto.x,
      hover * pointer.world.y + (1 - hover) * auto.y,
      (1 - hover) * auto.z,
    );
    probeWorld.lerp(ANSWER, conv * conv); // crystallise toward the answer
    probe.mesh.position.copy(probeWorld);
    probe.u.uAlpha.value = form * (1 - conv * 0.55);

    // --- k-NN: find the nearest documents to the probe ---
    for (let d = 0; d < DOCS; d++) dist[d] = probeWorld.distanceToSquared(docPos[d]);
    order.sort((a, b) => dist[a] - dist[b]);

    // reset lit targets, then light the k nearest (and bias toward the answer
    // node as the beams converge so they all aim at it by the end).
    litTarget.fill(0);
    const beamReach = clamp01(form) * (1 - conv * 0.15);
    let lt = 0;
    for (let k = 0; k < K_NN; k++) {
      // as conv rises, progressively replace neighbours with the answer node
      const useAnswer = conv > 0 && k >= Math.round((1 - conv) * K_NN);
      const dArr = useAnswer ? DOCS - 1 : order[k];
      const gi = docIndex[dArr];
      const w = 1 - k / K_NN; // nearest = brightest
      const strength = (0.5 + 0.5 * w) * beamReach;
      if (strength > litTarget[gi]) litTarget[gi] = strength;

      // write this beam segment (probe → node)
      const node = docPos[dArr];
      beamPos[lt * 6 + 0] = probeWorld.x;
      beamPos[lt * 6 + 1] = probeWorld.y;
      beamPos[lt * 6 + 2] = probeWorld.z;
      beamPos[lt * 6 + 3] = node.x;
      beamPos[lt * 6 + 4] = node.y;
      beamPos[lt * 6 + 5] = node.z;
      lt++;
    }
    beamPosAttr.needsUpdate = true;
    beamGeo.setDrawRange(0, lt * 2);
    // beams glow once the galaxy has formed; brighten through converge. A solid
    // base alpha keeps retrieval legible during the idle auto-orbit; hover lifts it.
    beamU.uAlpha.value = form * (0.62 + 0.38 * conv) * (0.72 + 0.28 * smooth(hover));

    // ease the per-point highlight toward target (snappy on, soft off)
    let dirty = false;
    for (let i = P; i < N; i++) {
      const cur = lit[i];
      const tgt = litTarget[i];
      const next = damp(cur, tgt, tgt > cur ? 14 : 6, dt);
      if (Math.abs(next - cur) > 0.001) {
        lit[i] = next;
        dirty = true;
      }
    }
    if (dirty) litAttr.needsUpdate = true;

    // --- crystal glow at the answer (blooms as the beams converge) ---
    crystal.u.uAlpha.value = conv * conv * (0.9 + 0.1 * Math.sin(clk * 2.0));

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      ptsGeo.dispose();
      ptsMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      probe.mesh.geometry.dispose();
      (probe.mesh.material as THREE.Material).dispose();
      crystal.mesh.geometry.dispose();
      (crystal.mesh.material as THREE.Material).dispose();
    });
  }

  return { tick, dispose };
}
