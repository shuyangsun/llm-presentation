/* ============================================================================
   main.ts — the director.

   The talking-head video is the prompt. Its playback position drives the whole
   interface: the two-step reveal, the teleprompter, the auto-translation, the
   illustrative scenes, the on-demand controls. Scrubbing the bar scrubs the
   video AND the site — they are one timeline. Nothing appears before the
   presenter asks for it.
   ============================================================================ */

import "./style.css";
import { gsap } from "gsap";
import { parseVtt, activeCueIndex, type Cue } from "./engine/vtt";
import { SCENES, activeSceneIndex, type SceneNode } from "./engine/scenes";
import { attachAudioAnalyser, resumeAudio } from "./engine/audio";
import { BEATS, CROP_DURATION, CHAPTERS, STRINGS, type Lang } from "./data/timeline";
import enVtt from "./data/en.vtt?raw";
import zhVtt from "./data/zh.vtt?raw";

/* --- transcript ---------------------------------------------------------- */
const CUES: Record<Lang, Cue[]> = { en: parseVtt(enVtt), zh: parseVtt(zhVtt) };
let lang: Lang = "en";
let manualLang: Lang | null = null; // set once the viewer picks a language
const REDUCE_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const VIDEO_SRC = "https://cdn.shuyangsun.com/videos/001_intro.v2.webm";
const VIDEO_POSTER = "https://cdn.shuyangsun.com/videos/001_intro.poster.v1.jpg";
// Progress-bar section thumbnails (generated art, one per chapter) — CDN-hosted
// like the video/poster; sources + render script live in web/scripts/thumbs/.
const THUMB_BASE = "https://cdn.shuyangsun.com/images/thumbs";
const LIVE_AUDIO_ANALYSER_ENABLED = false;

/* --- tiny DOM helper ----------------------------------------------------- */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) el.append(kid);
  return el;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h3.5v14H6zM14.5 5H18v14h-3.5z"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4 4 0 0 0-2.5-3.7v7.4A4 4 0 0 0 16.5 12z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm18.3-1.3-1.4-1.4L17 9.2 14.1 6.3l-1.4 1.4L15.6 10.6 12.7 13.5l1.4 1.4L17 12l2.9 2.9 1.4-1.4L18.4 10.6z"/></svg>',
  fsIn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM6 15v3h3v2H4v-5h2zm12 0h2v5h-5v-2h3v-3z"/></svg>',
  fsOut: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9H4V4h5v2H6v3zm9-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 3v-3h2v5h-5v-2h3z"/></svg>',
  loop: '<svg class="loop" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" stroke-dasharray="58 18"/></svg>',
  // a small globe glyph for the language trigger; soft, line-art, on-brand
  globe:
    '<svg class="lang-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3z"/></svg>',
  // the chevron in the trigger; rotates 180° via .lang-trigger[aria-expanded="true"]
  chevron:
    '<svg class="lang-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
  // the active-option marker — a soft terracotta check
  check:
    '<svg class="lang-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>',
};

/* ============================================================================
   Language picker — a bespoke, on-brand replacement for the native <select>.
   ----------------------------------------------------------------------------
   A pill trigger (current label + globe + chevron) that opens a small frosted
   "Paper" card listing the two languages, with a terracotta active marker, full
   ARIA listbox semantics, and keyboard support. It is deliberately framework-free
   and self-contained so it can drop into the existing DOM-helper world.

   The factory returns three things the rest of main.ts wires up:
     • wrap     — the .langwrap element body.picker-on reveals (replaces langWrap)
     • flashEl  — the .lang pill that gets the .flash confirmation pulse (langPick)
     • setValue — reflects a language WITHOUT firing onChange, so applyLang can keep
                  the control in two-way sync with the live site language.
   onChange(lang) fires only on a genuine user pick → wired to setLang().
   ============================================================================ */
type LangPicker = { wrap: HTMLDivElement; flashEl: HTMLDivElement; setValue: (lang: Lang) => void };
function createLangPicker(onChange: (lang: Lang) => void): LangPicker {
  const LANGS: { value: Lang; label: string }[] = [
    { value: "en", label: "English" },
    { value: "zh", label: "简体中文" },
  ];

  let current: Lang = "en";
  let open = false;

  // trigger pill — a real <button> for SR/keyboard; matches the existing pill family
  const triggerLabel = h("span", { class: "lang-label" }, LANGS[0].label);
  const trigger = h(
    "button",
    {
      type: "button",
      class: "lang-trigger",
      "aria-label": "Language",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
    },
  );
  trigger.innerHTML = ICON.globe;
  trigger.append(triggerLabel);
  trigger.insertAdjacentHTML("beforeend", ICON.chevron);

  // floating menu — a frosted Paper card; role=listbox over role=option rows
  const menu = h("div", { class: "lang-menu", role: "listbox", "aria-label": "Language", tabindex: "-1" });
  const options = LANGS.map(({ value, label }) => {
    const opt = h("div", { class: "lang-option", role: "option", "data-value": value, "aria-selected": "false" });
    opt.insertAdjacentHTML("beforeend", ICON.check); // marker (shown only when selected)
    opt.append(h("span", { class: "lang-option-label" }, label));
    return opt;
  });
  menu.append(...options);

  // .lang is the pill that flashes; it wraps the trigger + the (absolutely-placed) menu
  const flashEl = h("div", { class: "lang" }, trigger, menu);
  const wrap = h("div", { class: "langwrap" }, flashEl);

  /** Paint the selected state across the trigger label and the option markers. */
  function reflect(lang: Lang) {
    current = lang;
    const match = LANGS.find((l) => l.value === lang) ?? LANGS[0];
    triggerLabel.textContent = match.label;
    options.forEach((opt) => {
      const sel = opt.getAttribute("data-value") === lang;
      opt.setAttribute("aria-selected", sel ? "true" : "false");
      opt.classList.toggle("is-active", sel);
    });
  }

  /** Visually focus an option (keyboard navigation) without changing selection. */
  let activeIndex = 0;
  function focusOption(i: number) {
    activeIndex = (i + options.length) % options.length;
    options.forEach((opt, idx) => opt.classList.toggle("is-focus", idx === activeIndex));
    options[activeIndex].scrollIntoView({ block: "nearest" });
  }

  function openMenu() {
    if (open) return;
    open = true;
    flashEl.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    // start keyboard focus on the currently-selected option
    focusOption(Math.max(0, options.findIndex((o) => o.getAttribute("data-value") === current)));
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKey, true);
  }
  function closeMenu(returnFocus = false) {
    if (!open) return;
    open = false;
    flashEl.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    options.forEach((opt) => opt.classList.remove("is-focus"));
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onDocKey, true);
    if (returnFocus) trigger.focus();
  }

  /** Commit a user pick: close, then fire onChange only if it actually changed. */
  function pick(lang: Lang) {
    const changed = lang !== current;
    closeMenu(true);
    if (changed) onChange(lang); // → setLang → applyLang → setValue reflects it back
  }

  // click-outside / Esc / Tab all close; clicks inside are handled by the rows
  function onDocPointer(e: PointerEvent) {
    if (!flashEl.contains(e.target as Node)) closeMenu();
  }
  function onDocKey(e: KeyboardEvent) {
    if (!open) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusOption(activeIndex + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusOption(activeIndex - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        pick(LANGS[activeIndex].value);
        break;
      case "Tab":
        closeMenu(); // let focus move on naturally
        break;
    }
  }

  // trigger: toggle on click; Enter/Space/ArrowDown open (native button fires click
  // on Enter/Space, so we only special-case ArrowDown here to open + step in)
  trigger.addEventListener("click", () => (open ? closeMenu() : openMenu()));
  trigger.addEventListener("keydown", (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      openMenu();
    }
  });

  options.forEach((opt) =>
    opt.addEventListener("click", () => pick(opt.getAttribute("data-value") as Lang)),
  );

  reflect("en");
  return { wrap, flashEl, setValue: reflect };
}

/* ============================================================================
   Build the scaffold
   ============================================================================ */
const app = document.getElementById("app")!;

const aura = h("div", { class: "aura" });

const video = document.createElement("video");
video.playsInline = true;
if (LIVE_AUDIO_ANALYSER_ENABLED) video.crossOrigin = "anonymous";
// Only the metadata up front (duration → chapter dots); the full download
// starts on the play gesture in begin(), so the cold open is instant.
video.preload = "metadata";
video.setAttribute("playsinline", "");
video.poster = VIDEO_POSTER;
video.append(
  Object.assign(document.createElement("source"), { src: VIDEO_SRC, type: "video/webm" }),
);

const recText = h("span", { class: "rec-text" });
recText.textContent = STRINGS.rec[lang];
const rec = h("div", { class: "rec" }, h("span", { class: "rec-dot" }), recText);

// Big play affordance over the video whenever it's paused. The cold-open gate
// covers the very first play; this takes over for every pause (and the end)
// afterwards. aria-hidden + tabindex -1: it's a pointer affordance only — the
// labelled play button in the chrome stays the canonical control for SR/keyboard.
const pauseOverlay = h("button", { class: "po", "aria-hidden": "true", tabindex: "-1" });
pauseOverlay.innerHTML = `<span class="po-btn">${ICON.play}</span>`;

const stage = h("div", { class: "stage" }, video, rec, pauseOverlay);

/* deck — wordmark · illustrative scene · compact transcript */
const wmTitle = h("span", { class: "title" });
const wmSub = h("span", { class: "sub" });
const wordmark = h("div", { class: "wordmark interactive" });
wordmark.innerHTML = ICON.loop;
wordmark.append(h("div", {}, wmTitle, h("br"), wmSub));

/* language picker — a bespoke drop-down beside the title. It appears on its own
   scripted beat (BEATS.picker, via the body.picker-on flag) and then persists, since
   it now lives next to the always-on title rather than in the bottom chrome. It stays
   in two-way sync with the live site language: picking an option flips the site (and
   the 3D translate scene, which reads data-lang); the scene flipping it updates the
   drop-down back — both directions funnel through setLang → applyLang. Rather than a
   native <select> dropping the OS menu, this is a small frosted "Paper" card built to
   match the rest of the deck. createLangPicker returns { wrap, flashEl, setValue }:
   wrap is what body.picker-on reveals, flashEl is the pill that pulses on a manual
   pick, and setValue lets applyLang reflect the live language without firing onChange. */
const langPicker = createLangPicker((next) => setLang(next));
const langWrap = langPicker.wrap; // the .langwrap revealed by body.picker-on
const langPick = langPicker.flashEl; // the pill element that gets the .flash pulse
wordmark.append(langWrap);

const sceneStage = h("div", { class: "scene-stage" });

const ptText = h("span", { class: "pt-text" });
const prompterTag = h("div", { class: "prompter-tag" }, h("span", { class: "live-dot" }), ptText);
const plPrev = h("div", { class: "pl prev" });
const plCur = h("div", { class: "pl current" });
const plNext = h("div", { class: "pl next" });
const prompterLines = h("div", { class: "prompter-lines" }, plPrev, plCur, plNext);
const prompter = h("div", { class: "prompter" }, prompterTag, prompterLines);

const deck = h("div", { class: "deck" }, wordmark, sceneStage, prompter);

/* bottom chrome */
const barRail = h("div", { class: "bar-rail" });
const barFill = h("div", { class: "bar-fill" });
barRail.append(barFill);
const barDots = h("div", { class: "bar-dots" });
const barHead = h("div", { class: "bar-head" });
const tipThumb = h("img", { class: "tip-thumb", alt: "" });
const tipTime = h("span", { class: "tip-time" });
const tipChapter = h("span", { class: "tip-chapter" });
const barTip = h("div", { class: "bar-tip" }, tipThumb, h("div", { class: "tip-meta" }, tipTime, tipChapter));
const bar = h(
  "div",
  { class: "bar", role: "slider", "aria-label": "Seek", tabindex: "0", "aria-valuemin": "0" },
  barRail,
  barDots,
  barHead,
  barTip,
);

const playBtn = h("button", { class: "btn", "aria-label": "Play / pause" });
playBtn.innerHTML = ICON.play;
const muteBtn = h("button", { class: "btn", "aria-label": "Mute" });
muteBtn.innerHTML = ICON.vol;
const timeEl = h("div", { class: "time" });
const fsBtn = h("button", { class: "btn", "aria-label": "Fullscreen" });
fsBtn.innerHTML = ICON.fsIn;
const ctrl = h(
  "div",
  { class: "ctrl" },
  h("div", { class: "ctrl-left" }, playBtn, muteBtn, timeEl),
  h("div", { class: "ctrl-right" }, fsBtn),
);
const chrome = h("div", { class: "chrome" }, h("div", { class: "chrome-scrim" }), bar, ctrl);

/* cold-open gate */
const gatePlay = h("button", { class: "gate-play", "aria-label": "Play" });
gatePlay.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const gateHint = h("div", { class: "gate-hint" });
const gate = h("div", { class: "gate" }, gatePlay, gateHint);

const spinner = h("div", { class: "spinner" }, h("i", {}));

const helpCard = h("div", { class: "help-card" });
helpCard.innerHTML = `
  <h3>Keyboard</h3>
  <div class="help-row"><span>Play / pause</span><span><kbd>space</kbd></span></div>
  <div class="help-row"><span>Seek ±5s / +10s</span><span><kbd>←</kbd> <kbd>→</kbd> · <kbd>l</kbd></span></div>
  <div class="help-row"><span>Jump to 0–90%</span><span><kbd>0</kbd> … <kbd>9</kbd></span></div>
  <div class="help-row"><span>Volume / mute</span><span><kbd>↑</kbd> <kbd>↓</kbd> · <kbd>m</kbd></span></div>
  <div class="help-row"><span>Fullscreen</span><span><kbd>f</kbd></span></div>
  <div class="help-row"><span>Close</span><span><kbd>esc</kbd> <kbd>?</kbd></span></div>`;
const help = h(
  "div",
  { class: "help", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts", tabindex: "-1" },
  helpCard,
);
const helpHint = h("div", { class: "helphint" });
helpHint.textContent = "? shortcuts";

app.append(aura, stage, deck, chrome, helpHint, help, spinner, gate);

/* ============================================================================
   Layout — full-bleed → centered portrait (crop) → docked (reposition)
   ============================================================================ */
type StageState = "full" | "center" | "dock";
let currentStage: StageState = "full";

function isNarrow(): boolean {
  return window.innerWidth < 820 || (window.matchMedia("(orientation: portrait)").matches && window.innerWidth <= 1024);
}

function geomFor(state: StageState) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (state === "full") return { x: 0, y: 0, w: vw, h: vh, r: 0 };

  if (isNarrow()) {
    if (state === "center") {
      const hh = Math.round(vh * 0.6);
      const w = Math.round((hh * 9) / 16);
      return { x: Math.round((vw - w) / 2), y: Math.round((vh - hh) * 0.42), w, h: hh, r: 18 };
    }
    // dock — horizontal strip at the top
    const w = vw;
    const hh = Math.round((w * 9) / 16);
    return { x: 0, y: 0, w, h: hh, r: 0 };
  }

  // desktop: step 1 crops to a centered portrait, step 2 slides it left
  const hh = Math.round(vh * 0.8);
  const w = Math.round((hh * 9) / 16);
  const y = Math.round((vh - hh) / 2);
  const x = state === "center" ? Math.round((vw - w) / 2) : Math.round(vw * 0.055);
  return { x, y, w, h: hh, r: 22 };
}

function writeVideoVars(g: { x: number; y: number; w: number; h: number }) {
  const s = document.documentElement.style;
  s.setProperty("--video-x", `${g.x}px`);
  s.setProperty("--video-y", `${g.y}px`);
  s.setProperty("--video-w", `${g.w}px`);
  s.setProperty("--video-h", `${g.h}px`);
}

function applyStage(state: StageState, animate: boolean, duration = 1.3) {
  currentStage = state;
  const g = geomFor(state);
  stage.classList.toggle("docked", state !== "full");
  writeVideoVars(g);
  const props = { x: g.x, y: g.y, width: g.w, height: g.h, borderRadius: g.r };
  if (animate && !REDUCE_MOTION) gsap.to(stage, { ...props, duration, ease: "power3.inOut" });
  else gsap.set(stage, props);
}
applyStage("full", false);

/* ============================================================================
   Illustrative scenes
   ============================================================================ */
let sceneIndex = -2;

/* Each scene part is hidden until the presenter says its words. A part carries
   an optional `data-at` (seconds); parts without one inherit the scene's base
   time. The reveal is fully reversible — scrubbing before a part's time fades it
   back out — so the interface only ever shows what has already been spoken. */
function primeReveals(root: HTMLElement) {
  const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
  gsap.set(targets, REDUCE_MOTION ? { autoAlpha: 0 } : { autoAlpha: 0, y: 22, filter: "blur(8px)" });
}

function showReveals(nodes: HTMLElement[]) {
  if (REDUCE_MOTION) {
    gsap.set(nodes, { autoAlpha: 1, y: 0, filter: "blur(0px)" });
    return;
  }
  gsap.to(nodes, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "power3.out", stagger: 0.07 });
}

function hideReveal(node: HTMLElement) {
  gsap.killTweensOf(node);
  if (REDUCE_MOTION) {
    gsap.set(node, { autoAlpha: 0 });
    return;
  }
  gsap.to(node, { autoAlpha: 0, y: 22, filter: "blur(8px)", duration: 0.3, ease: "power2.in" });
}

/** Reveal/hide the active scene's parts to match the playhead `t`. */
function updateSceneReveals(t: number) {
  const node = sceneStage.lastElementChild as HTMLElement | null;
  if (!node || sceneIndex < 0) return;
  // GPU-driven scenes (e.g. the 3D ASR canvas) drive their own internal phases
  // from the playhead each frame — fully reversible under scrubbing.
  (node as SceneNode).__tick?.(t);
  const base = SCENES[sceneIndex].t;
  const toShow: HTMLElement[] = [];
  node.querySelectorAll<HTMLElement>("[data-reveal]").forEach((part) => {
    const at = part.dataset.at != null ? Number(part.dataset.at) : base;
    const want = t >= at;
    const shown = part.classList.contains("is-in");
    if (want && !shown) {
      part.classList.add("is-in");
      toShow.push(part);
    } else if (!want && shown) {
      part.classList.remove("is-in");
      hideReveal(part);
    }
  });
  if (toShow.length) showReveals(toShow);
}

function swapScene(i: number, force = false) {
  if (i === sceneIndex && !force) return;
  sceneIndex = i;

  // Crossfade: keep only the most recent outgoing scene to fade; drop any
  // stragglers immediately (robust against fast scrubbing and rAF throttling).
  const existing = Array.from(sceneStage.children) as HTMLElement[];
  const old = existing.pop() ?? null;
  existing.forEach((c) => {
    gsap.killTweensOf(c);
    (c as SceneNode).__cleanup?.(); // release any WebGL context before detaching
    c.remove();
  });
  if (old) {
    gsap.killTweensOf(old);
    gsap.to(old, { autoAlpha: 0, y: -14, filter: "blur(6px)", duration: REDUCE_MOTION ? 0.001 : 0.36, ease: "power2.in" });
    // remove on a wall-clock timer so it never lingers if the tween is throttled
    window.setTimeout(() => {
      (old as SceneNode).__cleanup?.();
      old.remove();
    }, 420);
  }

  if (i < 0) return;
  const node = SCENES[i].build(lang);
  sceneStage.append(node);
  // Start every part hidden; updateSceneReveals (called right after, each tick)
  // fades in only the parts whose words have been spoken.
  primeReveals(node);
}

/* ============================================================================
   Teleprompter
   ============================================================================ */
let lastCueIdx = -2;

function renderPrompter(t: number, force = false) {
  const cues = CUES[lang];
  const idx = activeCueIndex(cues, t);
  if (idx === lastCueIdx && !force) return;
  lastCueIdx = idx;
  if (idx < 0) {
    plPrev.textContent = "";
    plCur.textContent = "";
    plNext.textContent = cues[0]?.text ?? "";
    return;
  }
  plPrev.textContent = idx - 1 >= 0 ? cues[idx - 1].text : "";
  plCur.textContent = cues[idx].text;
  plNext.textContent = idx + 1 < cues.length ? cues[idx + 1].text : "";
  if (!REDUCE_MOTION) gsap.fromTo(plCur, { y: 6, opacity: 0.6 }, { y: 0, opacity: 1, duration: 0.5, ease: "power2.out" });
}

/* ============================================================================
   Progress bar + chapter dots (with frame thumbnails)
   ============================================================================ */
let duration = 0;

function fmt(t: number): string {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildDots() {
  barDots.innerHTML = "";
  for (const c of CHAPTERS) {
    const dot = h("div", { class: "bar-dot" });
    dot.style.left = `${(c.t / duration) * 100}%`;
    dot.dataset.t = String(c.t);
    barDots.append(dot);
  }
}

function chapterIndexAt(t: number): number {
  let idx = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t) idx = i;
  return idx;
}

function updateBar(t: number) {
  if (!duration) return;
  const pct = Math.min(100, (t / duration) * 100);
  barFill.style.width = `${pct}%`;
  barHead.style.left = `${pct}%`;
  bar.setAttribute("aria-valuemax", String(Math.round(duration)));
  bar.setAttribute("aria-valuenow", String(Math.round(t)));
  bar.setAttribute("aria-valuetext", `${fmt(t)} of ${fmt(duration)}`);
  timeEl.innerHTML = `<b>${fmt(t)}</b>&nbsp;/&nbsp;${fmt(duration)}`;
  barDots.querySelectorAll<HTMLElement>(".bar-dot").forEach((dot) => {
    const tt = Number(dot.dataset.t);
    const isPast = t >= tt;
    const next = CHAPTERS.find((c) => c.t > tt)?.t ?? Infinity;
    dot.classList.toggle("past", isPast);
    dot.classList.toggle("current", isPast && next > t);
  });
}

/* ============================================================================
   Beats — flip body classes by time, so scrubbing is reversible & synced
   ============================================================================ */
function setFlag(name: string, on: boolean) {
  document.body.classList.toggle(name, on);
}

// The progress bar stays revealed through the rest of the in-sync section — from
// "So display that progress bar" (BEATS.progress) until the next scene begins
// ("if you're on mobile"). Derived from the schedule so it tracks the timings.
const SCRUB_REVEAL_END = SCENES[activeSceneIndex(BEATS.progress) + 1]?.t ?? Infinity;

function applyBeats(t: number) {
  let wantStage: StageState = "full";
  if (t >= BEATS.dock) wantStage = "dock";
  else if (t >= BEATS.crop) wantStage = "center";
  if (wantStage !== currentStage) {
    // Step 1 (full → centered portrait) is the "very smooth animation" he asks
    // for, so it eases slowly; every other move (incl. scrubbing) stays snappy.
    const slowCrop = wantStage === "center" && currentStage === "full";
    applyStage(wantStage, true, slowCrop ? CROP_DURATION : 1.3);
  }

  setFlag("revealed", t >= BEATS.crop);
  setFlag("deck-on", t >= BEATS.deck);
  setFlag("picker-on", t >= BEATS.picker);

  // scripted language flip — unless the viewer has taken manual control
  if (manualLang === null) {
    const scripted: Lang = t >= BEATS.translate ? "zh" : "en";
    if (scripted !== lang) setLangInternal(scripted);
  }

  // The scrubber is *concealed* until the presenter asks for it: "So display that
  // progress bar" (BEATS.progress). Before that it only reveals on a deliberate
  // hover into the bottom edge (CSS), so the cold open never advertises that you
  // can jump ahead. From the cue it materialises and holds through the rest of
  // the in-sync section (the on-screen "wow"), then goes on-demand like YouTube.
  // Both flags are pure functions of t, so a reverse scrub re-conceals it.
  setFlag("scrub-locked", t < BEATS.progress);
  setFlag("scrub-reveal", t >= BEATS.progress && t < SCRUB_REVEAL_END);

  swapScene(t >= BEATS.deck ? activeSceneIndex(t) : -1);
  updateSceneReveals(t);
}

/* ============================================================================
   i18n — swap all UI copy + teleprompter + active scene
   ============================================================================ */
function applyLang() {
  document.documentElement.setAttribute("data-lang", lang);
  prompter.setAttribute("data-lang", lang);
  wmTitle.textContent = STRINGS.brand[lang];
  wmSub.textContent = STRINGS.brandSub[lang];
  ptText.textContent = STRINGS.transcriptLabel[lang];
  recText.textContent = STRINGS.rec[lang];
  gateHint.textContent = STRINGS.playHint[lang];
  // keep the drop-down in sync whenever the language changes from anywhere — the
  // scripted flip, the 3D translate scene, or a manual pick (two-way sync). setValue
  // only reflects the displayed label/selection; it does not re-fire onChange.
  langPicker.setValue(lang);
  renderPrompter(video.currentTime || 0, true);
  if (sceneIndex >= 0) {
    // Prefer an in-place language update when the active scene supports one (the
    // 3D translate scene drives + reflects the site language itself and must keep
    // its GL context across a flip); otherwise rebuild to re-translate its DOM.
    const active = sceneStage.lastElementChild as SceneNode | null;
    if (active && active.__setLang) active.__setLang(lang);
    else swapScene(sceneIndex, true);
    updateSceneReveals(video.currentTime || 0); // re-show the spoken parts at once (no flash on a paused switch)
  }
}

function setLangInternal(next: Lang) {
  if (next === lang) return;
  lang = next;
  applyLang();
}
function setLang(next: Lang) {
  manualLang = next;
  if (next === lang) return;
  lang = next;
  applyLang();
  langPick.classList.remove("flash");
  void langPick.offsetWidth;
  langPick.classList.add("flash");
}
// Selection is wired through createLangPicker's onChange callback (→ setLang above);
// there is no native <select> change event to listen for anymore.

// The 3D translate scene flips the whole site language when you drag the word
// across the glass — cursor on the left → English, on the right → 中文.
window.addEventListener("site-set-lang", (e) => {
  const next = (e as CustomEvent<Lang>).detail;
  if (next === "en" || next === "zh") setLang(next);
});

/* ============================================================================
   Transport: play/pause, mute, fullscreen, scrubbing, keyboard
   ============================================================================ */
function setPaused(paused: boolean) {
  setFlag("paused", paused);
  playBtn.innerHTML = paused ? ICON.play : ICON.pause;
  if (paused) showChrome();
}
function togglePlay() {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}
playBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlay();
});
video.addEventListener("play", () => {
  setPaused(false);
  resumeAudio(); // browsers can suspend the context across pauses/backgrounding
});
video.addEventListener("pause", () => setPaused(true));
video.addEventListener("ended", () => setPaused(true));

// click (desktop) toggles; tap (touch) just reveals the controls
stage.addEventListener("pointerup", (e) => {
  if (!hasBegun) return;
  if (e.pointerType === "touch") showChrome();
  else togglePlay();
});

// The paused overlay is a big resume button (mouse + touch). Swallow the
// pointerup so the stage handler above doesn't toggle a second time.
pauseOverlay.addEventListener("pointerup", (e) => e.stopPropagation());
pauseOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlay();
});

function setMuted(m: boolean) {
  video.muted = m;
  muteBtn.innerHTML = m || video.volume === 0 ? ICON.mute : ICON.vol;
}
muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setMuted(!video.muted);
});
video.addEventListener("volumechange", () => {
  muteBtn.innerHTML = video.muted || video.volume === 0 ? ICON.mute : ICON.vol;
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
fsBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  fsBtn.innerHTML = document.fullscreenElement ? ICON.fsOut : ICON.fsIn;
});

/* scrubbing */
function seekFromClientX(clientX: number) {
  if (!duration) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  video.currentTime = ratio * duration;
}
let dragging = false;
bar.addEventListener("pointerdown", (e) => {
  dragging = true;
  bar.setPointerCapture(e.pointerId);
  seekFromClientX(e.clientX);
});
bar.addEventListener("pointermove", (e) => {
  if (duration) {
    bar.classList.add("tipping");
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = ratio * duration;
    const ci = chapterIndexAt(t);
    barTip.style.left = `${ratio * 100}%`;
    tipThumb.src = `${THUMB_BASE}/thumb_${CHAPTERS[ci].thumb}.webp`;
    tipTime.textContent = fmt(t);
    tipChapter.textContent = CHAPTERS[ci].label[lang];
  }
  if (dragging) seekFromClientX(e.clientX);
});
function endDrag(e: PointerEvent) {
  dragging = false;
  try {
    bar.releasePointerCapture(e.pointerId);
  } catch {
    /* capture may already be gone */
  }
}
bar.addEventListener("pointerup", endDrag);
bar.addEventListener("pointercancel", endDrag);
bar.addEventListener("lostpointercapture", endDrag);
bar.addEventListener("click", (e) => e.stopPropagation());
// tooltip + thumbnail: driven by JS so it also works on touch (no :hover there)
bar.addEventListener("pointerenter", () => bar.classList.add("tipping"));
bar.addEventListener("pointerdown", () => bar.classList.add("tipping"));
bar.addEventListener("pointerleave", () => bar.classList.remove("tipping"));

/* keyboard — YouTube-like */
let hasBegun = false;

function seekBy(d: number) {
  video.currentTime = Math.min(duration || Infinity, Math.max(0, video.currentTime + d));
  showChrome();
}

let helpReturnFocus: HTMLElement | null = null;
function openHelp() {
  helpReturnFocus = document.activeElement as HTMLElement | null;
  help.classList.add("on");
  help.focus();
}
function closeHelp() {
  if (!help.classList.contains("on")) return;
  help.classList.remove("on");
  helpReturnFocus?.focus?.();
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Cold open: zero GUI. The first meaningful key *is* the play gesture.
  if (!hasBegun) {
    if (e.code === "Space" || e.key === "Enter") {
      e.preventDefault();
      begin();
    }
    return;
  }

  // Let a focused control handle its own activation key (no double-toggle).
  const ae = document.activeElement;
  const onControl = ae instanceof HTMLButtonElement || ae instanceof HTMLAnchorElement;
  if (onControl && (e.code === "Space" || e.key === "Enter")) return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowRight") {
    seekBy(5);
  } else if (e.key === "ArrowLeft") {
    seekBy(-5);
  } else if (e.key === "l") {
    seekBy(10);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    video.volume = Math.min(1, video.volume + 0.1);
    setMuted(false);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    video.volume = Math.max(0, video.volume - 0.1);
  } else if (e.key === "m") {
    setMuted(!video.muted);
  } else if (e.key === "f") {
    toggleFullscreen();
  } else if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
    if (help.classList.contains("on")) closeHelp();
    else if (document.body.classList.contains("revealed")) openHelp();
  } else if (e.key === "Escape") {
    closeHelp();
  } else if (/^[0-9]$/.test(e.key) && duration) {
    video.currentTime = (Number(e.key) / 10) * duration;
    showChrome();
  }
});
help.addEventListener("click", (e) => {
  if (e.target === help) closeHelp();
});

/* ============================================================================
   On-demand chrome (YouTube-style): hidden by default, shown near the bottom
   edge / on tap / when paused, auto-hides while playing.
   ============================================================================ */
let hideTimer = 0;
function showChrome() {
  setFlag("chrome-active", true);
  window.clearTimeout(hideTimer);
  if (!video.paused) hideTimer = window.setTimeout(() => setFlag("chrome-active", false), 2800);
}
window.addEventListener(
  "pointermove",
  (e) => {
    if (e.clientY >= window.innerHeight - 150) showChrome();
  },
  { passive: true },
);
window.addEventListener("pointerdown", () => showChrome(), { passive: true });
chrome.addEventListener("pointerenter", () => {
  window.clearTimeout(hideTimer);
  setFlag("chrome-active", true);
});

/* ============================================================================
   Cold open + buffering
   ============================================================================ */
function begin() {
  if (hasBegun) return;
  hasBegun = true;
  setFlag("begun", true); // from now on, pausing shows the play overlay + keeps the bar up
  setMuted(false);
  video.preload = "auto"; // pull the full media, after the user gesture
  // The CDN needs CORS before this can be enabled; otherwise Web Audio can
  // silence cross-origin media. The ASR scene falls back to intro.peaks.json.
  if (LIVE_AUDIO_ANALYSER_ENABLED) {
    attachAudioAnalyser(video);
    resumeAudio();
  }
  // Optimistically clear the paused state so the play overlay never flashes
  // under the fading gate; the play/pause events keep it honest if play() fails.
  setPaused(false);
  video.play().catch(() => setPaused(true));
  gate.classList.add("gone");
  showChrome();
  window.setTimeout(() => gate.remove(), 900);
}
gate.addEventListener("click", begin);

video.addEventListener("waiting", () => spinner.classList.add("on"));
video.addEventListener("stalled", () => spinner.classList.add("on"));
["playing", "canplay", "seeked"].forEach((ev) =>
  video.addEventListener(ev, () => spinner.classList.remove("on")),
);

/* ============================================================================
   Render loop + boot
   ============================================================================ */
function tick() {
  const t = video.currentTime;
  updateBar(t);
  renderPrompter(t);
  applyBeats(t);
  requestAnimationFrame(tick);
}

video.addEventListener("loadedmetadata", () => {
  duration = video.duration;
  buildDots();
  updateBar(0);
});

applyLang();
setPaused(true);
applyBeats(0);
requestAnimationFrame(tick);

window.addEventListener("resize", () => {
  // retarget an in-flight dock tween instead of snapping
  applyStage(currentStage, gsap.isTweening(stage));
});
