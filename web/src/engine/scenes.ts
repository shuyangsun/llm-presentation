/* ============================================================================
   scenes.ts — the illustrative visuals.

   The video carries the words; this stage carries a *fun, supporting visual*
   for whatever is being said right now, swapped on the transcript's beats. Each
   scene is mostly geometry + motion (CSS-driven idle animation, GSAP entrance),
   with at most a few words of label — never a wall of text.
   ============================================================================ */

import { STRINGS, SKILLS, type Lang } from "../data/timeline";

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function pick(lang: Lang, en: string, zh: string): string {
  return lang === "zh" ? zh : en;
}

function reveal(node: HTMLElement): HTMLElement {
  node.setAttribute("data-reveal", "");
  return node;
}

function cap(lang: Lang, en: string, zh: string): HTMLElement {
  return reveal(el("div", "scene-cap", pick(lang, en, zh)));
}

export interface SceneDef {
  t: number;
  key: string;
  build(lang: Lang): HTMLElement;
}

/* ---- individual scenes -------------------------------------------------- */

function asrScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--asr");
  let bars = "";
  for (let i = 0; i < 22; i++) bars += `<span style="--i:${i}"></span>`;
  root.append(reveal(el("div", "asr-wave", bars)));
  root.append(reveal(el("div", "asr-arrow", "↓")));
  const lines = el("div", "asr-lines");
  lines.append(el("span", "ln w1"), el("span", "ln w2"), el("span", "ln w3"));
  root.append(reveal(lines));
  root.append(cap(lang, "audio → transcript", "语音 → 字幕"));
  return root;
}

function translateScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--translate");
  const row = el("div", "tr-row");
  row.append(el("span", "tr-tag from", "EN"), el("span", "tr-mid", "→"), el("span", "tr-tag to", "中文"));
  root.append(reveal(row));
  const stack = el("div", "tr-stack");
  for (let i = 0; i < 3; i++) {
    const r = el("div", "tr-line", `<span class="lat"></span><span class="cjk">${"汉字字符词".slice(0, 3 + i)}</span>`);
    stack.append(r);
  }
  root.append(reveal(stack));
  root.append(cap(lang, "translated live", "实时翻译"));
  return root;
}

function syncScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--sync");
  const tracks = el("div", "sync-tracks");
  for (const label of [pick(lang, "VIDEO", "视频"), pick(lang, "SITE", "网站")]) {
    const tr = el("div", "sync-track");
    tr.append(el("span", "st-label", label));
    const rail = el("span", "st-rail");
    for (let i = 0; i < 4; i++) rail.append(el("i", "st-dot"));
    tr.append(rail);
    tracks.append(tr);
  }
  tracks.append(el("div", "sync-head"));
  root.append(reveal(tracks));
  root.append(cap(lang, "one timeline", "同一条时间线"));
  return root;
}

function responsiveScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--responsive");
  const row = el("div", "dev-row");
  const desk = el("div", "dev dev--desktop");
  desk.append(el("div", "dv side"), el("div", "dc"));
  const phone = el("div", "dev dev--phone");
  phone.append(el("div", "dv top"), el("div", "dc"));
  row.append(reveal(desk), reveal(phone));
  root.append(row);
  root.append(cap(lang, "desktop · mobile", "桌面 · 手机"));
  return root;
}

function directorScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--director");
  const clap = el("div", "clap");
  const stripes = '<span></span><span></span><span></span><span></span><span></span>';
  clap.append(el("div", "clap-top", stripes), el("div", "clap-body", `<em>${pick(lang, "Take 01", "第 01 镜")}</em>`));
  root.append(reveal(clap));
  root.append(cap(lang, "tell a story", "讲个故事"));
  return root;
}

function ragScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--rag");
  const orbit = el("div", "rag-orbit");
  for (let i = 0; i < 5; i++) orbit.append(el("i", `doc d${i}`));
  orbit.append(el("div", "rag-core", "RAG"));
  root.append(reveal(orbit));

  const answer = el("div", "rag-answer interactive");
  answer.append(reveal(el("div", "ctx-kicker", STRINGS.contextKicker[lang])));
  const model = el("div", "model");
  model.append(
    el("span", "q", STRINGS.contextLead[lang]),
    el("span", "a", STRINGS.modelName[lang]),
    el("span", "note", STRINGS.modelNote[lang]),
  );
  answer.append(reveal(model));
  const skills = el("div", "skills");
  for (const sk of SKILLS) {
    const arrow =
      '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';
    if (sk.href) {
      const a = el("a", "skill", `<span>${sk.name}</span>${arrow}`);
      a.setAttribute("href", sk.href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
      a.setAttribute("title", sk.blurb[lang]);
      skills.append(a);
    } else {
      skills.append(el("span", "skill", `<span>${sk.name}</span>`));
    }
  }
  answer.append(reveal(skills));
  root.append(answer);
  return root;
}

const RING_FULL =
  '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="27" fill="none" stroke="currentColor" stroke-width="3"/></svg>';
// a ring with a gap — the loop is broken, waiting for a human to close it
const RING_GAP =
  '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="27" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="118 52" transform="rotate(-58 40 40)"/></svg>';

function loopScene(lang: Lang): HTMLElement {
  const root = el("div", "scene scene--loop");
  const loops = el("div", "loops");

  // closed loop: a dot travels the ring forever — a self-improving process
  const closed = el("div", "loopcard closed");
  const cg = el("div", "loopglyph", RING_FULL);
  const orbit = el("div", "orbit");
  orbit.append(el("span", "orbit-dot"));
  cg.append(orbit);
  closed.append(cg, el("span", "lc-label", pick(lang, "closed · iterating", "闭环 · 迭代中")));

  // open loop: no rotation, a slow breathing glow — stuck, waiting for a human
  const open = el("div", "loopcard open");
  open.append(el("div", "loopglyph breathe", RING_GAP), el("span", "lc-label", pick(lang, "open · awaiting you", "开环 · 等你回来")));

  loops.append(reveal(closed), reveal(open));
  root.append(loops);
  root.append(cap(lang, "open where you add value", "在你创造价值之处开环"));
  return root;
}

/* ---- schedule ----------------------------------------------------------- */

export const SCENES: SceneDef[] = [
  { t: 134, key: "asr", build: asrScene },
  { t: 165.5, key: "translate", build: translateScene },
  { t: 186, key: "sync", build: syncScene },
  { t: 222, key: "responsive", build: responsiveScene },
  { t: 263, key: "director", build: directorScene },
  { t: 298, key: "rag", build: ragScene },
  { t: 335, key: "loop", build: loopScene },
];

/** Index of the active scene at time t (-1 before the first scene). */
export function activeSceneIndex(t: number): number {
  let idx = -1;
  for (let i = 0; i < SCENES.length; i++) {
    if (t >= SCENES[i].t) idx = i;
    else break;
  }
  return idx;
}
