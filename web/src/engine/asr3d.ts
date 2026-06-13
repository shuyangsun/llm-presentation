/* ============================================================================
   asr3d.ts — the 3D "audio → transcript" supporting art.

   Two coupled pieces, both pure functions of the playhead `t` (so the whole
   thing scrubs backward as cleanly as it plays forward):

   1. WAVEFORM — a row of frosted-glass slabs showing the *actual* audio of the
      video. We precompute the recording's amplitude envelope (see
      scripts/gen-waveform.py → src/data/intro.peaks.json) and scroll a ~1.4s
      window of it across the slabs, so the bars dance to exactly what's being
      said right now.

   2. TRANSCRIPT — the live caption, rendered as a cloud of terracotta particles
      that assemble into the *real* words (the current .vtt cue) like iMessage
      invisible ink developing. Moving the mouse over the text disturbs it —
      the particles scatter with noise (igloo.inc's closing page) and snap back
      to legible text when the cursor leaves.

   Igloo.inc is the spirit (frosted volume, fresnel halo, particle ink, glassy
   disturbance) — palette inverted to warm paper + terracotta, never icy blue.

   Lifecycle: the director (main.ts) owns the only rAF and calls `tick(t)` every
   frame while this scene is mounted, so we render there. `dispose()` releases
   the GL context on removal (browsers cap live contexts; this rebuilds on each
   EN↔中文 toggle).
   ============================================================================ */

import * as THREE from "three";
import peaksRaw from "../data/intro.peaks.json?raw";

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
const REVEAL = 0.7; // seconds for a cue's invisible-ink to develop

/* --- world layout -------------------------------------------------------- */
const COUNT_DESK = 28;
const COUNT_MOB = 18;
const SLAB_SPACING = 0.19;
const SLAB_W = 0.12;
const SLAB_D = 0.12;
const WAVE_STEP = 0.05; // seconds of audio per slab (window = COUNT * step)
const BASE_Y = 0.0; // waveform baseline
const CENTER_Y = -0.1;
const FOV = 34;
const BASE_AZ = -0.16; // resting 3/4 azimuth (rad)
const BASE_EL = 0.12; // resting elevation (rad)

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
  attribute float aHeight;          // 0..~1.1, the real audio amplitude for this slab
  varying vec3 vN;
  varying vec3 vV;
  varying vec2 vUv;
  varying float vUp;
  varying float vSeed;

  void main() {
    float h = max(0.0008, aHeight * uFormP);
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
  uniform float uReveal, uTime, uPixelRatio, uSize, uHover, uDisruptR, uDisruptK, uHazeR;
  uniform vec2 uMouse;
  attribute vec3 aRand;          // 0..1, stable per particle (haze dir + phase)
  attribute float aSeed;
  attribute float aActive;       // 1 = part of the current word, 0 = parked
  varying float vA;
  varying float vSeed;

  void main() {
    vSeed = aSeed;
    vec3 home = position;                                   // exact glyph pixel
    vec3 haze = home + (aRand * 2.0 - 1.0) * uHazeR;        // scattered ink
    float e = smoothstep(0.0, 1.0, clamp(uReveal * 1.3 - aSeed * 0.3, 0.0, 1.0));
    vec3 base = mix(haze, home, e);
    base.xy += vec2(sin(uTime * 1.6 + aSeed * 40.0), cos(uTime * 1.4 + aSeed * 27.0))
               * 0.004 * (0.5 + 0.7 * (1.0 - e));          // idle shimmer

    // mouse disturbance — animated random noise + a radial shove near the cursor
    // scatters the words; they snap back when it leaves (igloo's closing page).
    float d = distance(base.xy, uMouse);
    float infl = exp(-d * d * uDisruptR) * uHover;
    vec2 nz = vec2(
      sin(uTime * 9.0 + aSeed * 54.0) + sin(uTime * 5.3 + aSeed * 121.0),
      cos(uTime * 8.0 + aSeed * 39.0) + cos(uTime * 6.1 + aSeed * 88.0)
    ) * 0.5;
    base.xy += nz * infl * uDisruptK;                  // jitter (the "random noise")
    base.xy += normalize(base.xy - uMouse + 1e-4) * infl * 0.32; // repulsion away from cursor
    base.z += (aRand.z * 2.0 - 1.0) * infl * 0.3;

    vec4 mv = modelViewMatrix * vec4(base, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.7 + 0.45 * e);
    vA = aActive * (0.32 + 0.68 * e) * (1.0 - infl * 0.35);
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
  const heights = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) seeds[i] = Math.random();
  slabGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
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
    uReveal: { value: 0 },
    uTime: { value: 0 },
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 19 : 23 },
    uHover: { value: 0 },
    uDisruptR: { value: 3.5 }, // gaussian falloff (~0.75 world-unit radius)
    uDisruptK: { value: 0.3 },
    uHazeR: { value: 0.16 },
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

  let lastText: string | null = null;
  function applyText(text: string) {
    if (text === lastText) return;
    lastText = text;
    const { pos, count } = buildSamples(text);
    tPos.set(pos.subarray(0, count * 3));
    for (let i = 0; i < count; i++) tActive[i] = 1;
    for (let i = count; i < P; i++) tActive[i] = 0;
    posAttr.needsUpdate = true;
    activeAttr.needsUpdate = true;
  }

  // canvas text needs the web fonts; hold off building glyph particles until
  // they're ready so we never sample a fallback-font layout.
  document.fonts.ready.then(() => {
    fontReady = true;
  });

  /* --- waveform sampling: scroll a window of the real envelope across slabs --- */
  function sampleWave(t: number) {
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
      heights[i] = Math.max(0.04, Math.min(1.15, v * 1.9));
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

    // 1) waveform — real audio envelope, grown in over the first beat
    slabU.uFormP.value = smooth((t - T_WAVE) / 0.35);
    sampleWave(t);

    // 2) transcript — current cue's text + its invisible-ink develop progress
    const cue = getCue(t);
    if (fontReady) applyText(cue ? cue.text : "");
    textU.uReveal.value = cue && fontReady ? clamp01((t - cue.start) / REVEAL) : 0;
    textU.uTime.value = clock;

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
