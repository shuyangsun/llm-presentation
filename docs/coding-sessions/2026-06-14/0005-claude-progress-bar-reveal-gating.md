<!-- markdownlint-disable MD013 MD024 -->

# Hide the real seek bar until the in-sync beat reveals it (the "wow")

- **Date:** 2026-06-14
- **Repo:** llm-presentation · jj, work isolated in `claude-progress-bar-reveal` (off `main` @ `528d9258` "feat(web): recast 3D sync scene as a head-on link-rain progress bar")
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
- **Summary:** Made the real video chrome's progress/seek bar concealed during the cold open and revealed on cue. Before the presenter says "So display that progress bar" (`BEATS.progress`, 205.2s — mid-way through the `sync3d.ts` "one timeline" scene) the seek bar is hidden and only surfaces on a deliberate hover into the bottom edge (or while being grabbed/scrubbed); the rest of the chrome (play/time/mute) is untouched. At the cue it materialises and holds through the rest of the in-sync section (to 222.7s, "if you're on mobile"), then reverts to on-demand like YouTube. Implemented as two playhead-pure body flags (`scrub-locked` / `scrub-reveal`) so a reverse-scrub re-conceals it; the concealed bar uses `visibility:hidden` so it's out of the tab order + a11y tree. Verified with a 4-lens adversarial review workflow (no blockers), typechecked, rebased onto main, exported this transcript, and integrated.

Session setup: `/model` → Opus 4.8 (1M context); `/effort ultracode`; `/remote-control progress-bar`.

---

## User

Do not show the progress bar for the video at the begining, but hovering around that area should show it. We want the "wow" factor where the progress bar is only shown during the talk about contents in-sync (when @web/src/engine/sync3d.ts) is shown. We don't want to make it too obvious that the user can jump ahead right at the beginning.

## Assistant

Explored the player to understand the current chrome/seek-bar behavior:

- `web/src/main.ts` — the director. The bottom `chrome` element bundles the seek `bar` (rail + chapter dots + head + tooltip) and the `ctrl` row (play/pause, mute, time, fullscreen). Visibility is driven by body classes: `chrome-active` (set by `showChrome()`, auto-hides 2800ms while playing) and `body.begun.paused .chrome` (keeps the chrome up while paused). `showChrome()` fires from `begin()`, `setPaused(true)`, pointer-near-bottom (within 150px), pointerdown-anywhere, touch tap, and two scripted one-shots: a picker demo at `BEATS.picker` and a `progressDemoed` flash at `BEATS.progress`.
- `web/src/data/timeline.ts` — `BEATS.progress = 205.2` ("So display that progress bar"); `CHAPTERS` are the dots.
- `web/src/engine/scenes.ts` — `SCENES`; the `sync` scene runs `[186.7, 222.7)` (next scene "responsive" = "if you're on mobile").
- `web/src/data/en.vtt` — confirmed the exact cue timings: "When the users scrub on the progress bar…" at ~195.5, "They should always be in sync." at 202.7, **"So display that progress bar." at 205.2**, the "very thin line with dots… like YouTube" description through ~221, then "if you're on mobile" at 222.6.

Design chosen: gate the **seek bar specifically** (not the whole chrome — only the bar is the "jump-ahead" affordance) on two playhead-pure flags so the behavior is reversible like every other beat:

- `scrub-locked` = `t < BEATS.progress` → bar hidden; only reveals on `.chrome:hover` (a deliberate reach into the bottom edge, enabled by the existing 150px-proximity `showChrome()`) or while `.tipping` (actively grabbed/scrubbed).
- `scrub-reveal` = `t ∈ [205.2, SCRUB_REVEAL_END)` where `SCRUB_REVEAL_END` is derived from the schedule as the scene after `sync` (= 222.7) → forces the chrome up so the bar holds on screen while he describes it.

Edits:

- `web/src/main.ts` — removed the `progressDemoed` one-shot (superseded), added `const SCRUB_REVEAL_END = SCENES[activeSceneIndex(BEATS.progress) + 1]?.t ?? Infinity;` and, in `applyBeats(t)`, `setFlag("scrub-locked", t < BEATS.progress)` + `setFlag("scrub-reveal", t >= BEATS.progress && t < SCRUB_REVEAL_END)`. Kept the picker-demo one-shot.
- `web/src/style.css` — gave `.bar` an opacity/transform transition; added `body.scrub-locked .bar { opacity:0; transform:translateY(6px); pointer-events:none }`, the hover/`.tipping` override, and `body.scrub-reveal .chrome { opacity:1; … }`.

Symlinked `node_modules` from the canonical repo (the jj workspace doesn't carry it) and ran `tsc --noEmit` — clean.

Ran a background multi-lens adversarial review workflow (4 lenses — CSS specificity, state/reversibility, interaction edge cases, timing/narrative — each finding then independently verified, then synthesized). Outcome: **no blockers**. Notable verified results:

- "Auto-hide timer blanks the sustained bar during the wow window" → **refuted**: `body.scrub-reveal .chrome` forces opacity regardless of the timer.
- "Hover-to-reveal is circular (`.chrome:hover` can't fire while `pointer-events:none`)" → downgraded to low: works in practice because the JS bottom-proximity `showChrome()` makes the chrome hit-testable, then `:hover` lifts the bar.
- Touch users can't seek before 205.2 → **intended** (don't advertise jump-ahead).
- Bar staying on-demand after 222.7 (not re-locked) → **by design**.
- One worth fixing that my change introduced: while locked the bar was `opacity:0` but still `tabindex=0` → an invisible focus target when the chrome is otherwise up (e.g. paused before the cue).

Applied that one fix: switched the concealed bar to `visibility:hidden` (with a delayed transition so it still fades out), which removes it from the tab order + a11y tree; the hover/`.tipping` reveal sets `visibility:visible`.

## User

Rebase onto main, export session transcript, then integrate with /vcs

## Assistant

Checked VCS state: `main` had advanced 3 commits since the session started (rag-galaxy work + the sync-scene recast at `528d9258`), while the work was still based on the old `b6188dee`.

- Confirmed the new main commits touched `style.css` (+169) and `timeline.ts` (RAG additions only — `BEATS` unchanged) but **not** `main.ts`. `SCENES` sync/responsive timings (186.7 / 222.7) were unchanged, so `SCRUB_REVEAL_END` still resolves to 222.7.
- `jj rebase -r @ -d main` → rebased cleanly, **no conflicts**; jj auto-merged main's `style.css` additions with the chrome/bar edits (disjoint regions). Re-verified both edits survived and re-ran `tsc --noEmit` — clean.
- Renamed the work `claude-pending-40b5002d` → `claude-progress-bar-reveal` and set the commit description.
- Exported this transcript via the `export-transcript` skill (`next-index.sh` → index 0005).
- Integrated the work into `main` with the `vcs` skill.
