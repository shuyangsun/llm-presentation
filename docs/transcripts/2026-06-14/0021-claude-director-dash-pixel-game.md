<!-- markdownlint-disable MD013 MD024 -->

# Director scene → "Director's Dash" pixel-art platformer

- **Date:** 2026-06-14
- **Repo:** llm-presentation (jj workspace `claude-director-runner-game`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
- **Summary:** Replaced the moody 3D "Hollywood spotlight" director scene (`web/src/engine/director3d.ts`) with a playable, fun runner. It evolved over four rounds into a traditional pixel-art platformer (Celeste-flavoured, no WebGL/glass/particles): a clapperboard director hops necktie-wearing "corporate employee" turtles, ducks office-memo paper planes, and collects real open-source GitHub file links (with facts about this talk) into a clickable panel; plus an on-screen J/K controls hint and a 3-lives death mechanic with cute "X X" eyes and Enter-to-restart.

> Session started with `/effort` (ultracode) and `/model` (Opus 4.8, 1M context). Implementation was isolated in a jj workspace per the `vcs` skill; code followed `coding-style` (TypeScript strict). Verified throughout with `tsc --noEmit`, `vite build`, and headless/puppeteer-core screenshots against the dev preview (`preview.html?scene=director`).

---

## User

Redesign @web/src/engine/director3d.ts. I don't like the solid background it currently has, also, there is nothing fun about it. Although the animation has hints about hollywood and director, there is no element of "fun". Change it to a 2D platformer game like Chrome's dinasour game, but very related to what we are talking about. Keep the hollywood and directory element in it. Make sure you don't go overboard with effects and particles, so the game is playable and fun with good performance. Before you start implementing, give me a few options on the game, I'll pick one.

## Assistant

Gathered context before proposing options:

- Read `web/src/engine/director3d.ts` (the existing 3D scene: warm-dark vignette + steerable volumetric spotlight + clapperboard + spark burst) and the shared `web/src/engine/scene3d.ts` scaffold (`createStage`, `palette`, `trackPointer`, `makeClock`, `phase`, `damp`).
- Read `web/src/engine/scenes.ts` and `web/src/data/en.vtt` to pin the scene's narrative window (t ≈ 263 → 298) and the spoken beats: "a Hollywood director / tell a story" (263), "make it fun … number one non-negotiable" (≈278.5), "if it's not fun, I'll ask you to redo it" (≈282.5).
- Confirmed the lifecycle contract via `web/src/preview.ts` (`__tick(t)` per frame) and that there was no dark background pinned in CSS (only the WebGL vignette).

Presented three game concepts via an interactive question, each with an ASCII mock-up, plus the shared design rules I'd hold to (Paper palette, no solid background, attract-mode auto-play that hands off on input, **narrative pinned to the playhead so scrubbing rewinds it**, a handful of quads, minimal particles):

1. **Director's Dash (runner)** — faithful Chrome-dino: a clapperboard mascot auto-runs, tap/space to jump, hold to duck; dodge grey corporate slide-decks + boom mics, grab stars that light a marquee; "make it fun" ignites a spotlight + speeds up. (Recommended.)
2. **Keep the Star Lit (spotlight)** — steer the spotlight to keep an auto-running actor lit.
3. **Reel Flap (one-button)** — Flappy-style film reel threading gaps between corporate slide-stacks.

## User

> _(Selected **"Director's Dash (runner)"** from the options.)_

## Assistant

Built the runner as a Three.js head-on 2D scene on the shared scaffold:

- Implemented `web/src/engine/director3d.ts`: a flat 2D side-scroller — clapperboard mascot (face + clapping lid + legs), scrolling film-strip ground, instanced grey "corporate slide-deck" obstacles (jump), boom-mic obstacles (duck or jump), instanced stars → marquee bulbs, a spotlight shaft + pool, parallax studio set-flats, and a reversible confetti burst. Story beats (`intro` 263.1, `fun` 278.5, `retake` 282.6) are pure functions of `t`; the game loop runs on the idle clock. An attract-mode AI clears everything until a viewer taps/clicks; mouse steers the spotlight.
- Caught and fixed two of my own bugs pre-review: the boom-mic's drawn head didn't line up with its collision box (extreme-aspect quad distortion), and jump height vs. tallest-slide clearance was marginal.
- `tsc --noEmit` ✓ and `vite build` ✓ (lazy-loaded chunk).
- Ran a 4-dimension adversarial review **workflow** (GLSL/runtime, game-logic, lifecycle/reversibility, perf/visual; each finding independently verified). Applied all 5 confirmed fixes: the attract-AI-never-fails guarantee (clear slow-mo when auto takes over), spawn-pool exhaustion (retry + larger pools), the `started` reversibility latch (pure `intro > 0.05`), buffered jump + a clean AI-vs-human input split (which also fixed a duck-leak the review missed), and marquee crowding on phones; plus idle-draw skipping.
- Verified rendering with headless Chrome screenshots (muted/fun/retake/mobile). Discovered headless **virtual-time freezes `makeClock`'s wall-clock loop** (so the game didn't animate and frames sometimes blanked from a load race); used **puppeteer-core** against the system Chrome with a real delay to exercise the live loop — confirmed obstacles spawn/scroll, the mascot runs, the "make it fun" burst fires, and there were **0 runtime errors**. Saved a memory note on this verification technique.

## User

Good start, make the following changes:

1. Don't use space to jump, use mouse click of J key to jump, K key to squad down. Space is used to play / pause the video.
2. Instead of corporate documents, make it coorporate employees, that are little turtles in Super Mario. Don't make it disrespectful, just make it fun and poke a bit at coorporate culture.
3. You don't have to use the same design style like before, for this one, just make it look like a traditional 2D platformer game. No need to use the glass look or particles. I want it look like pixel-art video game like Celeste.

## Assistant

Rebuilt the scene from scratch as a **2D-canvas pixel-art platformer** (left WebGL/Three.js behind entirely):

- New `web/src/engine/director3d.ts`: a low-resolution internal canvas buffer upscaled nearest-neighbour (`image-rendering: pixelated`) so every edge is a crisp chunky pixel. Everything drawn with `fillRect` in game-pixels on a transparent (paper-cream) sky.
- **Controls:** click or **J** = jump, **K** = duck — Space left free for the video. Keyboard gated on hover so it never hijacks the page.
- **Obstacles:** the corporate-employee **turtles** (green shell, tan head, little red necktie, shuffling feet) — Mario-koopa style, with a **stomp-for-a-bonus**; plus flying office **memos** (paper planes) to duck/jump.
- Kept the Hollywood layer (clapperboard director, stars → marquee, fun-beat spotlight) and the playhead-pinned beats; "make it fun" now lifts a desaturation wash (muted corporate → vivid) instead of a particle burst.
- Updated `web/src/engine/scenes.ts` to drop the WebGL gate (the 2D game needs no WebGL; only reduced-motion falls back to the static clapper) and `web/src/style.css` (stale comment).
- Bundle dropped from ~20 kB to **~7.8 kB** (no Three.js). `tsc` ✓, `vite build` ✓. Verified with real-time puppeteer captures (desktop + mobile): the director runs, turtles/memos/stars spawn, the fun beat saturates the world — **0 runtime errors**.

## User

Love the new art style! Make the control instruction (J/K) visible on the screen if that's not already done. Add elements of my projects into this game. Use /retrieving-context skill if you need more context. I don't want it to be just any game, add interactive elements into this game, so the user learns random facts about this project (llm-presentation), collect important open-source markdown or code file links along the way, which they can later then click into the GitHub URL. Open source repos are llm-presentation, coding-agent-skills, alpha-zero-game, alpha-zero-api, az-game-xiang-qi, az-game-tic-tac-toe. Design the game to be explicit about this presentation, more context in @docs/archive/20260611/brain_dump_20260611_distilled.txt.

## Assistant

Gathered project context and made the game explicitly about the talk:

- Read `docs/archive/20260611/brain_dump_20260611_distilled.txt` (the thesis: LLMs as an OS layer; open vs. closed loops; comparative advantage; T-shaped orgs; the parallel-agent math `1 − (1 − p)^n`; the recursive meta-demo).
- Confirmed via `gh` that **all six repos are public** (owner `shuyangsun`, default branch `main`), pulled their file trees, and **verified 12 real markdown/code paths return HTTP 200** before using them as links (READMEs, the 5-min outline, `AGENTS.md`, the self-improving-skill `SKILL.md`s, `game.h`, and `web/src/engine/director3d.ts` itself).
- Added a DOM HUD over the pixel canvas:
  - an always-visible **controls hint** (keycap `J`/`K`, top-left);
  - collectible repo/file **tokens** in the world (little repo-coloured documents);
  - a **fact toast** on pickup teaching something about the talk (drawn from the brain dump);
  - a persistent, clickable **"open-source context" links panel** (top-right) of real `github.com/shuyangsun/<repo>/blob/main/<path>` URLs, de-duplicated.
- Fixed two layout nits found in testing (toast covered the hint on mobile → hint to top-left; two-line file+repo labels so the several READMEs stay distinct) and added a narrow-screen CSS rule.
- Updated the repo-visibility memory (all six now public + OK to link). Verified the collected `<a href>` values are correct GitHub URLs; **0 runtime errors**.

## User

Add a death mechanism with 3 lives. Once all 3 lives are done, the character should be dead on the ground with a cute "X X" on its eyes, but users should still be able to click on the docs / code collected, or hit Enter to restart.

## Assistant

Added the lives + death mechanic to `web/src/engine/director3d.ts` and `web/src/style.css`:

- **3 lives**, shown as a hearts HUD (top-left, above the controls hint) that empties as you take hits. A fatal hit is a side-on turtle or a memo to the head (at most one life lost per frame); **stomping** a turtle stays a bonus. Lives are only lost in manual play, so the **attract-mode AI never dies**.
- On the **third hit** the director **keels over on the ground with cute cream "X X" eyes**, a dazed mouth, legs up, and the clapper lid fallen beside it; the world freezes and dims and a centred **"GAME OVER — press Enter to restart · your links are saved"** card appears.
- While dead, the **collected-links panel stays clickable** (`pointer-events: auto`) and the links **persist across restart**. **Enter** restarts (lives → 3, field cleared); it also **auto-restarts after ~9 s** of inactivity so the attract loop recovers.
- `tsc` ✓, `vite build` ✓. Verified end-to-end with a scripted puppeteer playthrough that forces a death (took manual control and only ducked so the director never jumps): lives counted **3 → 2 → 1 → 0**, the game-over card showed, the links panel stayed clickable and survived the restart, and **Enter** restored lives to 3 — **0 runtime errors**. Zoomed in to confirm the "X X" eyes render crisply.

## User

> _(Ran `/export-transcript` with the argument: "then integrate with /vcs".)_

## Assistant

Exported this transcript under `docs/transcripts/2026-06-14/` (this file), then integrated the `claude-director-runner-game` work onto `main` via the `vcs` skill.
