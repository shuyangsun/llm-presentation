/* ============================================================================
   asr3d.ts — the 3D "audio → transcript" supporting art.

   Two coupled pieces that ENTER in sequence (never all at once): the waveform
   slabs rise first, then the transcript rains down out of them.

   1. WAVEFORM — a row of frosted-glass slabs that dance to the *actual* audio of
      the video. While the video plays we read its live signal through a Web Audio
      analyser (see engine/audio.ts) and scroll the recent levels across the slabs
      (rightmost slab = now), so the bars are always in phase with what you hear.
      When paused or scrubbing we fall back to a precomputed amplitude envelope
      (scripts/gen-waveform.py → src/data/intro.peaks.json) indexed by the
      playhead, so a still frame shows the correct waveform too.

   2. TRANSCRIPT — the live caption, rendered as a cloud of terracotta particles.
      They DROP down out of the waveform and assemble into the real words (the
      current .vtt cue). When the spoken line changes the old particles EVAPORATE
      back up into the bars and a fresh batch rains down to form the new words.
      Moving the mouse over the text disturbs it — the particles scatter with
      noise (igloo.inc's closing page) and snap back to legible text.

   Igloo.inc is the spirit (frosted volume, fresnel halo, particle ink, glassy
   disturbance) — palette inverted to warm paper + terracotta, never icy blue.

   Lifecycle: the director (main.ts) owns the only rAF and calls `tick(t)` every
   frame while this scene is mounted, so we render there. `dispose()` releases
   the GL context on removal (browsers cap live contexts; this rebuilds on each
   EN↔中文 toggle).
   ============================================================================ */

import * as THREE from "three";
import peaksRaw from "../data/intro.peaks.json?raw";
import { audioLevel } from "./audio";

// Author + emit colors in sRGB so shader output matches the CSS hex tokens.
THREE.ColorManagement.enabled = false;

interface PeaksData {
  hz: number;
  duration: number;
  n: number;
  peaks: number[];
}
const WAVE: PeaksData = JSON.parse(peaksRaw);

export interface Cue {
  text: string;
  start: number;
}
export interface Asr3DController {
  tick(t: number): void;
  resize(): void;
  dispose(): void;
}

/* --- the score ----------------------------------------------------------- */
const T_WAVE = 142.75; // waveform forms (scene base)
const WAVE_IN = 0.6; // seconds for the slabs to rise in (left → right)
const TEXT_START = T_WAVE + 0.9; // first transcript pours down once the bars are up
const ENTER_DUR = 0.72; // a batch of particles rains down and settles
const EXIT_DUR = 0.4; // the previous batch evaporates back into the bars

/* --- world layout -------------------------------------------------------- */
const COUNT_DESK = 28;
const COUNT_MOB = 18;
const SLAB_SPACING = 0.19;
const SLAB_W = 0.12;
const SLAB_D = 0.12;
const WAVE_STEP = 0.05; // seconds of audio per slab (window = COUNT * step)
const BASE_Y = 0.0; // waveform baseline
const BAR_POUR_Y = 0.0; // where transcript particles emerge from / evaporate into
const CENTER_Y = -0.1;
const FOV = 34;
const BASE_AZ = -0.16; // resting 3/4 azimuth (rad)
const BASE_EL = 0.12; // resting elevation (rad)

/* --- live-audio → bar height mapping ------------------------------------- */
const WAVE_GAIN = 3.4; // lifts speech-level RMS into a lively bar range
const WAVE_GAMMA = 0.7; // <1 opens up the quiet parts
const WAVE_DAMP = 16; // per-frame smoothing of bar heights (higher = snappier)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};

function token(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/* ---- shaders ------------------------------------------------------------- */

const SLAB_VERT = /* glsl */ `
  uniform float uFormP;
  attribute float aSeed;
  attribute float aOrder;           // 0..1 left→right, for the staggered rise-in
  attribute float aHeight;          // 0..~1.1, the real audio amplitude for this slab
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vUp;
  varying float vSeed;

  void main() {
    // staggered grow-in: bars rise left→right as uFormP ramps 0→1
    float form = clamp(uFormP * 1.6 - aOrder * 0.6, 0.0, 1.0);
    form = form * form * (3.0 - 2.0 * form);
    float h = max(0.0008, aHeight * form);
    vec3 p = position;
    float up = p.y + 0.5;            // 0 at base, 1 at top
    p.y = up * h;
    vUv = uv; vUp = up; vSeed = aSeed;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const SLAB_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uPaper, uGlass, uRim;
  uniform float uBaseAlpha;
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vUp;
  varying float vSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = 1.0 - smoothstep(0.0, 0.18, em);                 // faceted-ice edge glow
    float grad = smoothstep(1.0, 0.0, vUp) * 0.5 + 0.34;
    float frost = mix(0.74, 1.0, hash(floor(vec2(vUv.x * 8.0 + vSeed * 7.0, vUp * 18.0))));
    vec3 L = normalize(vec3(0.4, 0.92, 0.55));
    float spec = pow(clamp(dot(N, L), 0.0, 1.0), 6.0);
    float topL = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 core = uGlass * (grad * frost + 0.12) + uGlass * topL * 0.12;
    vec3 col = mix(core, uRim, max(fres * 0.7, edge * 0.6));
    col += vec3(1.0, 0.96, 0.9) * spec * 0.22;
    col = mix(col, uPaper, 0.05);
    float alpha = clamp(uBaseAlpha + fres * 0.42 + edge * 0.4, 0.0, 0.97);
    gl_FragColor = vec4(col, alpha);
  }
`;

const TEXT_VERT = /* glsl */ `
  uniform float uTime, uPixelRatio, uSize, uHover, uDisruptR, uDisruptK, uBarY;
  uniform float uEnter;          // 0..1: the current word raining down into place
  uniform float uExit;           // 0..1: the previous word evaporating up into the bars
  uniform vec2 uMouse;
  attribute vec3 aRand;          // 0..1, stable per particle (drift / spread)
  attribute float aSeed;
  attribute float aActive;       // 1 = part of the current word, 0 = parked
  varying float vA;
  varying float vSeed;

  void main() {
    vSeed = aSeed;
    vec3 home = position;                                   // exact glyph pixel

    // a release point up on the waveform line, roughly above this glyph, so the
    // particles look like they pour down out of the bars (and evaporate back up)
    vec3 src = vec3(home.x + (aRand.x * 2.0 - 1.0) * 0.05, uBarY + aRand.y * 0.12, (aRand.z * 2.0 - 1.0) * 0.05);

    // ENTER — staggered fall src→home (a stream, not a curtain)
    float eRaw = clamp(uEnter * 1.5 - aSeed * 0.5, 0.0, 1.0);
    float e = eRaw * eRaw * (3.0 - 2.0 * eRaw);
    vec3 pos = mix(src, home, e);

    // EXIT — staggered rise home→up&out, dissolving back into the bars
    float xRaw = clamp(uExit * 1.5 - (1.0 - aSeed) * 0.5, 0.0, 1.0);
    float x = xRaw * xRaw * (3.0 - 2.0 * xRaw);
    vec3 evap = vec3(home.x + (aRand.x * 2.0 - 1.0) * 0.14, uBarY + 0.16 + aRand.y * 0.38, (aRand.z * 2.0 - 1.0) * 0.14);
    pos = mix(pos, evap, x);

    // idle shimmer — stronger while in flight, near nothing once settled
    float unsettle = (1.0 - e) + x;
    pos.xy += vec2(sin(uTime * 1.6 + aSeed * 40.0), cos(uTime * 1.4 + aSeed * 27.0)) * 0.004 * (0.4 + 0.8 * unsettle);

    // mouse disturbance — animated random noise + a radial shove near the cursor
    // scatters the words; they snap back when it leaves (igloo's closing page).
    float d = distance(pos.xy, uMouse);
    float infl = exp(-d * d * uDisruptR) * uHover;
    vec2 nz = vec2(
      sin(uTime * 9.0 + aSeed * 54.0) + sin(uTime * 5.3 + aSeed * 121.0),
      cos(uTime * 8.0 + aSeed * 39.0) + cos(uTime * 6.1 + aSeed * 88.0)
    ) * 0.5;
    pos.xy += nz * infl * uDisruptK;                  // jitter (the "random noise")
    pos.xy += normalize(pos.xy - uMouse + 1e-4) * infl * 0.32; // repulsion away from cursor
    pos.z += (aRand.z * 2.0 - 1.0) * infl * 0.3;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float appear = smoothstep(0.0, 0.5, e);             // fade in as they fall
    float vanish = 1.0 - x;                             // fade out as they rise
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.7 + 0.45 * e);
    vA = aActive * appear * vanish * (1.0 - infl * 0.35);
  }
`;

const TEXT_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uColorHot;
  varying float vA;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uColor, uColorHot, core * 0.6);
    float a = mask * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller ---------------------------------------------------------- */

export function mountAsr3D(container: HTMLElement, getCue: (t: number) => Cue | null): Asr3DController {
  const small = window.innerWidth < 760;
  const COUNT = small ? COUNT_MOB : COUNT_DESK;
  const P = small ? 3600 : 7000; // max transcript particles
  const rowHalf = ((COUNT - 1) / 2) * SLAB_SPACING;

  // transcript region on the z=0 plane, below the waveform baseline
  const TX0 = -rowHalf * 0.97,
    TX1 = rowHalf * 0.97,
    TY0 = -0.46,
    TY1 = -1.22;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const tanH = Math.tan((FOV * Math.PI) / 360);

  const cPaper = token("--bg", "#f7f4ee");
  const cAccent = token("--accent", "#c25450");
  const cAccentInk = token("--accent-ink", "#9c3f3c");
  const cGlass = cAccent.clone().lerp(cPaper, 0.6);

  /* --- glass waveform slabs (1 draw call) --- */
  const slabGeo = new THREE.BoxGeometry(SLAB_W, 1, SLAB_D, 1, 6, 1);
  const seeds = new Float32Array(COUNT);
  const orders = new Float32Array(COUNT);
  const heights = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    seeds[i] = Math.random();
    orders[i] = COUNT > 1 ? i / (COUNT - 1) : 0;
  }
  slabGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  slabGeo.setAttribute("aOrder", new THREE.InstancedBufferAttribute(orders, 1));
  const heightAttr = new THREE.InstancedBufferAttribute(heights, 1);
  heightAttr.setUsage(THREE.DynamicDrawUsage);
  slabGeo.setAttribute("aHeight", heightAttr);

  const slabU = {
    uFormP: { value: 0 },
    uPaper: { value: cPaper },
    uGlass: { value: cGlass },
    uRim: { value: cAccent },
    uBaseAlpha: { value: 0.3 },
  };
  const slabMat = new THREE.ShaderMaterial({
    uniforms: slabU,
    vertexShader: SLAB_VERT,
    fragmentShader: SLAB_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, COUNT);
  slabs.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  slabs.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) {
    m4.makeTranslation(-rowHalf + i * SLAB_SPACING, BASE_Y, 0);
    slabs.setMatrixAt(i, m4);
  }
  slabs.instanceMatrix.needsUpdate = true;
  scene.add(slabs);

  /* --- transcript particles (1 draw call) --- */
  const tPos = new Float32Array(P * 3); // home = current glyph pixel
  const tRand = new Float32Array(P * 3);
  const tSeed = new Float32Array(P);
  const tActive = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    tRand[i * 3] = Math.random();
    tRand[i * 3 + 1] = Math.random();
    tRand[i * 3 + 2] = Math.random();
    tSeed[i] = Math.random();
  }
  const textGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(tPos, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const activeAttr = new THREE.BufferAttribute(tActive, 1);
  activeAttr.setUsage(THREE.DynamicDrawUsage);
  textGeo.setAttribute("position", posAttr);
  textGeo.setAttribute("aRand", new THREE.BufferAttribute(tRand, 3));
  textGeo.setAttribute("aSeed", new THREE.BufferAttribute(tSeed, 1));
  textGeo.setAttribute("aActive", activeAttr);

  const textU = {
    uEnter: { value: 0 },
    uExit: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 19 : 23 },
    uHover: { value: 0 },
    uDisruptR: { value: 3.5 }, // gaussian falloff (~0.75 world-unit radius)
    uDisruptK: { value: 0.3 },
    uBarY: { value: BAR_POUR_Y },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uColor: { value: cAccent },
    uColorHot: { value: cAccentInk.clone().lerp(new THREE.Color("#ffffff"), 0.25) },
  };
  const textMat = new THREE.ShaderMaterial({
    uniforms: textU,
    vertexShader: TEXT_VERT,
    fragmentShader: TEXT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(textGeo, textMat);
  points.frustumCulled = false;
  scene.add(points);

  /* --- text → particle homes (cached per cue string) --- */
  const CW = 1536;
  const CH = Math.max(120, Math.round(((TY0 - TY1) / (TX1 - TX0)) * CW));
  const STEP_PX = 3;
  const tcv = document.createElement("canvas");
  tcv.width = CW;
  tcv.height = CH;
  const tctx = tcv.getContext("2d", { willReadFrequently: true })!;
  const sampleCache = new Map<string, { pos: Float32Array; count: number }>();
  let fontReady = false;

  function buildSamples(text: string): { pos: Float32Array; count: number } {
    const cached = sampleCache.get(text);
    if (cached) return cached;
    tctx.clearRect(0, 0, CW, CH);
    if (!text) {
      const empty = { pos: new Float32Array(0), count: 0 };
      sampleCache.set(text, empty);
      return empty;
    }
    // size the font to fit the region in ≤3 lines
    const fontPx = Math.round(CH * 0.27);
    const lineH = fontPx * 1.18;
    tctx.font = `600 ${fontPx}px "JetBrains Mono","Geist","Noto Sans CJK SC",system-ui,sans-serif`;
    tctx.textBaseline = "middle";
    tctx.textAlign = "center";
    tctx.fillStyle = "#fff";
    // greedy word-wrap to the region width
    const maxW = CW * 0.96;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const trial = line ? line + " " + w : w;
      if (tctx.measureText(trial).width > maxW && line) {
        lines.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 3);
    const blockH = shown.length * lineH;
    let y = CH / 2 - blockH / 2 + lineH / 2;
    for (const ln of shown) {
      tctx.fillText(ln, CW / 2, y);
      y += lineH;
    }
    // sample ink pixels
    const data = tctx.getImageData(0, 0, CW, CH).data;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let py = 0; py < CH; py += STEP_PX) {
      for (let px = 0; px < CW; px += STEP_PX) {
        if (data[(py * CW + px) * 4 + 3] > 90) {
          xs.push(px);
          ys.push(py);
        }
      }
    }
    // shuffle so a subsample (when > P) is uniform; deterministic enough (cached)
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
      [ys[i], ys[j]] = [ys[j], ys[i]];
    }
    const count = Math.min(P, xs.length);
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = TX0 + (xs[i] / CW) * (TX1 - TX0);
      pos[i * 3 + 1] = TY0 + (ys[i] / CH) * (TY1 - TY0);
      pos[i * 3 + 2] = 0;
    }
    const res = { pos, count };
    sampleCache.set(text, res);
    return res;
  }

  // bake a word's glyph pixels into the particle buffer (the homes the drop lands on)
  function bakeText(text: string) {
    const { pos, count } = buildSamples(text);
    tPos.set(pos.subarray(0, count * 3));
    for (let i = 0; i < count; i++) tActive[i] = 1;
    for (let i = count; i < P; i++) tActive[i] = 0;
    posAttr.needsUpdate = true;
    activeAttr.needsUpdate = true;
    displayedText = text;
  }

  // canvas text needs the web fonts; hold off building glyph particles until
  // they're ready so we never sample a fallback-font layout.
  document.fonts.ready.then(() => {
    fontReady = true;
  });

  /* --- transcript transition state machine (wall-clock driven) ---
     A word drops in (enter), holds (settled), then on the next line evaporates
     up into the bars (exit) before the next word drops. Driven off `clock` so
     each spoken-line change re-triggers the rain, in either scrub direction. */
  type Phase = "empty" | "enter" | "settled" | "exit";
  let displayedText = ""; // currently baked into the buffer
  let targetText = ""; // what the active cue wants now
  let phase: Phase = "empty";
  let phaseStart = 0;

  function updateTranscript(t: number) {
    if (!fontReady) return;
    const cue = getCue(t);
    const want = cue && t >= TEXT_START ? cue.text : "";

    if (want !== targetText) {
      targetText = want;
      if (want === "") {
        if (displayedText !== "") {
          phase = "exit";
          phaseStart = clock;
        }
      } else if (displayedText === "") {
        bakeText(want);
        phase = "enter";
        phaseStart = clock;
      } else if (want !== displayedText) {
        // evaporate what's shown, then the new word rains down (handled on exit end)
        phase = "exit";
        phaseStart = clock;
      } else if (phase === "exit") {
        // scrubbed back to the word that's currently evaporating → let it settle
        phase = "settled";
      }
    }

    if (phase === "enter") {
      const p = (clock - phaseStart) / ENTER_DUR;
      textU.uEnter.value = clamp01(p);
      textU.uExit.value = 0;
      if (p >= 1) phase = "settled";
    } else if (phase === "settled") {
      textU.uEnter.value = 1;
      textU.uExit.value = 0;
    } else if (phase === "exit") {
      const p = (clock - phaseStart) / EXIT_DUR;
      textU.uExit.value = clamp01(p);
      if (p >= 1) {
        if (targetText !== "") {
          bakeText(targetText);
          phase = "enter";
          phaseStart = clock;
          textU.uEnter.value = 0;
          textU.uExit.value = 0;
        } else {
          displayedText = "";
          phase = "empty";
          textU.uEnter.value = 0;
          textU.uExit.value = 0;
        }
      }
    } else {
      textU.uEnter.value = 0;
      textU.uExit.value = 0;
    }
  }

  /* --- waveform: live audio while playing, precomputed envelope otherwise ---
     `target` holds the height each slab is heading toward; `disp` chases it each
     frame so the bars move fluidly. `ring` is the scrolling live-level history
     (index 0 = oldest/left, COUNT-1 = newest/right). */
  const target = new Float32Array(COUNT);
  const disp = new Float32Array(COUNT);
  const ring = new Float32Array(COUNT);
  let ringSeeded = false;
  let waveAccum = 0;
  let lastT = -1;
  let sinceAdvance = 999; // wall-clock seconds since the playhead last stepped forward
  let liveEnergy = 0; // decaying peak of the live signal — distinguishes real audio from muted/silent

  const liveHeight = (rms: number) =>
    Math.max(0.04, Math.min(1.15, Math.pow(Math.min(1, rms * WAVE_GAIN), WAVE_GAMMA) * 1.15));

  // fill `out` with a COUNT-slab window of the precomputed envelope ending at t
  function peaksWindow(t: number, out: Float32Array) {
    const hz = WAVE.hz;
    const peaks = WAVE.peaks;
    for (let i = 0; i < COUNT; i++) {
      const ti = t - (COUNT - 1 - i) * WAVE_STEP; // rightmost slab = now
      let v = 0;
      if (ti >= 0 && ti <= WAVE.duration) {
        const k0 = Math.floor(ti * hz);
        const k1 = Math.min(peaks.length - 1, Math.floor((ti + WAVE_STEP) * hz));
        let mx = 0;
        for (let k = k0; k <= k1; k++) {
          const p = peaks[k];
          if (p > mx) mx = p;
        }
        v = mx / 255;
      }
      out[i] = Math.max(0.04, Math.min(1.15, v * 1.9));
    }
  }

  function pushRing(h: number) {
    for (let i = 0; i < COUNT - 1; i++) ring[i] = ring[i + 1];
    ring[COUNT - 1] = h;
  }

  function updateWave(t: number, dtRender: number) {
    const live = audioLevel();
    if (lastT < 0) lastT = t;
    const dpt = t - lastT; // playhead advance since last frame
    lastT = t;

    // The video clock can update slower than rAF (e.g. 30fps media on a 60Hz
    // display), so `dpt` is 0 on some frames mid-playback. Latch "advancing" for
    // a beat after each real forward step so the bars don't flicker between the
    // live tap and the precomputed fallback; a true pause or scrub lets it lapse.
    const stepped = dpt > 1e-4 && dpt < 0.5;
    if (stepped) sinceAdvance = 0;
    else sinceAdvance += dtRender;
    const advancing = sinceAdvance < 0.18;

    // a decaying peak rides over the brief gaps between words; if it stays near
    // zero the audio is muted/silent, so we drive the bars from the precomputed
    // envelope instead (so muted viewers still see a waveform tracking the speech)
    if (!advancing) liveEnergy = 0;
    if (live != null) liveEnergy = Math.max(live, liveEnergy * Math.exp(-dtRender / 0.5));
    const hasLiveAudio = live != null && liveEnergy > 0.012;

    if (hasLiveAudio && advancing) {
      if (!ringSeeded) {
        peaksWindow(t, ring); // seed the history so live data scrolls in from the right
        ringSeeded = true;
      }
      const h = liveHeight(live);
      waveAccum += dpt;
      while (waveAccum >= WAVE_STEP) {
        waveAccum -= WAVE_STEP;
        pushRing(h);
      }
      if (h > ring[COUNT - 1]) ring[COUNT - 1] = h; // keep the right edge reactive between pushes
      for (let i = 0; i < COUNT; i++) target[i] = ring[i];
    } else {
      // paused, scrubbing, or no live audio → correct static waveform at the playhead
      peaksWindow(t, target);
      for (let i = 0; i < COUNT; i++) ring[i] = target[i];
      ringSeeded = true;
      waveAccum = 0;
    }

    const k = 1 - Math.exp(-WAVE_DAMP * dtRender);
    for (let i = 0; i < COUNT; i++) {
      disp[i] += (target[i] - disp[i]) * k;
      heights[i] = disp[i];
    }
    heightAttr.needsUpdate = true;
  }

  /* --- camera framing --- */
  let camDist = 6;
  function frame(w: number, h: number) {
    const aspect = w / h || 1;
    const halfH = 1.4;
    const halfW = rowHalf + 0.3;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    camDist = Math.max(zH, zW) * 1.12;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // fixed 3/4 pose — the object's own angle gives the 3D read; no mouse parallax
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, CENTER_Y + Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, CENTER_Y, 0);
  }

  /* --- pointer (drives text disturbance, not parallax) --- */
  const ray = new THREE.Raycaster();
  const planeZ0 = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2();
  const hitPt = new THREE.Vector3();
  let mTX = 0,
    mTY = 0,
    hoverT = 0;
  let mX = 0,
    mY = 0,
    hover = 0;

  function onPointerMove(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      hoverT = 0;
      return;
    }
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(planeZ0, hitPt)) {
      mTX = hitPt.x;
      mTY = hitPt.y;
      hoverT = 1;
    }
  }
  function onPointerLeave() {
    hoverT = 0;
  }
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerleave", onPointerLeave, { passive: true });

  /* --- sizing --- */
  let ready = false;
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    frame(w, h);
    ready = true;
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();
  try {
    renderer.compile(scene, camera);
  } catch {
    /* best-effort */
  }

  /* --- frame --- */
  let lastNow = 0;
  let clock = 0;
  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    if (!ready) resize();
    if (!ready) return;

    const now = performance.now() / 1000;
    let dt = lastNow ? now - lastNow : 0;
    lastNow = now;
    if (dt > 0.05) dt = 0.05;
    clock += dt;

    // 1) waveform — bars rise in (left→right), then track the real audio
    slabU.uFormP.value = smooth((t - T_WAVE) / WAVE_IN);
    updateWave(t, dt);

    // 2) transcript — rain down out of the bars; evaporate + re-drop on each line
    textU.uTime.value = clock;
    updateTranscript(t);

    // damped cursor → text disturbance (snappier than the camera)
    const kh = 1 - Math.exp(-9 * dt);
    hover += (hoverT - hover) * (1 - Math.exp(-7 * dt));
    if (hoverT > 0) {
      mX += (mTX - mX) * kh;
      mY += (mTY - mY) * kh;
    }
    textU.uHover.value = hover;
    (textU.uMouse.value as THREE.Vector2).set(mX, mY);

    renderer.render(scene, camera);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerleave", onPointerLeave);
    ro.disconnect();
    sampleCache.clear();
    slabGeo.dispose();
    slabMat.dispose();
    textGeo.dispose();
    textMat.dispose();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch {
      /* not all drivers support it */
    }
    canvas.remove();
  }

  return { tick, resize, dispose };
}
