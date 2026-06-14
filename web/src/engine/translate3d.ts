/* ============================================================================
   translate3d.ts — "translate it … to Mandarin Chinese" supporting art.

   The presenter says their native tongue is Mandarin, and the site auto-flips
   English → 中文. The scene makes that flip physical:

   A field of warm terracotta word-PARTICLES forms the English word "Text"
   on the LEFT. They stream rightward, pass through a single VERTICAL FROSTED-
   GLASS REFRACTING MEMBRANE standing at the centre where they tumble through a
   chaotic "magic transmutation" (swirl + gold spark), and re-form crisp as the
   single character "文" on the RIGHT. The membrane — a real frosted pane with a
   terracotta fresnel rim and animated vertical caustics — is the hero element
   and is what keeps this distinct from asr3d's equalizer slabs.

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing BACKWARD rewinds the crossing exactly (t<166.2 fully "Text",
   t>169 fully "文"). makeClock() drives ONLY idle shimmer + caustic animation.

   The mouse is the toy: moving it over the pane sends a ripple radiating from
   the cursor across the glass (the verts displace, the caustics bend) and the
   whole particle field FOLLOWS the cursor — particles near it are dragged along
   the direction of motion and spring back; hovering boosts the fresnel rim.

   Spirit of igloo.inc — frosted volume, fresnel halo, particle ink — but on warm
   Paper, never icy blue. NormalBlending + a bright warm core for glow (additive
   blows out to white on light paper). One Points draw call + one membrane draw
   call. Counts drop on small stages.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, damp, clamp01, TAU } from "./scene3d";
import type { Lang } from "../data/timeline";

/* --- the score (video seconds) ------------------------------------------- */
const T_FORM_A = 165.5; // membrane scales / fades in …
const T_FORM_B = 166.6; // … fully present here
const T_CROSS_A = 166.2; // particles begin streaming LEFT → RIGHT …
const T_CROSS_B = 169.0; // … all settled into 中文 by here

/* --- world layout -------------------------------------------------------- */
const X_SPAN = 1.32; // each word sits in x ∈ [gap .. X_SPAN] (and mirrored left)
const X_GAP = 0.34; // clear zone on either side of the membrane plane (x≈0)
const Y_BAND = 0.62; // half-height of the shared text band (both words match)
const Z_JITTER = 0.05; // tiny depth spread so the cloud reads volumetric

/* ---- membrane shaders ---------------------------------------------------- */
// Vertical frosted pane facing the 3/4 camera. Vertex pass displaces the glass
// with a cursor ripple + a gentle breathing swell; fragment pass paints frosted
// body + terracotta fresnel rim + animated vertical caustics + one faint cool
// core sliver (the only cool tone allowed, kept subtle).
const MEM_VERT = /* glsl */ `
  uniform float uTime, uForm, uHover, uCharge;
  uniform vec2  uRipple;     // cursor position in the pane's local x/y
  uniform float uRippleT;    // 0..1 freshness of the latest ripple
  varying vec2  vUv;
  varying vec3  vN;
  varying vec3  vV;
  varying float vRip;

  void main() {
    vUv = uv;
    vec3 p = position;

    // breathing swell so the glass feels liquid even at rest — distorts most as
    // the transmutation passes through (uCharge peaks mid-crossing)
    float swell = (sin(p.y * 5.0 + uTime * 1.3) * 0.012 + cos(p.y * 9.0 - uTime * 0.9) * 0.006) * (1.0 + 0.5 * uCharge);

    // a ripple ring radiating out from the cursor across the pane
    float d = distance(p.xy, uRipple);
    float ring = sin(d * 16.0 - uTime * 7.0) * exp(-d * 3.2);
    float rip = ring * uRippleT * (0.3 + 0.7 * uHover);
    vRip = rip;

    p.z += (swell + rip * 0.09) * uForm;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const MEM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3  uPaper, uGlass, uRim, uCore, uGold;
  uniform float uTime, uForm, uHover, uCharge;
  varying vec2  vUv;
  varying vec3  vN;
  varying vec3  vV;
  varying float vRip;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

    // frosted speckle so the body never reads as flat plastic
    float frost = mix(0.82, 1.0, hash(floor(vUv * vec2(34.0, 52.0))));

    // animated vertical caustic ripples streaming down the pane — they boil
    // harder and sharpen while the spell is mid-glass (uCharge)
    float caustic = 0.5 + 0.5 * sin(vUv.y * 26.0 + uTime * 1.6 + sin(vUv.x * 7.0) * 2.0);
    caustic *= 0.5 + 0.5 * sin(vUv.y * 11.0 - uTime * 1.1);
    caustic = pow(caustic, mix(1.6, 2.0, uCharge)) * (1.0 + 0.45 * uCharge);

    // a faint cool-white core sliver down the centre — the only cool tone, and
    // it recedes as the warm transmutation takes over the pane
    float core = smoothstep(0.5, 0.46, abs(vUv.x - 0.5));
    core *= 0.32 + 0.18 * sin(uTime * 0.8 + vUv.y * 4.0);

    // soft window vignette so the rectangle dissolves into the paper
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = smoothstep(0.0, 0.12, em);

    vec3 body = uGlass * (0.46 + 0.30 * frost + 0.22 * caustic);
    body = mix(body, uCore, core * 0.5 * (1.0 - 0.45 * uCharge));
    float rim = max(fres, abs(vRip) * 1.4) * (0.55 + 0.45 * uHover);
    vec3 col = mix(body, uRim, clamp(rim, 0.0, 0.92));
    // the fresnel rim warms toward gold at the magical peak, then cools back
    col = mix(col, uGold, 0.14 * uCharge);
    col = mix(col, uPaper, 0.06);

    float alpha = (0.18 + 0.42 * frost + 0.34 * fres + 0.18 * caustic) * edge * uForm;
    alpha = clamp(alpha, 0.0, 0.9);
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ---- particle shaders ---------------------------------------------------- */
// Each particle owns a LEFT home ("Text") and a RIGHT home ("文"). It computes a
// staggered crossing progress e=f(uCross,aSeed) — PURE, so a reverse scrub
// rewinds it exactly. At the ends (e≈0/1) it sits CRISP on its glyph (organize→1,
// minimal jitter). Through the glass it enters a magic transmutation: a curl-noise
// VORTEX swirls it around the pane, it heats terracotta→gold like an ember, a
// ~12% subset flare as rune-SPARKS, then it COOLS and snaps sharply onto 文. uTime
// drives ONLY idle shimmer + ember twinkle (look, never narrative position). The
// whole field FOLLOWS the cursor: a velocity wake combs nearby particles along the
// pointer's travel and springs back the instant it stops.
const PT_VERT = /* glsl */ `
  uniform float uTime, uCross, uPixelRatio, uSize, uHover;
  uniform vec2  uMouse;      // damped cursor world xy
  uniform vec2  uMouseVel;   // damped, clamped cursor velocity (world units/s)
  attribute vec3  aLeft;     // "Text" home
  attribute vec3  aRight;    // "文" home
  attribute vec3  aRand;     // stable per-particle noise (curl offset / dirs / depth)
  attribute float aSeed;     // 0..1 stagger / spark / twinkle seed
  varying float vMix;        // 0 = English side, 1 = Chinese side
  varying float vSeed;
  varying float vHeat;       // 0 cool ink .. 1 hot gold ember
  varying float vSpark;      // 1.0 for rune-sparks, else 0.0
  varying float vFlick;      // reversible ember flicker 0..1
  varying float vStretch;    // screen-space comet streak amount
  varying vec2  vVel;        // screen-space streak direction

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  // 2D curl of a scalar noise field → divergence-free swirl directions
  vec2 curl(vec2 p) {
    float e = 0.35;
    float n1 = vnoise(p + vec2(0.0, e));
    float n2 = vnoise(p - vec2(0.0, e));
    float n3 = vnoise(p + vec2(e, 0.0));
    float n4 = vnoise(p - vec2(e, 0.0));
    return vec2(n1 - n2, n4 - n3) / (2.0 * e);
  }

  void main() {
    vSeed = aSeed;

    // staggered crossing — PURE f(uCross, aSeed) so a reverse scrub rewinds it
    float local = clamp((uCross - aSeed * 0.42) / 0.58, 0.0, 1.0);
    float e = smoothstep(0.0, 1.0, local);
    vMix = e;

    // crisp narrative home: exactly "Text" at e=0, exactly "文" at e=1
    vec3 home = mix(aLeft, aRight, e);
    vec3 base = home;

    // ASYMMETRIC chaos window: airy un-knit out of "Text", a sharp snap into 文
    float exitR   = smoothstep(0.06, 0.32, e);
    float settleR = pow(smoothstep(0.94, 0.60, e), 2.2);
    float chaos   = clamp(exitR * settleR, 0.0, 1.0);   // 0 at the ends, 1 mid-pane
    float organize = 1.0 - chaos;                        // 1 at the formed ends
    float turb = chaos * chaos;                          // snappier band

    // deterministic ~12% of the field flare as brighter rune-sparks
    float spark = step(0.88, aSeed);
    vSpark = spark;

    // curl-noise VORTEX advection — the "time" a mote has dissolved is e (NOT
    // uTime), so scrubbing rewinds the exact swirl. Two octaves = airy turbulence.
    vec2 fp = home.xy * 2.1 + aRand.xy * 12.0 + vec2(e * 2.6, 0.0);
    vec2 flow = curl(fp) + curl(fp * 2.7 + 5.0) * 0.45;
    vec2 swirl = flow * (0.18 + 0.07 * spark);

    // membrane-locked shear: spin AROUND the pane centre (x≈0) — the portal read
    float ringR = length(home.xy) + 1e-3;
    vec2  tangent = vec2(-home.y, home.x) / ringR;
    swirl += tangent * (0.11 + 0.06 * aRand.x);

    base.xy += swirl * turb;
    base.y  += turb * (0.06 + 0.10 * aRand.y);           // hot sparks rise
    base.z  += turb * (0.12 + 0.08 * aRand.z) + turb * spark * 0.06; // bow into glass

    // ACTIVE organize: the last stretch contracts onto the EXACT glyph home
    base.xy = mix(base.xy, home.xy, organize * organize * 0.9);
    base.z  = mix(base.z,  home.z,  organize * organize * 0.9);

    // reversible ember flicker (brightness only, keyed to e + seed)
    vFlick = vnoise(vec2(e * 9.0, aSeed * 50.0));

    // ember heat: chaos + curl speed → frag colour ramp terracotta→gold
    float curlSpeed = length(flow);
    vHeat = clamp(turb * (0.46 + 0.7 * curlSpeed) + spark * turb * 0.3, 0.0, 1.0);

    // idle shimmer at the formed ends — sub-pixel, gated by organize
    base.xy += vec2(sin(uTime * 1.7 + aSeed * 41.0), cos(uTime * 1.4 + aSeed * 28.0)) * 0.0028 * organize;

    // WHOLE-FIELD MOUSE WAKE: comb particles along the cursor's travel, then
    // spring back when it stops (wake is pure f(current pointer), added atop home)
    vec2  md = base.xy - uMouse;
    float wake = exp(-dot(md, md) * 5.5) * uHover * (1.0 + 1.4 * chaos);
    float vmag = length(uMouseVel);
    base.xy += uMouseVel * wake * 0.16;                       // comb along travel
    base.xy += normalize(md + vec2(1e-4)) * wake * 0.04 * vmag; // part the field
    base.z  += (aRand.z - 0.5) * wake * 0.22;
    vHeat = clamp(vHeat + wake * vmag * 0.3 * (0.3 + 0.7 * chaos), 0.0, 1.0); // stirring stokes embers

    vec4 mv = modelViewMatrix * vec4(base, 1.0);
    gl_Position = projectionMatrix * mv;

    // comet streak (screen-space) for fast embers / strong wake
    vVel = normalize(swirl * turb + uMouseVel * wake + vec2(1e-4));
    vStretch = clamp(length(swirl * turb) * 2.0 + wake * vmag * 0.5, 0.0, 0.7);

    // fine ink dots at the ends; swell with ember heat at the glass; sparks pop
    float sizeMul = (0.82 - 0.16 * chaos) + 0.7 * vHeat + spark * (0.4 + 0.5 * turb) + wake * 0.2 * spark;
    float tw = 0.94 + 0.14 * sin(uTime * 6.0 + aSeed * 60.0);
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * clamp(sizeMul, 0.4, 2.2) * mix(1.0, tw, vHeat);
  }
`;

const PT_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uEn, uZh, uHot, uGold;
  varying float vMix;
  varying float vSeed;
  varying float vHeat;
  varying float vSpark;
  varying float vFlick;
  varying float vStretch;
  varying vec2  vVel;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;

    // anisotropic stretch ALONG velocity → a short comet streak for fast embers
    vec2 vd = normalize(vVel + vec2(1e-4));
    vec2 pv = vec2(dot(uv, vd), dot(uv, vec2(-vd.y, vd.x)));
    pv.x /= (1.0 + vStretch);
    float d = dot(pv, pv);
    if (d > 1.0) discard;

    float mask = smoothstep(1.0, 0.0, d);
    float coreW = mix(0.42, 0.62, vHeat);     // tight core at the ends, wider when hot
    float core = smoothstep(coreW, 0.0, d);
    float pin  = smoothstep(0.12, 0.0, d);    // hot pinpoint for sparks

    // base ink: terracotta (English) → deep ink-red as 文 settles
    vec3 col = mix(uEn, uZh, vMix);

    // ember temperature: warm core → amber gold at peak heat (opaque, not additive)
    float charge = vHeat * (0.55 + 0.45 * vFlick);
    vec3 hot = mix(uHot, uGold, smoothstep(0.42, 0.95, vHeat));
    col = mix(col, hot, core * (0.42 + 0.42 * charge));

    // rune-sparks: bias toward gold + a hot pinpoint ember centre
    col = mix(col, uGold, vSpark * core * (0.35 + 0.5 * vHeat));
    col += uGold * pin * vSpark * (0.35 + 0.65 * vFlick) * 0.55;

    // a faint 4-point star glint through hot ember centres (live-coal read)
    float glint = (1.0 - smoothstep(0.0, 0.10, abs(pv.x))) + (1.0 - smoothstep(0.0, 0.10, abs(pv.y)));
    glint = clamp(glint, 0.0, 1.0) * core * vHeat * 0.6;
    col = mix(col, uGold, glint);

    // per-particle warmth jitter — dropped when settled so glyphs read clean
    col *= 0.92 + 0.16 * vSeed * (0.3 + 0.7 * vHeat);

    // alpha: settled ink even + solid; embers pop but never bloom (capped < 1)
    float aJit = mix(1.0, 0.72 + 0.5 * vFlick, vHeat);
    float a = mask * (0.34 + 0.60 * core) * aJit * (0.85 + 0.30 * vSeed);
    a *= 0.90 + 0.45 * vHeat;
    a = min(a, 0.97);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- glyph sampling helper ----------------------------------------------- */
// Rasterise one word and return its ink points normalised to the glyph's OWN
// bounding box (0..1, y DOWN) plus that box's aspect (h/w). Bbox-relative coords
// let placeWord() contain-fit each word — Latin "Text" and a single bold CJK
// glyph — centred in its side window, so the settled ends read crisp + balanced
// regardless of how much of the canvas the raw glyph happened to cover.
function sampleWord(text: string, weight: number): { xs: number[]; ys: number[]; aspect: number } {
  const CW = 1024;
  const CH = 512;
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  const fontPx = Math.round(CH * 0.62);
  ctx.font = `${weight} ${fontPx}px "JetBrains Mono","Geist","Noto Sans CJK SC",system-ui,sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, CW / 2, CH / 2);
  const data = ctx.getImageData(0, 0, CW, CH).data;
  const xs: number[] = [];
  const ys: number[] = [];
  let minX = CW;
  let maxX = 0;
  let minY = CH;
  let maxY = 0;
  for (let py = 0; py < CH; py += 3) {
    for (let px = 0; px < CW; px += 3) {
      if (data[(py * CW + px) * 4 + 3] > 90) {
        xs.push(px);
        ys.push(py);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  // re-base each point to the glyph's bounding box → 0..1
  for (let i = 0; i < xs.length; i++) {
    xs[i] = (xs[i] - minX) / bw;
    ys[i] = (ys[i] - minY) / bh;
  }
  // shuffle so any subsample stays uniform across the glyphs
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  return { xs, ys, aspect: bh / bw };
}

/* ---- controller ---------------------------------------------------------- */
export function mountTranslate3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: 34 });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const clock = makeClock();
  const pointer = trackPointer(canvas, camera, 0);

  const P = small ? 2200 : 4200;

  // warm amber/gold spark accent for the magic — derived from the palette so a
  // theme tweak flows in; pushed toward a warm amber, NEVER a cold or white tone.
  const gold = pal.accent.clone().lerp(new THREE.Color("#ffb24a"), 0.62);

  /* --- membrane (1 draw call) --- */
  const memW = X_GAP * 1.7;
  const memH = Y_BAND * 2 + 0.5;
  const memGeo = new THREE.PlaneGeometry(memW, memH, 32, 48);
  const memU = {
    uTime: { value: 0 },
    uForm: { value: 0 },
    uHover: { value: 0 },
    uCharge: { value: 0 }, // reversible bell peaking mid-crossing — the spell passing through
    uRipple: { value: new THREE.Vector2(0, 0) },
    uRippleT: { value: 0 },
    uPaper: { value: pal.paper },
    uGlass: { value: pal.glass },
    uRim: { value: pal.accent },
    uGold: { value: gold },
    uCore: { value: pal.fgFaint.clone().lerp(new THREE.Color("#ffffff"), 0.55) },
  };
  const memMat = new THREE.ShaderMaterial({
    uniforms: memU,
    vertexShader: MEM_VERT,
    fragmentShader: MEM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const membrane = new THREE.Mesh(memGeo, memMat);
  membrane.frustumCulled = false;
  scene.add(membrane);

  /* --- particles (1 draw call) --- */
  const aLeft = new Float32Array(P * 3);
  const aRight = new Float32Array(P * 3);
  const aRand = new Float32Array(P * 3);
  const aSeed = new Float32Array(P);
  for (let i = 0; i < P; i++) {
    aRand[i * 3] = Math.random();
    aRand[i * 3 + 1] = Math.random();
    aRand[i * 3 + 2] = Math.random();
    aSeed[i] = Math.random();
  }

  const ptGeo = new THREE.BufferGeometry();
  const leftAttr = new THREE.BufferAttribute(aLeft, 3);
  const rightAttr = new THREE.BufferAttribute(aRight, 3);
  // `position` is required by three even though the shader drives off aLeft/aRight.
  ptGeo.setAttribute("position", new THREE.BufferAttribute(aLeft, 3));
  ptGeo.setAttribute("aLeft", leftAttr);
  ptGeo.setAttribute("aRight", rightAttr);
  ptGeo.setAttribute("aRand", new THREE.BufferAttribute(aRand, 3));
  ptGeo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));

  const ptU = {
    uTime: { value: 0 },
    uCross: { value: 0 },
    uPixelRatio: { value: dpr },
    uSize: { value: small ? 16 : 20 },
    uHover: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uMouseVel: { value: new THREE.Vector2(0, 0) }, // damped, clamped cursor velocity (world units/s)
    uEn: { value: pal.accent },
    uZh: { value: pal.accentInk.clone().lerp(pal.fg, 0.28) },
    uHot: { value: pal.accent.clone().lerp(new THREE.Color("#ffffff"), 0.4) },
    uGold: { value: gold },
  };
  const ptMat = new THREE.ShaderMaterial({
    uniforms: ptU,
    vertexShader: PT_VERT,
    fragmentShader: PT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(ptGeo, ptMat);
  points.frustumCulled = false;
  scene.add(points);

  // Contain-fit a sampled word into one side's window and fill an attribute
  // array. The word is centred on (cx, 0) and scaled to fill `winW × winH` by
  // its limiting dimension, so "Text" (wide) and "文" (a bold single glyph) each
  // sit crisp + balanced in their band — the organised resting state #4 wants.
  const FILL = 0.92;
  function placeWord(text: string, weight: number, cx: number, winW: number, winH: number, out: Float32Array) {
    const { xs, ys, aspect } = sampleWord(text, weight);
    const n = xs.length;
    if (n === 0) {
      for (let i = 0; i < P; i++) {
        out[i * 3] = cx;
        out[i * 3 + 1] = 0;
        out[i * 3 + 2] = 0;
      }
      return;
    }
    // contain-fit: width-limited unless the glyph is taller than the window
    let drawW = winW * FILL;
    let drawH = drawW * aspect;
    if (drawH > winH * FILL) {
      drawH = winH * FILL;
      drawW = drawH / aspect;
    }
    for (let i = 0; i < P; i++) {
      const k = i % n;
      out[i * 3] = cx + (xs[k] - 0.5) * drawW; // centred in the side window
      out[i * 3 + 1] = (0.5 - ys[k]) * drawH; // y DOWN → world y UP, centred on 0
      out[i * 3 + 2] = (aRand[i * 3 + 2] - 0.5) * Z_JITTER;
    }
  }

  const WIN_W = X_SPAN - X_GAP; // usable width of each side window
  const WIN_H = Y_BAND * 2; // shared band height
  const X_MID = (X_GAP + X_SPAN) * 0.5; // centre of a side window

  let fontReady = false;
  let disposed = false;
  function buildHomes() {
    // LEFT: capitalised Latin "Text", centred in x ∈ [-X_SPAN .. -X_GAP]
    placeWord("Text", 600, -X_MID, WIN_W, WIN_H, aLeft);
    // RIGHT: the single character 文 ("text"), centred in x ∈ [X_GAP .. X_SPAN]
    placeWord("文", 700, X_MID, WIN_W, WIN_H, aRight);
    leftAttr.needsUpdate = true;
    rightAttr.needsUpdate = true;
    (ptGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
  // Canvas text needs the web fonts; hold off until they resolve so we never
  // sample a fallback-font layout. A placeholder keeps verts valid meanwhile.
  buildHomes();
  document.fonts.ready.then(() => {
    if (disposed) return; // scene torn down before the fonts resolved
    fontReady = true;
    buildHomes();
  });

  /* --- camera framing: fit BOTH a tall mobile box and a wide desktop box --- */
  const FOV = 34;
  const tanH = Math.tan((FOV * Math.PI) / 360);
  const halfW = X_SPAN + 0.2;
  const halfH = memH * 0.5 + 0.15;
  const BASE_AZ = -0.18; // resting 3/4 azimuth
  const BASE_EL = 0.1; // resting elevation
  stage.onResize((w, h) => {
    const aspect = w / h || 1;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.14;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
  });

  /* --- ripple state: a decaying pulse seeded each time the cursor moves --- */
  const ripple = new THREE.Vector2(0, 0);
  let rippleT = 0;
  let lastMouseX = 0;
  let lastMouseY = 0;

  /* --- mouse-velocity state for the whole-field wake (#2). Kept SEPARATE from
     the ripple's last-position so the ripple test and the wake never fight. --- */
  const mouseVel = new THREE.Vector2(0, 0); // damped, clamped — drives the wake
  let lastWX = 0;
  let lastWY = 0;
  const MAX_VEL = 1.4; // world units/s clamp so a fast flick can't fling the field

  /* --- crossing state. While the first animation plays it tracks the narrative
     phase exactly (reversible scrub). Once that completes the crossing simply
     REFLECTS the live site language (en → "Text", zh → "文"); the cursor's side
     of the glass flips that language, so the scene drives AND mirrors the site. */
  let crossState = 0;
  const X_FLIP = 0.33; // world-x past the wall (just outside the pane) to flip language
  const docEl = document.documentElement;
  const siteIsZh = () => docEl.getAttribute("data-lang") === "zh";
  function requestLang(next: Lang) {
    // ask the host page to switch language — only when it would actually change
    // (the host's setLang guards too); the host echoes it back via data-lang.
    if ((siteIsZh() ? "zh" : "en") === next) return;
    window.dispatchEvent(new CustomEvent("site-set-lang", { detail: next }));
  }

  /* --- frame (narrative = pure f(t); clock = idle only) --- */
  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();
    pointer.update(dt);

    const mx = pointer.world.x;
    const my = pointer.world.y;

    // membrane form is a pure phase. Hold any crossing at the English side until
    // the web fonts resolve, so we never transmute a fallback layout.
    const formP = phase(t, T_FORM_A, T_FORM_B);

    // crossing: the NARRATIVE phase owns it (exact + reversible) while the first
    // animation plays; once it has completed (t ≥ T_CROSS_B) the CURSOR'S side of
    // the wall takes over — left half pulls back to "Text" (0), right half to
    // "文" (1) via the same transmutation in reverse. Cursor away → hold the word.
    const narrativeCross = fontReady ? phase(t, T_CROSS_A, T_CROSS_B) : 0;
    if (!fontReady || t < T_CROSS_B) {
      crossState = narrativeCross; // narrative owns it — exact + reversible
    } else {
      // first animation done: the cursor's side of the wall sets the SITE
      // language (left → English, right → 中文); crossState then reflects the
      // live site language (en → "Text"/0, zh → "文"/1), damped so the flip
      // replays the transmutation. The glass pane (±X_FLIP) is a neutral zone.
      if (pointer.hover > 0.02) {
        if (mx < -X_FLIP) requestLang("en");
        else if (mx > X_FLIP) requestLang("zh");
      }
      crossState = damp(crossState, siteIsZh() ? 1 : 0, 4.5, dt);
    }
    const cross = crossState;

    // membrane scales in (and grows opaque) on form; never crosses if no font.
    const s = 0.86 + 0.14 * smooth(formP);
    membrane.scale.set(s, s, 1);
    memU.uForm.value = formP;
    memU.uTime.value = idle;
    memU.uHover.value = pointer.hover;
    // the glass "charges up" as the spell passes through — a bell of the crossing
    // (peaks mid-pane), so it re-fires whenever the word flips back and forth too.
    memU.uCharge.value = Math.exp(-Math.pow((cross - 0.5) * 4.0, 2.0)) * formP;

    // cursor → membrane ripple: refresh the pulse when the cursor travels, decay
    // it otherwise, so a flick sends a ring radiating across the glass.
    const moved = Math.hypot(mx - lastMouseX, my - lastMouseY);
    lastMouseX = mx;
    lastMouseY = my;
    if (pointer.hover > 0.02 && moved > 0.002) {
      ripple.set(mx, my); // pane local x/y ≈ world x/y (pane stands on x/y at z≈0)
      rippleT = 1;
    } else {
      rippleT = Math.max(0, rippleT - dt * 0.9);
    }
    memU.uRipple.value.copy(ripple);
    memU.uRippleT.value = rippleT;

    // particles cross + transmute; settle into 文 by T_CROSS_B
    ptU.uCross.value = clamp01(cross);
    ptU.uTime.value = idle;
    ptU.uHover.value = pointer.hover;
    ptU.uMouse.value.set(mx, my);

    // cursor velocity → the whole-field wake (#2). Instantaneous world-space
    // velocity, magnitude-clamped, then low-pass damped: the damping IS the
    // wake's inertia + spring-back (it eases to 0 the moment the cursor stops or
    // leaves), so particles follow the pointer's travel and relax back home.
    const invDt = dt > 1e-4 ? 1 / dt : 0;
    let vx = (mx - lastWX) * invDt;
    let vy = (my - lastWY) * invDt;
    lastWX = mx;
    lastWY = my;
    const vm = Math.hypot(vx, vy);
    if (vm > MAX_VEL) {
      const sc = MAX_VEL / vm;
      vx *= sc;
      vy *= sc;
    }
    const present = pointer.hover > 0.02;
    mouseVel.x = damp(mouseVel.x, present ? vx : 0, 12, dt);
    mouseVel.y = damp(mouseVel.y, present ? vy : 0, 12, dt);
    ptU.uMouseVel.value.copy(mouseVel);

    // gentle whole-field sway keeps the cloud alive at the resting ends
    points.rotation.z = Math.sin(idle * 0.25) * 0.012 + (pointer.ndc.x * 0.03) / TAU;

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    stage.dispose(() => {
      memGeo.dispose();
      memMat.dispose();
      ptGeo.dispose();
      ptMat.dispose();
    });
  }

  return { tick, dispose };
}
