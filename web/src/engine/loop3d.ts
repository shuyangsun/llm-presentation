/* ============================================================================
   loop3d.ts — the finale: a closed loop that OPENS toward you.

   The closing image of the talk, "the open and close loop":

     CLOSED — a glowing frosted-glass TORUS (the ring) with a single bright
     COMET orbiting it forever. That endless circuit is the self-improving
     loop: model → output → feedback → better model, iterating on its own.

     OPEN — on "I'm going to open the loop now" a contiguous run of the ring's
     segments DISSOLVES, a gap opens, and the whole ring rotates so that gap
     turns to FACE the viewer. The comet flies to the opening and PARKS there,
     pulsing toward the camera (toward YOU). The closed circuit is broken on
     purpose: the loop now waits for the human to step in and add value.

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing backward re-closes the ring and re-launches the comet exactly.
   The orbit sweep, fresnel shimmer and the parked comet's pulse are the only
   idle (wall-clock) motion. Mouse: ndc.x spins the ring group so you can
   inspect the 3D torus, and hovering brightens the comet and the gap rim.

   Igloo.inc in spirit — frosted volume + terracotta fresnel rim + warm glow —
   but on warm Paper, never icy blue. NormalBlending with a bright warm core so
   the glow reads on light paper instead of blowing out the way ADDITIVE would.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, damp, TAU } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_APPEAR_A = 343.4; // ring + comet fade in (closed)
const T_APPEAR_B = 345.0;
const T_OPEN_A = 349.95; // "open the loop now" — gap dissolves, ring faces you
const T_OPEN_B = 351.6;

/* --- world layout ------------------------------------------------------- */
const RING_R = 1.0; // torus centre-line radius
const TUBE_R = 0.2; // tube radius (segment half-size)
const GAP_CENTER = -Math.PI / 2; // angle the gap opens at (bottom of the ring in its local frame)
const GAP_HALF = 0.62; // half-width of the dissolved run, in radians
const BASE_AZ = -0.34; // resting 3/4 azimuth of the camera (rad)
const BASE_EL = 0.26; // resting elevation (rad)
const SPIN_RANGE = 0.9; // how far ndc.x can spin the ring group (rad)

/* ---- shaders ----------------------------------------------------------- */

// Frosted-glass ring segments. Each instance carries its angle θ around the
// ring; the gap is computed in the shader from uGapCenter/uGapHalf/uOpen so the
// dissolving run is a smooth alpha falloff — no geometry rebuilt per frame.
const RING_VERT = /* glsl */ `
  uniform float uAppear;
  attribute float aTheta;
  attribute float aSeed;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vTheta;
  varying float vSeed;

  void main() {
    vUv = uv;
    vTheta = aTheta;
    vSeed = aSeed;
    vec3 p = position;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vV = normalize(cameraPosition - worldPos.xyz);
    // gentle scale-in from the centre as the ring appears
    vec4 mv = viewMatrix * worldPos;
    mv.xyz *= mix(0.82, 1.0, uAppear);
    gl_Position = projectionMatrix * mv;
  }
`;

const RING_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uGlass, uRim, uHot;
  uniform float uAppear, uOpen, uGapCenter, uGapHalf, uHover;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vTheta;
  varying float vSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // shortest angular distance to the gap centre
  float angDist(float a, float b) {
    float d = abs(a - b);
    return min(d, 6.2831853 - d);
  }

  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);

    // faceted-ice edge glow on each segment's silhouette
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.2, em);

    float frost = mix(0.78, 1.0, hash(floor(vec2(vUv.x * 10.0 + vSeed * 9.0, vUv.y * 14.0))));
    vec3 L = normalize(vec3(0.35, 0.85, 0.5));
    float spec = pow(clamp(dot(N, L), 0.0, 1.0), 7.0);
    float topL = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);

    vec3 core = uGlass * (frost * 0.62 + 0.18) + uGlass * topL * 0.12;
    vec3 rim = mix(uRim, uHot, uHover * 0.5);
    vec3 col = mix(core, rim, max(fres * 0.72, edge * 0.6));
    col += vec3(1.0, 0.96, 0.9) * spec * 0.22;
    col = mix(col, uPaper, 0.05);

    // the GAP: segments within uGapHalf of the gap centre dissolve as uOpen rises.
    float gd = angDist(vTheta, uGapCenter);
    float inGap = 1.0 - smoothstep(uGapHalf * 0.55, uGapHalf, gd); // 1 deep in the gap
    float cut = inGap * uOpen;
    // the two segments flanking the opening glow hotter — the "broken" rim ends.
    float lip = smoothstep(uGapHalf * 1.4, uGapHalf, gd) * (1.0 - inGap) * uOpen;
    col = mix(col, uHot, lip * (0.4 + 0.4 * uHover));

    float alpha = clamp(0.34 + fres * 0.42 + edge * 0.4, 0.0, 0.96);
    alpha *= uAppear * (1.0 - cut);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// Comet head + its trailing points. A per-point age (0 = head, 1 = tail end)
// fades alpha and shrinks the point along the trail.
const COMET_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize, uAppear, uPulse;
  attribute float aAge;          // 0 head .. 1 tail
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float taper = 1.0 - aAge;                       // head largest
    float pulse = mix(1.0, uPulse, step(aAge, 0.001)); // only the head pulses
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.3 + 0.7 * taper) * pulse;
    vA = uAppear * (0.15 + 0.85 * taper);
  }
`;

const COMET_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCore, uGlow;
  varying float vA;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float halo = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.42, 0.0, d);
    vec3 col = mix(uGlow, uCore, core);
    float a = halo * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller -------------------------------------------------------- */

export function mountLoop3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: 36 });
  const { renderer, scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const clock = makeClock();
  // spin the ring group, so pointer also reads ndc — track on the z=0 plane.
  const pointer = trackPointer(canvas, camera, 0);

  const SEG = small ? 80 : 140; // ring segment instances (1 draw call)
  const TRAIL = small ? 22 : 34; // comet trail points (incl. head)
  const hot = pal.accentInk.clone().lerp(new THREE.Color("#ffffff"), 0.3);

  // group lets us rotate the whole torso of the ring (gap faces camera on open).
  const group = new THREE.Group();
  scene.add(group);

  /* --- ring segments ---------------------------------------------------- */
  // Each instance is a short, slightly-rounded bar laid tangent to the ring,
  // tube-sized so the run of them reads as one frosted torus.
  const segLen = (TAU * RING_R) / SEG;
  const segGeo = new THREE.BoxGeometry(segLen * 1.18, TUBE_R * 2, TUBE_R * 2, 1, 1, 1);
  const segTheta = new Float32Array(SEG);
  const segSeed = new Float32Array(SEG);
  segGeo.setAttribute("aTheta", new THREE.InstancedBufferAttribute(segTheta, 1));
  segGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(segSeed, 1));

  const ringU = {
    uAppear: { value: 0 },
    uOpen: { value: 0 },
    uGapCenter: { value: GAP_CENTER },
    uGapHalf: { value: GAP_HALF },
    uHover: { value: 0 },
    uPaper: { value: pal.paper },
    uGlass: { value: pal.glass },
    uRim: { value: pal.accent },
    uHot: { value: hot },
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
  const ring = new THREE.InstancedMesh(segGeo, ringMat, SEG);
  ring.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  ring.frustumCulled = false;

  // place segments around a circle in the XY plane, each rotated to lie tangent.
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos3 = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < SEG; i++) {
    const th = (i / SEG) * TAU;
    segTheta[i] = th;
    segSeed[i] = Math.random();
    pos3.set(Math.cos(th) * RING_R, Math.sin(th) * RING_R, 0);
    q.setFromAxisAngle(zAxis, th + Math.PI / 2); // long axis follows the tangent
    m4.compose(pos3, q, scl);
    ring.setMatrixAt(i, m4);
  }
  ring.instanceMatrix.needsUpdate = true;
  group.add(ring);

  /* --- comet (head + trail, 1 draw call) -------------------------------- */
  const cometPos = new Float32Array(TRAIL * 3);
  const cometAge = new Float32Array(TRAIL);
  for (let i = 0; i < TRAIL; i++) cometAge[i] = i / (TRAIL - 1);
  const cometGeo = new THREE.BufferGeometry();
  const cometPosAttr = new THREE.BufferAttribute(cometPos, 3);
  cometPosAttr.setUsage(THREE.DynamicDrawUsage);
  cometGeo.setAttribute("position", cometPosAttr);
  cometGeo.setAttribute("aAge", new THREE.BufferAttribute(cometAge, 1));

  const cometU = {
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 110 : 150 },
    uAppear: { value: 0 },
    uPulse: { value: 1 },
    uCore: { value: new THREE.Color("#fff3ea") },
    uGlow: { value: pal.accent },
  };
  const cometMat = new THREE.ShaderMaterial({
    uniforms: cometU,
    vertexShader: COMET_VERT,
    fragmentShader: COMET_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const comet = new THREE.Points(cometGeo, cometMat);
  comet.frustumCulled = false;
  group.add(comet);

  // ring-path position for a given angle θ, in the group's local frame.
  const ORBIT_SPEED = 0.9; // rad/s while closed (idle, non-narrative)
  const TRAIL_SPACING = 0.05; // rad between consecutive trail points
  function ringPoint(theta: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(theta) * RING_R, Math.sin(theta) * RING_R, 0);
  }
  // damped comet angle so it eases from its free orbit to the parked gap angle.
  let cometTheta = GAP_CENTER + Math.PI; // start opposite the gap
  let cometInit = false;
  const headTmp = new THREE.Vector3();

  /* --- camera framing --------------------------------------------------- */
  const tanH = Math.tan((36 * Math.PI) / 360);
  const center = new THREE.Vector3(0, 0, 0);
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    // content half-extents: ring + tube, with headroom for the comet's halo.
    const half = RING_R + TUBE_R + 0.35;
    const zH = half / tanH;
    const zW = half / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.16;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(center);
  });

  /* --- frame ------------------------------------------------------------ */
  let disposed = false;
  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();
    pointer.update(dt);

    // narrative phases (pure functions of the playhead)
    const appear = phase(t, T_APPEAR_A, T_APPEAR_B);
    const openP = phase(t, T_OPEN_A, T_OPEN_B);

    ringU.uAppear.value = appear;
    ringU.uOpen.value = openP;
    cometU.uAppear.value = appear;

    // hover brightens the comet glow + gap rim.
    const hov = pointer.hover;
    ringU.uHover.value = hov;

    // open rotates the gap to FACE the camera. The gap sits at GAP_CENTER (the
    // ring's local -Y, its bottom), so the move that brings it to the lens is a
    // tilt about X: a negative rotation swings the bottom of the ring up and
    // toward +Z (toward us), turning the opening to face the viewer. We stop short
    // of a full quarter turn so the torus stays read as a ring (not edge-on) while
    // the broken arc still presents toward the lens.
    group.rotation.x = openP * -1.0;
    // ndc.x lets the viewer spin the torus about its vertical axis to inspect it.
    const spinY = pointer.ndc.x * SPIN_RANGE * (0.4 + 0.6 * hov);
    group.rotation.y = spinY;

    // comet angle: free orbit while closed, eased toward the gap centre on open.
    const orbitTheta = GAP_CENTER + Math.PI + idle * ORBIT_SPEED;
    if (!cometInit) {
      cometTheta = orbitTheta;
      cometInit = true;
    }
    // target = orbit when closed, parked at the gap centre when open.
    const parkBlend = smooth(openP);
    // unwrap the orbit target near the parked angle so the comet takes the short
    // way into the gap rather than spinning multiple turns as openP ramps.
    const target = orbitTheta * (1 - parkBlend) + nearestAngle(orbitTheta, GAP_CENTER) * parkBlend;
    cometTheta = damp(cometTheta, target, 4 + 6 * parkBlend, dt);

    // parked comet pulses toward the camera (toward YOU).
    const park = parkBlend;
    cometU.uPulse.value = 1 + park * (0.55 + 0.25 * hov) * (0.5 + 0.5 * Math.sin(idle * 3.4));
    cometU.uGlow.value = pal.accent.clone().lerp(hot, hov * 0.6 + park * 0.25);

    // lay the trail points back along the ring path behind the head; as it parks
    // the trail shortens (spacing eases to ~0) so the comet gathers at the gap.
    const spacing = TRAIL_SPACING * (1 - 0.85 * park);
    // when parked, push the head radially OUT through the opening (local -Y at the
    // gap). The open-tilt about X that faces the gap to the lens maps local -Y onto
    // mostly world +Z, so this reads as the comet pulsing forward toward YOU.
    const fwd = park * 0.18 * (0.6 + 0.4 * Math.sin(idle * 3.4));
    for (let i = 0; i < TRAIL; i++) {
      ringPoint(cometTheta - i * spacing, headTmp);
      const push = i === 0 ? fwd : fwd * (1 - i / TRAIL);
      cometPos[i * 3] = headTmp.x;
      cometPos[i * 3 + 1] = headTmp.y - push;
      cometPos[i * 3 + 2] = headTmp.z;
    }
    cometPosAttr.needsUpdate = true;

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      segGeo.dispose();
      ringMat.dispose();
      cometGeo.dispose();
      cometMat.dispose();
    });
  }

  // return the angle congruent to `to` (mod TAU) that is nearest to `from`, so a
  // damp between them never takes the long way round the circle.
  function nearestAngle(from: number, to: number): number {
    let d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return from + d;
  }

  // warm-compile so the first visible frame isn't a stall.
  try {
    renderer.compile(scene, camera);
  } catch {
    /* best-effort */
  }

  return { tick, dispose };
}
