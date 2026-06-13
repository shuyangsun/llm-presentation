---
name: updating-docs
description: Load BEFORE you write or update a doc (issue, plan, design, benchmark,
  session note, runbook, decision record), so you write it where both humans and
  retrieval will actually find it, and update what exists instead of forking it.
  Finding what's already there (the search-before-you-write step) is delegated to
  `retrieving-context`. Repo-agnostic.
---

# Updating docs

**Findability is the whole job.** A doc nobody can retrieve is worth nothing — it
gets rewritten, contradicted, or lost. This skill is the **write** half of that job:
update what already exists rather than forking it, and write so the next reader (a
human skimming, a retriever ranking) actually finds it. The **find** half — checking
what's already there before you write — is [`retrieving-context`](../retrieving-context/SKILL.md);
do that first.

Three empirical anchors drive every rule below; treat them as the _why_:

1. **Having the doc at all is the dominant lever.** The single biggest jump in
   findability is going from no doc to one indexed doc. So the first failure mode
   is a missing or unlinked doc, not an imperfect one — write it, and link it.
2. **Structure only pays off when something reads the structure.** Clean headings
   and one-concept files help a human and help heading-aware retrieval, but they do
   **not** rescue an answer that isn't stated in plain, searchable words. So
   structure is necessary, not sufficient: **anchor the answer lexically** (§5).
3. **Advanced retrieval still needs authored context.** Contextual retrieval, late
   chunking, graph retrieval, parent-document retrieval, and rerankers can recover
   more context than naive chunking, but they work best when the doc itself names
   its parent project/module, source paths, entities, and relationships. Write
   those context clues once, near the top and at section boundaries, instead of
   relying on a retriever to infer them.

## 1. Before you write: search first (don't duplicate)

Never author a doc until you've checked whether it already exists. Use
[`retrieving-context`](../retrieving-context/SKILL.md) to search the corpus the way
a reader would — read the directory index, search by concept (not just keyword),
walk the dated/typed folders. That skill owns the _how_; what matters here is the
rule it enforces:

- If a doc already covers the concept, **update it in place** rather than adding a
  near-duplicate. Two docs that both half-answer a question are worse than one.
- If nothing covers it (or the only doc is stale and half-right), that's your
  signal to write — proceed below.

## 2. Decide where it lives: co-locate vs centralize

- **Co-locate with the code** it explains when it is tightly coupled to one
  module/package (a `README.md` next to the code, a doc comment) — it travels and
  versions with that code and is found by anyone in that directory.
- **Centralize under the docs root** (`docs/`) when it is cross-cutting: a plan, a
  design/decision record, an issue write-up, a benchmark, a runbook, a session
  note. These are not owned by one module and belong in the shared, indexed tree.
- **Add a small source map** when a task, decision, or workflow spans several code
  files and no single file is the obvious home. The source map is a bridge, not a
  replacement for source: it states the answer, names the primary files/functions,
  and links to the code a reader must verify.

When in doubt, prefer the location where the next person _looking for this_ will
look first.

## 3. Match the repo's existing convention

Before inventing a layout, **adopt the host repo's**. Open the docs root and the
nearest `OVERVIEW.md`/`README.md` and copy the pattern already in use: directory
shape, filename scheme, header block, and how the index is kept.

If the repo has **no** convention yet, a durable default is one directory per doc
**type**, dated subfolders, and a zero-padded **globally-unique index** per type:

```text
docs/<type>/<YYYY-MM-DD>/<NNNN>-<kebab-slug>.md   # type ∈ issues, plans, designs, runbooks, …
```

- `NNNN` is unique across the whole type tree (it does **not** restart per day),
  so a numbered reference (e.g. "issue 0042") stays unambiguous. The next index is one more than
  the highest existing one — read from the **filename prefix**, not the `YYYY-`
  date folder, and forced base-10 so a leading-zero index isn't parsed as octal:

  ```sh
  last=$(find docs/<type> -name '[0-9][0-9][0-9][0-9]-*.md' -exec basename {} \; \
         | sed -E 's/^([0-9]{4}).*/\1/' | sort -n | tail -1)
  printf '%04d\n' "$([ -n "$last" ] && echo $((10#$last + 1)) || echo 0)"  # empty tree → 0000
  ```

- `<kebab-slug>` is **descriptive** — `0042-retry-storm-on-token-refresh`, never
  `0042-notes` or `0042-fix`. The filename is the first thing both a human and a
  filename-aware retriever match on.

## 4. One concept per file, with a skimmable shape

- **One concept per file.** A file that answers one question ranks cleanly for
  that question; a grab-bag file dilutes every query it could serve. Split when a
  doc grows a second top-level concern.
- **Open with a descriptive H1** that names the thing in the words a searcher
  would use — not "Notes" or "Update".
- **A short status/metadata block** under the H1 (Date, Status, Area, and
  whatever the repo uses) so staleness and ownership are visible at a glance.
- **A clean heading hierarchy**, one concept per section, no skipped levels.
  Heading-aware retrieval chunks on these boundaries, and humans navigate by them.
- **Keep it tight.** Cut throat-clearing and duplication; long docs bury the
  answer (§5) and rot faster.

## 5. Front-load the answer and anchor it lexically

This is the rule that most often decides whether a doc is found:

- **State the answer in plain prose near the top**, in a `## Summary` or lead
  paragraph — before background, history, or derivation. Retrieval and skimming
  both reward the answer being early.
- **Add a retrieval context line when the doc is not self-evident.** In one short
  sentence near the top, name the parent project/module, the workflow or failure
  mode, and the source paths or identifiers the doc explains. This gives
  contextual retrievers and parent/child chunkers the same disambiguating context a
  human would get from opening the full file.
- **Anchor it lexically.** Put the concrete fact — the number, the identifier, the
  command, the error string, the proper noun — in the prose itself, spelled the way
  someone would search for it. An answer that exists only in a table cell, a
  screenshot, an attached file, or implied between the lines is effectively
  unfindable: a query phrased differently from the document shares no surface terms
  with it and will not retrieve it. When you state a figure, name what it measures
  in the same sentence ("cold-start p95 latency dropped from 1.8s to 0.4s"),
  so the sentence matches both the value query and the topic query.
- **Make sections self-contained.** Start each section with the subject it is about
  ("`XqGame::kPolicySize` maps Xiang Qi actions to 8,100 policy slots"), not only
  "This" or "The fix". Chunk-level retrievers may see the section without the H1.
- **Mirror table-only facts in prose.** Tables are good for scanning, but each
  critical row needs a sentence that repeats the value, what it measures, and the
  entity it belongs to.
- **For image-backed workflows, name the asset and the project role.** A screenshot
  or generated image is not enough. State the real image path, what the image is
  used for, which code/docs/scripts consume or derive from it, and what must be
  regenerated when it changes. If the visual is only supporting evidence, say what
  primary source file or session note states the behavior.

## 6. Write for advanced retrieval without bloat

Do the work once in the doc, not once per chunk:

- **Use a compact context capsule.** A good top block is usually `Date`, `Status`,
  `Area`, `Sources`, then `## Summary`. `Sources` should list primary files,
  commands, issue IDs, benchmark data, or `docs/transcripts/` session transcript paths. Keep it short:
  a retriever needs anchors, not a second abstract.
- **Preserve relationship edges.** Say what the doc implements, supersedes,
  depends on, tests, or explains, and link those docs/code paths. Graph-style
  retrieval and rerankers can only use relationships that are explicit in text.
- **Prefer stable names over clever prose.** Use exact API names, config keys,
  file paths, commands, error strings, task IDs, benchmark IDs, and model/version
  names alongside natural-language descriptions.
- **Give image assets a compact source map.** For a small asset family, one
  indexed doc can list each image path, its purpose, its generated/derived
  siblings, the primary code that reads it, and the transcript or plan that
  explains why it exists. Keep this separate from eval questions and expected
  answers so retrieval benchmarks cannot find their own labels.
- **For long transcripts or generated logs, add a human-authored lead summary.**
  Keep the transcript/log faithful, but put the high-signal facts, changed files,
  commands, and outcome near the top so retrieval does not have to mine thousands
  of dialogue tokens before it finds the point.
- **Do not spray boilerplate into every section.** If the same context must repeat
  often, that is a sign the doc wants a source map, glossary, or split file.

## 7. Wire it into the graph

A new doc that nothing points to is nearly as lost as no doc:

- **Add it to the directory index** (`OVERVIEW.md`/`README.md`) — one line, the
  title, and a one-clause hook — in the same change that adds the doc.
- **Cross-link related docs** both ways where it helps. Links are relevance
  edges: they help readers and they let link-aware tooling connect questions to
  answers across files.
- **Mark superseded docs** as such and link forward to what replaced them, rather
  than silently leaving two live versions.

## Anti-patterns (revert these)

- A missing or **unlinked** doc — not in any index, pointed to by nothing.
- A **duplicate** that forks an existing doc instead of updating it.
- An **opaque filename** (`notes.md`, `0042-fix.md`) or a vague H1.
- The **answer buried** below the fold, or living only in a table/figure/attachment
  with no plain-prose, lexically-anchored statement.
- A **context-free chunk**: a section that says "this" or "the change" but does not
  name the project/module, source path, API, command, or error it is about.
- A **grab-bag** file mixing several concepts so it ranks for none.
- A **source map that replaces verification** — it must point to primary code/docs,
  not become an uncited copy that drifts.
- **Bloat** — pages of preamble around a one-paragraph answer.

## Checklist before you finish

- [ ] Searched first (via `retrieving-context`); this isn't a duplicate (or it
      updates the existing doc).
- [ ] Lives in the right place (co-located vs centralized) and follows the repo's
      naming/index convention.
- [ ] One concept; descriptive H1 + status block; clean headings.
- [ ] Answer is in the first screen, in plain prose, with the key fact, source
      path/API/command, and retrieval context spelled out.
- [ ] Linked from its directory index and cross-linked to related docs.
