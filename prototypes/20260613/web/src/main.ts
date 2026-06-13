/* ============================================================================
   main.ts — the director.

   Drives the interface from the talking-head video's playback position. The
   video is the prompt; scrubbing it scrubs the whole deck. Scene boundaries and
   content come from timeline.ts, anchored to the transcript's timestamps.
   ============================================================================ */

import "./style.css";
import { gsap } from "gsap";
import { SCENES, CHAPTERS, h, type StageKey, type Scene } from "./timeline";

const SCRUBBER_REVEAL_T = 47.8; // transcript: "on the bottom ... show a slider"
const EASE = "power3.inOut";

/* --- build the DOM scaffold ---------------------------------------------- */
const app = document.getElementById("app")!;

const aurora = h("div", { class: "aurora" },
  h("span", { class: "a1" }), h("span", { class: "a2" }), h("span", { class: "a3" }));

const video = document.createElement("video");
video.playsInline = true;
video.preload = "auto";
video.setAttribute("playsinline", "");
video.append(
  Object.assign(document.createElement("source"), { src: "presentation.webm", type: "video/webm" }),
  Object.assign(document.createElement("source"), { src: "presentation.mp4", type: "video/mp4" }),
);

const liveTag = h("div", { class: "live-tag" },
  h("span", { class: "dot" }), h("span", { class: "lt-text" }, "Live"));
liveTag.style.cssText = "position:absolute;left:16px;bottom:16px;opacity:1;";

const videoStage = h("div", { class: "video-stage is-full" }, video, liveTag);

const contentLayer = h("div", { class: "content-layer" });
const overlayLayer = h("div", {}); // holds fullscreen overlays
const pauseVeil = h("div", { class: "pause-veil" });
const pauseBadge = h("div", { class: "pause-badge" }, "Paused — explore");
const vignette = h("div", { class: "vignette" });
const grain = h("div", { class: "grain" });

const hudBrand = h("div", { class: "hud-brand" },
  h("span", { class: "loopmark" }), h("span", {}, "LLM", document.createElement("br")),
);
hudBrand.innerHTML = '<span class="loopmark"></span><span><b>LLMOS</b> · open ⟲ closed loops</span>';

const hudChapter = h("div", { class: "hud-chapter" });

/* scrubber */
const sbRail = h("div", { class: "sb-rail" }, h("div", { class: "sb-fill" }));
const sbTicks = h("div", { class: "sb-ticks" });
const sbHead = h("div", { class: "sb-head" });
const sbTrack = h("div", { class: "sb-track" }, sbRail, sbTicks, sbHead);
const sbTime = h("div", { class: "sb-time" });
const scrubber = h("div", { class: "scrubber" },
  h("div", { class: "sb-meta" },
    (() => { const l = h("div", { class: "lbl" }); l.innerHTML = "<b>Scrub the video</b> = scrub the deck"; return l; })(),
    sbTime),
  sbTrack);

/* controls */
const playBtn = h("button", { class: "play-btn", "aria-label": "Play or pause" });
const controls = h("div", { class: "controls" },
  playBtn,
  (() => { const hint = h("div", { class: "hint" }); hint.innerHTML = "<kbd>space</kbd> play / pause · <kbd>←</kbd> <kbd>→</kbd> seek · pause to explore"; return hint; })());

/* start gate (autoplay-with-sound needs a user gesture) */
const startGate = h("div", { class: "start-gate" });
startGate.innerHTML = `
  <div class="sg-inner">
    <div class="kicker">A live presentation</div>
    <h1 class="display sg-title">Open <em>&amp;</em> Closed Loops</h1>
    <p class="sg-sub">The economics of the LLMOS. The video is the prompt — the interface is generated from it.</p>
    <button class="sg-play" aria-label="Begin">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <div class="sg-cta">click to begin · sound on</div>
  </div>`;

/* loader */
const loader = h("div", { class: "loader" },
  h("div", { class: "lwrap" }, h("div", { class: "loopmark-lg" }), h("div", { class: "lt" }, "Loading the loop…")));

app.append(aurora, videoStage, contentLayer, overlayLayer, vignette, pauseVeil,
  hudBrand, hudChapter, pauseBadge, scrubber, controls, startGate, grain, loader);

const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
playBtn.innerHTML = PAUSE_ICON;

/* --- stage layout -------------------------------------------------------- */
function layoutFor(stage: StageKey, vw: number, vh: number) {
  if (stage === "full") return { w: vw, h: vh, x: 0, y: 0, r: 0 };
  if (stage === "narrow") {
    const hgt = vh * 0.8;
    const w = Math.min(hgt * (9 / 16), vw * 0.9);
    return { w, h: hgt, x: (vw - w) / 2, y: (vh - hgt) / 2, r: 20 };
  }
  // dock right
  const hgt = vh * 0.86;
  const w = Math.min(hgt * (9 / 16), vw * 0.34);
  const margin = vw * 0.045;
  return { w, h: hgt, x: vw - w - margin, y: (vh - hgt) / 2, r: 22 };
}

let currentStage: StageKey = "full";
function applyStage(stage: StageKey, animate = true) {
  currentStage = stage;
  const { w, h: hgt, x, y, r } = layoutFor(stage, window.innerWidth, window.innerHeight);
  videoStage.classList.toggle("is-full", stage === "full");
  const props = { width: w, height: hgt, x, y, borderRadius: r };
  if (animate) gsap.to(videoStage, { ...props, duration: 1.3, ease: EASE });
  else gsap.set(videoStage, props);
}
gsap.set(videoStage, { top: 0, left: 0 });
applyStage("full", false);

/* --- scene engine -------------------------------------------------------- */
let sceneIndex = -1;
let activePanel: HTMLElement | null = null;
let activeOverlay: HTMLElement | null = null;

function revealIn(root: HTMLElement, delay = 0) {
  const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
  gsap.fromTo(targets,
    { y: 30, autoAlpha: 0, filter: "blur(10px)" },
    { y: 0, autoAlpha: 1, filter: "blur(0px)", duration: 0.8, ease: "power3.out", stagger: 0.055, delay });
}

function swapPanel(next: Scene) {
  const old = activePanel;
  if (old) {
    old.classList.add("detached");
    gsap.to(old, {
      autoAlpha: 0, y: -24, filter: "blur(8px)", duration: 0.5, ease: "power2.in",
      onComplete: () => old.remove(),
    });
  }
  if (next.panel) {
    const panel = next.panel();
    contentLayer.append(panel);
    activePanel = panel;
    revealIn(panel, old ? 0.32 : 0.1);
    bindPanelInteractions(panel);
  } else {
    activePanel = null;
  }
}

function swapOverlay(next: Scene) {
  const old = activeOverlay;
  if (old) {
    gsap.to(old, { autoAlpha: 0, duration: 0.6, ease: "power2.in", onComplete: () => old.remove() });
    activeOverlay = null;
  }
  if (next.overlay) {
    const ov = next.overlay();
    overlayLayer.append(ov);
    activeOverlay = ov;
    gsap.fromTo(ov, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.9, ease: "power2.out" });
    revealIn(ov, 0.25);
  }
}

function goToScene(i: number) {
  if (i === sceneIndex || i < 0) return;
  sceneIndex = i;
  const scene = SCENES[i];
  applyStage(scene.stage);
  swapPanel(scene);
  swapOverlay(scene);
  hudChapter.innerHTML = `<b>${String(i + 1).padStart(2, "0")}</b> · ${scene.chapter}`;
}

function sceneIndexForTime(t: number) {
  let idx = 0;
  for (let i = 0; i < SCENES.length; i++) if (t >= SCENES[i].t) idx = i;
  return idx;
}

/* --- panel interactions (active when paused) ----------------------------- */
function bindPanelInteractions(panel: HTMLElement) {
  panel.querySelectorAll<HTMLElement>("[data-seek]").forEach((node) => {
    node.addEventListener("click", () => {
      const t = Number(node.dataset.seek);
      if (!Number.isNaN(t)) { video.currentTime = t; video.play(); }
    });
  });
}

/* --- scrubber ------------------------------------------------------------ */
let duration = 0;
let scrubberRevealed = false;

function buildTicks() {
  sbTicks.innerHTML = "";
  for (const c of CHAPTERS) {
    const tick = h("div", { class: "sb-tick" }, h("span", { class: "tip" }, c.label));
    tick.style.left = `${(c.t / duration) * 100}%`;
    tick.addEventListener("click", (e) => { e.stopPropagation(); video.currentTime = c.t; });
    sbTicks.append(tick);
    (tick as HTMLElement).dataset.t = String(c.t);
  }
}

function fmt(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateScrubber(t: number) {
  if (!duration) return;
  const pct = Math.min(100, (t / duration) * 100);
  (sbRail.firstElementChild as HTMLElement).style.width = `${pct}%`;
  sbHead.style.left = `${pct}%`;
  sbTime.innerHTML = `<b>${fmt(t)}</b> / ${fmt(duration)}`;
  sbTicks.querySelectorAll<HTMLElement>(".sb-tick").forEach((tick) => {
    const tt = Number(tick.dataset.t);
    tick.classList.toggle("past", t >= tt);
    tick.classList.toggle("current", t >= tt && (CHAPTERS.find((c) => c.t > tt)?.t ?? Infinity) > t);
  });
}

function revealScrubber() {
  if (scrubberRevealed) return;
  scrubberRevealed = true;
  gsap.to([scrubber, controls], { autoAlpha: 1, y: 0, duration: 1, ease: "power3.out", stagger: 0.12 });
}

/* seek by pointer */
function seekFromClientX(clientX: number) {
  const rect = sbTrack.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  video.currentTime = ratio * duration;
}
let dragging = false;
sbTrack.addEventListener("pointerdown", (e) => {
  dragging = true; sbTrack.setPointerCapture(e.pointerId); seekFromClientX(e.clientX);
});
sbTrack.addEventListener("pointermove", (e) => { if (dragging) seekFromClientX(e.clientX); });
sbTrack.addEventListener("pointerup", (e) => { dragging = false; sbTrack.releasePointerCapture(e.pointerId); });

/* --- play / pause -------------------------------------------------------- */
function setPaused(paused: boolean) {
  document.body.classList.toggle("is-paused", paused);
  playBtn.innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
  liveTag.classList.toggle("paused", paused);
  liveTag.querySelector(".lt-text")!.textContent = paused ? "Paused" : "Live";
}
function togglePlay() { if (video.paused) video.play(); else video.pause(); }
playBtn.addEventListener("click", togglePlay);
video.addEventListener("play", () => setPaused(false));
video.addEventListener("pause", () => setPaused(true));

/* click the video to pause/resume; ignore drags on controls */
videoStage.addEventListener("click", togglePlay);

document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.code === "ArrowRight") video.currentTime = Math.min(duration, video.currentTime + 5);
  else if (e.code === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 5);
});

/* --- start gate ---------------------------------------------------------- */
function begin() {
  video.play().catch(() => {});
  gsap.to(startGate, { autoAlpha: 0, duration: 0.8, ease: "power2.inOut",
    onComplete: () => startGate.remove() });
}
startGate.addEventListener("click", begin);

/* --- main render loop ---------------------------------------------------- */
function tick() {
  const t = video.currentTime;
  updateScrubber(t);
  goToScene(sceneIndexForTime(t));
  if (t >= SCRUBBER_REVEAL_T) revealScrubber();
  requestAnimationFrame(tick);
}

/* --- boot ---------------------------------------------------------------- */
video.addEventListener("loadedmetadata", () => {
  duration = video.duration;
  buildTicks();
});
video.addEventListener("canplay", () => {
  loader.classList.add("gone");
  setTimeout(() => loader.remove(), 900);
}, { once: true });

video.addEventListener("ended", () => setPaused(true));

window.addEventListener("resize", () => applyStage(currentStage, false));

// kick off the first scene immediately and start the loop
goToScene(0);
setPaused(true);
requestAnimationFrame(tick);
