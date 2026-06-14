/* ============================================================================
   rag3d.ts — the 3D "retrieval-augmented generation" supporting art.

   The beat: "I don't know what model I'll use to transcribe this ... use the
   RAG, don't just search for the string ... find out which model ... and show
   that on the screen." So this scene IS retrieval — in embedding space, not as
   string match:

   1. GALAXY — a soft warm constellation of faint document points (the whole
      chat-history corpus) floating in a rough disk/sphere. It fades + expands
      in on the scene's base beat.

      Each labelled node is a real OPEN-SOURCE file (complex session transcripts,
      a README, and rag3d.ts itself) and links to its source on GitHub. The cloud
      holds one size for the whole scene and stays steerable — it never collapses.

   2. PROBE — one bright query point you steer with the mouse (it auto-orbits
      slowly when the cursor is away). Each frame we find its k NEAREST document
      nodes in 3D and light thin terracotta BEAMS from the probe to them, and
      brighten those nodes — the felt experience of k-NN retrieval. Move the
      mouse and a different neighbourhood lights up: that is "use the RAG".
      (Hovering a link hides these probe beams so the page is clean to click.)

   3. SKILLS — the two named skills are DOM links whose curved edges scan the
      labelled corpus nodes, then lock one-by-one onto a node in the centre cloud
      as the narration names them (see the overlay below). The DOM answer card
      resolves the model name on its own beat; there is no cloud convergence.

   Igloo.inc is the spirit (frosted volume, terracotta fresnel halo, warm
   particle glow) — palette warm Paper + terracotta, never icy blue. Glow is a
   bright warm core on NormalBlending (additive blows out to white on paper).

   Everything narrative is a pure function of the playhead `t` via phase(t,a,b),
   so scrubbing backward rewinds the galaxy and the skill reveals exactly;
   makeClock() drives ONLY the idle twinkle/drift, the auto-orbit and edge scan. */

import * as THREE from "three";
import { createStage, palette, trackPointer, makeClock, phase, smooth, clamp01, damp, TAU } from "./scene3d";
import { SKILLS, SKILL_AT, CORPUS_FILES, type Lang } from "../data/timeline";

/* --- the score (playhead seconds) --------------------------------------- */
const T_FORM_A = 298.5; // galaxy begins to fade/expand in
const T_FORM_B = 300.2;

// Each skill's edge stops scanning random corpus nodes, swings onto a node in the
// cloud, and its DOM link goes permanently visible over this ramp — starting at
// its SKILL_AT beat (imported; pinned to en.vtt, one skill at a time).
const SKILL_LOCK = 2.0;

/* --- world layout -------------------------------------------------------- */
const FOV = 34;
const BASE_AZ = -0.22; // resting 3/4 azimuth (rad)
const BASE_EL = 0.16; // resting elevation (rad)
const R_DISK = 1.5; // embedding-space radius (xy)
const R_THICK = 0.5; // embedding-space half-thickness (z)
const K_NN = 5; // nearest neighbours lit per frame
const MAX_LIT = K_NN; // beam segment budget = neighbours

// Two document nodes parked in the dense centre — the "cloud" each named skill's
// edge resolves onto (kept apart so their arrowheads don't coincide). World y is
// up, x is right.
const CLOUD = [new THREE.Vector3(-0.3, 0.18, 0.06), new THREE.Vector3(0.26, -0.07, -0.05)];

/* ---- shaders ------------------------------------------------------------ */

// Ambient corpus cloud + the brighter document nodes share this point shader:
// a soft round warm sprite whose brightness/size is driven per-point by aLit
// (0 = faint corpus, up to 1 = a lit neighbour) and globally by uForm.
const PTS_VERT = /* glsl */ `
  uniform float uPixelRatio, uForm, uTime;
  uniform float uSizeBase, uSizeLit;
  attribute float aSeed;     // stable 0..1 per point (twinkle phase)
  attribute float aBright;   // base brightness class (corpus vs document)
  attribute float aLit;      // 0..1 retrieval highlight (documents only)
  varying float vGlow;
  varying float vSeed;

  void main() {
    // entrance: galaxy expands outward from the centre as it fades in, then HOLDS
    // this size for the rest of the scene — no late collapse, so it stays steerable.
    vec3 p = mix(position * 0.55, position, uForm);

    float tw = 0.6 + 0.4 * sin(uTime * 1.3 + aSeed * ${TAU.toFixed(5)});  // idle twinkle
    vGlow = aBright * (0.5 + 0.5 * tw) + aLit;
    vSeed = aSeed;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = mix(uSizeBase, uSizeLit, clamp(aLit, 0.0, 1.0));
    gl_PointSize = size * uPixelRatio * (1.0 / max(0.1, -mv.z)) * (0.35 + 0.65 * uForm);
  }
`;

const PTS_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uCorpus, uDoc, uHot;
  varying float vGlow;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = dot(uv, uv);
    if (d > 1.0) discard;
    float mask = smoothstep(1.0, 0.0, d);       // soft round falloff
    float core = smoothstep(0.45, 0.0, d);      // bright centre
    // faint corpus → warm document → hot lit neighbour, by brightness.
    vec3 col = mix(uCorpus, uDoc, clamp(vGlow, 0.0, 1.0));
    col = mix(col, uHot, clamp(vGlow - 1.0, 0.0, 1.0) + core * 0.35 * clamp(vGlow, 0.0, 1.0));
    float a = mask * clamp(0.18 + vGlow * 0.85, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

// k-NN beams: thin terracotta lines from probe → lit neighbours. Alpha rides a
// per-vertex aFade so a beam glows hottest near the probe and tapers out.
const BEAM_VERT = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  void main() {
    vFade = aFade;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BEAM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  uniform float uAlpha;
  varying float vFade;
  void main() {
    vec3 col = mix(uColor, uHot, vFade * 0.6);
    gl_FragColor = vec4(col, uAlpha * (0.25 + 0.75 * vFade));
  }
`;

// The probe glow: a soft halo billboard that rides the cursor / auto-orbit.
const GLOW_VERT = /* glsl */ `
  uniform float uPixelRatio, uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (1.0 / max(0.1, -mv.z));
  }
`;
const GLOW_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor, uHot;
  uniform float uAlpha;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float d = length(uv);
    if (d > 1.0) discard;
    float halo = smoothstep(1.0, 0.0, d);
    float core = smoothstep(0.4, 0.0, d);
    vec3 col = mix(uColor, uHot, core);
    float a = (halo * 0.4 + core * 0.85) * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---- controller --------------------------------------------------------- */

export function mountRag3D(container: HTMLElement, lang: Lang): { tick(t: number): void; dispose(): void } {
  const stage = createStage(container, { fov: FOV });
  const { scene, camera, canvas, dpr, small } = stage;
  const pal = palette();
  const pointer = trackPointer(canvas, camera, 0); // probe rides the z=0 plane
  const clock = makeClock();
  const tanH = Math.tan((FOV * Math.PI) / 360);

  const P = small ? 1400 : 2600; // ambient corpus points
  const DOCS = small ? 22 : 30; // candidate "document" nodes

  /* --- build the point field: corpus + documents in one THREE.Points ------ */
  const N = P + DOCS;
  const positions = new Float32Array(N * 3);
  const homes = new Float32Array(N * 3);
  const seeds = new Float32Array(N);
  const bright = new Float32Array(N);
  const lit = new Float32Array(N);

  // a rough flattened disk/sphere — denser toward the centre (a galaxy core).
  function placeInDisk(i: number, rScale: number) {
    const u = Math.random();
    const r = Math.pow(u, 0.6) * R_DISK * rScale;
    const a = Math.random() * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.82; // slightly flattened in y
    const z = (Math.random() * 2 - 1) * R_THICK * (1 - 0.4 * (r / R_DISK));
    homes[i * 3] = x;
    homes[i * 3 + 1] = y;
    homes[i * 3 + 2] = z;
  }

  for (let i = 0; i < P; i++) {
    placeInDisk(i, 1);
    seeds[i] = Math.random();
    bright[i] = 0.24 + Math.random() * 0.16; // faint corpus (warm, just present)
    lit[i] = 0;
  }
  // Document nodes: scattered through the same space, brighter. Keep their
  // world positions so we can run k-NN against the probe each frame.
  const docIndex: number[] = [];
  const docPos: THREE.Vector3[] = [];
  for (let d = 0; d < DOCS; d++) {
    const i = P + d;
    placeInDisk(i, 0.92);
    seeds[i] = Math.random();
    bright[i] = 0.5; // a clear "document"
    lit[i] = 0;
    docIndex.push(i);
    docPos.push(new THREE.Vector3(homes[i * 3], homes[i * 3 + 1], homes[i * 3 + 2]));
  }
  // Re-home a few documents into named roles. docIndex/docPos[d] are the d-th
  // document; we override the buffer home + the world position used for k-NN.
  function placeDoc(d: number, v: THREE.Vector3, b: number) {
    const gi = P + d;
    homes[gi * 3] = v.x;
    homes[gi * 3 + 1] = v.y;
    homes[gi * 3 + 2] = v.z;
    docPos[d].copy(v);
    bright[gi] = b;
  }
  // docs 0,1 → the two cloud landing nodes (centre, slightly brighter).
  CLOUD.forEach((c, s) => placeDoc(s, c, 0.62));

  // docs 2..2+NAMED-1 → the labelled open-source "corpus" nodes, spread on a loose
  // ring so their file-name labels don't pile up (and away from the lower-left
  // card). The emphasised file (rag3d.ts) is parked prominently up top, brighter.
  const NAMED = Math.min(CORPUS_FILES.length, DOCS - 3);
  const namedDoc: number[] = []; // doc-array indices that carry a label
  for (let n = 0; n < NAMED; n++) {
    const d = 2 + n;
    const emph = !!CORPUS_FILES[n].emphasis;
    if (emph) {
      placeDoc(d, new THREE.Vector3(-0.34, 1.04, 0.12), 0.95); // top-centre, bright
    } else {
      const ang = 0.62 + (n / NAMED) * TAU * 0.92; // ~340° arc, gap at lower-left
      const rr = R_DISK * (0.8 + 0.16 * (((n * 7) % 5) / 4));
      const z = (((n * 13) % 7) / 6 - 0.5) * R_THICK;
      placeDoc(d, new THREE.Vector3(Math.cos(ang) * rr, Math.sin(ang) * rr * 0.82, z), 0.55);
    }
    namedDoc.push(d);
  }

  positions.set(homes); // start at rest; the shader does the form/converge motion

  const ptsGeo = new THREE.BufferGeometry();
  ptsGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  ptsGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  ptsGeo.setAttribute("aBright", new THREE.BufferAttribute(bright, 1));
  const litAttr = new THREE.BufferAttribute(lit, 1);
  litAttr.setUsage(THREE.DynamicDrawUsage);
  ptsGeo.setAttribute("aLit", litAttr);

  const hot = pal.accent.clone().lerp(new THREE.Color("#ffffff"), 0.3);
  const ptsU = {
    uPixelRatio: { value: dpr },
    uForm: { value: 0 },
    uTime: { value: 0 },
    uSizeBase: { value: small ? 9 : 12 },
    uSizeLit: { value: small ? 20 : 26 },
    uCorpus: { value: pal.fgFaint.clone().lerp(pal.accent, 0.4) },
    uDoc: { value: pal.accent.clone().lerp(pal.paper, 0.18) },
    uHot: { value: hot },
  };
  const ptsMat = new THREE.ShaderMaterial({
    uniforms: ptsU,
    vertexShader: PTS_VERT,
    fragmentShader: PTS_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(ptsGeo, ptsMat);
  points.frustumCulled = false;
  scene.add(points);

  /* --- k-NN beams (1 draw call; rewrite only the lit edges) --------------- */
  const beamPos = new Float32Array(MAX_LIT * 2 * 3); // 2 verts per beam
  const beamFade = new Float32Array(MAX_LIT * 2); // 1 (probe end) → 0 (node end)
  const beamGeo = new THREE.BufferGeometry();
  const beamPosAttr = new THREE.BufferAttribute(beamPos, 3);
  beamPosAttr.setUsage(THREE.DynamicDrawUsage);
  beamGeo.setAttribute("position", beamPosAttr);
  beamGeo.setAttribute("aFade", new THREE.BufferAttribute(beamFade, 1));
  for (let k = 0; k < MAX_LIT; k++) {
    beamFade[k * 2] = 1; // probe end (hot)
    beamFade[k * 2 + 1] = 0; // node end (cool)
  }
  beamGeo.setDrawRange(0, 0);
  const beamU = {
    uColor: { value: pal.accentInk.clone() },
    uHot: { value: hot },
    uAlpha: { value: 0 },
  };
  const beamMat = new THREE.ShaderMaterial({
    uniforms: beamU,
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });
  const beams = new THREE.LineSegments(beamGeo, beamMat);
  beams.frustumCulled = false;
  scene.add(beams);

  /* --- probe glow (1 tiny THREE.Points, 1 vert) --------------------------- */
  function makeGlow(size: number, color: THREE.Color): { mesh: THREE.Points; u: { uAlpha: { value: number } } } {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const u = {
      uPixelRatio: { value: dpr },
      uSize: { value: size },
      uColor: { value: color },
      uHot: { value: hot },
      uAlpha: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    });
    const mesh = new THREE.Points(g, m);
    mesh.frustumCulled = false;
    return { mesh, u };
  }
  const probe = makeGlow(small ? 34 : 44, pal.accent.clone());
  scene.add(probe.mesh);

  /* --- DOM/SVG overlay: corpus-file labels + the two skill links -----------
     The crisp type rides the DOM (matching the answer card), positioned each
     frame by projecting world points to screen. The two skills are drawn as
     curved SVG *edges*: before each skill is named its edge scans the labelled
     corpus nodes (dashed, faint); at its SKILL_AT beat the edge locks onto a
     node in the centre cloud and the link fades in to stay (one at a time).
     Opacities are pure functions of the playhead, so scrubbing rewinds them. */
  const SVGNS = "http://www.w3.org/2000/svg";
  const overlay = document.createElement("div");
  overlay.className = "rag-overlay";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "rag-edges");
  svg.innerHTML =
    '<defs><marker id="rag-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1 9 5 1 9z"/></marker></defs>';
  overlay.appendChild(svg);

  // Hovering any overlay link calms the cloud: tick reads hoveredLinks to fade the
  // probe + k-NN beams, so the "other extending edges from the point cloud" don't
  // crowd the link you're about to click. (Per-link pointer events flip off while
  // a link is invisible, so the counter stays balanced.)
  let hoveredLinks = 0;
  function addHoverSuppress(elm: HTMLElement) {
    elm.addEventListener("pointerenter", () => {
      hoveredLinks++;
    });
    elm.addEventListener("pointerleave", () => {
      hoveredLinks = Math.max(0, hoveredLinks - 1);
    });
  }

  // the labelled corpus nodes — each a real OPEN-SOURCE file, linked to GitHub.
  const labelEls = namedDoc.map((d, n) => {
    const f = CORPUS_FILES[n];
    const a = document.createElement("a");
    a.className = "rag-node-label" + (f.emphasis ? " rag-node-label--src" : "");
    a.href = f.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = f.href.replace("https://github.com/", "");
    a.innerHTML = f.emphasis
      ? `<span class="nl-name">${f.label}</span><span class="nl-tag">the code drawing this scene ↗</span>`
      : `<span class="nl-name">${f.label}</span>`;
    addHoverSuppress(a);
    overlay.appendChild(a);
    return { el: a, d, emphasis: !!f.emphasis };
  });
  const labelHi = new Float32Array(labelEls.length); // eased 0..1 scan highlight

  // skill link chips, anchored at a fixed screen spot clear of the answer card
  const tails = small
    ? [{ fx: 0.5, fy: 0.12 }, { fx: 0.5, fy: 0.225 }]
    : [{ fx: 0.8, fy: 0.3 }, { fx: 0.8, fy: 0.5 }];
  const ARROW =
    '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';
  const skillEls = SKILLS.map((sk, i) => {
    const link = document.createElement("a");
    link.className = "rag-skill";
    link.innerHTML = `<span class="rag-skill__name">${sk.name}</span>${sk.href ? ARROW : ""}`;
    if (sk.href) {
      link.href = sk.href;
      link.target = "_blank";
      link.rel = "noopener";
      link.title = sk.blurb[lang];
    }
    addHoverSuppress(link);
    overlay.appendChild(link);
    const edge = document.createElementNS(SVGNS, "path") as SVGPathElement;
    edge.setAttribute("class", "rag-edge");
    edge.setAttribute("marker-end", "url(#rag-arrow)");
    const dot = document.createElementNS(SVGNS, "circle") as SVGCircleElement;
    dot.setAttribute("class", "rag-edge-src");
    dot.setAttribute("r", "2.6");
    svg.append(edge, dot);
    const tail = tails[i] ?? tails[tails.length - 1];
    return {
      link,
      edge,
      dot,
      tailFx: tail.fx,
      tailFy: tail.fy,
      cloud: CLOUD[i] ?? CLOUD[CLOUD.length - 1],
      roam: (docPos[namedDoc[i] ?? 0] ?? CLOUD[0]).clone(), // damped edge head
      halfW: sk.name.length * 4.1 + 24, // ~ half chip width in px (mono type)
      halfH: 17,
      bow: i % 2 === 0 ? 1 : -1, // curve sign so the two edges separate
      scanIdx: -1, // which labelled node the edge currently scans (-1 = none)
    };
  });
  container.appendChild(overlay);

  // project a world point to container CSS pixels (camera is a fixed 3/4 pose).
  const projV = new THREE.Vector3();
  function toScreen(v: THREE.Vector3): { x: number; y: number; vis: boolean } {
    projV.copy(v).project(camera);
    return {
      x: (projV.x * 0.5 + 0.5) * stage.size.w,
      y: (-projV.y * 0.5 + 0.5) * stage.size.h,
      vis: projV.z < 1,
    };
  }

  const tmpHead = new THREE.Vector3();
  function updateOverlay(t: number, galaxy: number, clk: number, dt: number) {
    const w = stage.size.w;
    const h = stage.size.h;
    overlay.style.display = galaxy < 0.001 || w === 0 ? "none" : "block";
    if (galaxy < 0.001 || w === 0) return;

    // --- the two skill edges + links ---
    for (let i = 0; i < skillEls.length; i++) {
      const sk = skillEls[i];
      const lock = smooth(phase(t, SKILL_AT[i], SKILL_AT[i] + SKILL_LOCK)); // 0→1 reveal
      // the edge/dot fade in a few seconds before the skill is named, scan, lock.
      const present = smooth(phase(t, SKILL_AT[i] - 7, SKILL_AT[i] - 1.5));
      const scanning = present > 0.4 && lock < 0.5;

      // scan target cycles through the labelled nodes (idle, like the auto-orbit)
      let scanIdx = -1;
      if (labelEls.length) {
        scanIdx = Math.floor(clk * 0.4 + i * 1.7) % labelEls.length;
        if (scanIdx < 0) scanIdx += labelEls.length;
      }
      sk.scanIdx = scanning ? scanIdx : -1;
      const scanPos = scanIdx >= 0 ? docPos[labelEls[scanIdx].d] : sk.cloud;

      // head world: scan node (pre) → cloud node (post), damped for a smooth swing
      tmpHead.copy(scanPos).lerp(sk.cloud, lock);
      sk.roam.lerp(tmpHead, 1 - Math.exp(-(lock > 0.5 ? 11 : 5) * dt));

      const tx = sk.tailFx * w;
      const ty = sk.tailFy * h;
      const head = toScreen(sk.roam);
      const dx = head.x - tx;
      const dy = head.y - ty;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // start at the chip's edge along the head direction once locked; just off
      // the source dot while scanning.
      const rectGap = Math.min(sk.halfW / Math.max(1e-3, Math.abs(ux)), sk.halfH / Math.max(1e-3, Math.abs(uy)));
      const startGap = 9 + (rectGap + 5 - 9) * lock;
      const sx = tx + ux * startGap;
      const sy = ty + uy * startGap;
      const ex = head.x - ux * 9; // stop short so the arrowhead sits on the node
      const ey = head.y - uy * 9;
      const blen = Math.hypot(ex - sx, ey - sy) || 1;
      const bow = sk.bow * Math.min(blen * 0.12, 44);
      const cx = (sx + ex) / 2 + (-(ey - sy) / blen) * bow;
      const cy = (sy + ey) / 2 + ((ex - sx) / blen) * bow;
      sk.edge.setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
      sk.edge.style.opacity = String(galaxy * present * (0.34 + 0.66 * lock) * (head.vis ? 1 : 0));
      if (lock < 0.5) sk.edge.setAttribute("stroke-dasharray", "3 7");
      else sk.edge.removeAttribute("stroke-dasharray");

      sk.dot.setAttribute("cx", tx.toFixed(1));
      sk.dot.setAttribute("cy", ty.toFixed(1));
      sk.dot.style.opacity = String(galaxy * present * (1 - lock) * 0.8);

      sk.link.style.left = `${tx.toFixed(1)}px`;
      sk.link.style.top = `${ty.toFixed(1)}px`;
      sk.link.style.transform = `translate(-50%, -50%) translateY(${((1 - lock) * 9).toFixed(1)}px)`;
      sk.link.style.opacity = String(lock);
      sk.link.style.pointerEvents = lock > 0.6 ? "auto" : "none";
    }

    // --- corpus-file labels: steady, readable LINKS (they never fade out — the
    // cloud no longer converges), lifted a touch while a skill scans them; the
    // emphasised rag3d.ts sits brightest. pointer-events off while ~invisible. ---
    for (let n = 0; n < labelEls.length; n++) {
      const { el, d, emphasis } = labelEls[n];
      const s = toScreen(docPos[d]);
      let hot = 0;
      for (const sk of skillEls) if (sk.scanIdx === n) hot = 1;
      labelHi[n] = damp(labelHi[n], hot, hot > labelHi[n] ? 9 : 4, dt);
      const b = emphasis ? 0.95 : 0.52;
      const op = s.vis ? galaxy * (b + (1 - b) * labelHi[n]) : 0;
      // grow each label toward the side with room so long file names don't clip
      // off the edge (nodes in the right zone flip their text to the left).
      const flip = s.x > w * 0.6;
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(${flip ? "-100%" : "0"}, -50%) translate(${flip ? -11 : 11}px, 0)`;
      el.style.textAlign = flip ? "right" : "left";
      el.style.opacity = String(op);
      el.style.pointerEvents = op > 0.05 ? "auto" : "none";
    }
  }

  /* --- camera framing (fixed 3/4 pose; fits tall mobile + wide desktop) --- */
  function frame(w: number, h: number) {
    const aspect = w / h || 1;
    const halfH = R_DISK * 1.18; // content half-extents
    const halfW = R_DISK * 1.18;
    const zH = halfH / tanH;
    const zW = halfW / (tanH * aspect);
    const camDist = Math.max(zH, zW) * 1.2 + R_THICK;
    const ce = Math.cos(BASE_EL);
    camera.position.set(Math.sin(BASE_AZ) * ce * camDist, Math.sin(BASE_EL) * camDist, Math.cos(BASE_AZ) * ce * camDist);
    camera.lookAt(0, 0, 0);
  }
  stage.onResize(frame);

  /* --- per-frame retrieval state ------------------------------------------ */
  const probeWorld = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  // (distance, docArrayIndex) pairs, reused each frame to avoid allocations.
  const dist = new Float32Array(DOCS);
  const order: number[] = [];
  for (let d = 0; d < DOCS; d++) order.push(d);
  const litTarget = new Float32Array(N); // desired aLit, eased toward each frame

  let beamSuppress = 0; // eased 0..1 — 1 while a link is hovered (calms the cloud)
  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    const { dt, t: clk } = clock();
    pointer.update(dt, 7);

    // --- narrative phases (pure functions of the playhead) ---
    const form = phase(t, T_FORM_A, T_FORM_B);
    ptsU.uForm.value = form;
    ptsU.uTime.value = clk;

    // hovering any overlay link fades the probe + beams so they don't crowd it.
    beamSuppress = damp(beamSuppress, hoveredLinks > 0 ? 1 : 0, 12, dt);

    // --- probe position: mouse on z=0, else a slow auto-orbit (always live) ---
    const orbitR = R_DISK * 0.62;
    const oa = clk * 0.32;
    const auto = tmp.set(Math.cos(oa) * orbitR, Math.sin(oa * 0.9) * orbitR * 0.7, Math.sin(oa * 1.3) * R_THICK * 0.6);
    const hover = pointer.hover;
    // blend cursor (when present, already damped by trackPointer) with the idle
    // orbit; the probe stays steerable for the whole scene — no converge hijack.
    probeWorld.set(
      hover * pointer.world.x + (1 - hover) * auto.x,
      hover * pointer.world.y + (1 - hover) * auto.y,
      (1 - hover) * auto.z,
    );
    probe.mesh.position.copy(probeWorld);
    probe.u.uAlpha.value = form * (1 - 0.85 * beamSuppress);

    // --- k-NN: find the nearest documents to the probe ---
    for (let d = 0; d < DOCS; d++) dist[d] = probeWorld.distanceToSquared(docPos[d]);
    order.sort((a, b) => dist[a] - dist[b]);

    // reset lit targets, then light the k nearest neighbours (pure k-NN, always).
    litTarget.fill(0);
    const beamReach = clamp01(form);
    let lt = 0;
    for (let k = 0; k < K_NN; k++) {
      const dArr = order[k];
      const gi = docIndex[dArr];
      const w = 1 - k / K_NN; // nearest = brightest
      const strength = (0.5 + 0.5 * w) * beamReach;
      if (strength > litTarget[gi]) litTarget[gi] = strength;

      // write this beam segment (probe → node)
      const node = docPos[dArr];
      beamPos[lt * 6 + 0] = probeWorld.x;
      beamPos[lt * 6 + 1] = probeWorld.y;
      beamPos[lt * 6 + 2] = probeWorld.z;
      beamPos[lt * 6 + 3] = node.x;
      beamPos[lt * 6 + 4] = node.y;
      beamPos[lt * 6 + 5] = node.z;
      lt++;
    }
    beamPosAttr.needsUpdate = true;
    beamGeo.setDrawRange(0, lt * 2);
    // beams glow once the galaxy has formed; a solid base keeps retrieval legible
    // during the idle auto-orbit, hover lifts it, link-hover fades it right out.
    beamU.uAlpha.value = form * 0.7 * (0.72 + 0.28 * smooth(hover)) * (1 - beamSuppress);

    // the two centre "cloud" nodes (docs 0,1) brighten as their skill edge locks on
    for (let i = 0; i < SKILL_AT.length && i < CLOUD.length; i++) {
      const lock = smooth(phase(t, SKILL_AT[i], SKILL_AT[i] + SKILL_LOCK)) * 0.95;
      const gi = docIndex[i];
      if (lock > litTarget[gi]) litTarget[gi] = lock;
    }

    // ease the per-point highlight toward target (snappy on, soft off)
    let dirty = false;
    for (let i = P; i < N; i++) {
      const cur = lit[i];
      const tgt = litTarget[i];
      const next = damp(cur, tgt, tgt > cur ? 14 : 6, dt);
      if (Math.abs(next - cur) > 0.001) {
        lit[i] = next;
        dirty = true;
      }
    }
    if (dirty) litAttr.needsUpdate = true;

    // --- DOM overlay: corpus-file links + the two skill edges/links ---
    updateOverlay(t, clamp01(form), clk, dt);

    stage.render();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    pointer.dispose();
    overlay.remove();
    stage.dispose(() => {
      ptsGeo.dispose();
      ptsMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
      probe.mesh.geometry.dispose();
      (probe.mesh.material as THREE.Material).dispose();
    });
  }

  return { tick, dispose };
}
