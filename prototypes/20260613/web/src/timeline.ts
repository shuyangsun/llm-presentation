/* ============================================================================
   timeline.ts — the presentation, generated from the transcript.

   The talking-head video IS the prompt. Every beat below is anchored to a real
   timestamp in docs/subtitles/presentation_test.vtt, and the director
   (main.ts) drives the interface from the video's playback position. Scrubbing
   the video scrubs the deck; the two are the same timeline.
   ============================================================================ */

export type StageKey = "full" | "narrow" | "dock";

export interface Scene {
  /** start time in seconds, taken from the transcript */
  t: number;
  /** short HUD chapter label */
  chapter: string;
  /** video stage layout for this beat */
  stage: StageKey;
  /** left-hand generated content panel (null = video-only beat) */
  panel?: () => HTMLElement;
  /** fullscreen overlay (used for the cold-open title and the outro bookend) */
  overlay?: () => HTMLElement;
}

/* --- tiny hyperscript helper --------------------------------------------- */
type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

/** Split text into word spans so the director can stagger-reveal them. */
function words(text: string, cls = "") {
  const frag = document.createDocumentFragment();
  text.split(" ").forEach((w, i) => {
    if (i) frag.append(document.createTextNode(" "));
    const span = h("span", { class: `word ${cls}`.trim(), "data-reveal": "" });
    span.innerHTML = w;
    frag.append(span);
  });
  return frag;
}

function kicker(text: string, tone: "mint" | "coral" = "mint") {
  return h("div", { class: `kicker ${tone === "coral" ? "coral" : ""}`.trim(), "data-reveal": "" }, text);
}

/* --- reusable visuals ----------------------------------------------------- */

const FULL_CIRCLE = "M100,18 a42,42 0 1,1 -0.1,0";

function closedLoopCard() {
  const card = h("div", { class: "loop-card closed", "data-reveal": "" });
  card.innerHTML = `
    <div class="lc-label">Closed loop</div>
    <div class="lc-title">Self-iterating</div>
    <svg class="loop-svg" viewBox="0 0 200 120" aria-hidden="true">
      <circle class="track" cx="100" cy="60" r="42" stroke="var(--mint)"></circle>
      <circle r="6" fill="var(--mint)" class="runner" style="color:var(--mint)">
        <animateMotion dur="2.6s" repeatCount="indefinite" path="${FULL_CIRCLE}"></animateMotion>
      </circle>
    </svg>
    <div class="lc-note">Diagnoses, retries, repairs and improves on its own — cheap, parallel, repeatable.</div>`;
  return card;
}

function openLoopCard() {
  const card = h("div", { class: "loop-card open", "data-reveal": "" });
  // arc with a gap at the top where the human must step in; the runner dwells there.
  card.innerHTML = `
    <div class="lc-label">Open loop</div>
    <div class="lc-title">Human-gated</div>
    <svg class="loop-svg" viewBox="0 0 200 120" aria-hidden="true">
      <path class="track" d="M108,19 a42,42 0 1,1 -16,0" stroke="var(--coral)"></path>
      <circle cx="100" cy="18" r="9" fill="none" stroke="var(--coral)" stroke-width="2.5"></circle>
      <circle cx="100" cy="18" r="3" fill="var(--coral)"></circle>
      <circle r="6" fill="var(--coral)" class="runner" style="color:var(--coral)">
        <animateMotion dur="4.6s" repeatCount="indefinite" calcMode="linear"
          keyPoints="0;0.46;0.54;1" keyTimes="0;0.30;0.78;1" path="${FULL_CIRCLE}"></animateMotion>
      </circle>
    </svg>
    <div class="lc-note">Stalls at the human checkpoint. Expensive: people are slower, scarcer, less available.</div>`;
  return card;
}

function skillLoop() {
  const wrap = h("div", { class: "skill-loop" });
  const nodes = h("div", { class: "skill-nodes", "data-reveal": "" });
  for (const [pre, name] of [
    ["skill", "vcs"],
    ["skill", "retrieving-context"],
    ["skill", "updating-docs"],
  ]) {
    nodes.append(h("div", { class: "chip" }, h("span", { class: "pre" }, pre + " ·"), name));
  }
  const flow = h("div", { class: "flowline", "data-reveal": "" });
  flow.innerHTML = `
    <span class="step">Claude rewrites the skill</span>
    <span class="arrow">→</span>
    <span class="step">run it</span>
    <span class="arrow">→</span>
    <span class="step metric">metric ↑</span>
    <span class="loopback">↻ repeat — no human inside</span>`;
  wrap.append(nodes, flow);
  return wrap;
}

/* --- panels --------------------------------------------------------------- */

function titlePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h1", { class: "display t-hero" });
  hero.append(words("Open"), document.createTextNode(" "));
  const amp = h("em", {}, "&"); amp.classList.add("word"); amp.setAttribute("data-reveal", "");
  hero.append(amp, document.createTextNode(" "));
  hero.append(words("Closed"), h("br"), words("Loops"));
  p.append(
    kicker("Open ⟲ Closed"),
    hero,
    h("p", { class: "lead", "data-reveal": "" },
      ((): Node => { const s = h("span", {}); s.innerHTML = "The economics of the <strong>LLMOS</strong> — large-language-model operating systems for work."; return s; })(),
    ),
  );
  return p;
}

function timelinePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-lg" });
  hero.append(words("One timeline."), h("br"));
  const two = words("Two things move.");
  hero.append(two);
  const lead = h("p", { class: "lead", "data-reveal": "" });
  lead.innerHTML = "The scrubber drives the <span class='mint'>video</span> and the <span class='mint'>deck</span> at once. Move it and the talk and the interface travel together — one position, one truth.";
  p.append(kicker("Playback = Progress"), hero, lead);
  return p;
}

function interactivePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-lg" });
  hero.append(words("An interactive site —"), h("br"));
  const not = h("em", {}, "not"); not.classList.add("word"); not.setAttribute("data-reveal", "");
  hero.append(not, document.createTextNode(" "), words("a video."));
  const lead = h("p", { class: "lead", "data-reveal": "" });
  lead.innerHTML = "A recording would just play at you. Here you can <strong>pause anytime</strong> and explore the deck yourself. Go on — press <kbd>space</kbd>.";
  p.append(kicker("Not a recording", "coral"), hero, lead);
  return p;
}

function agendaPanel() {
  const p = h("div", { class: "panel" });
  const list = h("ul", { class: "agenda" });
  const items: Array<[string, string, number | null]> = [
    ["01", "What is open vs closed loop?", 96.2],
    ["02", "Comparative advantage", null],
    ["03", "Context is the real asset", null],
    ["04", "Cheap parallel agents", null],
  ];
  for (const [n, title, seek] of items) {
    const li = h("li", { "data-reveal": "" }, h("span", { class: "n" }, n), h("span", { class: "t" }, title));
    if (n === "01") li.classList.add("active");
    if (seek !== null) li.dataset.seek = String(seek);
    else li.append(h("span", { class: "n", style: "grid-column:2;color:var(--bone-dim);font-size:11px;letter-spacing:.14em" }, "— in the full talk"));
    list.append(li);
  }
  p.append(kicker("The plan"), h("h2", { class: "display t-lg", "data-reveal": "" }, "Topics"), list);
  return p;
}

function topicTitlePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-hero" });
  hero.append(words("What is"), h("br"), words("a loop?"));
  p.append(kicker("Topic 01"), hero);
  return p;
}

function definitionPanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-lg" });
  hero.append(words("Put a human"), document.createTextNode(" "));
  const inn = h("em", {}, "in"); inn.classList.add("word"); inn.setAttribute("data-reveal", "");
  hero.append(inn, document.createTextNode(" "), words("the loop"), h("br"), words("→ it slows down."));
  const loops = h("div", { class: "loops" }, closedLoopCard(), openLoopCard());
  p.append(kicker("Definitions"), hero, loops);
  return p;
}

function examplePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-lg" });
  hero.append(words("Skills that"), h("br"), words("improve themselves."));
  const lead = h("p", { class: "lead", "data-reveal": "" });
  lead.innerHTML = "In my coding-agent repo I prompt Claude to <strong>rewrite my skills</strong> against a metric, then loop. The inner cycle has no human in it — that is a closed loop, live.";
  p.append(kicker("Closed loop, live"), hero, skillLoop(), lead);
  return p;
}

function pausePanel() {
  const p = h("div", { class: "panel" });
  const hero = h("h2", { class: "display t-lg", "data-reveal": "" }, "Pause here.");
  const lead = h("p", { class: "lead", "data-reveal": "" });
  lead.innerHTML = "Hit <kbd>space</kbd> and poke around. Scrub back, open a loop, re-read a beat. The deck is yours to drive.";
  p.append(kicker("Your turn"), hero, lead);
  return p;
}

function metaPanel() {
  const p = h("div", { class: "panel" });
  const card = h("div", { class: "meta-card", "data-reveal": "" });
  card.innerHTML = `<span class="tag">$ ./build-presentation</span><br/>
    &gt; the video is the prompt<br/>
    &gt; the interface is generated from its transcript<br/>
    &gt; every element aligned to a timestamp<br/>
    &gt; <span class="tag">closed loop:</span> say the intent, let the agent execute`;
  p.append(
    kicker("Meta"),
    h("h2", { class: "display t-lg", "data-reveal": "" }, "This is the test."),
    card,
  );
  return p;
}

/* --- overlays ------------------------------------------------------------- */

function coldOpenOverlay() {
  const o = h("div", { class: "fs-overlay" });
  o.append(h("div", { class: "scrim" }));
  const wrap = h("div", {});
  wrap.append(
    kicker("A live presentation"),
    (() => {
      const t = h("div", { class: "display t-xl", "data-reveal": "" });
      t.innerHTML = "The economics of the <em>LLMOS</em>";
      return t;
    })(),
  );
  o.append(wrap);
  return o;
}

function outroOverlay() {
  const o = h("div", { class: "fs-overlay" });
  o.append(h("div", { class: "scrim" }));
  const wrap = h("div", {});
  const t = h("div", { class: "display t-hero" });
  t.append(words("Thank you."));
  wrap.append(
    kicker("Fin"),
    t,
    (() => {
      const c = h("p", { class: "lead", "data-reveal": "" });
      c.innerHTML = "for attending my talk. <br/><span style='opacity:.6'>Open &amp; Closed Loops — generated from a talking-head transcript.</span>";
      return c;
    })(),
  );
  o.append(wrap);
  return o;
}

/* --- the timeline (anchored to transcript timestamps) -------------------- */

export const SCENES: Scene[] = [
  { t: 0.0, chapter: "00 · Cold open", stage: "full" },
  { t: 16.0, chapter: "00 · Cold open", stage: "full", overlay: coldOpenOverlay },
  { t: 26.9, chapter: "Reframing", stage: "narrow" },
  { t: 34.3, chapter: "Reframing", stage: "dock" },
  { t: 42.5, chapter: "Title", stage: "dock", panel: titlePanel },
  { t: 59.4, chapter: "Timeline", stage: "dock", panel: timelinePanel },
  { t: 68.0, chapter: "Interactive", stage: "dock", panel: interactivePanel },
  { t: 83.8, chapter: "Agenda", stage: "dock", panel: agendaPanel },
  { t: 96.2, chapter: "01 · Loops", stage: "dock", panel: topicTitlePanel },
  { t: 102.4, chapter: "01 · Loops", stage: "dock", panel: definitionPanel },
  { t: 113.5, chapter: "Example", stage: "dock", panel: examplePanel },
  { t: 147.3, chapter: "Your turn", stage: "dock", panel: pausePanel },
  { t: 151.6, chapter: "Meta", stage: "dock", panel: metaPanel },
  { t: 158.2, chapter: "Fin", stage: "full", overlay: outroOverlay },
];

/** Chapters for the scrubber tick marks (deduped, human labels). */
export const CHAPTERS = [
  { t: 0.0, label: "Cold open" },
  { t: 26.9, label: "Reframe" },
  { t: 42.5, label: "Title" },
  { t: 59.4, label: "Timeline" },
  { t: 68.0, label: "Interactive" },
  { t: 83.8, label: "Agenda" },
  { t: 96.2, label: "01 · Loops" },
  { t: 113.5, label: "Example" },
  { t: 151.6, label: "Meta" },
  { t: 158.2, label: "Fin" },
];
