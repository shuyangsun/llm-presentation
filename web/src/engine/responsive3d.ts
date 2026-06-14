/* ============================================================================
   responsive3d.ts — the 3D "mobile layout" supporting art.

   ONE glass device — a rounded frosted slab standing in for a PHONE held in
   PORTRAIT — whose inner "video" tile retells exactly what the monologue says
   about the mobile layout. Responsiveness *is* the content, and it plays out in
   three beats, each pinned to the playhead so a backward scrub rewinds it:

     1. FULL   (≈3:50, "a vertical layout aspect ratio") — the red video tile
        fills the whole screen: the phone is playing the video full-bleed.
     2. DOCK   (≈3:57, "instead of putting it ... put it on the top") — the video
        slides + shrinks to the TOP of the screen. Nothing below it yet.
     3. CONTENT(≈4:01, "the main content should be below the video") — the page
        content blocks fade in, stacked BELOW the video.

   There is no landscape/desktop state here — this beat is purely about mobile,
   so the device never rotates to a wide aspect.

   INTERACTIVE: the viewer's cursor drags the video's bottom edge. A stable
   threshold sits at that edge in the docked state. Hold the cursor ABOVE it — up
   over the video — and the layout keeps the split (video on top, content below);
   drop BELOW it and the video grows back to FULL-screen. Crossing the border is
   the gesture.

   Like the other scenes, every narrative reveal is `phase(t,a,b)`; the wall-clock
   only drives a faint idle breath, and the cursor fold is damped per-frame so it
   eases rather than jumps. Igloo.inc spirit — frosted glass, terracotta fresnel
   rim, warm core glow on warm Paper; ColorManagement is OFF so colours are
   authored + emitted in sRGB to match the DOM.
   ============================================================================ */

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createStage, palette, trackPointer, makeClock, phase, smooth, damp } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) ---------------------------------------- */
// Anchored to docs/subtitles/0001_intro.vtt.
const T_APPEAR_A = 228.4; // 03:48.4 "a vertical ..." — full-screen video fades in
const T_APPEAR_B = 230.7; // 03:50.7 "... layout aspect ratio" — fully present
const T_DOCK_A = 237.0; //   03:57.0 "instead of putting it ... make it horizontal"
const T_DOCK_B = 240.0; //   04:00.0 "... and put it on the top" — video docked top
const T_CONTENT_A = 241.0; // 04:01.0 "the main content should be below ..."
const T_CONTENT_B = 243.3; // 04:03.3 "... the video" — content blocks settled in

/* --- device half-extents (world units) — PORTRAIT phone, fixed aspect ----- */
const DEV_DEPTH = 0.12; // slab thickness (the glass body)
const PORT_HW = 0.62; // portrait half-width  (narrow)
const PORT_HH = 1.18; // portrait half-height (tall)
const PAD = 0.14; // inner margin from the device edge to the tile field
const TILE_DEPTH = 0.05; // inner tiles float just proud of the front face
const TILE_GAP = 0.06; // gap between content blocks
const FACE_Z = DEV_DEPTH * 0.5 + TILE_DEPTH * 0.5; // z of the tile front plane

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

/* The two video poses + the content stack, all in the portrait face space.
   FULL: the video fills the entire inner face (full-screen playback).
   DOCK: the video shrinks to the top ~42%, with three content blocks stacked in
   the remaining height below it — the classic mobile article layout. */
const IX = PORT_HW - PAD; // inner half-width
const IY = PORT_HH - PAD; // inner half-height
const VIDEO_FULL: Rect = { x: 0, y: 0, hw: IX, hh: IY };

const VIDEO_DOCK_HH = IY * 0.42; // docked video occupies the top ~42%
const VIDEO_DOCK_Y = IY - VIDEO_DOCK_HH; // its centre y (pinned to the top edge)
const VIDEO_DOCK: Rect = { x: 0, y: VIDEO_DOCK_Y, hw: IX, hh: VIDEO_DOCK_HH };
const VIDEO_DOCK_BOTTOM = VIDEO_DOCK_Y - VIDEO_DOCK_HH; // local y of the fold line

// three content blocks filling the height below the docked video.
const STACK_TOP = VIDEO_DOCK_BOTTOM - TILE_GAP; // top edge of the content stack
const STACK_H = STACK_TOP - -IY; // remaining height for the blocks
const BLOCK_HH = (STACK_H - 2 * TILE_GAP) / 6; // half-height of one of three blocks
const contentRects: Rect[] = [0, 1, 2].map((n) => ({
  x: 0,
  y: STACK_TOP - BLOCK_HH - n * (BLOCK_HH * 2 + TILE_GAP),
  hw: IX,
  hh: BLOCK_HH,
}));

const N_TILES = 4; // [video, content×3] — one instanced draw call

/* --- glass shader (frosted volume + terracotta fresnel rim) -------------- */
// Shared by the device frame and the inner tiles. `tintExpr` mixes the body
// toward terracotta (1 for the video tile, 0 for neutral content); `revealExpr`
// fades the whole tile up. The frame feeds both from uniforms; the tiles feed
// them per-instance (aTint/aReveal varyings) so the video can stay lit while the
// content blocks fade independently — all from one draw call.
const TILE_VERT = /* glsl */ `
  attribute float aTint;
  attribute float aReveal;
  varying float vTint;
  varying float vReveal;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vTint = aTint;
    vReveal = aReveal;
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
// `decl` declares whatever `tintExpr`/`revealExpr` reference (uniforms for the
// frame, varyings for the tiles) so the two materials share one body with no
// dead uniforms.
const glassFrag = (decl: string, tintExpr: string, revealExpr: string): string => /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uGlass, uTintCol, uRim;
  uniform float uGlow, uAlpha;
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
    float a = clamp(uAlpha + fres * 0.4 + edge * 0.34, 0.0, 0.96) * (${revealExpr});
    gl_FragColor = vec4(col, a);
  }
`;
const FRAME_FRAG = glassFrag("uniform float uTint; uniform float uReveal;", "uTint", "uReveal");
const TILE_FRAG = glassFrag("varying float vTint; varying float vReveal;", "vTint", "vReveal");

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

  /* --- device frame (single rounded glass slab) ---------------------------- */
  // Built unit-sized (1×1×depth) and scaled once to the portrait aspect — the
  // device never changes shape now, so there is no per-frame geometry work.
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
  const device = new THREE.Group(); // holds frame + tiles; we float this
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.scale.set(PORT_HW * 2, PORT_HH * 2, 1); // fixed portrait aspect
  frame.frustumCulled = false;
  device.add(frame);
  scene.add(device);

  /* --- inner tiles (one instanced rounded-box mesh) ------------------------ */
  const tileGeo = new RoundedBoxGeometry(1, 1, TILE_DEPTH, 3, TILE_DEPTH * 0.5);
  const tintArr = new Float32Array(N_TILES); // 1 = video tile, 0 = content
  tintArr[0] = 1;
  tileGeo.setAttribute("aTint", new THREE.InstancedBufferAttribute(tintArr, 1));
  const revealAttr = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES), 1);
  revealAttr.setUsage(THREE.DynamicDrawUsage); // video vs content fade independently
  tileGeo.setAttribute("aReveal", revealAttr);
  const tileU = {
    uPaper: { value: pal.paper },
    uGlass: { value: pal.surface.clone().lerp(pal.glass, 0.25) }, // neutral content body
    uTintCol: { value: pal.accent.clone().lerp(pal.glass, 0.15) }, // video tile tone
    uRim: { value: pal.accent },
    uGlow: { value: 0.35 },
    uAlpha: { value: 0.32 },
  };
  const tileMat = new THREE.ShaderMaterial({
    uniforms: tileU,
    vertexShader: TILE_VERT, // per-instance aTint/aReveal
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

  // The three content blocks never move — only the video tile (instance 0)
  // animates — so place the content once up front.
  for (let i = 0; i < 3; i++) {
    const r = contentRects[i];
    tileM4.makeScale(r.hw * 2, r.hh * 2, 1);
    tileM4.setPosition(r.x, r.y, FACE_Z);
    tiles.setMatrixAt(i + 1, tileM4);
  }

  /* --- soft warm core glow (1 quad, behind the device) --------------------- */
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
  glow.scale.set(PORT_HW * 4.2, PORT_HH * 4.2, 1);
  scene.add(glow);

  /* --- camera framing: fit the portrait phone with a comfortable margin, on a
     gentle 3/4 view so the glass slab reads as a physical object. ----------- */
  const FOV = 32;
  const tanH = Math.tan((FOV * Math.PI) / 360);
  const BASE_AZ = 0.24; // resting azimuth (rad) — camera to the right, so the phone's
  //                       face turns LEFT toward the desktop video docked on that side
  const BASE_EL = 0.12; // resting elevation (rad)
  let camDist = 6;
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const halfH = PORT_HH + 0.3;
    const halfW = PORT_HW + 0.3;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    camDist = Math.max(zH, zW) * 1.12;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(); // keep matrixWorldInverse fresh for project() below
  });

  let disposed = false;
  let fold = 0; // damped cursor fold: 0 = FULL (hover over video), 1 = split layout
  const probe = new THREE.Vector3(); // reused for the threshold projection

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();
    pointer.update(dt);

    /* narrative phases — pure functions of the playhead ---------------------- */
    const appear = phase(t, T_APPEAR_A, T_APPEAR_B);
    const dockNarr = phase(t, T_DOCK_A, T_DOCK_B); // video full → top
    const contentNarr = phase(t, T_CONTENT_A, T_CONTENT_B); // content fades in below

    /* device pose: entrance pop + a faint idle breath only (no reflow spin) --- */
    const pop = 0.82 + 0.18 * appear;
    const breath = Math.sin(idle * 0.7) * 0.025;
    device.scale.setScalar(pop + breath);
    const driftY = Math.sin(idle * 0.9) * 0.05;
    device.rotation.y = Math.sin(idle * 0.5) * 0.02; // whisper of life
    device.rotation.x = -0.02 + driftY * 0.3;
    device.position.y = driftY * 0.15;
    device.updateMatrixWorld(true); // refresh before we project the fold line

    /* interactive fold ------------------------------------------------------- */
    // The threshold is the video's bottom border in the DOCKED pose — a stable
    // screen line. The cursor "drags" that bottom edge: project the line to NDC y,
    // then ABOVE it (up over the video) holds the split (video on top, content
    // below), and BELOW it pulls the video back to FULL-screen.
    probe.set(0, VIDEO_DOCK_BOTTOM, FACE_Z).applyMatrix4(device.matrixWorld).project(camera);
    const thresholdNdcY = probe.y;
    if (pointer.hover > 0.02) {
      const want = pointer.ndc.y > thresholdNdcY ? 1 : 0; // cursor above the fold → video docked top
      fold = damp(fold, want, 7, dt);
    } else {
      // park on the narrative value so re-entry blends seamlessly into the story
      fold = damp(fold, dockNarr, 4, dt);
    }

    // Blend story ↔ cursor by how present the pointer is. While hovering, the
    // fold drives BOTH the dock and the content together (it's a single gesture);
    // the narrative keeps them as distinct beats (dock leads, content follows).
    const k = pointer.hover;
    const dock = dockNarr + (fold - dockNarr) * k;
    const content = contentNarr + (fold - contentNarr) * k;

    /* video tile: lerp FULL → DOCK by `dock`, place on the front face --------- */
    const v = lerpRect(VIDEO_FULL, VIDEO_DOCK, dock);
    tileM4.makeScale(Math.max(0.02, v.hw * 2), Math.max(0.02, v.hh * 2), 1);
    tileM4.setPosition(v.x, v.y, FACE_Z);
    tiles.setMatrixAt(0, tileM4);
    tiles.instanceMatrix.needsUpdate = true;

    /* reveals: video tracks the entrance; content waits until the video has
       docked (gate on `dock`) so the two never overlap mid-fold. ------------- */
    const gate = smooth((dock - 0.5) / 0.5); // 0 until the video is half-docked
    revealAttr.setX(0, appear); // video tile
    const contentReveal = appear * content * gate;
    revealAttr.setX(1, contentReveal);
    revealAttr.setX(2, contentReveal);
    revealAttr.setX(3, contentReveal);
    revealAttr.needsUpdate = true;

    /* frame + warm glow ------------------------------------------------------ */
    frameU.uReveal.value = appear;
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
