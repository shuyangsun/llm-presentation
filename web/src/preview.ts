/* DEV-ONLY preview harness for the 3D ASR scene (asr3d.ts). Mounts the scene in
   a deck-like panel and drives __tick(t) at a fixed playhead time chosen via the
   URL (?t=145.5&mx=0.5&my=0.5&lang=en). Lets us screenshot each narrative phase
   without the (uncommitted) video. Not shipped — vite build ignores it. */
import "./style.css";
import { gsap } from "gsap";
import { SCENES } from "./engine/scenes";
import type { SceneNode } from "./engine/scenes";
import type { Lang } from "./data/timeline";

const q = new URLSearchParams(location.search);
let t = parseFloat(q.get("t") ?? "146");
const lang = (q.get("lang") as Lang) ?? "en";
const mxFrac = q.get("mx") != null ? parseFloat(q.get("mx")!) : null; // 0..1 across canvas (screenshot mode)
const myFrac = q.get("my") != null ? parseFloat(q.get("my")!) : null;

document.documentElement.setAttribute("data-lang", lang);
document.body.classList.add("deck-on", "revealed");

const app = document.getElementById("app")!;
const panel = document.createElement("div");
panel.style.cssText =
  "position:fixed; inset:0; padding:6vh 6vw; display:flex; flex-direction:column; gap:24px; background:var(--bg);";
// interactive review controls: scrub the playhead (142.75 wave → 145.5 settled →
// 165.5 next scene) and Play to watch the crystallization. Move the mouse over
// the slabs to feel the hover-on-ice + parallax.
const bar = document.createElement("div");
bar.style.cssText =
  "display:flex; align-items:center; gap:14px; font-family:var(--font-mono); font-size:12px; color:var(--fg-muted);";
const playBtn = document.createElement("button");
playBtn.textContent = "▶ play";
playBtn.style.cssText =
  "font:inherit; padding:6px 12px; border:1px solid var(--hairline-strong); border-radius:8px; background:var(--surface); color:var(--accent-ink); cursor:pointer;";
const slider = document.createElement("input");
slider.type = "range";
slider.min = "142";
slider.max = "166";
slider.step = "0.01";
slider.value = String(t);
slider.style.cssText = "flex:1 1 auto; accent-color:var(--accent);";
const label = document.createElement("div");
label.style.cssText = "min-width:170px; text-align:right;";
const setLabel = () => (label.textContent = `t=${t.toFixed(2)}  lang=${lang}  (move mouse over the ice)`);
setLabel();

let playing = false;
let playStartT = t;
let playStartClock = 0;
playBtn.addEventListener("click", () => {
  playing = !playing;
  playBtn.textContent = playing ? "❚❚ pause" : "▶ play";
  if (playing) {
    if (t >= 147) t = 142.5; // restart from the top of the beat
    playStartT = t;
    playStartClock = performance.now() / 1000;
  }
});
slider.addEventListener("input", () => {
  playing = false;
  playBtn.textContent = "▶ play";
  t = parseFloat(slider.value);
  setLabel();
});
bar.append(playBtn, slider, label);

const stageWrap = document.createElement("div");
stageWrap.className = "scene-stage";
stageWrap.style.cssText = "position:relative; flex:1 1 auto; min-height:300px;";
panel.append(bar, stageWrap);
app.append(panel);

const scene = SCENES[0].build(lang) as SceneNode; // SCENES[0].build === asrScene
stageWrap.append(scene);

// reveal all [data-reveal] parts immediately (main.ts would stagger these)
scene.querySelectorAll<HTMLElement>("[data-reveal]").forEach((n) => {
  n.classList.add("is-in");
  gsap.set(n, { autoAlpha: 1, y: 0, filter: "blur(0px)" });
});

function dispatchMouse() {
  if (mxFrac == null || myFrac == null) return;
  const canvas = scene.querySelector("canvas");
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  const ev = new PointerEvent("pointermove", {
    clientX: r.left + r.width * mxFrac,
    clientY: r.top + r.height * myFrac,
    bubbles: true,
  });
  window.dispatchEvent(ev);
}

function loop() {
  if (playing) {
    // ~1x speed through the beat, then hold on the settled transcript
    t = Math.min(147, playStartT + (performance.now() / 1000 - playStartClock));
    slider.value = String(t);
    setLabel();
    if (t >= 147) {
      playing = false;
      playBtn.textContent = "▶ play";
    }
  }
  dispatchMouse();
  scene.__tick?.(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
