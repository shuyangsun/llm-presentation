/* ============================================================================
   director3d.ts — "Director's Dash", a tiny pixel-art platformer ABOUT this talk.

   "Think of yourself as a Hollywood director trying to tell a story ... making
   this presentation FUN is the number one non-negotiable requirement." This beat
   is a playable Chrome-dino-style runner, drawn as a TRADITIONAL 2D PLATFORMER in
   the spirit of Celeste: a low-resolution canvas upscaled with nearest-neighbour
   so every edge is a crisp chunky pixel. No WebGL, no glass, no particles.

   It is explicitly about THIS project. A little pixel CLAPPERBOARD director runs a
   grassy stage and:
     - HOPS the corporate EMPLOYEES (cute necktie-wearing turtles — a gentle poke at
       office life, à la Super Mario koopas; stomp one for a bonus),
     - DUCKS the flying office MEMOS (paper planes),
     - and COLLECTS open-source FILE TOKENS. Each token is a real markdown/code file
       from the presenter's public repos (llm-presentation, coding-agent-skills, the
       AlphaZero projects, ...). Grabbing one teaches a fact about the talk and drops a
       clickable GitHub link into the on-screen panel to open later. Controls and
       collected links live in the DOM (crisp text) over the pixel canvas.

   Two clocks, on purpose:
   - The GAME loop (run cycle, scrolling, spawns, jumps, collisions, score) runs on
     the wall-clock + player input — like any game, it is NOT rewound by scrubbing.
     It waits for the first CLICK/J/K input, then runs live and may later fall back
     to a tiny attract-mode AI so the stage recovers if abandoned.
   - The STORY beats stay a pure function of the playhead `t` (via phase(t,a,b)):
       intro   phase(t, 263.1, 264.5)  the scene fades in.
       fun     phase(t, 278.5, 280.8)  "make it fun, number one" — the washed-out
                                        corporate world saturates into full colour, a
                                        spotlight lands on the director, the dash speeds up.
       retake  phase(t, 282.6, 284.3)  "if it's not fun, I'll ask you to redo it" — a flash.

   Controls: J starts/jumps, K starts/ducks; after start, CLICK also jumps (Space is
   free for the video). 3 LIVES — on the third hit the director keels over with cute
   "X X" eyes; collect 5 file tokens to win. The collected links stay clickable and
   ENTER restarts (it also auto-restarts after a while so the attract loop recovers).
   ============================================================================ */

import type { Lang } from "../data/timeline";

/* --- the score (playhead seconds, pinned to en.vtt) ----------------------- */
const BASE_A = 263.1,
  BASE_B = 264.5; // "a Hollywood director" — the stage fades in
const FUN_A = 278.5,
  FUN_B = 280.8; // "make it fun / number one" — the world saturates
const RETAKE_A = 282.6,
  RETAKE_B = 284.3; // "if it's not fun, I'll ask you to redo it" — scripted RETAKE flash

/* --- the open-source loot: real files from the presenter's public repos ---- */
const OWNER = "shuyangsun";
type RepoKey =
  | "llm-presentation"
  | "coding-agent-skills"
  | "alpha-zero-game"
  | "alpha-zero-api"
  | "az-game-xiang-qi"
  | "az-game-tic-tac-toe";
const REPO_COLOR: Record<RepoKey, string> = {
  "llm-presentation": "#c25450", // terracotta — the talk itself
  "coding-agent-skills": "#4e8d7c", // teal
  "alpha-zero-game": "#d99a3c", // amber
  "alpha-zero-api": "#6a78b0", // indigo
  "az-game-xiang-qi": "#9c6bb0", // plum
  "az-game-tic-tac-toe": "#5b9bd1", // sky
};
type LinkDef = { repo: RepoKey; path: string; fact: string };
// every path was verified to exist on the repo's `main` branch (HTTP 200).
const LINKS: LinkDef[] = [
  { repo: "llm-presentation", path: "README.md", fact: "This talk: “Open & Closed Loops — The Economics of the LLM OS”, built as one scrubbable video + website." },
  { repo: "llm-presentation", path: "docs/archive/20260611/llmos_5_minute_outline.md", fact: "Closed loop = self-improves without a human; open loop = a human steps in. Open it only where your judgment wins." },
  { repo: "llm-presentation", path: "AGENTS.md", fact: "Repo-level memory: shared context lets many agents work in parallel — if each wins with p=0.3, ten give 1−0.7¹⁰ ≈ 97%." },
  { repo: "llm-presentation", path: "web/src/engine/director3d.ts", fact: "Meta: the source of THIS mini-game — written with a coding agent, in this very repo." },
  { repo: "coding-agent-skills", path: "README.md", fact: "Universal, reusable skills you drop into any repo so coding agents share one playbook." },
  { repo: "coding-agent-skills", path: ".agents/skills/improving-context-retrieval-skills/SKILL.md", fact: "A closed loop in action: an LLM writes a skill that improves another skill, scored by metrics." },
  { repo: "coding-agent-skills", path: ".agents/skills/improving-vcs-skill/SKILL.md", fact: "Self-improving the version-control skill: measure, iterate, keep the better version." },
  { repo: "alpha-zero-game", path: "README.md", fact: "A Cookiecutter template that scaffolds a new AlphaZero game with its skills + docs baked in." },
  { repo: "alpha-zero-api", path: "README.md", fact: "The interface a game implements so AlphaZero can learn to play it — durable, agent-built context." },
  { repo: "alpha-zero-api", path: "src/include/alpha-zero-api/game.h", fact: "game.h: the C++ contract every AlphaZero game implements." },
  { repo: "az-game-xiang-qi", path: "README.md", fact: "Xiang Qi (Chinese chess) — implemented by Claude Opus 4.7 against the AlphaZero API." },
  { repo: "az-game-tic-tac-toe", path: "README.md", fact: "Tic-Tac-Toe — the minimal AlphaZero game: proof the API + agent loop works end-to-end." },
];
const linkUrl = (l: LinkDef): string => `https://github.com/${OWNER}/${l.repo}/blob/main/${l.path}`;
// a short file label; for generic names (README/SKILL/AGENTS) keep the parent folder so
// the several READMEs/SKILLs stay distinguishable.
const linkFile = (l: LinkDef): string => {
  const parts = l.path.split("/");
  const f = parts[parts.length - 1] ?? l.path;
  return parts.length > 1 && /^(README|SKILL|AGENTS|CLAUDE)\./i.test(f) ? `${parts[parts.length - 2]}/${f}` : f;
};

/* --- world metrics (GAME PIXELS — the low-res internal buffer) ------------- */
const GROUND_H = 24; // grassy stage band at the bottom
const STAND_H = 18; // director silhouette height (feet → top of lid)
const DUCK_H = 11; // ducked silhouette height
const PW = 13; // director body width
const TURTLE_W = 18,
  TURTLE_H = 13; // a corporate-employee turtle
const MEMO_W = 15,
  MEMO_H = 8; // a flying office memo (paper plane)
const TOKEN_R = 5; // collectible file-token pickup radius

/* --- physics (game-px / second) ------------------------------------------- */
const RUN_SPEED = 80; // muted scroll speed; ×(1 + 0.5·fun) once it gets fun
const GRAVITY = 900;
const JUMP_V = 270; // → apex ≈ 40px (clears the 13px turtles with room)
const FASTFALL = 700; // extra pull while K is held airborne
const STOMP_BOUNCE = 210; // hop after stomping a turtle
const AUTO_AFTER = 4.0; // seconds of no input before the attract-mode AI takes over
const JUMP_BUFFER = 0.13; // a press up to this long before landing still jumps
const MAX_LIVES = 3; // hits before the director keels over
const DEAD_AUTORESTART = 9; // seconds idle on the game-over screen before it self-restarts
const WIN_FILES = 5; // file tokens needed to win the run

/* --- pixel palette (warm + earthy, harmonised with the Paper theme) ------- */
const PAL = {
  cloud: "#fbf9f4",
  hillFar: "#d3c7c9", // dusty mauve ridge
  hillNear: "#b3b785", // muted sage ridge
  dirt: "#b27a4f",
  dirtDark: "#92603c",
  grass: "#8c9a52",
  grassDark: "#6f7e40",
  ink: "#2b2722", // outline / near-black warm
  slate: "#3a3530", // clapperboard body
  slateLt: "#55504a",
  cream: "#f4efe6", // face / belly / paper
  creamSh: "#d8d2c6",
  red: "#c25450", // accent — lid stripes, neckties
  shell: "#6f9b5e", // turtle shell
  shellDark: "#4f7a45",
  skin: "#d8b48a", // turtle head
  gold: "#e7b743",
  spot: "#ffe9b0", // spotlight / flash warm
} as const;

/* --- tiny math (kept local so this scene pulls in no three.js) ------------- */
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number): number => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
const phase = (t: number, a: number, b: number): number => smooth((t - a) / (b - a));
const damp = (cur: number, tgt: number, l: number, dt: number): number => cur + (tgt - cur) * (1 - Math.exp(-l * dt));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/* --- entity pools --------------------------------------------------------- */
type Turtle = { active: boolean; x: number; dead: number }; // dead 0..1 = stomp/slide-off
type Memo = { active: boolean; x: number };
type Token = { active: boolean; x: number; y: number; pop: number; link: number }; // link → LINKS[]

/* ---- controller ----------------------------------------------------------- */

export function mountDirector3D(container: HTMLElement, lang: Lang): { tick(t: number): void; dispose(): void } {
  const isZh = lang === "zh";
  const copy = {
    controls: isZh ? "游戏控制" : "Game controls",
    jump: isZh ? "跳跃:" : "Jump:",
    duck: isZh ? "下蹲:" : "Duck:",
    click: isZh ? "点击" : "Click",
    title: isZh ? "导演冲刺" : "Director's Dash",
    start: isZh ? "按 J 或 K 开始" : "Press J or K to start",
    jumpHint: isZh ? "跳跃" : "jump",
    duckHint: isZh ? "下蹲" : "duck",
    goal: isZh ? `收集 ${WIN_FILES} 份文档获胜` : `Collect ${WIN_FILES} docs to win`,
    collected: isZh ? "已收集" : "collected",
    toGo: isZh ? "还差" : "to go",
    context: isZh ? "开源文档" : "open-source context",
    gameOver: isZh ? "游戏结束" : "game over",
    restart: isZh ? "按 Enter 重新开始 · 链接已保存 ↗" : "press Enter to restart · your links are saved ↗",
    win: isZh ? "你赢了" : "you win",
    winFiles: isZh ? `已收集 ${WIN_FILES} 份开源文档` : `${WIN_FILES} open-source files collected`,
    reset: isZh ? "按 Enter 重置" : "press Enter to reset",
  } as const;
  const controls = document.createElement("div");
  controls.className = "dg-controls";
  controls.setAttribute("aria-label", "Director's Dash controls");
  controls.innerHTML = `<span class="dg-controls-title">${copy.controls}</span><span class="dg-action">${copy.jump}</span><b>${copy.click}</b><span>/</span><b>J</b><span class="dg-sep">·</span><span class="dg-action">${copy.duck}</span><b>K</b><span class="dg-progress"></span>`;
  const progressEl = controls.querySelector(".dg-progress");
  const startOverlay = document.createElement("div");
  startOverlay.className = "dg-start show";
  startOverlay.innerHTML = `<div class="dg-start-card"><span>${copy.title}</span><b>${copy.start}</b><i><kbd>J</kbd> ${copy.jumpHint} · <kbd>K</kbd> ${copy.duckHint}</i><strong>${copy.goal}</strong><em></em></div>`;
  const startProgressEl = startOverlay.querySelector("em");
  const playfield = document.createElement("div");
  playfield.className = "dg-playfield";
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.imageRendering = "pixelated";
  container.append(playfield);
  playfield.appendChild(canvas);
  const ctx0 = canvas.getContext("2d");
  if (!ctx0) {
    controls.remove();
    playfield.remove();
    return { tick() {}, dispose() {} };
  }
  const ctx = ctx0; // narrowed to non-null; the alias stays non-null inside the draw closures
  ctx.imageSmoothingEnabled = false;

  // a warm tint pulled from the theme so the accents track a future palette tweak
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || PAL.red;

  /* --- DOM HUD over the canvas: controls, lives, facts, collected links -- */
  const livesEl = document.createElement("div");
  livesEl.className = "dg-lives";
  const toast = document.createElement("div");
  toast.className = "dg-toast";
  const panel = document.createElement("div");
  panel.className = "dg-links";
  const linksHead = document.createElement("div");
  linksHead.className = "dg-links-h";
  linksHead.textContent = copy.context;
  const linksList = document.createElement("div");
  linksList.className = "dg-links-list";
  panel.append(linksHead, linksList);
  const restartEl = document.createElement("div");
  restartEl.className = "dg-restart";
  restartEl.innerHTML = `<b>${copy.gameOver}</b><span>${copy.restart}</span>`;
  const winEl = document.createElement("div");
  winEl.className = "dg-win";
  winEl.innerHTML = `<b>${copy.win}</b><span>${copy.winFiles}</span><i>${copy.reset}</i>`;
  playfield.append(controls, startOverlay, livesEl, toast, panel, restartEl, winEl);

  const collected = new Set<number>();
  let toastHideAt = 0;
  function progressText(): string {
    const got = Math.min(runFiles, WIN_FILES);
    const left = Math.max(0, WIN_FILES - got);
    return isZh ? `${copy.collected} ${got}/${WIN_FILES} · ${copy.toGo} ${left}` : `${got}/${WIN_FILES} ${copy.collected} · ${left} ${copy.toGo}`;
  }
  function renderProgress() {
    const text = progressText();
    if (progressEl) progressEl.textContent = text;
    if (startProgressEl) startProgressEl.textContent = text;
  }
  function collect(li: number) {
    if (won) return;
    score++;
    runFiles++;
    const l = LINKS[li];
    if (!l) return;
    // fact toast (transient, non-interactive so it never eats a jump-click)
    toast.innerHTML = `<span class="dg-dot" style="background:${REPO_COLOR[l.repo]}"></span><b>${l.repo}/${linkFile(l)}</b> — ${l.fact}`;
    toast.classList.add("show");
    toastHideAt = idle + 5;
    // persistent clickable link (deduped)
    if (collected.has(li)) return;
    collected.add(li);
    const a = document.createElement("a");
    a.href = linkUrl(l);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = `${l.repo}/${l.path} — ${l.fact}`;
    a.innerHTML = `<span class="dg-dot" style="background:${REPO_COLOR[l.repo]}"></span><span class="dg-name"><b>${linkFile(l)}</b><i>${l.repo}</i></span>`;
    linksList.append(a);
    linksHead.textContent = `${copy.context} · ${collected.size}`;
    panel.classList.add("has");
    renderProgress();
    if (runFiles >= WIN_FILES) triggerWin();
  }

  /* --- internal buffer + layout (recomputed on resize) ------------------ */
  let GW = 320,
    GH = 160; // game-pixel buffer size
  let groundY = GH - GROUND_H; // y of the stage surface (feet rest here)
  let playerX = 80;
  let spawnX = GW + 24;
  let despawnX = -32;
  let small = false;

  function layout() {
    const cw = Math.max(1, playfield.clientWidth);
    const ch = Math.max(1, playfield.clientHeight);
    small = cw < 560;
    // fix a chunky pixel size (~4 screen-px), clamp the play height so a short
    // hero panel still has room for sky + ground.
    const px = small ? 3 : 4;
    GH = Math.min(240, Math.max(118, Math.round(ch / px)));
    GW = Math.max(140, Math.round((GH * cw) / ch));
    canvas.width = GW;
    canvas.height = GH;
    ctx.imageSmoothingEnabled = false;
    groundY = GH - GROUND_H;
    playerX = Math.round(Math.min(GW * 0.4, Math.max(34, GW * 0.26)));
    spawnX = GW + 24;
    despawnX = -36;
  }
  const ro = new ResizeObserver(() => layout());
  ro.observe(playfield);
  layout();

  /* --- input: CLICK or J = jump, K = duck (Space stays free for the video) -- */
  const input = { jumpAt: -999, keyDuck: false, lastInput: -999 };
  let idle = 0; // wall-clock accumulator
  let gameStarted = false;
  const markInput = () => (input.lastInput = idle);
  const startGame = () => {
    if (gameStarted || dead || won) return;
    gameStarted = true;
    startOverlay.classList.remove("show");
    markInput();
  };
  const resetToStart = () => {
    gameStarted = false;
    input.jumpAt = -999;
    input.keyDuck = false;
    input.lastInput = -999;
    startOverlay.classList.add("show");
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!gameStarted || dead || won) return;
    input.jumpAt = idle;
    markInput();
  };
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Enter" && (dead || won)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      restart();
      return;
    }
    if (dead) return; // no jump/duck while dead
    if (e.code === "KeyJ") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      startGame();
      input.jumpAt = idle;
      markInput();
    } else if (e.code === "KeyK") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      startGame();
      input.keyDuck = true;
      markInput();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code !== "KeyJ" && e.code !== "KeyK") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.code === "KeyK") input.keyDuck = false;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("click", onClick);
  startOverlay.addEventListener("pointerdown", swallow);
  startOverlay.addEventListener("click", swallow);
  winEl.addEventListener("pointerdown", swallow);
  winEl.addEventListener("click", swallow);
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });

  /* --- game state ------------------------------------------------------- */
  const N_TURTLES = 6,
    N_MEMOS = 4,
    N_TOKENS = 8;
  const turtles: Turtle[] = Array.from({ length: N_TURTLES }, () => ({ active: false, x: 0, dead: 0 }));
  const memos: Memo[] = Array.from({ length: N_MEMOS }, () => ({ active: false, x: 0 }));
  const tokens: Token[] = Array.from({ length: N_TOKENS }, () => ({ active: false, x: 0, y: 0, pop: 0, link: 0 }));
  const ai = { jump: false, duck: false };

  let jy = 0; // height above the ground (up = +)
  let vy = 0;
  let grounded = true;
  let ducking = false;
  let runPhase = 0; // accumulates with scroll → leg cycle
  let stretch = 1; // squash/stretch (Celeste-style)
  let blink = 0;
  let nextBlink = rand(1.5, 4);
  let scroll = 0; // world scroll (px) for ground/parallax
  let spawnCd = 0.7;
  let tokenCd = 1.1;
  let linkCursor = 0; // spawn order through LINKS (prefers uncollected)
  let score = 0;
  let runFiles = 0;
  renderProgress();
  let stumble = 0; // collide/RETAKE wobble + slow-mo, decays
  let invuln = 0;
  let flashAmt = 0; // wall-clock flash (stomp / collide)
  let started = false;
  let last = 0;
  let lives = MAX_LIVES;
  let dead = false;
  let deathFall = 0; // 0..1 keel-over animation
  let won = false;
  let winCelebration = 0;
  const bulbLit = new Float32Array(16);

  function spawnObstacle(fun: number) {
    let placed = false;
    if (Math.random() < 0.25 && memos.some((m) => !m.active)) {
      const m = memos.find((o) => !o.active);
      if (m) {
        m.active = true;
        m.x = spawnX;
        placed = true;
      }
    } else {
      const tu = turtles.find((o) => !o.active);
      if (tu) {
        tu.active = true;
        tu.x = spawnX;
        tu.dead = 0;
        placed = true;
      }
    }
    spawnCd = placed ? rand(1.5, 2.6) / (1 + 0.5 * fun) : 0.3;
  }
  function nextLinkIndex(): number {
    // hand out an uncollected link first (in order); once all are gathered, cycle
    for (let k = 0; k < LINKS.length; k++) {
      const i = (linkCursor + k) % LINKS.length;
      if (!collected.has(i)) {
        linkCursor = (i + 1) % LINKS.length;
        return i;
      }
    }
    const i = linkCursor % LINKS.length;
    linkCursor = (linkCursor + 1) % LINKS.length;
    return i;
  }
  function spawnToken() {
    const tk = tokens.find((o) => !o.active);
    if (!tk) {
      tokenCd = 0.3;
      return;
    }
    tk.active = true;
    tk.x = spawnX + rand(-6, 16);
    tk.y = groundY - (Math.random() < 0.45 ? rand(26, 38) : rand(9, 15)); // apex-height or run-height
    tk.pop = 0;
    tk.link = nextLinkIndex();
    tokenCd = rand(1.3, 2.4);
  }

  function renderLives() {
    let s = "";
    for (let i = 0; i < MAX_LIVES; i++) s += i < lives ? "<span>♥</span>" : '<span class="x">♥</span>';
    livesEl.innerHTML = s;
  }
  renderLives();
  function clearLiveField() {
    for (const tu of turtles) tu.active = false;
    for (const m of memos) m.active = false;
    for (const tk of tokens) tk.active = false;
  }
  function triggerWin() {
    if (won) return;
    won = true;
    gameStarted = false;
    input.jumpAt = -999;
    input.keyDuck = false;
    winCelebration = 0.001;
    flashAmt = 0.9;
    toast.classList.remove("show");
    toastHideAt = 0;
    clearLiveField();
    startOverlay.classList.remove("show");
    playfield.classList.add("is-won");
    renderProgress();
    winEl.classList.add("show");
  }
  function loseLife() {
    if (dead || won) return;
    lives--;
    renderLives();
    flashAmt = 0.7;
    if (lives <= 0) {
      dead = true;
      deathFall = 0.001;
      restartEl.classList.add("show");
    } else {
      stumble = 1;
      invuln = 1.4; // a brief mercy-invulnerability after a hit
    }
  }
  function restart() {
    lives = MAX_LIVES;
    renderLives();
    dead = false;
    deathFall = 0;
    won = false;
    winCelebration = 0;
    runFiles = 0;
    restartEl.classList.remove("show");
    winEl.classList.remove("show");
    playfield.classList.remove("is-won");
    clearLiveField(); // clear the live field; the COLLECTED links panel stays
    jy = 0;
    vy = 0;
    grounded = true;
    ducking = false;
    stumble = 0;
    invuln = 1;
    flashAmt = 0;
    spawnCd = 0.8;
    tokenCd = 1;
    renderProgress();
    resetToStart();
  }

  // attract-mode AI: jump turtles, duck memos (so both controls are shown off),
  // and hop for a high token now and then. Writes the shared `ai` intent.
  function autoControl(speed: number) {
    const tApex = JUMP_V / GRAVITY;
    let jump = false;
    let duck = false;
    for (const tu of turtles) {
      if (!tu.active || tu.dead > 0 || tu.x < playerX) continue;
      const reach = (tu.x - playerX) / speed;
      if (reach > 0 && reach <= tApex * 1.04 && grounded) jump = true;
    }
    for (const m of memos) {
      if (!m.active) continue;
      if (m.x > playerX - TURTLE_W && m.x < playerX + TURTLE_W) duck = true; // duck while it passes overhead
    }
    if (!jump && grounded) {
      for (const tk of tokens) {
        if (!tk.active || tk.pop > 0) continue;
        const reach = (tk.x - playerX) / speed;
        if (groundY - tk.y > 22 && reach > tApex * 0.6 && reach <= tApex * 1.1) jump = true;
      }
    }
    ai.jump = jump;
    ai.duck = duck;
  }

  /* --- draw helpers (all in game-pixels; integer coords = crisp) -------- */
  const R = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  };
  const wash = (a: number, c: string) => {
    if (a <= 0.002) return;
    ctx.globalAlpha = clamp01(a);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, GW, GH);
    ctx.globalAlpha = 1;
  };

  // a parallax ridge: chunky 4px columns, height from two sines + the scroll offset
  function drawRidge(color: string, par: number, base: number, amp: number, freq: number, ph: number) {
    const off = scroll * par;
    for (let x = 0; x < GW; x += 4) {
      const wx = x + off;
      const h = base + Math.sin(wx * freq + ph) * amp + Math.sin(wx * freq * 0.43 + ph * 2) * amp * 0.5;
      const top = Math.round(groundY - h);
      R(x, top, 4, groundY - top, color);
    }
  }

  function drawClouds() {
    const off = scroll * 0.08;
    for (let i = 0; i < (small ? 2 : 3); i++) {
      const cx = ((i * 140 - off) % (GW + 80) + GW + 80) % (GW + 80) - 40;
      const cy = 12 + ((i * 37) % Math.max(8, Math.round(GH * 0.28)));
      R(cx, cy, 18, 5, PAL.cloud);
      R(cx + 5, cy - 3, 12, 4, PAL.cloud);
      R(cx + 3, cy + 5, 20, 3, PAL.cloud);
    }
  }

  function drawGround() {
    R(0, groundY, GW, GROUND_H, PAL.dirt); // dirt body
    R(0, groundY, GW, 3, PAL.grass); // grass top
    R(0, groundY + 3, GW, 1, PAL.grassDark);
    // tile seams + grass tufts, scrolling
    const o = Math.round(scroll) % 16;
    for (let x = -o; x < GW; x += 16) {
      R(x, groundY + 4, 1, GROUND_H - 4, PAL.dirtDark);
      R(x + 7, groundY - 1, 2, 1, PAL.grassDark); // a tuft
    }
  }

  function drawDirector() {
    if (dead) {
      drawDeadDirector();
      return;
    }
    const h = ducking ? DUCK_H : STAND_H;
    const sh = Math.round(h * stretch); // squash/stretch
    const feet = groundY - jy;
    const bx = playerX - ((ducking ? PW + 2 : PW) >> 1);
    const bw = ducking ? PW + 2 : PW;
    const legH = 3;
    const bodyBot = feet - legH;
    const bodyH = sh - legH - 4; // leave 4px for the lid
    const bodyTop = bodyBot - bodyH;
    // legs (alternate while grounded; tucked in the air)
    const swing = grounded ? Math.round(Math.sin(runPhase) * 2) : 0;
    R(bx + 1, bodyBot, 3, legH + (grounded ? 0 : -1), PAL.slate);
    R(bx + bw - 4, bodyBot, 3, legH + (grounded ? 0 : -1), PAL.slate);
    if (grounded) {
      R(bx + 1, bodyBot + legH - 1, 3 + swing, 1, PAL.ink);
      R(bx + bw - 4 - (swing < 0 ? -swing : 0), bodyBot + legH - 1, 3, 1, PAL.ink);
    }
    // body slate (outline + fill)
    R(bx - 1, bodyTop - 1, bw + 2, bodyH + 2, PAL.ink);
    R(bx, bodyTop, bw, bodyH, PAL.slate);
    R(bx + 1, bodyTop + 1, bw - 2, 1, PAL.slateLt); // top highlight
    // face
    const ey = bodyTop + Math.max(2, Math.round(bodyH * 0.32));
    if (blink > 0.5) {
      R(bx + 3, ey + 1, 2, 1, PAL.cream);
      R(bx + bw - 5, ey + 1, 2, 1, PAL.cream);
    } else {
      R(bx + 3, ey, 2, 2, PAL.cream);
      R(bx + bw - 5, ey, 2, 2, PAL.cream);
    }
    if (!ducking) {
      const my = bodyTop + bodyH - 3;
      R(bx + 4, my, 1, 1, PAL.cream);
      R(bx + 5, my + 1, bw - 10, 1, PAL.cream);
      R(bx + bw - 5, my, 1, 1, PAL.cream);
    }
    // hinged clapper lid on top — diagonal stripes; "claps" shut (drops) on takeoff
    const clap = grounded ? 0 : Math.round((1 - Math.min(1, jy / 14)) * 2);
    const ly = bodyTop - 4 + clap;
    R(bx - 1, ly - 1, bw + 2, 5, PAL.ink);
    for (let i = 0; i < bw; i++) {
      const stripe = ((i + (ly & 1)) >> 1) & 1;
      R(bx + i, ly, 1, 3, stripe ? accent : PAL.cream);
    }
  }

  // the cute "X X" eye for the keeled-over director (a 3×3 cross)
  function drawX(x: number, y: number) {
    R(x, y, 1, 1, PAL.cream);
    R(x + 2, y, 1, 1, PAL.cream);
    R(x + 1, y + 1, 1, 1, PAL.cream);
    R(x, y + 2, 1, 1, PAL.cream);
    R(x + 2, y + 2, 1, 1, PAL.cream);
  }
  function drawDeadDirector() {
    const settle = smooth(deathFall);
    const bw2 = PW + 6;
    const bh2 = 8;
    const bx2 = playerX - (bw2 >> 1);
    const oy = groundY - bh2 - Math.round((1 - settle) * 9); // keels over onto the ground
    // little legs sticking up (flat on its back)
    R(bx2 + 3, oy - 3, 2, 3, PAL.slate);
    R(bx2 + bw2 - 5, oy - 3, 2, 3, PAL.slate);
    // body slate (outline + fill)
    R(bx2 - 1, oy - 1, bw2 + 2, bh2 + 2, PAL.ink);
    R(bx2, oy, bw2, bh2, PAL.slate);
    R(bx2 + 1, oy + 1, bw2 - 2, 1, PAL.slateLt);
    // X X eyes + a dazed little mouth
    drawX(bx2 + 3, oy + 2);
    drawX(bx2 + bw2 - 7, oy + 2);
    R(bx2 + (bw2 >> 1) - 1, oy + bh2 - 2, 3, 1, PAL.cream);
    // the clapper lid fallen flat beside it
    for (let i = 0; i < 6; i++) R(bx2 + bw2 + 2 + i, groundY - 2, 1, 2, i & 1 ? accent : PAL.cream);
  }

  function drawTurtle(tu: Turtle, fun: number) {
    const x = Math.round(tu.x);
    const baseY = groundY;
    if (tu.dead > 0) {
      // stomped: shell squashes flat and slides off
      const k = smooth(tu.dead);
      R(x - 8, baseY - 3 - Math.round((1 - k) * 6), 16, 3 + Math.round((1 - k) * 4), PAL.shellDark);
      return;
    }
    const walk = (Math.floor(idle * 6) + (x >> 3)) & 1; // foot shuffle
    // feet
    R(x - 6, baseY - 2, 3, 2, PAL.shellDark);
    R(x + 3, baseY - 2, 3, 2, PAL.shellDark);
    if (walk) {
      R(x - 6, baseY, 3, 1, PAL.ink);
    } else {
      R(x + 3, baseY, 3, 1, PAL.ink);
    }
    // shell (faces left, toward the approaching director)
    R(x - 8, baseY - TURTLE_H, 16, TURTLE_H - 2, PAL.ink); // outline
    R(x - 7, baseY - TURTLE_H + 1, 14, TURTLE_H - 3, PAL.shell);
    R(x - 5, baseY - TURTLE_H + 1, 10, 1, PAL.shell); // round the top
    R(x - 7, baseY - 4, 14, 1, PAL.shellDark); // rim
    R(x - 3, baseY - TURTLE_H + 3, 7, 1, PAL.shellDark); // shell segments
    R(x - 2, baseY - TURTLE_H + 6, 5, 1, PAL.shellDark);
    // head poking out the front-left, with an eye
    R(x - 12, baseY - 9, 5, 6, PAL.ink);
    R(x - 11, baseY - 8, 4, 4, PAL.skin);
    R(x - 11, baseY - 7, 1, 1, PAL.ink); // eye
    // the corporate necktie — the gentle office gag
    R(x - 9, baseY - 4, 1, 2, accent);
    R(x - 10, baseY - 5, 3, 1, accent);
    // a faint warm rim once it gets fun
    if (fun > 0.4) R(x - 7, baseY - TURTLE_H + 1, 2, TURTLE_H - 3, PAL.shellDark);
  }

  function drawMemo(m: Memo) {
    const x = Math.round(m.x);
    const y = Math.round(groundY - (DUCK_H + 2) - MEMO_H + Math.sin(idle * 5 + x) * 1.5);
    // a little paper plane (office memo)
    R(x - 1, y - 1, MEMO_W + 2, MEMO_H + 2, PAL.ink); // outline box (cheap)
    R(x, y, MEMO_W, MEMO_H, PAL.cream);
    R(x, y + Math.round(MEMO_H / 2), 6, 1, PAL.creamSh); // fold
    R(x, y + Math.round(MEMO_H / 2), 1, MEMO_H >> 1, PAL.creamSh);
    R(x + MEMO_W - 4, y + 1, 1, MEMO_H - 2, PAL.creamSh);
  }

  // an open-source file token — a little document, header bar in its repo colour
  function drawToken(tk: Token, fun: number) {
    const k = tk.pop > 0 ? 1 - smooth(tk.pop) : 1;
    if (k <= 0.05) return;
    const l = LINKS[tk.link];
    const col = l ? REPO_COLOR[l.repo] : PAL.red;
    const s = tk.pop > 0 ? 1 + smooth(tk.pop) : 1;
    const w = Math.round(9 * s),
      ph = Math.round(11 * s);
    const px = Math.round(tk.x) - (w >> 1),
      py = Math.round(tk.y) - (ph >> 1);
    ctx.globalAlpha = clamp01(k);
    R(px - 1, py - 1, w + 2, ph + 2, PAL.ink); // outline
    R(px, py, w, ph, PAL.cream); // page
    R(px, py, w, 3, col); // repo-coloured header bar
    R(px + 1, py + 5, w - 3, 1, PAL.creamSh); // text lines
    R(px + 1, py + 7, w - 2, 1, PAL.creamSh);
    R(px + 1, py + 9, w - 4, 1, PAL.creamSh);
    R(px + w - 3, py, 3, 3, PAL.creamSh); // folded corner
    if (fun > 0.5 || tk.pop > 0) {
      R(px + w, py - 1, 1, 1, PAL.gold); // a tiny glint when it's fun / on pickup
      R(px - 1, py + ph, 1, 1, PAL.gold);
    }
    ctx.globalAlpha = 1;
  }

  function drawMarquee(fun: number, dt: number) {
    const lit = Math.min(runFiles, WIN_FILES);
    const span = Math.min(GW - 24, small ? 120 : 160);
    const x0 = Math.round((GW - span) / 2);
    const y = 6;
    for (let i = 0; i < WIN_FILES; i++) {
      const want = i < lit ? 0.72 + 0.28 * fun : 0.0;
      bulbLit[i] = damp(bulbLit[i] ?? 0, want, 8, dt);
      const on = bulbLit[i] ?? 0;
      const bx = Math.round(x0 + (span * i) / (WIN_FILES - 1));
      R(bx - 2, y - 2, 6, 6, PAL.ink);
      R(bx - 1, y - 1, 4, 4, on > 0.5 ? PAL.gold : PAL.creamSh);
      if (on > 0.6) R(bx - 1, y - 1, 4, 1, PAL.cream);
    }
  }

  function drawSpotlight(fun: number) {
    if (fun < 0.02) return;
    const apexX = playerX;
    const baseY = groundY - jy + 2;
    ctx.globalAlpha = clamp01(fun * 0.16);
    ctx.fillStyle = PAL.spot;
    ctx.beginPath();
    ctx.moveTo(apexX - 4, 0);
    ctx.lineTo(apexX + 4, 0);
    ctx.lineTo(apexX + 12, baseY);
    ctx.lineTo(apexX - 12, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawWinCelebration() {
    if (winCelebration <= 0) return;
    const count = small ? 28 : 46;
    const fall = winCelebration * 56;
    for (let i = 0; i < count; i++) {
      const x = Math.round(((i * 47 + Math.sin(winCelebration * 2.4 + i) * 18) % (GW + 24)) - 12);
      const y = Math.round(((fall + i * 17) % (GH + 34)) - 24);
      const w = i % 3 === 0 ? 4 : 2;
      const h = i % 2 === 0 ? 2 : 4;
      const color = i % 4 === 0 ? PAL.gold : i % 4 === 1 ? PAL.red : i % 4 === 2 ? PAL.cream : PAL.grass;
      R(x, y, w, h, color);
    }
  }

  let disposed = false;

  function tick(t: number) {
    if (disposed) return;
    const now = performance.now() / 1000;
    let dt = last ? now - last : 0;
    last = now;
    if (dt > 0.05) dt = 0.05;
    idle += dt;

    /* --- story beats (pure functions of the playhead) -------------------- */
    const intro = smooth(phase(t, BASE_A, BASE_B));
    const fun = smooth(phase(t, FUN_A, FUN_B));
    const funBurst = phase(t, FUN_A, FUN_B);
    const retake = phase(t, RETAKE_A, RETAKE_B);
    const retakePulse = Math.sin(clamp01(retake) * Math.PI);
    started = intro > 0.05; // the live loop runs only while the scene is on (reverses on scrub)

    /* --- choose control + advance the live game -------------------------- */
    const manual = gameStarted && idle - input.lastInput < AUTO_AFTER;
    if (!manual) stumble = 0; // the AI never inherits a manual crash's slow-mo
    const slowMo = 1 - 0.6 * smooth(stumble);
    const speed = RUN_SPEED * (1 + 0.5 * fun) * slowMo;

    if (started && gameStarted && !dead && !won) {
      let wantJump: boolean;
      let wantDuck: boolean;
      if (manual) {
        wantJump = idle - input.jumpAt <= JUMP_BUFFER;
        wantDuck = input.keyDuck;
      } else {
        autoControl(speed);
        wantJump = ai.jump;
        wantDuck = ai.duck;
      }

      // jump / gravity / fast-fall
      if (grounded && wantJump) {
        vy = JUMP_V;
        grounded = false;
        stretch = 1.18;
        if (manual) input.jumpAt = -999;
      }
      if (!grounded) {
        vy -= (GRAVITY + (wantDuck ? FASTFALL : 0)) * dt;
        jy += vy * dt;
        if (jy <= 0) {
          jy = 0;
          vy = 0;
          grounded = true;
          stretch = 0.82; // squash on landing
        }
      }
      ducking = grounded && wantDuck;
      stretch = damp(stretch, 1, 12, dt);

      // scroll + run cycle
      const dx = speed * dt;
      scroll += dx;
      runPhase += dx * 0.5;
      for (const tu of turtles) if (tu.active) tu.x -= dx;
      for (const m of memos) if (m.active) m.x -= dx;
      for (const tk of tokens) if (tk.active) tk.x -= dx;

      // spawns
      spawnCd -= dt;
      if (spawnCd <= 0) spawnObstacle(fun);
      tokenCd -= dt;
      if (tokenCd <= 0) spawnToken();

      // recycle + stomp animation
      for (const tu of turtles) {
        if (!tu.active) continue;
        if (tu.dead > 0) {
          tu.dead += dt * 2.2;
          if (tu.dead >= 1) tu.active = false;
        } else if (tu.x < despawnX) tu.active = false;
      }
      for (const m of memos) if (m.active && m.x < despawnX) m.active = false;

      // collisions — a fatal hit costs a life (at most one per frame; AI never hits)
      const feetJy = jy;
      const headH = ducking ? DUCK_H : STAND_H;
      if (manual && invuln <= 0 && !dead) {
        let hit = false;
        for (const tu of turtles) {
          if (!tu.active || tu.dead > 0) continue;
          if (Math.abs(tu.x - playerX) > (TURTLE_W + PW) / 2) continue;
          if (vy < 0 && feetJy > TURTLE_H - 5) {
            // descending onto the shell → a Mario-style stomp (bonus + bounce, no life lost)
            tu.dead = 0.001;
            vy = STOMP_BOUNCE;
            grounded = false;
            score++;
            flashAmt = Math.max(flashAmt, 0.12);
          } else if (feetJy < TURTLE_H - 3) {
            tu.active = false;
            loseLife();
            hit = true;
            break;
          }
        }
        if (!hit && !dead) {
          for (const m of memos) {
            if (!m.active) continue;
            if (Math.abs(m.x - playerX) > (MEMO_W + PW) / 2) continue;
            // memo sits just above duck height: standing head hits it, ducking clears, jump clears
            if (feetJy + headH > DUCK_H + 2 && feetJy < DUCK_H + 2 + MEMO_H) {
              m.active = false;
              loseLife();
              break;
            }
          }
        }
      }
      // file-token pickups (count in manual AND auto so the attract demo gathers links)
      const cy = groundY - feetJy - headH / 2;
      for (const tk of tokens) {
        if (!tk.active) continue;
        if (tk.pop > 0) {
          tk.pop += dt * 3;
          if (tk.pop >= 1) tk.active = false;
          continue;
        }
        if (tk.x < despawnX) {
          tk.active = false;
          continue;
        }
        if (Math.abs(tk.x - playerX) < TOKEN_R + 6 && Math.abs(tk.y - cy) < 9) {
          tk.pop = 0.001;
          collect(tk.link);
        }
      }
    }

    // decays + the scripted RETAKE flash (rides the playhead)
    stumble = Math.max(0, stumble - dt * 1.4);
    invuln = Math.max(0, invuln - dt);
    flashAmt = Math.max(0, flashAmt - dt * 1.8);
    nextBlink -= dt;
    if (nextBlink <= 0) {
      blink = 1;
      nextBlink = rand(2, 5);
    }
    blink = Math.max(0, blink - dt * 7);
    if (toastHideAt > 0 && idle > toastHideAt) {
      toast.classList.remove("show");
      toastHideAt = 0;
    }
    if (dead) {
      deathFall = Math.min(1, deathFall + dt * 3);
      if (idle - input.lastInput > DEAD_AUTORESTART) restart(); // recover the attract loop if abandoned
    }
    if (won) winCelebration += dt;

    /* --- draw (back → front) --------------------------------------------- */
    ctx.clearRect(0, 0, GW, GH); // transparent sky → the paper page shows through
    drawClouds();
    drawRidge(PAL.hillFar, 0.12, GH * 0.34, GH * 0.12, 0.018, 0);
    drawRidge(PAL.hillNear, 0.28, GH * 0.22, GH * 0.1, 0.03, 2.2);
    drawGround();
    drawSpotlight(fun);
    for (const tk of tokens) if (tk.active) drawToken(tk, fun);
    for (const m of memos) if (m.active) drawMemo(m);
    for (const tu of turtles) if (tu.active) drawTurtle(tu, fun);
    drawDirector();
    drawMarquee(fun, dt);
    // muted corporate → vivid Hollywood: a cream wash that the "fun" beat lifts
    wash((1 - fun) * 0.4, PAL.cream);
    // warm flashes (no particles): the fun crest, the RETAKE gag, a stomp/hit
    wash(clamp01(funBurst * (1 - funBurst) * 0.5 + retakePulse * 0.22 + flashAmt * 0.5), PAL.spot);
    if (won) {
      wash(0.12 + 0.08 * Math.sin(winCelebration * 7) ** 2, PAL.spot);
      drawWinCelebration();
    }
    // game over: a gentle dim behind the restart prompt
    if (dead) wash(0.26 * smooth(deathFall), "#241f1b");
    // intro fade-in (and fade the whole thing out on a backward scrub)
    wash(1 - intro, PAL.cream);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("click", onClick);
    startOverlay.removeEventListener("pointerdown", swallow);
    startOverlay.removeEventListener("click", swallow);
    winEl.removeEventListener("pointerdown", swallow);
    winEl.removeEventListener("click", swallow);
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("keyup", onKeyUp, { capture: true });
    livesEl.remove();
    controls.remove();
    startOverlay.remove();
    toast.remove();
    panel.remove();
    restartEl.remove();
    winEl.remove();
    playfield.remove();
  }

  return { tick, dispose };
}
