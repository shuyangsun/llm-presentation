<!-- markdownlint-disable MD013 MD024 -->

# RAG 3D scene — readable file labels, brain_dump link, and skills as cloud links

- **Date:** 2026-06-14
- **Repo:** llm-presentation (jj workspace `claude-pending-41e5a3c2`, integrating to `main`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, thinking: max)
- **Summary:** Reworked the 3D RAG scene (`web/src/engine/rag3d.ts`): enlarged the corpus file-name labels, added `brain_dump_20260611.vtt` as a linked node, replaced the two skills' curved "pointer" edges with link-style chips sitting among the cloud (timing preserved), and reduced the dot count while enlarging each dot. Replaced the overlapping ring layout with an explicit vertically-separated layout (responsive desktop/mobile) and verified no label overlaps headlessly. Also pointed `/retrieving-context` at its `SKILL.md` and kept `/export-transcript` on its directory.

---

## User

`/effort max`

## User

File name text on @web/src/engine/rag3d.ts are too small, increase the font size so they are not that hard to see. Also, add the GitHub link to docs/subtitles/brain_dump_20260611.vtt to that RAG clould. Also, remove the two big pointers from the two skills, just show them in their current link-style among the clouds like other files. Keep the current animation timing of these two skills. Reduce the number of dots in the RAG cloud, but increase each dot's size by a bit. Review the result visually to make sure different file names are not too close, they shouldn't be too cramped. Once you're done, spin up a local server for me to review.

## Assistant

Explored the scene and its data/styling to map the request to code:

- Read `web/src/engine/rag3d.ts`, `web/src/data/timeline.ts` (`SKILLS`, `SKILL_AT`, `CORPUS_FILES`), `web/src/style.css` (the `.rag-node-label` / `.rag-skill` / `.rag-edge` rules), and `web/src/engine/scenes.ts` / `web/src/preview.ts`.
- Found the dev-only preview harness: `preview.html?scene=rag&t=<sec>&lang=en` drives the scene at a fixed playhead without the talking-head video — ideal for reviewing the RAG cloud.
- Set up the preview in the jj workspace: symlinked the canonical `web/node_modules` and the git-ignored `web/public/media` into the workspace.
- Confirmed `docs/subtitles/brain_dump_20260611.vtt` is committed on `main` (commit `39e979a`) so its GitHub blob link will resolve.

Identified the three change areas: (1) bump label fonts in CSS; (2) add a `CORPUS_FILES` entry for the vtt; (3) in `rag3d.ts`, delete the curved SVG skill edges + source dots and render the skills as link chips anchored to the centre-cloud nodes (keeping the `SKILL_AT` reveal timing), plus reduce `P` (ambient points) and raise `uSizeBase`/`uSizeLit`.

## User

Oh, btw, links to the retrieving context skill should link to the `SKILL.md` itself, but the link to the export-transcript skill should link to the directory (like how it is now).

## Assistant

Verified the skill paths on `main` of the `coding-agent-skills` repo: `.agents/skills/retrieving-context/SKILL.md` (uppercase) exists, and `.agents/skills/export-transcript/` is a directory. Then made the edits:

- **`timeline.ts`** — `/retrieving-context` href → `…/blob/main/.agents/skills/retrieving-context/SKILL.md`; `/export-transcript` left as `…/tree/main/.agents/skills/export-transcript` (directory). Added the corpus file `{ label: "brain_dump_20260611.vtt", href: "…/llm-presentation/blob/main/docs/subtitles/brain_dump_20260611.vtt" }` (the live subtitles of the talk).
- **`style.css`** — corpus label `font-size` 11 → 13px; emphasised `--src` 13.5 → 15.5px; its `.nl-tag` 9.5 → 11px; the `@media (max-width:760px)` sizes bumped to match. Removed the now-dead `.rag-edges` / `.rag-edge` / `.rag-edge-src` / `#rag-arrow` rules and updated the overlay comment.
- **`rag3d.ts`** — dots: `P` 2600 → 1500 (mobile 1400 → 850); `uSizeBase` 12 → 15, `uSizeLit` 26 → 31 (mobile 9 → 11, 20 → 24). Removed the SVG overlay, the per-skill curved `edge`/`dot`, the fixed-screen `tails`, and the scan/roam machinery. Skills are now pill links anchored to two centre-cloud nodes (`CLOUD`), fading in one-at-a-time on `SKILL_AT` with the same `SKILL_LOCK` ramp; the centre nodes still brighten as each skill locks. Simplified `updateOverlay(t, galaxy)` and dropped the dead `labelHi`/scan highlight. Updated the file's doc comments and the `scenes.ts` comment.

First visual pass exposed the real problem: the ring layout piled the long transcript filenames on top of each other at the top and bottom of the ring. Replaced the ring formula with an explicit, vertically-separated layout — `NAMED_POS` rows in two side columns on wide viewports and a single stacked column on narrow ones, the centre column reserved for the two skill chips, the lower-left kept clear for the answer card. Split `CLOUD` into `CLOUD_WIDE`/`CLOUD_SMALL` and selected by the `small` flag.

Verification (headless, since no browser MCP is wired up):

- `tsc --noEmit` clean; grepped to confirm no stragglers of the removed identifiers.
- Started `vite` dev server (port 5173 was already in use, so it bound **5174**).
- Wrote a `puppeteer-core` screenshot + bounding-box overlap script. WebGL only initialised after adding `--enable-unsafe-swiftshader` (Chrome 148 gates SwiftShader WebGL); before that the scene fell back to the 2D variant.
- Desktop (1440×900): 0 overlaps; skills reveal one-at-a-time (t=305 labels only, t=315 first skill, t=320 both). Mobile (402×860): initial label-vs-card overlaps at the bottom, fixed by spreading the single-column rows across the full height above the card and slightly slimming the chips via a mobile `@media` rule.
- Confirmed rendered hrefs (brain_dump, retrieving-context → SKILL.md, export-transcript → directory) and no console errors beyond a harmless default `favicon.ico` 404.
- `npm run build`: `tsc` passes and all modules transform; the only failure is vite copying `web/public/media/intro.mp4`, a symlink to an unmounted NAS path — pre-existing and unrelated to the code.

Left the dev server running at `http://localhost:5174/preview.html?scene=rag&t=320&lang=en` for review.

## User

Looks good. /export-transcript then integrate with /vcs

## Assistant

Exported this transcript under `docs/transcripts/2026-06-14/`, then integrated the change with the `vcs` skill.
