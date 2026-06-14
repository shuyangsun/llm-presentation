<!-- markdownlint-disable MD013 MD024 -->

# Language picker — relocate to the title as a two-way-synced dropdown

- **Date:** 2026-06-14
- **Repo:** llm-presentation (jj bookmark `claude-language-picker`, change `wornpmkrwwvr`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, effort: max)
- **Summary:** Moved the language picker from beside the bottom progress bar to the right end of the wordmark/title row at the top of the deck, replaced the `EN`/`中文` button toggle with a styled `<select>` (`English` / `简体中文`), preserved its scripted debut beat (`BEATS.picker`), and kept the two-way language sync with `web/src/engine/translate3d.ts`. Verified with `tsc`/`vite` and headless-Chrome screenshots of the real CSS, updated the living doc `web/README.md`, then exported this transcript and committed via the `vcs` skill.

---

## User

> (session set to `/effort max`; remote-control target `language-picker`)

Move the language picker shown after the translation page is mentioned from next to the progress bar to next to the presentation title at the top. Make sure the appearing timing is still the same. Instead of a binary option, change it to a drop-down menu. Use "English" and "简体中文" as options. Make sure it is still in-sync (two-way sync) with @web/src/engine/translate3d.ts.

After you're done, /updating-docs if neccessary.

## Assistant

Worked in the session's isolated jj workspace (created by the session-start hook).

**Explored** the relevant code before touching anything:

- `web/src/engine/translate3d.ts` — the 3D "translate" scene. Each frame it reads the live site language via `document.documentElement.getAttribute("data-lang")`, and when the cursor drags the word across the glass it dispatches a `site-set-lang` CustomEvent. So the scene both *reads* and *drives* `data-lang`.
- `web/src/main.ts` — the director. Found: the picker built as two `<button>`s (`EN` / `中文`) inside `.lang`/`.langwrap`, appended at the top level near the bottom chrome; visibility gated by body classes `chrome-active` + `picker-on`, with `picker-on` flipped at `BEATS.picker` and a one-shot `pickerDemoed` block calling `showChrome()` at the beat; the wordmark/title (`.wordmark` → loop glyph + `.title`/`.sub`) inside `.deck`; and all language changes funneling through `setLang` → `applyLang` (which sets `data-lang`, calls the active scene's `__setLang`, and previously toggled the buttons' `aria-pressed`).
- `web/src/data/timeline.ts` — `BEATS.picker = 176` ("…now show a language picker somewhere on the UI"); `BEATS.translate = 169.0` (scripted EN→中文 auto-flip).
- `web/src/engine/scenes.ts` — the translate scene exposes `__setLang` (updates its caption in place and never rebuilds, to keep the WebGL context).

Confirmed both sync directions already converge on `setLang`/`applyLang`, so the dropdown only had to (a) call `setLang` on `change` and (b) be mirrored from `applyLang`.

**Edited `web/src/main.ts`:**

- Rebuilt the picker as a `<select class="lang-select" aria-label="Language">` with `English` / `简体中文` options and appended it **into `.wordmark`** so it rides in the title row; removed the old two-button block and dropped the now-orphan top-level `langWrap` from `app.append(...)`.
- Two-way sync on the same path the buttons used: a `change` listener → `setLang(langSelect.value)`, and `applyLang` now sets `langSelect.value = lang` so the scripted flip *and* the scene's cursor-driven flip both update the dropdown.
- Removed the `pickerDemoed` chrome-flash block and the `langWrap` `pointerenter` handler — both only made sense when the picker lived in the bottom chrome.

**Edited `web/src/style.css`:**

- `.langwrap`: dropped `position: fixed; bottom: 64px` (beside the playhead) for a flex item with `margin-left: auto` / `align-self: center` at the right end of the title row; gated visibility on `body.picker-on` alone (same debut beat) and kept `pointer-events: none` until then so it can't be hit while invisible.
- Restyled the native select into a themed pill: `appearance: none`, a custom chevron via `.lang::after`, hover / `focus-visible` states, themed `option` colors; added `flex-wrap: wrap` to `.wordmark` so the row degrades gracefully on very narrow desktops; updated the mobile overrides (`.lang-select` touch sizing) and removed the obsolete `.lang button` and fixed-`bottom` rules.

**Timing:** visibility changed from `body.chrome-active.picker-on` to `body.picker-on`; `picker-on` still flips at `BEATS.picker` (~2:56), so the debut beat is identical — the picker now persists next to the always-on title instead of flickering with the bottom chrome.

**Verified:**

- `npm run typecheck` and `npm run build` (tsc + vite) both pass. (Per the workspace preview convention, symlinked `web/node_modules` from the canonical repo first, since a jj workspace doesn't carry git-ignored deps.)
- The dev preview harness (`web/src/preview.ts`) mounts individual scenes only — not the chrome — so to eyeball the picker I wrote a throwaway static harness that reused the real `web/src/style.css` with the exact `deck → wordmark → langwrap → lang → select` DOM frozen in the `picker-on` state, and screenshotted it with headless `google-chrome` at desktop (中文 default + English) and mobile (390×844). All three showed the dropdown sitting at the right end of the title row with the correct labels. Sent the screenshots to the user, then removed the temp files.

**`/updating-docs`:** Followed the skill's routing — read the `docs/README.md` index and grepped the docs tree for picker references. The matches were all dated, point-in-time records (the talk's subtitles, dated research/design specs, and session-export transcripts). Per `AGENTS.md`, transcript/coding-session exports are authored only on explicit request, so the one *living* doc to fix was `web/README.md`, whose choreography table described the picker as "EN / 中文, defaulting to 中文 (near the playhead)". Updated that line to a drop-down (English / 简体中文) beside the title at the top, defaulting to 中文, two-way synced with `translate3d.ts`. No new doc created.

Isolated the work on the jj bookmark `claude-language-picker` and set a change description; left committing for the explicit request below.

## User

> /export-transcript

then integrate with /vcs

## Assistant

Exported this transcript to `docs/transcripts/2026-06-14/0021-claude-language-picker-dropdown.md` using the index from `next-index.sh`, then ran `redaction-scan.sh` and re-read the file (no secrets/PII; repo paths kept relative).

Integrated with the `vcs` skill: the change (code + `web/README.md` + this transcript) is committed on the isolated jj bookmark `claude-language-picker`, off `main`. Not pushed (not requested).

**Files changed**

- `web/src/main.ts` — picker rebuilt as a title-adjacent `<select>`; two-way sync via `change` → `setLang` and `applyLang` → `langSelect.value`; removed the demo/hover chrome logic.
- `web/src/style.css` — picker moved into the wordmark row and restyled as a dropdown pill (custom chevron, hover/focus, mobile sizing); `.wordmark` `flex-wrap`.
- `web/README.md` — choreography table line for the language picker updated to match.
- `docs/transcripts/2026-06-14/0021-claude-language-picker-dropdown.md` — this transcript.
