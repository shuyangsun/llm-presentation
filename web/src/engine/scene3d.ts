/* ============================================================================
   scene3d.ts — shared scaffold for the 3D supporting-art scenes.

   asr3d.ts shipped first and is self-contained; the *other* scenes
   (translate / sync / responsive / director / rag / loop) all share the same
   skeleton, so it lives here once:

   - a WebGL stage (transparent renderer over the paper bg, DPR-capped,
     ResizeObserver-driven) with a perspective camera the scene frames itself,
   - the Paper palette read straight from the CSS `:root` tokens (so a future
     theme tweak flows into the shaders),
   - a pointer tracker that projects the cursor onto a world plane and exposes a
     damped position + a 0..1 hover amount (every scene reacts to the mouse),
   - the small math vocabulary the scenes lean on: `phase(t,a,b)` (a smoothstep
     ramp pinned to two playhead timestamps — the reversible building block) and
     `damp` (frame-rate-independent easing for idle/pointer motion).

   Like asr3d, colour management is OFF so a `new THREE.Color("#c25450")` emits
   that exact sRGB hex — matching the DOM captions sitting beside the canvas.
   ============================================================================ */

import * as THREE from "three";

// Author + emit colours in sRGB so shader output matches the CSS hex tokens.
THREE.ColorManagement.enabled = false;

/* --- math ---------------------------------------------------------------- */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number): number => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
/** A reversible phase ramp: 0 at playhead `a`, 1 at `b`, smoothstepped between.
 *  Every narrative reveal is built from these so scrubbing rewinds exactly. */
export const phase = (t: number, a: number, b: number): number => smooth((t - a) / (b - a));
/** Frame-rate-independent easing toward `tgt` (λ = responsiveness). */
export const damp = (cur: number, tgt: number, lambda: number, dt: number): number =>
  cur + (tgt - cur) * (1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

/* --- palette ------------------------------------------------------------- */
export interface Palette {
  paper: THREE.Color;
  surface: THREE.Color;
  surface2: THREE.Color;
  hairline: THREE.Color;
  hairlineStrong: THREE.Color;
  fg: THREE.Color;
  fg2: THREE.Color;
  fgMuted: THREE.Color;
  fgFaint: THREE.Color;
  accent: THREE.Color;
  accentInk: THREE.Color;
  /** terracotta lightened toward paper — the milky "frosted glass" body tone. */
  glass: THREE.Color;
}

function token(name: string, fallback: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export function palette(): Palette {
  const paper = token("--bg", "#f7f4ee");
  const accent = token("--accent", "#c25450");
  return {
    paper,
    surface: token("--surface", "#fbf9f4"),
    surface2: token("--surface-2", "#f1ede4"),
    hairline: token("--hairline", "#e6e1d7"),
    hairlineStrong: token("--hairline-strong", "#d6cfc0"),
    fg: token("--fg", "#1a1614"),
    fg2: token("--fg-2", "#3a3530"),
    fgMuted: token("--fg-muted", "#6b6660"),
    fgFaint: token("--fg-faint", "#a8a299"),
    accent,
    accentInk: token("--accent-ink", "#9c3f3c"),
    glass: accent.clone().lerp(paper, 0.6),
  };
}

/* --- stage --------------------------------------------------------------- */
export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** capped device-pixel-ratio actually used (feed shader uPixelRatio). */
  dpr: number;
  /** true on phones / narrow containers — scenes drop particle counts here. */
  small: boolean;
  /** latest container size in CSS px. */
  size: { w: number; h: number };
  /** register a framing callback; runs on every resize and once when first sized. */
  onResize(cb: (w: number, h: number) => void): void;
  /** render if the container has a non-zero size yet; returns whether it drew. */
  render(): boolean;
  /** full teardown (RO + GL context + canvas); pass `extra` to dispose scene geo/mats. */
  dispose(extra?: () => void): void;
}

export function createStage(container: HTMLElement, opts: { fov?: number } = {}): Stage {
  const small = window.innerWidth < 760;
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
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 34, 1, 0.1, 100);

  const size = { w: 0, h: 0 };
  let ready = false;
  const resizeCbs: ((w: number, h: number) => void)[] = [];

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    size.w = w;
    size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const cb of resizeCbs) cb(w, h);
    ready = true;
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();

  let disposed = false;
  return {
    renderer,
    scene,
    camera,
    canvas,
    dpr,
    small,
    size,
    onResize(cb) {
      resizeCbs.push(cb);
      if (ready) cb(size.w, size.h);
    },
    render() {
      if (disposed) return false;
      if (!ready) resize();
      if (!ready) return false;
      renderer.render(scene, camera);
      return true;
    },
    dispose(extra) {
      if (disposed) return;
      disposed = true;
      ro.disconnect();
      try {
        extra?.();
      } catch {
        /* best-effort scene teardown */
      }
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {
        /* not all drivers support it */
      }
      canvas.remove();
    },
  };
}

/* --- clock --------------------------------------------------------------- */
/** Wall-clock delta for idle motion (shimmer/spin) — never used for narrative
 *  phase, which must stay a pure function of the playhead so scrubs reverse. */
export function makeClock(): () => { dt: number; t: number } {
  let last = 0;
  let elapsed = 0;
  return () => {
    const now = performance.now() / 1000;
    let dt = last ? now - last : 0;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp after a stall / backgrounded tab
    elapsed += dt;
    return { dt, t: elapsed };
  };
}

/* --- text → point samples ------------------------------------------------ */
export interface GlyphSamples {
  /** xy pairs normalised to [0..1] within the text region, y pointing DOWN. */
  pos: Float32Array;
  count: number;
  /** region aspect (height / width) the layout was sized for. */
  aspect: number;
}

/** Rasterise `text` (word-wrapped, centred) to an offscreen canvas and sample its
 *  ink pixels into up to `max` normalised points — the same technique asr3d uses
 *  to turn the live cue into particles, exposed for any scene that morphs words.
 *  Sample only after `document.fonts.ready`, or the layout uses a fallback font. */
export function sampleGlyphs(
  text: string,
  opts: { max: number; aspect?: number; lines?: number; weight?: number; step?: number } = { max: 4000 },
): GlyphSamples {
  const aspect = opts.aspect ?? 0.5;
  const lines = opts.lines ?? 2;
  const step = opts.step ?? 3;
  const CW = 1024;
  const CH = Math.max(96, Math.round(CW * aspect));
  const cv = document.createElement("canvas");
  cv.width = CW;
  cv.height = CH;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  if (!text) return { pos: new Float32Array(0), count: 0, aspect };

  const fontPx = Math.round((CH / lines) * 0.62);
  const lineH = fontPx * 1.16;
  ctx.font = `${opts.weight ?? 600} ${fontPx}px "JetBrains Mono","Geist","Noto Sans CJK SC",system-ui,sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillStyle = "#fff";

  // greedy word-wrap to the region width
  const maxW = CW * 0.94;
  const words = text.split(/\s+/);
  const wrapped: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (ctx.measureText(trial).width > maxW && line) {
      wrapped.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) wrapped.push(line);
  const shown = wrapped.slice(0, lines);
  const blockH = shown.length * lineH;
  let y = CH / 2 - blockH / 2 + lineH / 2;
  for (const ln of shown) {
    ctx.fillText(ln, CW / 2, y);
    y += lineH;
  }

  const data = ctx.getImageData(0, 0, CW, CH).data;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let py = 0; py < CH; py += step) {
    for (let px = 0; px < CW; px += step) {
      if (data[(py * CW + px) * 4 + 3] > 90) {
        xs.push(px);
        ys.push(py);
      }
    }
  }
  // shuffle so a subsample (when > max) stays uniform across the glyphs
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
    [ys[i], ys[j]] = [ys[j], ys[i]];
  }
  const count = Math.min(opts.max, xs.length);
  const pos = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos[i * 2] = xs[i] / CW;
    pos[i * 2 + 1] = ys[i] / CH;
  }
  return { pos, count, aspect };
}

/* --- pointer ------------------------------------------------------------- */
export interface Pointer {
  /** damped cursor position in world units on the tracked plane. */
  world: THREE.Vector2;
  /** raw normalised device coords (-1..1, y up); 0,0 when outside. */
  ndc: THREE.Vector2;
  /** damped 0..1 presence — 1 while the cursor is over the canvas. */
  hover: number;
  /** advance the damping; call once per frame with the clock dt. */
  update(dt: number, lambda?: number): void;
  dispose(): void;
}

/** Project the cursor onto the world plane z = `planeZ` and expose a damped
 *  position + hover amount. Scenes that want rotation can also read `ndc.x`. */
export function trackPointer(canvas: HTMLElement, camera: THREE.Camera, planeZ = 0): Pointer {
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
  const ndcRaw = new THREE.Vector2(0, 0);
  const hit = new THREE.Vector3();
  const tgt = new THREE.Vector2(0, 0);
  const world = new THREE.Vector2(0, 0);
  const ndc = new THREE.Vector2(0, 0);
  let hoverTgt = 0;
  let hover = 0;

  function onMove(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) {
      hoverTgt = 0;
      return;
    }
    ndcRaw.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndcRaw.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndcRaw, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      tgt.set(hit.x, hit.y);
      hoverTgt = 1;
    }
  }
  function onLeave() {
    hoverTgt = 0;
  }
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerleave", onLeave, { passive: true });

  return {
    world,
    ndc,
    get hover() {
      return hover;
    },
    update(dt, lambda = 8) {
      hover = damp(hover, hoverTgt, 7, dt);
      // only chase the cursor while it's present, so it parks where it left.
      if (hoverTgt > 0) {
        world.x = damp(world.x, tgt.x, lambda, dt);
        world.y = damp(world.y, tgt.y, lambda, dt);
        ndc.x = damp(ndc.x, ndcRaw.x, lambda, dt);
        ndc.y = damp(ndc.y, ndcRaw.y, lambda, dt);
      } else {
        // ease NDC back to centre so rotation-driven scenes relax to rest.
        ndc.x = damp(ndc.x, 0, 2.5, dt);
        ndc.y = damp(ndc.y, 0, 2.5, dt);
      }
    },
    dispose() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    },
  } as Pointer;
}
