/* ============================================================================
   sync3d.ts — the 3D "one timeline drives both" supporting art.

   The presenter: "there's the video element ... then there's this interactive
   website ... When the users scrub on the progress bar, they should both scrub
   the video and the website. They should always be in sync."

   So the scene is a head-on, viewer-facing 3D PROGRESS BAR (no 3/4 tilt):
     · TOP lane  = VIDEO — a row of little 16:9 frosted film-FRAME tiles.
     · BOTTOM lane = SITE — a row of little UI-BLOCK tiles (web content).
     · BETWEEN them, the hero: a continuous rain of warm PARTICLES — each mote is
       one LINK of data falling out of the video lane and landing in the web lane,
       so the two tracks are visibly *bound* by a live downward flow. ~10% are
       brighter "link-packets" with firmer comet-streaks so the flow reads as
       discrete links, not undirected dust.
     · A horizontal TIMELINE rail carries the full set of progress-bar SECTION
       dots (CHAPTERS) at their true time-proportional x, with a terracotta FILL
       that grows to the real playback position — a literal echo of the DOM bar.
     · A glowing terracotta PLAYHEAD beam rides the rail; it sits at the real time
       and follows the cursor once "scrub" is reached. The lit COLUMN under it
       brightens on video, on web, and the rain pouring between — same moment,
       both tracks. Hovering surfaces the nearest SECTION TITLE in a small tooltip
       (text, no thumbnail) — just like the progress bar.

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing backward rewinds it exactly:
     · formP   (186.7→188.2): lanes + rail + dots + rain fade in.
     · scrubEnable (195.5→197.2): the beam hands over from real-time to the MOUSE
       — the viewer scrubs and BOTH lanes (and the rain) stay in sync.
     · lockPulse (202.6→203.4): a bright "in sync" flash — rain snaps to the lit
       column, the beam + nearest dot flare.
   The continuous downward FLOW (the fract() fall, curl drift, idle twinkle) is the
   only clock-driven motion — it carries no narrative position, so it free-runs.

   Igloo.inc is the spirit (frosted glass volume, terracotta fresnel rim, warm
   particle glow) — palette warm Paper + terracotta, never icy blue. NormalBlending
   throughout (additive blows out to white on the cream paper); glow is a bright
   warm CORE on a soft sprite. Two ribbons + one Points rain + a few thin quads.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, clamp01, damp } from "./scene3d";
import { CHAPTERS, type Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_FORM_A = 186.7; // lanes + rail + rain fade in
const T_FORM_B = 188.2;
const T_SCRUB_A = 195.5; // hand the beam over to the mouse
const T_SCRUB_B = 197.2;
const T_LOCK_A = 202.6; // "in sync" flash
const T_LOCK_B = 203.4;

/* --- world layout (head-on; x = the whole video timeline) ---------------- */
const TILE_DESK = 14;
const TILE_MOB = 9;
const TILE_SPACING = 0.46;
const ROW_Y_VIDEO = 0.72; // top lane (video) centre
const ROW_Y_SITE = -0.72; // bottom lane (web content) centre
const VIDEO_W = 0.4; // 16:9 frame
const VIDEO_H = 0.225;
const SITE_W = 0.36; // UI card
const SITE_H = 0.32;
const FOV = 34;

// rain falls from just under the video tiles to just above the web tiles
const RAIN_TOP = ROW_Y_VIDEO - VIDEO_H / 2 - 0.02;
const RAIN_BOT = ROW_Y_SITE + SITE_H / 2 + 0.02;

const LAST_T = CHAPTERS[CHAPTERS.length - 1].t; // 335 — used for the duration fallback

/* ---- tile shaders (the two lanes) --------------------------------------- */

/* A flat-ish glass tile. uKind selects the printed face (0 = video frame with a
   sprocket dot row, 1 = UI card with stacked bars). uPlayheadX brightens the
   tile column nearest the beam via a gaussian on each instance's world x. */
const TILE_VERT = /* glsl */ `
  uniform float uFormP;
  uniform float uPlayheadX;
  attribute float aSeed;
  attribute float aCol;            // 0..1 column position along the lane
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  varying float vSeed;
  varying float vNear;             // 0..1 proximity to the beam

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
  uniform float uFormP;            // entrance fade — keeps the lane dark before its beat
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

    // beam column highlight — warm core lift so the lit tile glows on paper
    float hot = vNear * form;
    col = mix(col, mix(uRim, vec3(1.0, 0.96, 0.9), 0.35), hot * 0.7);
    col += uRim * hot * 0.25;

    float alpha = clamp(uBaseAlpha + fres * 0.34 + edge * 0.32 + ink * 0.25 + hot * 0.35, 0.0, 0.96) * form;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ---- rain shader (the hero: links flowing video → web) ------------------- */

/* One THREE.Points field. Each mote owns a stable column (aCol → world x across
   the whole timeline), a fall-phase seed, and noise. It falls top→bottom on a
   clock-driven loop (fract wrap), drifting through curl-noise mid-fall and
   re-converging crisp onto the lanes. The COLUMN under the beam (real playhead +
   cursor scrub) rains faster, brighter, hotter — the live link. ~10% of motes are
   brighter packets with firmer streaks so the flow reads as discrete links. */
const RAIN_VERT = /* glsl */ `
  uniform float uFlow;        // clock-driven loop time (idle only — no narrative)
  uniform float uForm;        // reveal 0..1 (pure f(t))
  uniform float uFallSpeed;
  uniform float uColK;        // column gaussian tightness
  uniform float uPlayX;       // real playhead world x (gentle column)
  uniform float uHoverX;      // cursor scrub world x (bright column)
  uniform float uHoverAmt;    // 0..1 how present the scrub column is
  uniform float uLaneTop, uLaneBot;
  uniform float uX0, uX1;
  uniform float uPixelRatio, uSize;
  uniform float uLock;        // sync flash 0..1
  attribute float aCol;       // 0..1 column position across the timeline
  attribute float aSeed;      // fall-phase / size / packet / twinkle seed
  attribute vec3 aRand;       // curl seed x, lateral jitter, z-depth
  varying float vHeat;
  varying float vMix;         // 0 video (top) .. 1 web (bottom)
  varying float vEnv;         // vertical spawn/despawn envelope
  varying float vSeed;
  varying float vPacket;
  varying vec2 vVel;
  varying float vStretch;

  float hash21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  vec2 curl(vec2 p){
    float e = 0.35;
    float n1 = vnoise(p + vec2(0.0, e)), n2 = vnoise(p - vec2(0.0, e));
    float n3 = vnoise(p + vec2(e, 0.0)), n4 = vnoise(p - vec2(e, 0.0));
    return vec2(n1 - n2, n4 - n3) / (2.0 * e);
  }

  void main(){
    vSeed = aSeed;
    float packet = step(0.9, aSeed);   // deterministic ~10% bright "link-packets"
    vPacket = packet;

    float laneX = mix(uX0, uX1, aCol);

    // proximity to the two lit columns (real playhead, cursor scrub)
    float dR = laneX - uPlayX;  float nearR = exp(-dR * dR * uColK);
    float dH = laneX - uHoverX; float nearH = exp(-dH * dH * uColK) * uHoverAmt;
    float near = max(nearR * 0.5, nearH);
    vHeat = clamp(near * 1.2 + packet * 0.22, 0.0, 1.0);

    // fall progress — PURELY clock-driven loop; the lit column falls a bit faster
    float speedJ = 0.6 + 0.8 * aRand.x + packet * 0.45;
    float f = fract(aSeed + uFlow * uFallSpeed * speedJ + near * uFlow * 0.5);
    float yt = f * f * (3.0 - 2.0 * f);
    vMix = yt;
    float y = mix(uLaneTop, uLaneBot, yt);

    // curl drift, faded at the ends so motes leave / arrive crisp on the lanes —
    // kept small so each mote reads as a coherent vertical link, not a smear
    float organize = 1.0 - 4.0 * f * (1.0 - f);                 // 1 at lanes, 0 mid-fall
    vec2 fp = vec2(laneX * 2.0, f * 3.0) + aRand.xy * 9.0;
    vec2 drift = curl(fp) * 0.04 * (1.0 - organize) * (1.0 - 0.6 * packet);
    float x = laneX + drift.x;
    x = mix(x, laneX, uLock * 0.85);                            // sync flash: snap to column
    float z = (aRand.z - 0.5) * 0.12 + near * 0.06;             // tiny depth + bow under the beam

    vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
    gl_Position = projectionMatrix * mv;

    // invisible at the wrap: fade in just under the video lane, out just above web
    vEnv = smoothstep(0.0, 0.10, f) * smoothstep(1.0, 0.86, f);

    // downward comet streak — present everywhere (reads as flow), firmer in the
    // lit column + for packets
    vStretch = clamp(0.34 + near * 0.42 + packet * 0.3, 0.0, 0.82);
    vVel = normalize(vec2(drift.x * 0.5, -1.0));

    float sz = (0.74 + 0.5 * near) * (1.0 + packet * 0.9) * (1.0 + 0.5 * uLock * near);
    float tw = 0.9 + 0.14 * sin(uFlow * 5.0 + aSeed * 60.0);
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * sz * tw * (0.45 + 0.55 * uForm);
  }
`;

const RAIN_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uWarm, uCool, uHot;
  uniform float uForm;
  varying float vHeat;
  varying float vMix;
  varying float vEnv;
  varying float vSeed;
  varying float vPacket;
  varying vec2 vVel;
  varying float vStretch;
  void main(){
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    // stretch ALONG fall velocity → a fine downward rain-streak
    vec2 vd = normalize(vVel + vec2(1e-4));
    vec2 pv = vec2(dot(uv, vd), dot(uv, vec2(-vd.y, vd.x)));
    pv.x /= (1.0 + vStretch);
    float d = dot(pv, pv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float coreW = mix(0.42, 0.62, vHeat);
    float core = smoothstep(coreW, 0.0, d);

    // terracotta leaving the video lane → settles to deep ink in the web lane
    vec3 col = mix(uWarm, uCool, vMix);
    col = mix(col, uHot, core * (0.32 + 0.5 * vHeat));   // hot core in the lit column
    col = mix(col, uHot, vPacket * core * 0.4);          // packets warmer
    col *= 0.92 + 0.14 * vSeed;

    // ambient floor keeps the whole-timeline binding visible; the lit column lifts
    float a = vEnv * mask * (0.15 + 0.6 * vHeat + vPacket * 0.14 + core * 0.22) * uForm;
    a = min(a, 0.95);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- timeline rail (hairline + the progress fill) ----------------------- */
const RAIL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RAIL_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uHair, uFill;
  uniform float uFillFrac;   // 0..1 fraction filled (real playback position)
  uniform float uForm;
  varying vec2 vUv;
  void main(){
    float band = smoothstep(0.5, 0.18, abs(vUv.y - 0.5));   // soft thin rail
    float filled = step(vUv.x, uFillFrac);
    vec3 col = mix(uHair, uFill, filled);
    float a = band * mix(0.5, 0.92, filled) * uForm;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- section dots (the chapter markers on the rail) --------------------- */
const DOT_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize;
  uniform float uFillX;      // real playhead world x → past/future split
  uniform float uPlayX;      // beam world x → "current" highlight
  uniform float uForm;
  varying float vPast;
  varying float vNear;
  varying float vForm;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vPast = step(position.x, uFillX + 0.02);
    float dx = position.x - uPlayX;
    vNear = exp(-dx * dx * 22.0);
    vForm = uForm;
    gl_PointSize = uSize * uPixelRatio * (0.7 + 0.7 * vNear) * uForm;
  }
`;
const DOT_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uFaint, uPast, uHot;
  varying float vPast;
  varying float vNear;
  varying float vForm;
  void main(){
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float ring = smoothstep(0.55, 0.35, d) - smoothstep(0.35, 0.18, d); // ring on the current dot
    vec3 col = mix(uFaint, uPast, vPast);
    col = mix(col, uHot, vNear);
    float a = (mask * (0.5 + 0.5 * vPast) + ring * vNear * 0.8) * vForm;
    a = clamp(a, 0.0, 0.95);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- playhead beam (a vertical glowing quad spanning both lanes) --------- */
const HEAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const HEAD_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uRim, uHot;
  uniform float uAlpha;
  uniform float uPulse;          // 0..1 sync-lock flash
  varying vec2 vUv;
  void main(){
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

/* ---- small DOM helpers (match the progress-bar tooltip) ----------------- */
function fmtTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function chapterIndexAt(t: number): number {
  let idx = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t) idx = i;
  return idx;
}

/* ---- controller --------------------------------------------------------- */

export function mountSync3D(container: HTMLElement, lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: FOV });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();

  const COUNT = small ? TILE_MOB : TILE_DESK;
  const rowHalf = ((COUNT - 1) / 2) * TILE_SPACING;
  const X0 = -rowHalf;
  const X1 = rowHalf;
  const tanH = Math.tan((FOV * Math.PI) / 360);

  const hot = pal.accent.clone().lerp(new THREE.Color("#ffb24a"), 0.55); // warm gold spark — never white
  const cool = pal.accentInk.clone().lerp(pal.fg, 0.2); // settled ink as a mote lands in the web lane

  // map a video time → world x along the timeline (the same proportional layout
  // as the DOM progress bar: x = X0 + (t/duration)*(X1-X0))
  const videoEl = document.querySelector("video") as HTMLVideoElement | null;
  let duration = LAST_T / 0.96; // fallback until the media metadata resolves
  const xOf = (tt: number) => X0 + clamp01(tt / duration) * (X1 - X0);

  /* --- the two lanes — one InstancedMesh of glass tiles each --------------- */
  function makeLane(rowY: number, w: number, h: number, kind: number): { mat: THREE.ShaderMaterial; geo: THREE.PlaneGeometry } {
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

  const video = makeLane(ROW_Y_VIDEO, VIDEO_W, VIDEO_H, 0); // top: film frames
  const site = makeLane(ROW_Y_SITE, SITE_W, SITE_H, 1); // bottom: UI cards

  /* --- the rain of link-particles (1 draw call) --------------------------- */
  const P = small ? 2000 : 4200;
  const aCol = new Float32Array(P);
  const aSeed = new Float32Array(P);
  const aRand = new Float32Array(P * 3);
  for (let i = 0; i < P; i++) {
    aCol[i] = Math.random();
    aSeed[i] = Math.random();
    aRand[i * 3] = Math.random();
    aRand[i * 3 + 1] = Math.random();
    aRand[i * 3 + 2] = Math.random();
  }
  const rainGeo = new THREE.BufferGeometry();
  // `position` is required by three even though the shader drives off aCol/aSeed.
  rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P * 3), 3));
  rainGeo.setAttribute("aCol", new THREE.BufferAttribute(aCol, 1));
  rainGeo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  rainGeo.setAttribute("aRand", new THREE.BufferAttribute(aRand, 3));
  const rainMat = new THREE.ShaderMaterial({
    uniforms: {
      uFlow: { value: 0 },
      uForm: { value: 0 },
      uFallSpeed: { value: 0.12 },
      uColK: { value: 7.0 },
      uPlayX: { value: 0 },
      uHoverX: { value: 0 },
      uHoverAmt: { value: 0 },
      uLaneTop: { value: RAIN_TOP },
      uLaneBot: { value: RAIN_BOT },
      uX0: { value: X0 },
      uX1: { value: X1 },
      uPixelRatio: { value: dpr },
      uSize: { value: small ? 16 : 21 },
      uLock: { value: 0 },
      uWarm: { value: pal.accent },
      uCool: { value: cool },
      uHot: { value: hot },
    },
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 1;
  scene.add(rain);

  /* --- the timeline rail + progress fill (1 thin quad) -------------------- */
  const railGeo = new THREE.PlaneGeometry(X1 - X0, 0.05, 1, 1);
  const railMat = new THREE.ShaderMaterial({
    uniforms: {
      uHair: { value: pal.hairlineStrong },
      uFill: { value: pal.accent },
      uFillFrac: { value: 0 },
      uForm: { value: 0 },
    },
    vertexShader: RAIL_VERT,
    fragmentShader: RAIL_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.set(0, 0, 0.01);
  rail.frustumCulled = false;
  rail.renderOrder = 2;
  scene.add(rail);

  /* --- the section dots (the progress-bar chapters) ----------------------- */
  const dotPos = new Float32Array(CHAPTERS.length * 3);
  function layoutDots() {
    for (let i = 0; i < CHAPTERS.length; i++) {
      dotPos[i * 3] = xOf(CHAPTERS[i].t);
      dotPos[i * 3 + 1] = 0;
      dotPos[i * 3 + 2] = 0.03;
    }
  }
  layoutDots();
  const dotGeo = new THREE.BufferGeometry();
  const dotPosAttr = new THREE.BufferAttribute(dotPos, 3);
  dotPosAttr.setUsage(THREE.DynamicDrawUsage);
  dotGeo.setAttribute("position", dotPosAttr);
  const dotMat = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: dpr },
      uSize: { value: small ? 13 : 17 },
      uFillX: { value: X0 },
      uPlayX: { value: 0 },
      uForm: { value: 0 },
      uFaint: { value: pal.fgFaint.clone().lerp(pal.paper, 0.1) },
      uPast: { value: pal.accent },
      uHot: { value: hot },
    },
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  dots.frustumCulled = false;
  dots.renderOrder = 3;
  scene.add(dots);

  /* --- the playhead beam (a vertical glowing quad) ------------------------ */
  const beamH = ROW_Y_VIDEO - ROW_Y_SITE + VIDEO_H + SITE_H + 0.4;
  const beamGeo = new THREE.PlaneGeometry(0.34, beamH, 1, 1);
  const beamMat = new THREE.ShaderMaterial({
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
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(0, (ROW_Y_VIDEO + ROW_Y_SITE) / 2, 0.02);
  beam.frustumCulled = false;
  beam.renderOrder = 4;
  scene.add(beam);

  /* --- the section-title tooltip (DOM — crisp bilingual type, no thumbnail,
     exactly like the progress bar's tip) ----------------------------------- */
  const tip = document.createElement("div");
  tip.className = "sync-tip";
  const tipTime = document.createElement("span");
  tipTime.className = "sync-tip-time";
  const tipName = document.createElement("span");
  tipName.className = "sync-tip-name";
  tip.append(tipTime, tipName);
  container.appendChild(tip);

  /* --- camera: head-on, facing the viewer (no tilt) ----------------------- */
  const halfH = (ROW_Y_VIDEO - ROW_Y_SITE) / 2 + Math.max(VIDEO_H, SITE_H) / 2 + 0.55;
  const halfW = rowHalf + Math.max(VIDEO_W, SITE_W) / 2 + 0.35;
  const baseCam = new THREE.Vector3(0, 0, 1);
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.1;
    baseCam.set(0, 0, camDist); // straight on — the animation faces the viewer
    camera.position.copy(baseCam);
    camera.lookAt(0, 0, 0);
  });

  /* --- pointer: cursor x scrubs the shared playhead; hover shows titles ---- */
  const pointer = trackPointer(canvas, camera, 0);
  const clock = makeClock();
  let disposed = false;

  let playX = 0; // smoothed beam x in world units
  let playInit = false; // start the beam already at the real playhead (no mount slide)
  const parallax = new THREE.Vector2(0, 0); // damped subtle head-on parallax
  const projV = new THREE.Vector3();

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: ct } = clock();
    pointer.update(dt);

    // duration resolves from the media; re-lay the dots once it does
    const dur = videoEl?.duration;
    if (dur && isFinite(dur) && dur > 1 && Math.abs(dur - duration) > 0.5) {
      duration = dur;
      layoutDots();
      dotPosAttr.needsUpdate = true;
    }

    const formP = phase(t, T_FORM_A, T_FORM_B);
    const scrubEnable = phase(t, T_SCRUB_A, T_SCRUB_B);
    const lockPulse = phase(t, T_LOCK_A, T_LOCK_B);

    // lane entrance
    video.mat.uniforms.uFormP.value = formP;
    site.mat.uniforms.uFormP.value = formP;

    // --- the real playback position + the cursor scrub position ---
    const frac = clamp01(t / duration);
    const realX = xOf(t);
    const cursorX = Math.max(X0, Math.min(X1, pointer.world.x));
    const hover = pointer.hover; // 0..1 presence over the canvas
    // the beam rests at real time, and hands over to the cursor once "scrub"
    // begins (a touch of response before the beat, full after) — reversible.
    const grab = hover * Math.max(0.25, scrubEnable);
    let beamTarget = realX + (cursorX - realX) * grab;
    // the sync flash nudges the beam onto the nearest section-dot column
    if (lockPulse > 0) {
      let best = beamTarget;
      let bestD = Infinity;
      for (let i = 0; i < CHAPTERS.length; i++) {
        const cx = dotPos[i * 3];
        const dd = Math.abs(cx - beamTarget);
        if (dd < bestD) {
          bestD = dd;
          best = cx;
        }
      }
      beamTarget += (best - beamTarget) * lockPulse;
    }
    if (!playInit) {
      playX = beamTarget; // converge on the first frame so the beam never slides in from centre
      playInit = true;
    }
    playX = damp(playX, beamTarget, 9, dt);

    // tiles brighten under the beam (same column lights on video AND web)
    video.mat.uniforms.uPlayheadX.value = playX;
    site.mat.uniforms.uPlayheadX.value = playX;

    // rain: real column glows gently, the cursor column glows bright on scrub
    rainMat.uniforms.uFlow.value = ct;
    rainMat.uniforms.uForm.value = formP;
    rainMat.uniforms.uPlayX.value = realX;
    rainMat.uniforms.uHoverX.value = cursorX;
    rainMat.uniforms.uHoverAmt.value = hover * formP * (0.3 + 0.7 * scrubEnable);
    rainMat.uniforms.uLock.value = lockPulse;

    // rail fill + section dots
    railMat.uniforms.uFillFrac.value = frac;
    railMat.uniforms.uForm.value = formP;
    dotMat.uniforms.uFillX.value = realX;
    dotMat.uniforms.uPlayX.value = playX;
    dotMat.uniforms.uForm.value = formP;

    // beam
    beam.position.x = playX;
    beamMat.uniforms.uAlpha.value = formP * (0.32 + 0.34 * hover + 0.34 * scrubEnable);
    beamMat.uniforms.uPulse.value = lockPulse;

    // --- section-title tooltip (text only, like the progress bar) ---
    const tipOn = formP > 0.45 && hover > 0.08;
    if (tipOn) {
      const cursorFrac = clamp01((cursorX - X0) / (X1 - X0));
      const cursorT = cursorFrac * duration;
      const ci = chapterIndexAt(cursorT);
      const liveLang = (document.documentElement.getAttribute("data-lang") as Lang) || lang;
      tipTime.textContent = fmtTime(cursorT);
      tipName.textContent = CHAPTERS[ci].label[liveLang];
      // project the cursor column (top of the video lane) to container pixels
      projV.set(cursorX, ROW_Y_VIDEO + VIDEO_H / 2, 0).project(camera);
      const px = (projV.x * 0.5 + 0.5) * container.clientWidth;
      const py = (-projV.y * 0.5 + 0.5) * container.clientHeight;
      tip.style.left = `${px}px`;
      tip.style.top = `${py}px`;
      tip.style.opacity = String(clamp01((hover - 0.08) * 1.6));
    } else {
      tip.style.opacity = "0";
    }

    // subtle head-on parallax so the flat plane still feels dimensional
    parallax.x = damp(parallax.x, pointer.ndc.x, 3, dt);
    parallax.y = damp(parallax.y, pointer.ndc.y, 3, dt);
    camera.position.set(baseCam.x + parallax.x * 0.14, baseCam.y + parallax.y * 0.1, baseCam.z);
    camera.lookAt(0, 0, 0);

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    tip.remove();
    stage.dispose(() => {
      video.geo.dispose();
      video.mat.dispose();
      site.geo.dispose();
      site.mat.dispose();
      rainGeo.dispose();
      rainMat.dispose();
      railGeo.dispose();
      railMat.dispose();
      dotGeo.dispose();
      dotMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
    });
  }

  return { tick, dispose };
}
