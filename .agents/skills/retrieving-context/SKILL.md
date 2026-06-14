---
name: retrieving-context
description: >-
  Load when you need to FIND or RETRIEVE context (docs, prior decisions, code) to
  answer a question or do a task — and BEFORE you grind ripgrep blindly or write
  a new doc. Routes to the best retrieval available, best-first: cloud RAG →
  local RAG → navigating the doc structure by hand. Nudges you up a tier when the
  corpus is large or you'll query it repeatedly. Repo-agnostic.
---

# Retrieving context

You need context — a prior decision, the doc that already answers this, the code
that does the thing — before you can act. **Getting that context is its own skill:**
the difference between one good query and an afternoon of blind `rg` is which
retrieval you reach for. This skill **routes you to the best retrieval available**
and, when only a weak one is, tells you when it is worth standing up a better one.

Two failure modes bracket the job, and both are common:

1. **Under-powered.** Grinding keyword `rg` over a large or long-form corpus
   (transcripts, a big `docs/` tree) when a vector index would answer in one shot —
   or _re-grinding_ it on every follow-up question.
2. **Over-powered.** Spinning up a RAG pipeline to find one fact in a five-file
   repo, where a single `rg` or reading the directory index is faster.

So: **pick the most capable retrieval that is actually available, sized to the
corpus and how often you'll query it** — and fall back gracefully when the better
tiers are absent.

## The routing ladder (best-first; fall down it, nudge back up it)

### Tier 1 — Cloud / managed RAG, if the repo wires one

If the host or repo exposes a **managed retrieval service** — a hosted vector DB, a
retrieval MCP tool, an indexed knowledge base, a documented search endpoint —
**prefer it** for any large or shared corpus. It is maintained, it scales past one
machine, and it is shared across agents, so its index is usually fresher and broader
than anything you'd build ad hoc.

- **Detect:** scan for a configured retrieval/search MCP tool, a project retrieval
  endpoint, or a knowledge base named in the repo's docs or agent config. Don't
  assume one exists; don't assume one doesn't — look.
- **Use it, then verify.** Query in the corpus's own words; treat the hits as
  candidates and confirm against the cited source before relying on them.

### Tier 2 — Local RAG (if a local RAG stack is installed)

No cloud retrieval, but a **medium-to-large local corpus** (a real `docs/` tree,
exported transcripts, a source tree)? Use a local hybrid index when the host
project has installed one, such as the `setting-up-rag` Qdrant + FastEmbed stack.
It beats keyword search on recall because it fuses dense (semantic) and sparse
(lexical) retrieval and reranks the shortlist.

- **Is it up?** Run `setting-up-rag`'s `check-local-rag.sh` (prints `READY` /
  `NOT_READY`), then query with its `query.py`. In repos that vendor the
  `setting-up-rag` skill, those scripts usually live under
  `<setting-up-rag-dir>/scripts/`. If `READY` and the corpus is indexed:

  ```sh
  python3 <setting-up-rag-dir>/scripts/query.py "a natural-language question" --top-k 20
  python3 <setting-up-rag-dir>/scripts/query.py "…" --project <name-or-path> --kind all
  python3 <setting-up-rag-dir>/scripts/query.py --list-projects
  ```

- **Up but corpus not indexed?** Index it first using the installed stack's setup
  command, which should also record the project in `$RAG_HOME/projects.json`; then
  query it by project name or root path.
- **Not set up at all?** If the corpus is large or you're about to make many
  queries, **set it up** via `setting-up-rag` rather than grinding `rg` — that is
  the nudge, not a detour. For a one-off lookup, drop to Tier 3 instead.

### Tier 3 — Navigate the doc structure by hand (always available)

When no RAG is available — a small corpus, a quick one-off lookup, a fresh repo, or
RAG simply not set up — find the answer by **understanding the structure**. This is
the floor, and it is often enough:

- **Read the directory index first.** Most doc trees keep an `OVERVIEW.md` /
  `README.md` / `index.md` per directory. Read it — it is the curated map and the
  cheapest way to see what's already covered. Then open the **primary doc** it
  points at; don't stop at the index (it only lists, it rarely states the answer).
- **Search by the concept, not just the keyword.** `rg -i` across the docs/code
  root for the identifier, error string, number, or proper noun you expect the
  answer to contain. If you only know the topic, search the **natural-language
  phrasing a reader would use** — that is how a findable doc is written, so it is
  how it is found.
- **Walk the structure.** Dated / indexed / typed folders (e.g.
  `docs/<type>/<YYYY-MM-DD>/<NNNN>-<slug>`) let you scan by recency and area without
  opening files. A numbered reference ("issue 0042") points straight at one file.

### The nudge — escalate when the floor gets expensive

Tier 3 is the fallback, **not the goal**. Move up a tier the moment manual retrieval
starts costing more than the setup would: you're paging through dozens of `rg` hits,
the corpus is large or long-form (dialog transcripts especially), or you'll query it
repeatedly across the task. Those are the signals to stand up local RAG
(`setting-up-rag`) or reach for a cloud index. Conversely, don't climb the ladder
for a three-file repo — the floor is the right tool there.

## Retrieve well, whatever the tier

- **Phrase the query in the corpus's words.** Paraphrase the need into the
  identifiers, error strings, and proper nouns the answer doc would contain — both
  lexical search and embedders match on shared surface terms.
- **Orient before you dive.** Read the directory map / a top-k skim first; it is
  cheap and stops you deep-reading the wrong file.
- **Prefer the primary source over an aggregator.** The doc that _states_ the
  answer beats an index or a summary that merely _cites_ it.
- **Verify before you rely.** Retrieval surfaces candidates, not ground truth — open
  the source and confirm the fact is actually there, phrased as you'll use it.
- **Preserve provenance when retrieved context feeds an answer.** Keep source IDs,
  paths, headings, and line ranges attached to each chunk; don't paste anonymous
  excerpts into the prompt. Require citations on factual answer sentences and
  mechanically check that the cited chunk exists and contains the claimed support.
- **For image-backed project questions, retrieve project context first.** Ask the
  development question in terms of the workflow, asset name, source path, script,
  or bug history; the best evidence is usually code/docs/session history, with
  image paths or image summaries as supporting provenance. Do not answer a
  project question from an image summary alone when a source file or session note
  states the behavior. If an image path is retrieved and the visual detail matters,
  inspect the actual image before relying on the summary.
- **Pack for the reader, not just the retriever.** For larger answer contexts, start
  with score order or parent/section grouped packs that preserve source IDs. Use
  source-path order only when you have measured it on that corpus; on this repo's
  mixed code/docs benchmark it was worse for both answer sentinel containment and
  citation support. Escalate to raw top-k only when exact literal extraction matters
  more than token budget.

## When retrieval comes up empty — write it down

If you searched well across the available tiers and the answer **isn't** in the
corpus (or lives only in a stale, half-right doc), that is a signal to **record it**.
Hand off to [`updating-docs`](../updating-docs/SKILL.md): this skill satisfies the
"find before you write" precondition (you've confirmed it's missing or needs
updating); that skill writes it so the _next_ retrieval finds it. The two are a pair
— retrieve here, write there.

## Anti-patterns (revert these)

- **Blind grind** — re-running keyword `rg` over a large or long-form corpus when an
  index exists or could be built in one command.
- **Over-engineering** — standing up RAG to find one fact in a handful of files.
- **Stopping at the index** — reading the `OVERVIEW.md` listing and never opening the
  primary doc that actually answers the question.
- **Trusting rank 1** — quoting the top retrieved chunk without opening the source to
  confirm it says what you think.
- **Not looking for the better tier** — assuming no cloud/local index is available
  without checking the repo's tools and config.
