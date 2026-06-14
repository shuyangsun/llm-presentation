/* ============================================================================
   responsive3d.ts — the 3D "responsive layout" supporting art.

   ONE glass device — a rounded frosted slab standing in for a screen — that
   physically ROTATES from PORTRAIT (a phone) to LANDSCAPE (a desktop) while its
   inner content TILES smoothly REFLOW between two arrangements as it crosses the
   breakpoint. Responsiveness *is* the content:

     PORTRAIT / mobile  — a "video" tile on TOP, content blocks STACKED below it.
     LANDSCAPE / desktop — the "video" tile docked to the SIDE, content beside it.

   Like asr3d, everything narrative is a pure function of the playhead `t` built
   from `phase(t,a,b)`, so scrubbing BACKWARD rewinds the rotation + reflow
   exactly. The wall-clock is used ONLY for the idle float/breath so a parked
   device never freezes, and the mouse adds a purely-additive parallax spin (plus
   a tiny breakpoint nudge) layered on top of the t-driven pose.

   Igloo.inc is the spirit — frosted-glass volume, terracotta fresnel rim, a soft
   warm core glow — palette kept on warm Paper, never icy blue. ColorManagement
   is OFF globally, so colours are authored + emitted in sRGB to match the DOM.
   ============================================================================ */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createStage, palette, trackPointer, makeClock, phase, smooth } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) ---------------------------------------- */
const T_APPEAR_A = 222.7; // device fades/scales in, PORTRAIT, content stacked
const T_APPEAR_B = 224.2;
const T_REFLOW_A = 234.6; // "instead of putting it to the side / make it horizontal"
const T_REFLOW_B = 237.0; // device is LANDSCAPE, tiles docked side-by-side

/* --- device half-extents, in the two states (world units) ---------------- */
// The slab keeps a constant area-ish footprint; only its aspect morphs. Half
// width/height interpolate by `reflow`; the camera frames the larger envelope.
const DEV_DEPTH = 0.12; // slab thickness (the glass body)
const PORT_HW = 0.62; // portrait half-width  (narrow)
const PORT_HH = 1.18; // portrait half-height (tall)
const LAND_HW = 1.34; // landscape half-width (wide)
const LAND_HH = 0.86; // landscape half-height (short)
const PAD = 0.14; // inner margin from the device edge to the tile field
const TILE_DEPTH = 0.05; // inner tiles float just proud of the front face
const TILE_GAP = 0.06; // gap between content blocks

/* A tile rectangle in the device's LOCAL face space (centre x/y, half w/h). */
interface Rect {
  x: number;
  y: number;
  hw: number;
  hh: number;
}
const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  hw: a.hw + (b.hw - a.hw) * k,
  hh: a.hh + (b.hh - a.hh) * k,
});

/* Build the two layouts for a given device size. PORTRAIT: video on top, three
   content blocks stacked below. LANDSCAPE: video docked left, content stacked to
   its right. Returns matched [video, c0, c1, c2] rect arrays. */
function layoutPortrait(hw: number, hh: number): Rect[] {
  const ix = hw - PAD; // inner half-width
  const iy = hh - PAD; // inner half-height
  const videoHH = iy * 0.42; // video occupies the top ~42%
  const top = iy - videoHH; // y of the video centre
  const stackTop = top - videoHH - TILE_GAP; // top edge of the content stack
  const stackH = stackTop - -iy; // remaining height for 3 blocks
  const blockHH = (stackH - 2 * TILE_GAP) / 6; // half-height of one block
  const bx = ix; // full-width content
  const c = (n: number): Rect => ({
    x: 0,
    y: stackTop - blockHH - n * (blockHH * 2 + TILE_GAP),
    hw: bx,
    hh: blockHH,
  });
  return [{ x: 0, y: top, hw: ix, hh: videoHH }, c(0), c(1), c(2)];
}

function layoutLandscape(hw: number, hh: number): Rect[] {
  const ix = hw - PAD;
  const iy = hh - PAD;
  const videoHW = ix * 0.46; // video docks to the left ~46%
  const left = -ix + videoHW; // x of the video centre
  const colLeft = left + videoHW + TILE_GAP; // left edge of the content column
  const colW = ix - colLeft; // width left for the stacked blocks (colLeft → right inner edge +ix)
  const colHW = colW / 2;
  const cx = colLeft + colHW; // content column centre x
  const blockHH = (2 * iy - 2 * TILE_GAP) / 6;
  const c = (n: number): Rect => ({
    x: cx,
    y: iy - blockHH - n * (blockHH * 2 + TILE_GAP),
    hw: colHW,
    hh: blockHH,
  });
  return [{ x: left, y: 0, hw: videoHW, hh: iy }, c(0), c(1), c(2)];
}

const N_TILES = 4; // [video, content×3] — one instanced draw call

/* --- glass shader (frosted volume + terracotta fresnel rim) -------------- */
// Shared by the device frame and the inner tiles; `uTint` mixes the body toward
// terracotta (1 for the video tile, 0 for neutral content), `uGlow` lifts a warm
// core so it reads on light paper with NormalBlending (additive would blow out).
// Tile variant: instanced, with a per-instance `aTint` (1 = the video tile).
const TILE_VERT = /* glsl */ `
  attribute float aTint;
  varying float vTint;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vTint = aTint;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
// Frame variant: same look without the instanceMatrix (a single mesh).
const FRAME_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
// The tint amount comes from a uniform (frame: one mesh) or a varying (tiles:
// per-instance). `tintExpr` is the GLSL that yields it, `decl` declares whatever
// it references — so the two materials share one body with no dead uniforms.
const glassFrag = (decl: string, tintExpr: string): string => /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uGlass, uTintCol, uRim;
  uniform float uGlow, uAlpha, uReveal;
  ${decl}
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    // rounded-rect edge glow from the face UVs (the "faceted ice" rim)
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.16, em);
    vec3 L = normalize(vec3(0.35, 0.85, 0.6));
    float spec = pow(clamp(dot(N, L), 0.0, 1.0), 7.0);
    float topL = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 body = mix(uGlass, uTintCol, ${tintExpr});     // video tile leans terracotta
    vec3 core = body * (0.66 + 0.18 * topL) + body * uGlow * 0.4;
    vec3 col = mix(core, uRim, max(fres * 0.7, edge * 0.55));
    col += vec3(1.0, 0.96, 0.9) * spec * 0.2;
    col = mix(col, uPaper, 0.04);
    float a = clamp(uAlpha + fres * 0.4 + edge * 0.34, 0.0, 0.96) * uReveal;
    gl_FragColor = vec4(col, a);
  }
`;
const FRAME_FRAG = glassFrag("uniform float uTint;", "uTint");
const TILE_FRAG = glassFrag("varying float vTint;", "vTint");

/* --- soft warm core glow behind the device (1 textured quad) ------------- */
const GLOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5));
    float g = smoothstep(0.5, 0.0, d);          // radial falloff
    float a = g * g * uAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export function mountResponsive3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: 32 });
  const { scene, camera, canvas } = stage;
  const pal = palette();
  const pointer = trackPointer(canvas, camera, 0);
  const clock = makeClock();

  /* --- precompute both layouts for the two device sizes -------------------- */
  // Tile rects live in the LARGEST face space; we lerp the device size and the
  // rects together by `reflow`, so a tile always sits inside its frame.
  const portRects = layoutPortrait(PORT_HW, PORT_HH);
  const landRects = layoutLandscape(LAND_HW, LAND_HH);

  /* --- device frame (single rounded glass slab) ---------------------------- */
  // Built unit-sized (1×1×depth) and scaled per-frame to the morphing aspect, so
  // there is never a per-frame geometry rebuild.
  const frameGeo = new RoundedBoxGeometry(1, 1, DEV_DEPTH, 4, DEV_DEPTH * 0.5);
  const frameU = {
    uPaper: { value: pal.paper },
    uGlass: { value: pal.glass },
    uTintCol: { value: pal.accent },
    uRim: { value: pal.accent },
    uTint: { value: 0 },
    uGlow: { value: 0.5 },
    uAlpha: { value: 0.22 },
    uReveal: { value: 0 },
  };
  const frameMat = new THREE.ShaderMaterial({
    uniforms: frameU,
    vertexShader: FRAME_VERT,
    fragmentShader: FRAME_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const device = new THREE.Group(); // holds frame + tiles; we rotate/scale this
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.frustumCulled = false;
  device.add(frame);
  scene.add(device);

  /* --- inner tiles (one instanced rounded-box mesh) ------------------------ */
  const tileGeo = new RoundedBoxGeometry(1, 1, TILE_DEPTH, 3, TILE_DEPTH * 0.5);
  const tintArr = new Float32Array(N_TILES); // 1 = video tile, 0 = content
  tintArr[0] = 1;
  tileGeo.setAttribute("aTint", new THREE.InstancedBufferAttribute(tintArr, 1));
  const tileU = {
    uPaper: { value: pal.paper },
    uGlass: { value: pal.surface.clone().lerp(pal.glass, 0.25) }, // neutral content body
    uTintCol: { value: pal.accent.clone().lerp(pal.glass, 0.15) }, // video tile tone
    uRim: { value: pal.accent },
    uGlow: { value: 0.35 },
    uAlpha: { value: 0.32 },
    uReveal: { value: 0 },
  };
  const tileMat = new THREE.ShaderMaterial({
    uniforms: tileU,
    vertexShader: TILE_VERT, // per-instance aTint -> vTint -> body mix
    fragmentShader: TILE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, N_TILES);
  tiles.frustumCulled = false;
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  device.add(tiles);
  const tileM4 = new THREE.Matrix4();

  /* --- soft warm core glow (1 quad, always facing the camera plane) -------- */
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glowU = { uColor: { value: pal.accent.clone().lerp(pal.paper, 0.35) }, uAlpha: { value: 0 } };
  const glowMat = new THREE.ShaderMaterial({
    uniforms: glowU,
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.frustumCulled = false;
  glow.position.set(0, 0, -0.6); // sits behind the device
  scene.add(glow);

  /* --- camera framing: fit BOTH the tall portrait box AND the wide landscape
     envelope so neither orientation clips on mobile or desktop. -------------- */
  const FOV = 32;
  const tanH = Math.tan((FOV * Math.PI) / 360);
  const BASE_AZ = -0.32; // resting 3/4 azimuth (rad)
  const BASE_EL = 0.16; // resting elevation (rad)
  let camDist = 6;
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    // worst-case envelope across the whole reflow: tallest height, widest width
    const halfH = Math.max(PORT_HH, LAND_HH) + 0.35;
    const halfW = Math.max(PORT_HW, LAND_HW) + 0.35;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    camDist = Math.max(zH, zW) * 1.18;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
  });

  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();
    pointer.update(dt);

    /* narrative phases — pure functions of the playhead ---------------------- */
    const appear = phase(t, T_APPEAR_A, T_APPEAR_B);
    // hover may bias the breakpoint a touch earlier/later, but only ADDITIVELY
    // and clamped so it can never fight or overshoot the t-driven reflow.
    const bias = pointer.ndc.y * 0.6; // -0.6..0.6 s of nudge while hovering
    const reflow = smooth((t - (T_REFLOW_A - bias)) / (T_REFLOW_B - T_REFLOW_A));

    /* device size + orientation morph -------------------------------------- */
    const hw = PORT_HW + (LAND_HW - PORT_HW) * reflow;
    const hh = PORT_HH + (LAND_HH - PORT_HH) * reflow;
    frame.scale.set(hw * 2, hh * 2, 1);

    // entrance: scale-in pop + the t-driven rotation; idle breath + mouse spin
    // are purely additive so the reflow read stays clean.
    const pop = 0.82 + 0.18 * appear;
    const breath = Math.sin(idle * 0.7) * 0.025;
    device.scale.setScalar(pop + breath);
    const spin = pointer.ndc.x * 0.6 * pointer.hover; // mouse turns it in 3D
    const float = Math.sin(idle * 0.9) * 0.05; // gentle idle drift
    // The aspect morph (tall → wide) already carries portrait → landscape; the
    // device only needs a flip-and-SETTLE flourish that peaks mid-reflow and
    // returns face-on at both ends — a full 90° turn would go edge-on (a sliver)
    // at the midpoint and hide the content. The camera's 3/4 azimuth gives the 3D.
    const flip = Math.sin(reflow * Math.PI) * 0.42;
    device.rotation.y = flip + spin;
    device.rotation.x = -0.04 + float * 0.4;
    device.position.y = float * 0.18;

    /* inner tiles reflow: lerp each rect, place on the front face ------------ */
    for (let i = 0; i < N_TILES; i++) {
      const r = lerpRect(portRects[i], landRects[i], reflow);
      tileM4.makeScale(Math.max(0.02, r.hw * 2), Math.max(0.02, r.hh * 2), 1);
      tileM4.setPosition(r.x, r.y, DEV_DEPTH * 0.5 + TILE_DEPTH * 0.5);
      tiles.setMatrixAt(i, tileM4);
    }
    tiles.instanceMatrix.needsUpdate = true;

    /* reveals + warm glow --------------------------------------------------- */
    frameU.uReveal.value = appear;
    tileU.uReveal.value = appear;
    // tiles fade up a beat after the frame so the device "boots" its content
    tileU.uAlpha.value = 0.32 * smooth((appear - 0.35) / 0.65);
    glow.scale.set(hw * 4.2, hh * 4.2, 1);
    glowU.uAlpha.value = (0.16 + 0.06 * Math.sin(idle * 1.3)) * appear;

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      frameGeo.dispose();
      frameMat.dispose();
      tileGeo.dispose();
      tileMat.dispose();
      glowGeo.dispose();
      glowMat.dispose();
    });
  }

  return { tick, dispose };
}
