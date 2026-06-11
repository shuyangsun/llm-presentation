# CHUNKING — how the corpus is split before embedding

Chunking is the highest-leverage retrieval choice: the chunk is the unit that gets
embedded, retrieved, and handed to the consumer. Too big and the embedding is
diluted and the consumer drowns; too small and a chunk loses the context that made
it answerable. The implementation is `chunk_*` in
[`scripts/rag_lib.py`](scripts/rag_lib.py); the knobs are the `chunker` block of
[`scripts/rag-config.json`](scripts/rag-config.json) (all sizes in **words**).

## Prose / markdown (`--kind md`)

**Structure-aware with a size floor.** Split on Markdown headings so each chunk is
a coherent section, then:

1. **Merge tiny adjacent sections** up to `min_words` (default 80). Heading-dense
   docs (changelogs, dialog transcripts with `## User` / `## Assistant`, deep
   outlines) otherwise explode into hundreds of one- or two-line chunks — each a
   weak, near-duplicate embedding that bloats the index and dilutes ranking. On
   this repo's `docs/`, the floor cut chunk count ≈2.5× (2729 → 1092) at equal
   recall: fewer, denser, better-separated vectors and a smaller, faster index.
2. **Window over-long sections** (> `size`, default 350) into fixed word windows
   with `overlap` (default 40) so a long section is still retrievable in pieces and
   a fact that straddles a window boundary survives in the overlap.

Why these numbers: ~350 words (~450–500 tokens) is large enough to hold a
self-contained answer and small enough that one topic dominates the embedding;
~10% overlap is the usual boundary-safety margin without much duplication.

## Code (`--kind code`)

**Block-packed.** Source code has no headings, and fixed character windows slice
through the middle of functions. Instead, pack blank-line-separated blocks
(functions, config stanzas, import groups) up to `code_size` (default 120 words),
keeping small functions and config objects whole; any single over-long block falls
back to fixed windows (`code_overlap` 20). Smaller than prose because a code
"unit" (a function, a config key) is smaller and you want the matching symbol to
dominate its chunk.

## What to tune, and how to know

- **Heading-dense corpus still over-chunking?** Raise `min_words` (e.g. 120).
- **Answers truncated / context split across chunks?** Raise `size` and/or
  `overlap`.
- **Index too large / near-duplicate hits?** Raise `min_words`, lower `overlap`.

Chunking interacts with retrieval and reranking, so never eyeball it — change one
knob, re-index, and re-score on the held-out gold set ([TUNING.md](TUNING.md)).
Keep the change only if recall@k / nDCG hold or rise. A structural choice that
helps heading-aware retrieval can hurt a flat dump, so validate on a corpus that
matches your real one.
