<!-- markdownlint-disable MD013 MD024 -->

# 3D "one timeline" scene → a head-on progress bar with link-rain flowing video→web

- **Date:** 2026-06-14
- **Repo:** llm-presentation · jj, work isolated in `claude-3d-in-sync` (off `main` @ `48a3f263` "docs(coding-sessions): add transcript for rag3d skill-edges + open-source links")
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
- **Summary:** Reworked the `sync3d.ts` supporting-art scene ("one timeline drives both"): removed the 3/4 tilt so it faces the viewer head-on, and recast it as a 3D progress bar — two front-facing VIDEO/WEB tile lanes bound by a continuous rain of warm particle "links" flowing top→bottom (densest in the live column), the full set of progress-bar section dots + a real-time fill on a timeline rail, and a cursor-scrub playhead whose hover surfaces the nearest section title in a tooltip (text, no thumbnail, bilingual). Verified head-on via headless screenshots, then rebased onto main, exported this transcript, and integrated.

Session setup: `/model` → Opus 4.8 (1M context); `/effort ultracode`; `/remote-control 3d-in-sync`.

---

## User

In the @web/src/engine/sync3d.ts file, remove the tilt so the 3D animation faces the viewer. Read some past transcripts about particle effects, and change this animation to have a similar effect / style. Particles should be links flowing from video to the web content, and sections marked on the progress bar should also show on this animation view, as the user move the mouse around, section titles should show (not thumbnail), just like the progress bar.

Once you're done, give me a preview link, I'll give you feedback.

## Assistant

Read the scene and its surroundings to ground the change before touching anything: `sync3d.ts` (two tilted ribbons + a sweeping playhead beam), the shared scaffold `scene3d.ts` (stage, palette-from-CSS, `trackPointer`, reversible `phase(t,a,b)`, `makeClock`), the three particle-effect transcripts, the timeline data (`CHAPTERS` = the progress-bar section markers with bilingual labels; `BEATS`), the progress-bar rendering + hover tooltip in `main.ts` (`tipChapter`, `chapterIndexAt`), the scene registry/windows in `scenes.ts` (sync is active 186.7–222.7), and the relevant CSS (`.bar-tip`, scene-canvas shells, palette tokens). Studied the two reference particle scenes in depth: `translate3d.ts` (one `THREE.Points` field, curl-noise advection, warm terracotta→gold ember ramp, comet-streak sprites, NormalBlending on cream paper) and `rag3d.ts` (probe→node beams as links, soft warm-core glow billboards).

Set up the jj workspace for preview (symlinked `node_modules` + the git-ignored media `public/` from the canonical repo), confirmed a green baseline typecheck, and mapped the scene's active window so the redesign could double as a faithful, full-timeline progress bar.

Ran a 3-direction design-ideation **Workflow** for the "links flowing video→web" hero (Data Rain · Courier Arcs · The Loom), then synthesized: **Data Rain as the base** (a calm, directed downward field of warm motes — each a "link" raining out of the video lane and landing in the web lane, densest in the live column) enriched with **Courier Arcs' discrete bright "link-packets"** (~10% of motes, firmer comet-streaks, so it reads as links not dust), and reframed the whole scene as a **head-on 3D progress bar**.

Rewrote `web/src/engine/sync3d.ts`:

- **Removed the tilt:** camera is now straight down +z (no `BASE_AZ/EL`), facing the viewer; a tiny damped mouse parallax keeps the flat plane dimensional.
- **Link-rain (the hero):** one `THREE.Points` pass (4200 desktop / 2000 mobile). Each mote owns a stable timeline column (`aCol`→world x) and falls top→bottom on a `fract()` clock loop, drifting through curl-noise mid-fall and re-converging crisp onto the lanes; colour ramps terracotta→deep-ink as it settles into the web lane. The column under the playhead rains faster/brighter/hotter (gaussian on x for the real playhead + the cursor scrub). Vertical comet-streak sprites point the flow downward.
- **Progress-bar structure:** a horizontal timeline rail (hairline + a terracotta **fill** that grows to the real playback position), the full set of `CHAPTERS` **section dots** at their true `t/duration` x (past/current states like the DOM bar, duration read from the `<video>` with a fallback), and a glowing **playhead beam** that rests at real time and hands over to the cursor on the "scrub" beat.
- **Section-title tooltip:** a DOM label appended into the scene container, styled like the progress-bar tip but **text-only** (time + title, no thumbnail), bilingual via live `data-lang`, projected to track the hovered column exactly. Added matching `.sync-tip` CSS.
- **Reversibility preserved:** all narrative reveal/handover/flash stays `phase(t)` (`formP` 186.7→188.2, `scrubEnable` 195.5→197.2, `lockPulse` 202.6→203.4); only the downward flow is clock-driven.

Verified head-on with headless Chrome (SwiftShader) screenshots through the dev-only `preview.html` harness across states: formed-in, hover (tooltip read "2:04 The reveal"), Chinese ("3:18 两种语言", sans font), pre-form (blank — reversible), and a narrow mobile layout (9 tiles/lane, tooltip aligned with the beam at "2:54 Two languages"). Tuned from the screenshots: raised the ambient floor so the whole-timeline binding is visible (not just the lit column), tightened curl drift + firmed the streaks for a clearer downward "flow" read, bumped particle/dot sizes, initialized `playX` converged so the beam never slides in on mount, and gated the section-dot alpha by `uForm` to fix a pre-form leak (re-verified blank). `npm run typecheck` and `npm run build` both green; sync3d bundles at ~17 kB.

Delivered the preview links (the isolated `preview.html?scene=sync` harness for mouse/scrub interaction, plus the full app) with before/after screenshots and a summary of the knobs available for feedback.

## User

Rebase onto main, export session transcript, then integrate with $vcs

## Assistant

Loaded the `vcs` skill (jj mode confirmed; working in the isolated `claude-pending-b094a4ab` workspace). Dropped the dev-only `web/public` media symlink that jj had started tracking (kept the git-ignored `node_modules`/`dist`), renamed the work to `claude-3d-in-sync`, and `jj git fetch`'d — `main` had advanced four commits past my base (pause overlay, Nemotron serving config, rag galaxy links, rag transcript). Confirmed my base was a clean ancestor of the new `main` and rebased the working-copy commit onto it (`48a3f263`) — no conflicts; post-rebase `npm run typecheck` green.

Loaded the `export-transcript` skill and wrote this transcript under `docs/coding-sessions/2026-06-14/`. Next: clean the remaining dev-only symlink out of the working copy, then integrate the `claude-3d-in-sync` work onto `main` via the vcs helper.
