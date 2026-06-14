/* ============================================================================
   director3d.ts — the "Hollywood director" supporting art.

   "Think of yourself as a Hollywood director trying to tell a story ... making
   this presentation FUN is the number one non-negotiable requirement." So the
   stage IS a film set: a moody, warm-dark vignette (deep terracotta-brown, never
   black — paper still shows at the corners), a steerable volumetric SPOTLIGHT
   that you aim with the mouse, glinting DUST MOTES drifting inside its beam, and
   a 3D CLAPPERBOARD whose hinged top SNAPS shut on the iconic clap.

   Everything narrative is a pure function of the playhead `t` (via phase(t,a,b)),
   so scrubbing backward rewinds the clap, the lights, and the spark burst exactly:

     snap     phase(t, 263.1, 263.9)  clapper top closes; lights come up.
     funBurst phase(t, 278.5, 280.6)  on "make it fun, number one" warm sparks
                                      puff up out of the clapper into the beam.
     echo     phase(t, 284.0, 285.4)  a smaller second puff.

   makeClock() drives ONLY idle life: mote drift/twinkle + a faint beam flicker.

   Spirit of igloo.inc — frosted volume + warm fresnel + soft particle glow — but
   on the warm Paper palette. NormalBlending throughout with bright warm cores
   (ADDITIVE blows out to white on light paper); transparent + depthWrite:false
   for the glass/beam/particles. Built on the shared scene3d helper.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, clamp01, damp, TAU } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (all pinned to the words in en.vtt; scene base = SNAP_A) -- */
const SNAP_A = 263.1,
  SNAP_B = 263.9; // clapper SNAPS shut, vignette + beam fade in
const FUN_A = 278.5,
  FUN_B = 280.6; // "make it fun / number one" — spark burst
const ECHO_A = 284.0,
  ECHO_B = 285.4; // smaller echo puff

/* --- world layout -------------------------------------------------------- */
const FLOOR_Y = -1.15; // the stage floor the spotlight lands on
const BEAM_TOP_Y = 1.85; // spotlight apex (above frame)
const BEAM_LEN = BEAM_TOP_Y - FLOOR_Y;
const BEAM_R = 0.9; // beam radius at the floor
const AIM_RANGE = 0.92; // how far (world units) the mouse can drag the pool
const HALF_W = 1.95; // content half-extents for camera framing
const HALF_H = 1.55;
const CENTER_Y = -0.1;
const BASE_AZ = -0.17; // resting 3/4 azimuth (rad)
const BASE_EL = 0.1; // resting elevation (rad)
const FOV = 36;

/* ---- shaders ------------------------------------------------------------- */

// Vignette — a big background quad with a warm-dark radial pool that fades to
// transparent at the corners so the CSS paper still reads. uLit ramps it in.
const VIG_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const VIG_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uDark, uWarm;
  uniform float uLit, uAim, uAimX;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;           // -1..1
    p.x *= 1.18;                        // slightly wider so the pool is oval
    float r = length(p);
    // base cinematic darkness: strong in the centre, gone by the corners
    float dark = smoothstep(1.42, 0.18, r) * uLit;
    // a warmer pooled glow that drifts toward where the spotlight is aimed
    vec2 c = vec2(uAimX * 0.5, -0.18);
    float pool = smoothstep(1.05, 0.0, length(p - c)) * uAim * uLit;
    vec3 col = mix(uDark, uWarm, pool * 0.85);
    float a = clamp(dark * 0.9 + pool * 0.16, 0.0, 0.94);
    gl_FragColor = vec4(col, a);
  }
`;

// Volumetric spotlight cone — bright near the apex, fading to nothing at the
// rim and the base, so it reads as soft warm god-rays rather than solid plastic.
const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;                           // uv.y: 0 at base, 1 at apex (we build it so)
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCore, uEdge;
  uniform float uLit, uFlicker, uHover;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    // along the cone: bright at the apex (top), gone at the floor
    float along = smoothstep(0.0, 0.92, vUv.y);
    // across the cone wall: glow along the silhouette (grazing) reads as a beam
    float graze = pow(1.0 - clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.6);
    float body = along * (0.30 + 0.70 * graze);
    vec3 col = mix(uEdge, uCore, along * (0.5 + 0.5 * graze));
    float glow = body * (0.34 + 0.20 * uFlicker) * (0.78 + 0.42 * uHover) * uLit;
    gl_FragColor = vec4(col, clamp(glow, 0.0, 0.6));
  }
`;

// A soft warm disc where the beam lands on the floor — the "pool of light".
const POOL_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCore;
  uniform float uLit, uHover, uFlicker;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float d = length(uv);
    float a = smoothstep(1.0, 0.0, d);
    a = a * a;
    float glow = a * (0.30 + 0.16 * uHover + 0.06 * uFlicker) * uLit;
    gl_FragColor = vec4(uCore, clamp(glow, 0.0, 0.5));
  }
`;

// Dust motes — THREE.Points adrift inside the beam, brightening where the beam
// currently points (so steering the mouse "relights" them). Soft round sprites.
const MOTE_VERT = /* glsl */ `
  uniform float uTime, uPixelRatio, uSize, uLit, uHover;
  uniform vec3 uAim;                    // beam floor target (world)
  attribute vec3 aRand;                 // 0..1 stable per mote (phase + drift)
  attribute float aSeed;
  varying float vGlow;
  void main() {
    vec3 p = position;
    // slow buoyant drift; loops smoothly so it never pops
    float ph = aSeed * 6.2831;
    p.x += sin(uTime * (0.18 + aRand.x * 0.30) + ph) * 0.14;
    p.z += cos(uTime * (0.16 + aRand.y * 0.26) + ph * 1.3) * 0.14;
    p.y += sin(uTime * 0.22 + ph) * 0.10;
    // motes near the aimed pool (in x/z) light up — that's the mouse "relight"
    float d = length(p.xz - uAim.xz);
    float lit = smoothstep(1.05, 0.05, d);
    float tw = 0.5 + 0.5 * sin(uTime * 2.4 + aSeed * 40.0);   // per-mote twinkle
    vGlow = lit * (0.35 + 0.65 * tw) * (0.7 + 0.5 * uHover) * uLit;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.5 + 0.9 * vGlow);
  }
`;
const MOTE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  varying float vGlow;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.4, 0.0, d);
    vec3 col = mix(uColor, uHot, core * 0.7);
    float a = mask * vGlow;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  }
`;

// Spark/confetti burst — particles launch from the clapper on a ballistic arc
// driven purely by the burst progress (so it's reversible). Bright warm cores.
const SPARK_VERT = /* glsl */ `
  uniform float uProg, uEcho, uPixelRatio, uSize;
  uniform vec3 uOrigin;
  attribute vec3 aDir;                  // launch direction (mostly up + out)
  attribute float aSeed;
  attribute float aSet;                 // 0 = main burst, 1 = echo burst
  varying float vA;
  void main() {
    float g = mix(uProg, uEcho, aSet);  // this spark's own progress 0..1
    // ease-out launch + a little gravity settle; all a pure function of g
    float fly = 1.0 - pow(1.0 - g, 2.2);
    float speed = mix(0.9, 1.5, aSeed);
    vec3 p = uOrigin + aDir * fly * speed;
    p.y -= g * g * 0.55 * (0.6 + aSeed * 0.8);   // arc back down
    // brief flutter so confetti tumbles
    p.x += sin(g * 9.0 + aSeed * 30.0) * 0.05 * g;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float life = smoothstep(0.0, 0.12, g) * (1.0 - smoothstep(0.62, 1.0, g));
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.6 + 0.8 * life);
    vA = life;
  }
`;
const SPARK_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  varying float vA;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.45, 0.0, d);
    vec3 col = mix(uColor, uHot, core);
    float a = mask * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  }
`;

// Frosted clapper slats / body — a tiny fresnel-lit glass shader so the board
// catches the same warm rim light as the rest of the family.
const SLAB_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SLAB_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uRim;
  uniform float uLit, uAlpha;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    vec3 L = normalize(vec3(0.3, 0.95, 0.5));
    float lamb = clamp(dot(N, L), 0.0, 1.0) * 0.5 + 0.5;
    vec3 col = uColor * (0.30 + 0.55 * lamb * uLit);
    col = mix(col, uRim, fres * 0.75 * uLit);
    col += vec3(1.0, 0.95, 0.88) * pow(clamp(dot(N, L), 0.0, 1.0), 8.0) * 0.18 * uLit;
    float a = clamp(uAlpha + fres * 0.3, 0.0, 0.98);
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller ---------------------------------------------------------- */

export function mountDirector3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: FOV });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const pointer = trackPointer(canvas, camera, FLOOR_Y); // cursor on the stage floor
  const clock = makeClock();

  const MOTES = small ? 90 : 200;
  const SPARKS = small ? 90 : 170;

  // a hot, near-white warm tint for spark/mote cores (warm "glow" without ADD)
  const WHITE = new THREE.Color("#ffffff");
  const cHot = pal.accent.clone().lerp(WHITE, 0.55);
  const cWarmDark = pal.accentInk.clone().lerp(new THREE.Color("#2a1714"), 0.5); // deep terracotta-brown

  /* --- vignette (1 draw call) ------------------------------------------- */
  const vigGeo = new THREE.PlaneGeometry(2, 2);
  const vigU = {
    uDark: { value: cWarmDark },
    uWarm: { value: pal.accentInk.clone() },
    uLit: { value: 0 },
    uAim: { value: 0 },
    uAimX: { value: 0 },
  };
  const vigMat = new THREE.ShaderMaterial({
    uniforms: vigU,
    vertexShader: VIG_VERT,
    fragmentShader: VIG_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const vignette = new THREE.Mesh(vigGeo, vigMat);
  vignette.frustumCulled = false;
  vignette.renderOrder = -10; // always behind
  scene.add(vignette);

  /* --- spotlight cone + floor pool -------------------------------------- */
  // ConeGeometry: apex at +Y by default; we want apex up, open base at the floor.
  // Build UV so uv.y = 1 at apex, 0 at base (Three's cone uv already runs that way
  // top→bottom; we just sample it directly).
  const coneGeo = new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 40, 1, true);
  const beamU = {
    uCore: { value: pal.accent.clone().lerp(WHITE, 0.35) },
    uEdge: { value: pal.accent.clone() },
    uLit: { value: 0 },
    uFlicker: { value: 0 },
    uHover: { value: 0 },
  };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamU,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const beam = new THREE.Mesh(coneGeo, beamMat);
  beam.frustumCulled = false;
  // a holder so we can aim the whole cone by pivoting about the fixed apex
  const beamPivot = new THREE.Group();
  beamPivot.position.set(0, BEAM_TOP_Y, 0); // the fixed lamp position (apex)
  beam.position.set(0, -BEAM_LEN / 2, 0); // cone centre below the pivot → apex at pivot
  beamPivot.add(beam);
  scene.add(beamPivot);

  const poolGeo = new THREE.PlaneGeometry(BEAM_R * 2.4, BEAM_R * 2.4);
  const poolU = {
    uCore: { value: pal.accent.clone().lerp(WHITE, 0.45) },
    uLit: { value: 0 },
    uHover: { value: 0 },
    uFlicker: { value: 0 },
  };
  const poolMat = new THREE.ShaderMaterial({
    uniforms: poolU,
    vertexShader: VIG_VERT, // reuse: passes uv through
    fragmentShader: POOL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.rotation.x = -Math.PI / 2; // lay flat on the floor
  pool.position.y = FLOOR_Y + 0.002;
  pool.frustumCulled = false;
  scene.add(pool);

  /* --- dust motes (1 draw call) ----------------------------------------- */
  // seed inside a column roughly matching the beam volume
  const mPos = new Float32Array(MOTES * 3);
  const mRand = new Float32Array(MOTES * 3);
  const mSeed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    const rr = Math.sqrt(Math.random()) * BEAM_R * 0.95;
    const a = Math.random() * TAU;
    mPos[i * 3] = Math.cos(a) * rr;
    mPos[i * 3 + 1] = FLOOR_Y + Math.random() * (BEAM_LEN * 0.85);
    mPos[i * 3 + 2] = Math.sin(a) * rr;
    mRand[i * 3] = Math.random();
    mRand[i * 3 + 1] = Math.random();
    mRand[i * 3 + 2] = Math.random();
    mSeed[i] = Math.random();
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mPos, 3));
  moteGeo.setAttribute("aRand", new THREE.BufferAttribute(mRand, 3));
  moteGeo.setAttribute("aSeed", new THREE.BufferAttribute(mSeed, 1));
  const moteU = {
    uTime: { value: 0 },
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 26 : 30 },
    uLit: { value: 0 },
    uHover: { value: 0 },
    uAim: { value: new THREE.Vector3(0, FLOOR_Y, 0) },
    uColor: { value: pal.accent.clone() },
    uHot: { value: cHot },
  };
  const moteMat = new THREE.ShaderMaterial({
    uniforms: moteU,
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  /* --- spark burst (1 draw call) ---------------------------------------- */
  const sDir = new Float32Array(SPARKS * 3);
  const sSeed = new Float32Array(SPARKS);
  const sSet = new Float32Array(SPARKS);
  for (let i = 0; i < SPARKS; i++) {
    // mostly upward, spread outward into a fountain cone
    const a = Math.random() * TAU;
    const spread = 0.35 + Math.random() * 0.7;
    sDir[i * 3] = Math.cos(a) * spread;
    sDir[i * 3 + 1] = 1.1 + Math.random() * 0.9; // strong up component
    sDir[i * 3 + 2] = Math.sin(a) * spread;
    sSeed[i] = Math.random();
    sSet[i] = i % 3 === 0 ? 1 : 0; // ~1/3 belong to the echo puff
  }
  const sparkGeo = new THREE.BufferGeometry();
  // a static position buffer (origin) so Three has a `position` attribute;
  // the shader ignores it and rebuilds from uOrigin + aDir.
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  sparkGeo.setAttribute("aDir", new THREE.BufferAttribute(sDir, 3));
  sparkGeo.setAttribute("aSeed", new THREE.BufferAttribute(sSeed, 1));
  sparkGeo.setAttribute("aSet", new THREE.BufferAttribute(sSet, 1));
  const sparkU = {
    uProg: { value: 0 },
    uEcho: { value: 0 },
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 34 : 42 },
    uOrigin: { value: new THREE.Vector3(0, FLOOR_Y + 0.55, 0.18) }, // out of the clapper mouth
    uColor: { value: pal.accent.clone() },
    uHot: { value: cHot },
  };
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: sparkU,
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);

  /* --- clapperboard ------------------------------------------------------ */
  // a body slab + a hinged top bar (with diagonal stripe segments) that snaps
  // shut on the hinge at the back-top corner of the body.
  const clapper = new THREE.Group();
  clapper.position.set(0, FLOOR_Y, 0);
  clapper.rotation.y = 0.16; // slight 3/4 turn for depth
  scene.add(clapper);

  const BODY_W = 1.0,
    BODY_H = 0.62,
    BODY_D = 0.12;
  const cleanup: { dispose(): void }[] = [];
  function track<T extends { dispose(): void }>(o: T): T {
    cleanup.push(o);
    return o;
  }

  const slabMat = track(
    new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: pal.glass.clone() },
        uRim: { value: pal.accent.clone() },
        uLit: { value: 0 },
        uAlpha: { value: 0.5 },
      },
      vertexShader: SLAB_VERT,
      fragmentShader: SLAB_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    }),
  );

  const bodyGeo = track(new THREE.BoxGeometry(BODY_W, BODY_H, BODY_D));
  const body = new THREE.Mesh(bodyGeo, slabMat);
  body.position.set(0, BODY_H / 2 + 0.05, 0);
  clapper.add(body);

  // the hinged top bar pivots about its left end (the hinge), sitting just above
  // the body. Closed = horizontal (rests on body); open = rotated up.
  const TOP_W = BODY_W,
    TOP_H = 0.16,
    TOP_D = BODY_D;
  const topPivot = new THREE.Group();
  topPivot.position.set(-BODY_W / 2, BODY_H + 0.06, 0); // hinge at the top-left corner
  clapper.add(topPivot);

  const topBar = new THREE.Group();
  topBar.position.set(TOP_W / 2, 0, 0); // bar centred to the right of the hinge
  topPivot.add(topBar);

  const barGeo = track(new THREE.BoxGeometry(TOP_W, TOP_H, TOP_D));
  const bar = new THREE.Mesh(barGeo, slabMat);
  topBar.add(bar);

  // diagonal stripe segments alternating accent / paper across the bar face
  const STRIPES = 5;
  const stripeGeo = track(new THREE.BoxGeometry(TOP_W / STRIPES, TOP_H * 0.96, 0.02));
  const stripeAccent = track(new THREE.MeshBasicMaterial({ color: pal.accent.clone(), transparent: true }));
  const stripePaper = track(new THREE.MeshBasicMaterial({ color: pal.paper.clone(), transparent: true }));
  const stripeMats = [stripeAccent, stripePaper];
  for (let i = 0; i < STRIPES; i++) {
    const s = new THREE.Mesh(stripeGeo, stripeMats[i % 2]);
    s.position.set(-TOP_W / 2 + (i + 0.5) * (TOP_W / STRIPES), 0, TOP_D / 2 + 0.001);
    s.rotation.z = 0.32; // the iconic diagonal slant
    topBar.add(s);
  }

  const OPEN_ANGLE = -0.95; // open: top bar lifted up (rad about hinge, +Z)
  const CLOSED_ANGLE = 0.0;

  /* --- camera framing (fit a tall mobile box AND a wide desktop box) ----- */
  const tanH = Math.tan((FOV * Math.PI) / 360);
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const zH = HALF_H / tanH;
    const zW = HALF_W / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.16;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, CENTER_Y + Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, CENTER_Y, 0);
    // keep the vignette quad filling the view, parked just in front of the far plane
    const fillDepth = camDist * 1.8;
    const fillH = 2 * tanH * fillDepth;
    vignette.scale.set((fillH * aspect) / 2, fillH / 2, 1);
    vignette.position.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), fillDepth);
    vignette.quaternion.copy(camera.quaternion);
  });

  try {
    stage.renderer.compile(scene, camera);
  } catch {
    /* best-effort precompile */
  }

  /* --- aim state -------------------------------------------------------- */
  const aim = new THREE.Vector3(0, FLOOR_Y, 0); // damped beam floor target
  const tmpDir = new THREE.Vector3();
  const apex = new THREE.Vector3(0, BEAM_TOP_Y, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();

  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock(); // idle = wall-clock seconds for non-narrative drift/flicker
    pointer.update(dt);

    // narrative phases (pure functions of the playhead)
    const snap = phase(t, SNAP_A, SNAP_B);
    const lit = smooth(snap); // lights come up with the clap
    const funBurst = phase(t, FUN_A, FUN_B);
    const echo = phase(t, ECHO_A, ECHO_B);

    // --- clapper snap: top rotates open→closed, with a tiny overshoot bounce ---
    // before the scene base the board sits OPEN; snap drives it shut by SNAP_B.
    const closeP = lit;
    const bounce = Math.sin(closeP * Math.PI) * (1 - closeP) * 0.18; // settles to 0
    topPivot.rotation.z = OPEN_ANGLE * (1 - closeP) + CLOSED_ANGLE * closeP - bounce;

    // --- steer the spotlight toward the cursor on the floor ---
    const px = clamp01((pointer.world.x / AIM_RANGE + 1) / 2) * 2 - 1; // -1..1 clamped
    const pz = clamp01(((pointer.world.y - FLOOR_Y) / AIM_RANGE + 1) / 2) * 2 - 1;
    // target floor point (mouse present pulls it; otherwise relax to centre)
    const tgX = px * AIM_RANGE * pointer.hover;
    const tgZ = pz * AIM_RANGE * pointer.hover - 0.05; // bias slightly toward camera
    aim.x = damp(aim.x, tgX, 6, dt);
    aim.z = damp(aim.z, tgZ, 6, dt);

    // aim the cone: rotate the pivot so the apex→floor axis points at `aim`
    tmpDir.set(aim.x - apex.x, aim.y - apex.y, aim.z - apex.z).normalize();
    // default cone axis (apex→base) is -Y in pivot space; rotate -Y onto tmpDir
    q.setFromUnitVectors(yAxis.clone().negate(), tmpDir);
    beamPivot.quaternion.copy(q);
    pool.position.set(aim.x, FLOOR_Y + 0.002, aim.z);

    // --- vignette / beam / pool light levels + idle flicker ---
    const flick = 0.6 + 0.4 * Math.sin(idle * 9.0) * Math.sin(idle * 3.3); // alive, never strobing
    vigU.uLit.value = lit;
    vigU.uAim.value = lit;
    vigU.uAimX.value = aim.x / AIM_RANGE;
    beamU.uLit.value = lit;
    beamU.uFlicker.value = flick;
    beamU.uHover.value = pointer.hover;
    poolU.uLit.value = lit;
    poolU.uHover.value = pointer.hover;
    poolU.uFlicker.value = flick;

    // --- motes drift + relight under the aimed pool ---
    moteU.uTime.value = idle;
    moteU.uLit.value = lit;
    moteU.uHover.value = pointer.hover;
    moteU.uAim.value.set(aim.x, FLOOR_Y, aim.z);

    // --- spark burst: launches from the clapper into the beam (reversible) ---
    sparkU.uProg.value = funBurst;
    sparkU.uEcho.value = echo;

    // frosted board picks up the room light
    slabMat.uniforms.uLit.value = lit;

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      vigGeo.dispose();
      vigMat.dispose();
      coneGeo.dispose();
      beamMat.dispose();
      poolGeo.dispose();
      poolMat.dispose();
      moteGeo.dispose();
      moteMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      for (const o of cleanup) o.dispose();
    });
  }

  return { tick, dispose };
}
