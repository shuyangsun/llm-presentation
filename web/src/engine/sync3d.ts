/* ============================================================================
   sync3d.ts — the 3D "one timeline drives both" supporting art.

   The presenter: "there's the video element ... then there's this interactive
   website ... When the users scrub on the progress bar, they should both scrub
   the video and the website. They should always be in sync."

   So: TWO parallel horizontal RIBBONS stacked in y, seen at a fixed 3/4 angle —
     · TOP ribbon  = VIDEO — a row of little 16:9 frosted film-FRAME tiles
       (each with a faint sprocket dot row).
     · BOTTOM ribbon = SITE — a row of little UI-BLOCK tiles, each a couple of
       stacked horizontal bars (a card with a header + body lines).
   A single glowing terracotta PLAYHEAD plane sweeps across BOTH ribbons locked
   together, with a thin vertical CONNECTOR spanning between the two heads — one
   timeline, visibly driving both tracks. The tile nearest the head in EACH
   ribbon brightens (gaussian proximity in the shader), so wherever the head is,
   the same column lights up on video AND site.

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing backward rewinds it exactly:
     · formP   (186.7→188.2): ribbons + tiles slide/fade in.
     · idle    (clock):        the head auto-sweeps left<->right slowly.
     · scrubEnable (195.5→197.2): blend the head from auto-sweep to MOUSE control
       — the viewer literally scrubs and BOTH ribbons stay in sync.
     · lockPulse (202.6→203.4): a bright sync flash on the connector + both heads.

   Igloo.inc is the spirit (frosted glass volume, terracotta fresnel rim, warm
   particle glow) — palette warm Paper + terracotta, never icy blue. Two ribbons
   = two InstancedMesh draw calls; the head/connector/glow are a few thin quads.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, clamp01, damp } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_FORM_A = 186.7; // ribbons + tiles slide/fade in
const T_FORM_B = 188.2;
const T_SCRUB_A = 195.5; // hand the head over to the mouse
const T_SCRUB_B = 197.2;
const T_LOCK_A = 202.6; // "in sync" flash
const T_LOCK_B = 203.4;

/* --- world layout -------------------------------------------------------- */
const TILE_DESK = 14;
const TILE_MOB = 9;
const TILE_SPACING = 0.46;
const ROW_Y_VIDEO = 0.62; // top ribbon centre
const ROW_Y_SITE = -0.62; // bottom ribbon centre
const VIDEO_W = 0.4; // 16:9 frame
const VIDEO_H = 0.225;
const SITE_W = 0.36; // UI card
const SITE_H = 0.32;
const FOV = 34;
const BASE_AZ = -0.18; // resting 3/4 azimuth (rad)
const BASE_EL = 0.16; // resting elevation (rad)

/* ---- shaders ------------------------------------------------------------ */

/* A flat-ish glass tile. uKind selects the printed face (0 = video frame with a
   sprocket dot row, 1 = UI card with stacked bars). uPlayheadX brightens the
   tile column nearest the head via a gaussian on each instance's world x. */
const TILE_VERT = /* glsl */ `
  uniform float uFormP;
  uniform float uPlayheadX;
  attribute float aSeed;
  attribute float aCol;            // 0..1 column position along the ribbon
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  varying float vSeed;
  varying float vNear;             // 0..1 proximity to the playhead

  void main() {
    vUv = uv; vSeed = aSeed;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    // entrance: tiles rise + settle from a small downward offset, staggered by column
    float e = clamp(uFormP * 1.35 - aCol * 0.35, 0.0, 1.0);
    e = e * e * (3.0 - 2.0 * e);
    worldPos.y += (1.0 - e) * -0.55;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - worldPos.xyz);
    float dx = worldPos.x - uPlayheadX;
    vNear = exp(-dx * dx * 9.0);   // gaussian column highlight (~0.33u radius)
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const TILE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uGlass, uRim, uInk;
  uniform float uKind;             // 0 = video frame, 1 = UI card
  uniform float uBaseAlpha;
  uniform float uFormP;            // entrance fade — keeps the ribbon dark before its beat
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  varying float vSeed;
  varying float vNear;

  float bar(float y, float c, float h) {       // soft horizontal bar mask
    return smoothstep(h, h * 0.4, abs(y - c));
  }

  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

    // frosted body + faceted edge glow (igloo glass, warm)
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.14, em);
    vec3 body = uGlass * (0.82 + 0.18 * vSeed);

    // printed face — what makes a VIDEO tile read different from a SITE tile
    float ink = 0.0;
    if (uKind < 0.5) {
      // video: a faint sprocket dot row top + bottom
      float gx = fract(vUv.x * 6.0) - 0.5;
      float dotsT = smoothstep(0.18, 0.0, length(vec2(gx, (vUv.y - 0.12) * 2.2)));
      float dotsB = smoothstep(0.18, 0.0, length(vec2(gx, (vUv.y - 0.88) * 2.2)));
      ink = (dotsT + dotsB) * 0.5;
    } else {
      // site: a header bar + two body lines (a little UI card)
      float head = bar(vUv.y, 0.26, 0.07) * step(0.18, vUv.x) * step(vUv.x, 0.62);
      float l1 = bar(vUv.y, 0.55, 0.045) * step(0.18, vUv.x) * step(vUv.x, 0.84);
      float l2 = bar(vUv.y, 0.74, 0.045) * step(0.18, vUv.x) * step(vUv.x, 0.7);
      ink = head * 0.85 + l1 * 0.55 + l2 * 0.55;
    }

    // base shading
    vec3 col = mix(body, uRim, max(fres * 0.6, edge * 0.55));
    col = mix(col, uInk, ink * 0.6);
    col = mix(col, uPaper, 0.04);

    // entrance fade — a smooth ramp on the entrance phase so a scrub before the
    // beat shows nothing and rewinds cleanly (the y-rise alone never hid the tile)
    float form = smoothstep(0.0, 1.0, uFormP);

    // playhead column highlight — warm core lift so the lit tile glows on paper
    float hot = vNear * form;
    col = mix(col, mix(uRim, vec3(1.0, 0.96, 0.9), 0.35), hot * 0.7);
    col += uRim * hot * 0.25;

    float alpha = clamp(uBaseAlpha + fres * 0.34 + edge * 0.32 + ink * 0.25 + hot * 0.35, 0.0, 0.96) * form;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/* The sweeping playhead: a vertical glowing quad. A soft gaussian in x gives it a
   bright terracotta core that fades to nothing — additive would blow out on the
   light paper, so we stay NormalBlending with a warm core + paper falloff. */
const HEAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HEAD_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uRim, uHot;
  uniform float uAlpha;
  uniform float uPulse;          // 0..1 sync-lock flash
  varying vec2 vUv;
  void main() {
    float gx = abs(vUv.x - 0.5) * 2.0;          // 0 centre -> 1 edge
    float core = exp(-gx * gx * 7.0);           // soft vertical beam
    float taper = smoothstep(0.0, 0.12, vUv.y) * smoothstep(0.0, 0.12, 1.0 - vUv.y);
    float m = core * taper;
    vec3 col = mix(uRim, uHot, core * (0.5 + 0.5 * uPulse));
    col = mix(uPaper, col, m);                   // sit on paper, not white-out
    float a = clamp(m * (uAlpha + uPulse * 0.5), 0.0, 0.95);
    gl_FragColor = vec4(col, a);
  }
`;

/* The vertical connector tying the two heads + the two glowing head-markers that
   ride exactly on each ribbon. Simple bright dots/line — reinforces "one driver". */
const SPARK_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z));
  }
`;

const SPARK_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uRim, uHot;
  uniform float uAlpha;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.45, 0.0, d);
    vec3 col = mix(uRim, uHot, core);
    float a = mask * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller --------------------------------------------------------- */

export function mountSync3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: FOV });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();

  const COUNT = small ? TILE_MOB : TILE_DESK;
  const rowHalf = ((COUNT - 1) / 2) * TILE_SPACING;
  const X0 = -rowHalf;
  const X1 = rowHalf;
  const tanH = Math.tan((FOV * Math.PI) / 360);

  const hot = pal.accentInk.clone().lerp(new THREE.Color("#ffffff"), 0.35);

  /* --- one ribbon = one InstancedMesh of glass tiles ---------------------- */
  function makeRibbon(rowY: number, w: number, h: number, kind: number): { mat: THREE.ShaderMaterial; geo: THREE.PlaneGeometry } {
    const geo = new THREE.PlaneGeometry(w, h, 1, 1);
    const seeds = new Float32Array(COUNT);
    const cols = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      seeds[i] = Math.random();
      cols[i] = COUNT > 1 ? i / (COUNT - 1) : 0;
    }
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(cols, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uFormP: { value: 0 },
        uPlayheadX: { value: 0 },
        uPaper: { value: pal.paper },
        uGlass: { value: pal.glass },
        uRim: { value: pal.accent },
        uInk: { value: pal.accentInk },
        uKind: { value: kind },
        uBaseAlpha: { value: 0.26 },
      },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < COUNT; i++) {
      m4.makeTranslation(X0 + i * TILE_SPACING, rowY, 0);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    return { mat, geo };
  }

  const video = makeRibbon(ROW_Y_VIDEO, VIDEO_W, VIDEO_H, 0); // top: film frames
  const site = makeRibbon(ROW_Y_SITE, SITE_W, SITE_H, 1); // bottom: UI cards

  /* --- the sweeping playhead beam (a vertical glowing quad) ---------------- */
  const beamH = ROW_Y_VIDEO - ROW_Y_SITE + VIDEO_H + SITE_H + 0.4;
  const headGeo = new THREE.PlaneGeometry(0.34, beamH, 1, 1);
  const headMat = new THREE.ShaderMaterial({
    uniforms: {
      uPaper: { value: pal.paper },
      uRim: { value: pal.accent },
      uHot: { value: hot },
      uAlpha: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: HEAD_VERT,
    fragmentShader: HEAD_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, (ROW_Y_VIDEO + ROW_Y_SITE) / 2, 0.02);
  head.frustumCulled = false;
  head.renderOrder = 2;
  scene.add(head);

  /* --- connector line + two head-markers (the "one driver" tie) ----------- */
  // a thin vertical line spanning both heads, drawn as a 2-point line
  const lineGeo = new THREE.BufferGeometry();
  const linePos = new Float32Array([0, ROW_Y_VIDEO, 0.03, 0, ROW_Y_SITE, 0.03]);
  const linePosAttr = new THREE.BufferAttribute(linePos, 3);
  linePosAttr.setUsage(THREE.DynamicDrawUsage);
  lineGeo.setAttribute("position", linePosAttr);
  const lineMat = new THREE.LineBasicMaterial({ color: pal.accent, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const connector = new THREE.Line(lineGeo, lineMat);
  connector.frustumCulled = false;
  connector.renderOrder = 3;
  scene.add(connector);

  // the two bright markers riding exactly on each ribbon row
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array([0, ROW_Y_VIDEO, 0.04, 0, ROW_Y_SITE, 0.04]);
  const sparkPosAttr = new THREE.BufferAttribute(sparkPos, 3);
  sparkPosAttr.setUsage(THREE.DynamicDrawUsage);
  sparkGeo.setAttribute("position", sparkPosAttr);
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: dpr },
      uSize: { value: small ? 26 : 34 },
      uRim: { value: pal.accent },
      uHot: { value: hot },
      uAlpha: { value: 0 },
    },
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 4;
  scene.add(sparks);

  /* --- camera framing: fit both a tall mobile box and a wide desktop box --- */
  const halfH = (ROW_Y_VIDEO - ROW_Y_SITE) / 2 + Math.max(VIDEO_H, SITE_H) / 2 + 0.5;
  const halfW = rowHalf + Math.max(VIDEO_W, SITE_W) / 2 + 0.35;
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.1;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
  });

  /* --- pointer: cursor x scrubs the shared playhead once enabled ----------- */
  const pointer = trackPointer(canvas, camera, 0);
  const clock = makeClock();
  let disposed = false;

  // smoothed playhead x in world units (eases between auto-sweep + mouse target)
  let playX = 0;

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: ct } = clock();
    pointer.update(dt);

    const formP = phase(t, T_FORM_A, T_FORM_B);
    const scrubEnable = phase(t, T_SCRUB_A, T_SCRUB_B);
    const lockPulse = phase(t, T_LOCK_A, T_LOCK_B);

    // ribbon entrance
    video.mat.uniforms.uFormP.value = formP;
    site.mat.uniforms.uFormP.value = formP;

    // --- where is the head? ---
    // auto-sweep: a slow ping-pong across the ribbon (idle, non-narrative)
    const sweep = Math.sin(ct * 0.6) * 0.5 + 0.5; // 0..1 ping-pong
    const autoX = X0 + sweep * (X1 - X0);
    // mouse scrub: cursor world x mapped + clamped into the ribbon span
    const cursorX = Math.max(X0, Math.min(X1, pointer.world.x));
    // blend auto-sweep -> mouse as scrub turns on; the mouse only "grabs" while present
    const grab = scrubEnable * pointer.hover;
    const targetX = autoX + (cursorX - autoX) * grab;
    // the lock pulse nudges both heads to perfect alignment at the column centre
    const snapX = lockPulse > 0 ? targetX + (Math.round((targetX - X0) / TILE_SPACING) * TILE_SPACING + X0 - targetX) * lockPulse : targetX;
    playX = damp(playX, snapX, 9, dt);

    // drive both ribbons from the one playhead x — same column lights on both
    video.mat.uniforms.uPlayheadX.value = playX;
    site.mat.uniforms.uPlayheadX.value = playX;

    // beam + connector + markers ride playX
    head.position.x = playX;
    headMat.uniforms.uAlpha.value = formP * (0.5 + 0.5 * scrubEnable);
    headMat.uniforms.uPulse.value = lockPulse;

    linePos[0] = playX;
    linePos[3] = playX;
    linePosAttr.needsUpdate = true;
    lineMat.opacity = formP * (0.25 + 0.45 * scrubEnable + 0.3 * lockPulse);

    sparkPos[0] = playX;
    sparkPos[3] = playX;
    sparkPosAttr.needsUpdate = true;
    // markers pulse subtly on idle + flare on the sync lock; brighten while the
    // viewer is actively scrubbing so the mouse-grab feels alive.
    const flare = 0.6 + 0.18 * Math.sin(ct * 3.0) + 0.3 * grab + 0.6 * lockPulse;
    sparkMat.uniforms.uAlpha.value = clamp01(formP * flare);

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      video.geo.dispose();
      video.mat.dispose();
      site.geo.dispose();
      site.mat.dispose();
      headGeo.dispose();
      headMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
    });
  }

  return { tick, dispose };
}
