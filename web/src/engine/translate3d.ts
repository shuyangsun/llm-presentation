/* ============================================================================
   translate3d.ts — "translate it … to Mandarin Chinese" supporting art.

   The presenter says their native tongue is Mandarin, and the site auto-flips
   English → 中文. The scene makes that flip physical:

   A field of warm terracotta word-PARTICLES forms the English word "translate"
   on the LEFT. They stream rightward, pass through a single VERTICAL FROSTED-
   GLASS REFRACTING MEMBRANE standing at the centre, refract / scatter as they
   cross it, and re-form as "翻译" on the RIGHT. The membrane — a real frosted
   pane with a terracotta fresnel rim and animated vertical caustics — is the
   hero element and is what keeps this distinct from asr3d's equalizer slabs.

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing BACKWARD rewinds the crossing exactly (t<166.2 fully English,
   t>169 fully 中文). makeClock() drives ONLY idle shimmer + caustic animation.

   The mouse is the toy: moving it over the pane sends a ripple radiating from
   the cursor across the glass (the verts displace, the caustics bend) and nudges
   any particles mid-crossing nearby; hovering boosts the fresnel rim.

   Spirit of igloo.inc — frosted volume, fresnel halo, particle ink — but on warm
   Paper, never icy blue. NormalBlending + a bright warm core for glow (additive
   blows out to white on light paper). One Points draw call + one membrane draw
   call. Counts drop on small stages.
   ============================================================================ */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, clamp01, TAU } from "./scene3d";
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
  uniform float uTime, uForm, uHover;
  uniform vec2  uRipple;     // cursor position in the pane's local x/y
  uniform float uRippleT;    // 0..1 freshness of the latest ripple
  varying vec2  vUv;
  varying vec3  vN;
  varying vec3  vV;
  varying float vRip;

  void main() {
    vUv = uv;
    vec3 p = position;

    // breathing swell so the glass feels liquid even at rest
    float swell = sin(p.y * 5.0 + uTime * 1.3) * 0.012 + cos(p.y * 9.0 - uTime * 0.9) * 0.006;

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
  uniform vec3  uPaper, uGlass, uRim, uCore;
  uniform float uTime, uForm, uHover;
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

    // animated vertical caustic ripples streaming down the pane
    float caustic = 0.5 + 0.5 * sin(vUv.y * 26.0 + uTime * 1.6 + sin(vUv.x * 7.0) * 2.0);
    caustic *= 0.5 + 0.5 * sin(vUv.y * 11.0 - uTime * 1.1);
    caustic = pow(caustic, 1.6);

    // a faint cool-white core sliver down the centre — the only cool tone
    float core = smoothstep(0.5, 0.46, abs(vUv.x - 0.5));
    core *= 0.32 + 0.18 * sin(uTime * 0.8 + vUv.y * 4.0);

    // soft window vignette so the rectangle dissolves into the paper
    float em = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edge = smoothstep(0.0, 0.12, em);

    vec3 body = uGlass * (0.46 + 0.30 * frost + 0.22 * caustic);
    body = mix(body, uCore, core * 0.5);
    float rim = max(fres, abs(vRip) * 1.4) * (0.55 + 0.45 * uHover);
    vec3 col = mix(body, uRim, clamp(rim, 0.0, 0.92));
    col = mix(col, uPaper, 0.06);

    float alpha = (0.18 + 0.42 * frost + 0.34 * fres + 0.18 * caustic) * edge * uForm;
    alpha = clamp(alpha, 0.0, 0.9);
    gl_FragColor = vec4(col, alpha);
  }
`;

/* ---- particle shaders ---------------------------------------------------- */
// Each particle owns a LEFT home (English) and a RIGHT home (中文). `aPhase` is
// a staggered crossing progress 0→1 it computes against uCross; near the centre
// plane it wobbles + scatters (the "transmutation" at the glass) then snaps to
// its Chinese home. Idle shimmer once settled; the cursor nudges crossers.
const PT_VERT = /* glsl */ `
  uniform float uTime, uCross, uPixelRatio, uSize, uHover;
  uniform vec2  uMouse;
  attribute vec3  aLeft;     // English home
  attribute vec3  aRight;    // 中文 home
  attribute vec3  aRand;     // stable per-particle noise (scatter dir + phase)
  attribute float aSeed;     // 0..1 stagger / shimmer seed
  varying float vMix;        // 0 = English side, 1 = Chinese side
  varying float vSeed;

  void main() {
    vSeed = aSeed;

    // staggered crossing: each particle starts later by its seed so the field
    // flows through the pane as a stream rather than teleporting in unison.
    float local = clamp((uCross - aSeed * 0.42) / 0.58, 0.0, 1.0);
    float e = smoothstep(0.0, 1.0, local);
    vMix = e;

    vec3 base = mix(aLeft, aRight, e);

    // transmutation: a bell peaking as the particle passes the centre plane —
    // it bows toward the glass (+z), scatters, and the point swells briefly.
    float atGlass = exp(-pow((e - 0.5) * 3.4, 2.0));
    vec3 scatter = (aRand - 0.5) * vec3(0.22, 0.30, 0.34);
    base += scatter * atGlass;
    base.z += atGlass * 0.22;

    // idle shimmer (strongest once settled at either end)
    float rest = 1.0 - atGlass;
    base.xy += vec2(sin(uTime * 1.7 + aSeed * 41.0), cos(uTime * 1.4 + aSeed * 28.0)) * 0.006 * rest;

    // cursor nudges particles that are mid-crossing near the pointer
    float md = distance(base.xy, uMouse);
    float infl = exp(-md * md * 4.0) * uHover * atGlass;
    base.xy += normalize(base.xy - uMouse + 1e-4) * infl * 0.22;
    base.z  += (aRand.z - 0.5) * infl * 0.5;

    vec4 mv = modelViewMatrix * vec4(base, 1.0);
    gl_Position = projectionMatrix * mv;
    // swell at the membrane reads as the "refraction flash"
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.85 + 0.7 * atGlass);
  }
`;

const PT_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uEn, uZh, uHot;
  varying float vMix;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.45, 0.0, d);
    // warm terracotta on the English side, deepening toward ink as 中文 settles
    vec3 col = mix(uEn, uZh, vMix);
    col = mix(col, uHot, core * 0.5);
    // a faint per-particle warmth jitter so the settled field twinkles as ink
    col *= 0.92 + 0.16 * vSeed;
    float a = mask * (0.34 + 0.62 * core) * (0.85 + 0.3 * vSeed);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- glyph sampling helper ----------------------------------------------- */
// Rasterise one word into normalised ink points, mapped into a world band on
// the chosen side. (Local sampler so the two words share an identical y-band
// and we can place CJK vs Latin on different x-windows with the same code.)
function sampleWord(text: string, weight: number): { xs: number[]; ys: number[] } {
  const CW = 1024;
  const CH = 512;
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  const fontPx = Math.round(CH * 0.6);
  ctx.font = `${weight} ${fontPx}px "JetBrains Mono","Geist","Noto Sans CJK SC",system-ui,sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";
  ctx.fillText(text, CW / 2, CH / 2);
  const data = ctx.getImageData(0, 0, CW, CH).data;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let py = 0; py < CH; py += 3) {
    for (let px = 0; px < CW; px += 3) {
      if (data[(py * CW + px) * 4 + 3] > 90) {
        xs.push(px / CW); // 0..1
        ys.push(py / CH); // 0..1, y DOWN
      }
    }
  }
  // shuffle so any subsample stays uniform across the glyphs
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  return { xs, ys };
}

/* ---- controller ---------------------------------------------------------- */
export function mountTranslate3D(container: HTMLElement, _lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: 34 });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const clock = makeClock();
  const pointer = trackPointer(canvas, camera, 0);

  const P = small ? 2200 : 4200;

  /* --- membrane (1 draw call) --- */
  const memW = X_GAP * 1.7;
  const memH = Y_BAND * 2 + 0.5;
  const memGeo = new THREE.PlaneGeometry(memW, memH, 32, 48);
  const memU = {
    uTime: { value: 0 },
    uForm: { value: 0 },
    uHover: { value: 0 },
    uRipple: { value: new THREE.Vector2(0, 0) },
    uRippleT: { value: 0 },
    uPaper: { value: pal.paper },
    uGlass: { value: pal.glass },
    uRim: { value: pal.accent },
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
    uEn: { value: pal.accent },
    uZh: { value: pal.accentInk.clone().lerp(pal.fg, 0.28) },
    uHot: { value: pal.accent.clone().lerp(new THREE.Color("#ffffff"), 0.4) },
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

  // Map a sampled word into one side's world band and fill an attribute array.
  function placeWord(text: string, weight: number, x0: number, x1: number, out: Float32Array) {
    const { xs, ys } = sampleWord(text, weight);
    const n = xs.length;
    if (n === 0) {
      for (let i = 0; i < P; i++) {
        out[i * 3] = (x0 + x1) * 0.5;
        out[i * 3 + 1] = 0;
        out[i * 3 + 2] = 0;
      }
      return;
    }
    for (let i = 0; i < P; i++) {
      const k = i % n;
      out[i * 3] = x0 + xs[k] * (x1 - x0); // map normalised x into the side window
      out[i * 3 + 1] = Y_BAND - ys[k] * (Y_BAND * 2); // y DOWN → world y UP
      out[i * 3 + 2] = (aRand[i * 3 + 2] - 0.5) * Z_JITTER;
    }
  }

  let fontReady = false;
  let disposed = false;
  function buildHomes() {
    // LEFT: English "translate" in x ∈ [-X_SPAN .. -X_GAP]
    placeWord("translate", 600, -X_SPAN, -X_GAP, aLeft);
    // RIGHT: 中文 "翻译" in x ∈ [X_GAP .. X_SPAN]
    placeWord("翻译", 700, X_GAP, X_SPAN, aRight);
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

  /* --- frame (narrative = pure f(t); clock = idle only) --- */
  function tick(t: number) {
    if (disposed) return;
    const { dt, t: idle } = clock();
    pointer.update(dt);

    // narrative phases — reversible scrubbing. Hold the crossing at the English
    // side until the web fonts resolve, so we never transmute a fallback layout.
    const formP = phase(t, T_FORM_A, T_FORM_B);
    const cross = fontReady ? phase(t, T_CROSS_A, T_CROSS_B) : 0;

    // membrane scales in (and grows opaque) on form; never crosses if no font.
    const s = 0.86 + 0.14 * smooth(formP);
    membrane.scale.set(s, s, 1);
    memU.uForm.value = formP;
    memU.uTime.value = idle;
    memU.uHover.value = pointer.hover;

    // cursor → membrane ripple: refresh the pulse when the cursor travels, decay
    // it otherwise, so a flick sends a ring radiating across the glass.
    const mx = pointer.world.x;
    const my = pointer.world.y;
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

    // particles cross + transmute; settle into 中文 by T_CROSS_B
    ptU.uCross.value = clamp01(cross);
    ptU.uTime.value = idle;
    ptU.uHover.value = pointer.hover;
    ptU.uMouse.value.set(mx, my);

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
