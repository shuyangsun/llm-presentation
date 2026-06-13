/* ============================================================================
   scenes.ts — the illustrative visuals.

   The video carries the words; this stage carries a *fun, supporting visual*
   for whatever is being said right now, swapped on the transcript's beats. Each
   scene is mostly geometry + motion (CSS-driven idle animation, GSAP entrance),
   with at most a few words of label — never a wall of text.

   A scene does NOT appear all at once: each [data-reveal] part carries an
   optional `data-at` timestamp (seconds into the video) and the director loop
   in main.ts fades it in only once the presenter has *said* the matching words
   — and fades it back out when you scrub before that moment. Parts without a
   `data-at` reveal at the scene's own base time (see SCENES below).
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

/** Mark a node as a reveal target. `at` (seconds) pins it to a word; omit it to
 *  reveal at the scene's base time. */
function reveal(node: HTMLElement, at?: number): HTMLElement {
  node.setAttribute("data-reveal", "");
  if (at != null) node.dataset.at = String(at);
  return node;
}

function cap(lang: Lang, en: string, zh: string, at?: number): HTMLElement {
  return reveal(el("div", "scene-cap", pick(lang, en, zh)), at);
}

export interface SceneDef {
  t: number;
  key: string;
  build(lang: Lang): HTMLElement;
}

/* ---- individual scenes -------------------------------------------------- */

function asrScene(lang: Lang): HTMLElement {
  // "show this teleprompter ... the .VTT file that's transcribed from this
  // video" — audio becomes a transcript, drawn from the top down.
  const root = el("div", "scene scene--asr");
  let bars = "";
  for (let i = 0; i < 22; i++) bars += `<span style="--i:${i}"></span>`;
  root.append(reveal(el("div", "asr-wave", bars))); // base 142 ".VTT file"
  root.append(reveal(el("div", "asr-arrow", "↓"), 143));
  const lines = el("div", "asr-lines");
  lines.append(el("span", "ln w1"), el("span", "ln w2"), el("span", "ln w3"));
  root.append(reveal(lines, 144));
  root.append(cap(lang, "audio → transcript", "语音 → 字幕", 145.5));
  return root;
}

function translateScene(lang: Lang): HTMLElement {
  // "My native tongue is Mandarin Chinese, so translate it" — EN flips to 中文.
  const root = el("div", "scene scene--translate");
  const row = el("div", "tr-row");
  row.append(el("span", "tr-tag from", "EN"), el("span", "tr-mid", "→"), el("span", "tr-tag to", "中文"));
  root.append(reveal(row)); // base 165.5
  const stack = el("div", "tr-stack");
  for (let i = 0; i < 3; i++) {
    const r = el("div", "tr-line", `<span class="lat"></span><span class="cjk">${"汉字字符词".slice(0, 3 + i)}</span>`);
    stack.append(r);
  }
  root.append(reveal(stack, 167));
  root.append(cap(lang, "translated live", "实时翻译", 169));
  return root;
}

function syncScene(lang: Lang): HTMLElement {
  // "there's the video element ... then there's this interactive website" — two
  // tracks; the shared playhead arrives on "scrub", the caption on "in sync".
  const root = el("div", "scene scene--sync");
  const tracks = el("div", "sync-tracks");
  for (const label of [pick(lang, "VIDEO", "视频"), pick(lang, "SITE", "网站")]) {
    const tr = el("div", "sync-track");
    tr.append(el("span", "st-label", label));
    const rail = el("span", "st-rail");
    for (let i = 0; i < 4; i++) rail.append(el("i", "st-dot"));
    tr.append(rail);
    tracks.append(reveal(tr)); // base 186.6 — VIDEO + SITE
  }
  tracks.append(reveal(el("div", "sync-head"), 195.5)); // "When the users scrub on the progress bar"
  root.append(tracks);
  root.append(cap(lang, "one timeline", "同一条时间线", 202.75)); // "They should always be in sync"
  return root;
}

function responsiveScene(lang: Lang): HTMLElement {
  // "if you're on mobile ... a vertical layout" then "make it horizontal and
  // put it on the top" — the phone leads, the desktop joins on the transition.
  const root = el("div", "scene scene--responsive");
  const row = el("div", "dev-row");
  const phone = el("div", "dev dev--phone");
  phone.append(el("div", "dv top"), el("div", "dc"));
  const desk = el("div", "dev dev--desktop");
  desk.append(el("div", "dv side"), el("div", "dc"));
  row.append(reveal(phone), reveal(desk, 234.6)); // phone base 222.7; desktop on "instead of putting it to the side"
  root.append(row);
  root.append(cap(lang, "mobile · desktop", "手机 · 桌面", 240));
  return root;
}

function directorScene(lang: Lang): HTMLElement {
  // "Think of yourself as a Hollywood director trying to tell a story."
  const root = el("div", "scene scene--director");
  const clap = el("div", "clap");
  const stripes = '<span></span><span></span><span></span><span></span><span></span>';
  clap.append(el("div", "clap-top", stripes), el("div", "clap-body", `<em>${pick(lang, "Take 01", "第 01 镜")}</em>`));
  root.append(reveal(clap)); // base 263
  root.append(cap(lang, "tell a story", "讲个故事", 266.8));
  return root;
}

// The two skills are *named in order* in the recording, so they pop in one at a
// time, and the model name only resolves when he says "show that on the screen".
const SKILL_AT = [313.25, 316.0]; // "retrieving context skill" · "and the export transcript skill"

function ragScene(lang: Lang): HTMLElement {
  // "I don't know what model I will be using to transcribe this video yet" —
  // pose the question, surface the tools he names, then reveal the answer.
  const root = el("div", "scene scene--rag");
  const orbit = el("div", "rag-orbit");
  for (let i = 0; i < 5; i++) orbit.append(el("i", `doc d${i}`));
  orbit.append(el("div", "rag-core", "RAG"));
  root.append(reveal(orbit)); // base 298.5

  const answer = el("div", "rag-answer interactive");
  answer.append(reveal(el("div", "ctx-kicker", STRINGS.contextKicker[lang]), 300));
  const model = el("div", "model");
  model.append(
    reveal(el("span", "q", STRINGS.contextLead[lang]), 300), // "Who transcribed this?"
    reveal(el("span", "a", STRINGS.modelName[lang]), 329.65), // "...show that on the screen"
    reveal(el("span", "note", STRINGS.modelNote[lang]), 329.65),
  );
  answer.append(model);
  const skills = el("div", "skills");
  SKILLS.forEach((sk, i) => {
    const arrow =
      '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>';
    const at = SKILL_AT[i] ?? 316.0;
    if (sk.href) {
      const a = el("a", "skill", `<span>${sk.name}</span>${arrow}`);
      a.setAttribute("href", sk.href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
      a.setAttribute("title", sk.blurb[lang]);
      skills.append(reveal(a, at));
    } else {
      skills.append(reveal(el("span", "skill", `<span>${sk.name}</span>`), at));
    }
  });
  answer.append(skills);
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

  // closed = "what you just witnessed" (the agent iterating); open reveals on
  // "I'm going to open the loop now" — the moment he hands the work back to you.
  loops.append(reveal(closed), reveal(open, 349.95));
  root.append(loops);
  root.append(cap(lang, "open where you add value", "在你创造价值之处开环", 352));
  return root;
}

/* ---- schedule ----------------------------------------------------------- */

/** Each scene's base time = when its first part should appear (parts with their
 *  own `data-at` reveal later). Pinned to the words in en.vtt. */
export const SCENES: SceneDef[] = [
  { t: 142.75, key: "asr", build: asrScene }, // 02:22.72 "the .VTT file that's transcribed"
  { t: 165.5, key: "translate", build: translateScene }, // 02:45.47 "translate it"
  { t: 186.7, key: "sync", build: syncScene }, // 03:06.63 "there's the video element ... interactive website"
  { t: 222.7, key: "responsive", build: responsiveScene }, // 03:42.63 "if you're on mobile"
  { t: 263.1, key: "director", build: directorScene }, // 04:23.08 "a Hollywood director"
  { t: 298.5, key: "rag", build: ragScene }, // 04:58.46 "what model I will be using to transcribe"
  { t: 343.4, key: "loop", build: loopScene }, // 05:43.33 "the open and close loop"
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
