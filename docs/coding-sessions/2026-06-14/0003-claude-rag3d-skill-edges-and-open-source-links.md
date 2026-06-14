<!-- markdownlint-disable MD013 MD024 -->

# RAG 3D scene: skills as graph edges, open-source file links, and a cloud that holds its size

- Date: 2026-06-14
- Repo: llm-presentation (jj bookmark `claude-rag3d-skill-edges`, rebased onto `main`)
- Author: Shuyang Sun <shuyangsun10@gmail.com>
- Agent: Claude Code (Opus 4.8, 1M context, effort: ultracode — xhigh + dynamic workflow orchestration)
- Summary: Reworked the 3D RAG supporting-art scene (`web/src/engine/rag3d.ts`). The two named skills are no longer chips on the answer card — each is a curved SVG **edge** that scans labelled corpus nodes, then locks one-by-one onto a node in the centre "cloud" at its spoken beat and becomes a permanent link. The corpus node labels became real **open-source GitHub links** (complex session transcripts, one README, and `rag3d.ts` itself, emphasised as the source of the animation). Hovering any link fades the probe + k-NN beams. Removed the late "converge" collapse so the point cloud holds one size and stays interactive. Verified at every beat on desktop + mobile via headless-Chrome screenshots; rebased onto `main`; exported this transcript; integrated via the `vcs` helper.

## User

For the @web/src/engine/rag3d.ts, read past transcripts to understand its purpose. Instead of showing the two links from @web/src/data/timeline.ts on the GUI, make them show as edges pointed towards nodes on the graph. Before the reveal, these nodes should include random code or session transcript file names you get by using the /retrieving-context skill. During the reveal, these two skills should point to the cloud one-by-one with the existing timing, and become permanently visible links pointing to nodes in the cloud.

Once you're done, start a local preview server so I can give you feedback.

(Session settings for the turn: model Opus 4.8 (1M context), effort `ultracode`, remote-control on.)

## Assistant

Explored the scene and its wiring before touching anything:

- Read `web/src/engine/rag3d.ts` and `web/src/data/timeline.ts`, then `web/src/engine/scenes.ts` (the `ragScene` / `ragAnswer` DOM), `web/src/engine/scene3d.ts` (the shared WebGL stage + pointer + `phase(t,a,b)`), the reveal/`__tick` mechanism in `web/src/main.ts`, the rag CSS in `web/src/style.css`, and the dev-only `web/src/preview.ts` harness (`?scene=rag&t=<sec>`).
- Read the scene's design + transcript docs to confirm intent: an embedding-space galaxy with a mouse-steered query probe that lights its k nearest neighbours — "use the RAG, don't just search for the string."

Retrieved real corpus file names via the **`/retrieving-context`** skill → local Qdrant RAG (project `llm-presentation`), pulling the `doc_id` source paths from the code + transcript collections.

Implemented the redesign:

- `scenes.ts` — stopped rendering the two skill chips on the 3D answer card (`ragAnswer(lang, false)`); the 2D / reduced-motion fallback keeps them. Moved `SKILL_AT` into `timeline.ts`.
- `timeline.ts` — added `SKILL_AT` and `CORPUS_FILES` (real basenames from the corpus).
- `rag3d.ts` — added a DOM/SVG overlay positioned each frame by projecting world points to screen: labelled corpus nodes, plus the two skills drawn as curved SVG edges. Before each skill's `SKILL_AT` beat the edge is dashed/faint and scans the labelled nodes (name hidden, synced to audio); at the beat it swings onto a centre "cloud" node, goes solid, and the DOM link fades in to stay — one at a time. Opacities are pure functions of the playhead so scrubbing rewinds them.
- `style.css` — overlay/edge/label/link styling; the answer card stays above the overlay.

Verified each beat with headless-Chrome (SwiftShader WebGL) screenshots against the preview harness — scanning (t=308), first skill locked while the second still scans (t=315), both locked (t=319), converge (t=327). `tsc` + `vite build` green; the rag chunk stayed a small lazy chunk.

Set up the jj-workspace preview (symlinked `node_modules` + `public/media` from the canonical checkout, which the workspace doesn't carry), started the Vite dev server (port 5173 was taken, so it came up on **5174**), and confirmed the page + media served. Untracked the preview symlinks via a local `info/exclude` so `jj status` showed only the source files. Flagged the on-screen-privacy note (at the time `llm-presentation` was private) and offered to swap the labels for generic placeholders.

## User

1. When the mouse hover on one of the two skill links, don't show other extending edges from the point cloud.
2. In the point cloud, only show file names from open-source repositories (this llm-presentation one, alpha-zero-api, alpha-zero-game, coding-agent-skills). For these file names, also add links to them. Pick complex session transcripts for docs, one README.md, and code showing the 3d animation of this point cloud file. For all these files, link them to the actual open-source file URL on GitHub. Emphasize rag3d.ts to make it clear that is the source code of this RAG animation.
3. The point-cloud should not become smaller later, I'm not sure what that's for. Keep it the same size and keep it interactable.

## Assistant

Noted that requirement 2 means `llm-presentation` is now open-source (linking its files on GitHub) — overriding the earlier "private" note — and updated the corresponding memory (also recording that `alpha-zero-api` / `alpha-zero-game` are public).

Gathered and verified the file set:

- Confirmed all four repos are public on GitHub.
- Queried the local RAG for real paths in those repos and ranked transcripts by chunk count (a proxy for "complex"). Picked: `rag3d.ts` (emphasised), complex session transcripts `0013-…-interactive-presentation-prototype` and `0018-…-3d-asr-supporting-art` (llm-presentation), `0017-…-vcs-script-first-jj-workspaces`, `0055-…-contextual-retrieval-generator-comparison`, `0060-…-rag-wave7-answer-faithfulness` (coding-agent-skills), and one README (`alpha-zero-game`). Verified every blob URL resolves on each repo's `main`.

Implemented all three changes:

1. **Hover calms the cloud** — `pointerenter`/`pointerleave` on every overlay link feed a counter; a damped `beamSuppress` in the render loop fades the probe + k-NN beams (and dims the probe) so the "other extending edges from the point cloud" don't crowd the link you're about to click. The decorative SVG edge layer is `pointer-events: none` so only links capture hover.
2. **Open-source links** — `CORPUS_FILES` became `CorpusFile[]` (`label` / `href` / `emphasis`). Node labels are now real `<a>` GitHub links; `rag3d.ts` is emphasised (accent, bold, parked top-centre, tagged "the code drawing this scene ↗") so it's clear the animation renders its own source. Labels stay readable links (no longer fade out) and flip to whichever side has room so long file names don't clip; smaller on mobile.
3. **Cloud holds its size** — removed the `uConv` collapse from the point vertex shader, the probe→answer hijack, the converge beam-bias, and the crystal glow entirely (plus the now-unused `ANSWER` constant + answer node). The galaxy expands in once on `uForm`, then holds one size for the whole scene, and the probe k-NN stays steerable throughout. The DOM answer card still resolves the model name on its own beat.

Verified on desktop and mobile with headless-Chrome screenshots: the emphasised `rag3d.ts`, the linked transcripts/README, the one-by-one skill lock, and identical cloud size at t=319 vs t=340 (no collapse). `tsc` + `vite build` green; `jj status` clean (4 source files). Flagged that `alpha-zero-api` isn't shown (no session transcripts in the corpus; only its README was available, and the one README slot went to `alpha-zero-game`).

## User

Rebase onto main, export transcript, then integrate with /vcs

## Assistant

Loaded the `vcs` skill (jj mode; already isolated in the `claude-rag3d-skill-edges` workspace).

- **Rebase** — `main` had advanced to the `cursor-trtllm-nemotron-config` integration since branching, so `jj rebase -s @ -d main`. It merged cleanly with main's changes (the translate-beat retiming and the `__setLang` in-place language flip) — no conflicts, only my 4 source files in the working copy. Re-ran `vite build` to confirm the combined tree is green.
- **Export** — ran this skill's `next-index.sh` (→ `docs/coding-sessions/2026-06-14`, index `0003`) and wrote this transcript, reconstructed faithfully from session context with verbatim user turns and relative paths.
- **Integrate** — landed the work on `main` with the `vcs` helper (`integrate.sh claude-rag3d-skill-edges`), which handles the jj merge, `main` publish, and retiring the isolated workspace.
