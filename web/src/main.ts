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
};

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

/* language picker — a drop-down beside the title. It appears on its own scripted
   beat (BEATS.picker, via the body.picker-on flag) and then persists, since it now
   lives next to the always-on title rather than in the bottom chrome. It stays in
   two-way sync with the live site language: picking an option flips the site (and
   the 3D translate scene, which reads data-lang); the scene flipping it updates
   the drop-down back — both directions funnel through setLang → applyLang. */
const langSelect = h("select", { class: "lang-select", "aria-label": "Language" });
langSelect.append(
  Object.assign(document.createElement("option"), { value: "en", textContent: "English" }),
  Object.assign(document.createElement("option"), { value: "zh", textContent: "简体中文" }),
);
const langPick = h("div", { class: "lang" }, langSelect);
const langWrap = h("div", { class: "langwrap" }, langPick);
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
  <div class="help-row"><span>Play / pause</span><span><kbd>space</kbd> <kbd>k</kbd></span></div>
  <div class="help-row"><span>Seek ±5s / ±10s</span><span><kbd>←</kbd> <kbd>→</kbd> · <kbd>j</kbd> <kbd>l</kbd></span></div>
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
  // scripted flip, the 3D translate scene, or a manual pick (two-way sync).
  langSelect.value = lang;
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
langSelect.addEventListener("change", () => setLang(langSelect.value as Lang));

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
    tipThumb.src = `/media/thumbs/thumb_${CHAPTERS[ci].thumb}.jpg`;
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
    if (e.code === "Space" || e.key === "k" || e.key === "Enter") {
      e.preventDefault();
      begin();
    }
    return;
  }

  // Let a focused control handle its own activation key (no double-toggle).
  const ae = document.activeElement;
  const onControl = ae instanceof HTMLButtonElement || ae instanceof HTMLAnchorElement;
  if (onControl && (e.code === "Space" || e.key === "Enter")) return;

  if (e.code === "Space" || e.key === "k") {
    e.preventDefault();
    togglePlay();
  } else if (e.key === "ArrowRight") {
    seekBy(5);
  } else if (e.key === "ArrowLeft") {
    seekBy(-5);
  } else if (e.key === "l") {
    seekBy(10);
  } else if (e.key === "j") {
    seekBy(-10);
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
