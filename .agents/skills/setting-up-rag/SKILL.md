---
name: setting-up-rag
description: Load when STANDING UP or TUNING a local retrieval (RAG) system over a
  document or code set — provision the stack, chunk, embed, index, and configure
  hybrid (dense+sparse) search, reranking, and vector-DB knobs. Local-first
  (Qdrant + FastEmbed, CPU, no cloud). To merely RETRIEVE context for a task (not
  build the index), load `retrieving-context` instead; it queries this stack.
---

# Setting up RAG — local-first retrieval over a doc set

**Stand up and tune** effective retrieval over a given corpus (markdown docs,
transcripts, or source code) so a downstream agent can answer from it. The
pipeline is **Qdrant + FastEmbed**, CPU-only, no cloud key: chunk → embed
(dense + sparse) → index → hybrid retrieve (RRF) → rerank → top-k. Defaults live
in [`scripts/rag-config.json`](scripts/rag-config.json); the helpers do the
mechanics, so spend tokens on the corpus-specific choices, not the boilerplate.

> **Building the index vs. using it.** This skill is the **operator** side —
> provision the stack, index a corpus, and tune the config. An agent that just
> needs to **retrieve context to answer a question or do a task** should load
> [`retrieving-context`](../retrieving-context/SKILL.md) instead: it routes to
> the best retrieval available and queries _this_ local stack (the `query.py`
> below) when it is running. Come here to build or improve what it queries.

This file assumes local RAG is **already running**. The first two lines below
handle the one case where it isn't — do not read the setup docs otherwise.

## 0. Make sure local RAG is up (one-time per host)

```sh
bash <skill-dir>/scripts/check-local-rag.sh   # prints READY or NOT_READY
```

If it prints **`NOT_READY`**, provision once with
`bash <skill-dir>/scripts/setup-local-rag.sh` (add `--warm` to pre-download
models). Only then open [SETUP.md](SETUP.md) — for Docker/Ollama/offline
specifics or troubleshooting. If it prints **`READY`**, skip all of that and go
to §1. (Qdrant runs as a server when one is up, else embedded on-disk with no
daemon; both use the same code path.)

## 1. Index the corpus

```sh
python3 <skill-dir>/scripts/index.py --corpus <dir> --kind md   # prose/markdown
python3 <skill-dir>/scripts/index.py --corpus <dir> --kind code # source code
```

Indexes into a hybrid collection (named `dense` + `sparse` vectors); point IDs are
time-ordered Snowflakes (`snowflake.py`). **Re-running replaces the prior chunks of
changed and added docs** — each doc's old points are dropped before re-insert, so
no duplicates or orphans accumulate. Pass `--recreate` after a chunking/embedding
change or when docs were **removed**; `--local` forces embedded mode. Use a
distinct `--collection` per corpus or content type. Chunking adapts to `--kind`
(heading-aware for prose, block-packed for code) — see [CHUNKING.md](CHUNKING.md).

The loader prunes nested VCS roots below the selected corpus root. A Jujutsu
workspace created inside a repo (`jj workspace add <name>`) or a Git worktree
inside the repo is not indexed as part of the parent corpus; pass that
workspace/worktree as `--corpus` directly if it is the corpus you want. This keeps
the behavior generic across repositories. A repo-specific `.gitignore` pattern
for predictable workspace directory names is a useful extra guard, but the indexer
does not rely on it.

## 2. Query

```sh
python3 <skill-dir>/scripts/query.py "a natural-language question" --top-k 20
python3 <skill-dir>/scripts/query.py "…" --json        # JSONL for a consumer/eval
python3 <skill-dir>/scripts/query.py "…" --no-rerank   # skip the rerank stage
```

Each query runs a dense and a sparse retrieval, fuses them with RRF, then a local
cross-encoder reranks the top candidates. The how-and-why is in
[RETRIEVAL.md](RETRIEVAL.md).

## 3. The method (what makes retrieval good, in priority order)

1. **Hybrid beats either arm alone.** Dense (semantic, `bge-small`) catches
   paraphrase; sparse (lexical, `bm25`) catches exact identifiers, error codes,
   API names. Fuse rank lists with **RRF** (robust to incompatible score scales).
2. **Chunk on structure, with a size floor.** Split markdown on headings, but
   **merge tiny sections** up to `min_words` so a heading-dense doc doesn't
   explode into hundreds of one-line chunks (a real cost: ~2.5× fewer chunks at
   equal recall on this repo). Code chunks pack whole blocks. → [CHUNKING.md](CHUNKING.md)
3. **Rerank the shortlist.** A cross-encoder re-scores the fused top-N; it sharply
   separates the right chunk from near-misses, at a small CPU cost. Worth it for
   search; drop it when latency is critical. → [RETRIEVAL.md](RETRIEVAL.md)
4. **Right-size top-k and prefetch** to the consumer's context budget.

## 4. Tune and validate against YOUR corpus — don't trust defaults blindly

The defaults are a strong start, **not** a guarantee. A knob that helps one corpus
can hurt another. Before keeping any change: build a small held-out gold query set
and confirm the change **beats the baseline** on recall@k / nDCG / MRR. Method,
gold-set construction, and the keep/revert rule are in [TUNING.md](TUNING.md).

## 5. Config

All knobs are in [`scripts/rag-config.json`](scripts/rag-config.json) (models,
chunk sizes, fusion, prefetch, rerank, top-k) and documented inline. Pass an
edited copy with `--config`. Provider/model alternatives (bigger dense model,
SPLADE sparse, Ollama embeddings) are noted there and in SETUP.md.

## 6. Optional: local-GPU campaign upgrades (not in the CPU default)

The default above is CPU-only and ships as-is. With a local GPU and an
OpenAI-compatible LLM endpoint, **contextual retrieval** is a measured upgrade for
mixed **code**+docs corpora — generate a 1–2-sentence "situating context" per chunk
with a local model and prepend it to the **embedding/sparse** field, keeping
`raw_text` byte-verbatim for citations:

```text
[repo] path :: heading/symbol (lang)     # deterministic header — keep it
<LLM: "Defines the MctsConfig struct … for Monte-Carlo Tree Search.">
                                         # blank line
<verbatim raw_text>                      # embedded AND what is retrieved/cited
```

Measured on a six-repo gold set (held-out): **nDCG +0.031 overall, +0.045 on the code
domain, sentinel coverage +0.080**, and it is **index-time only** — query latency and
answer-context token cost are unchanged (the context is embedded, never packed into the
answer). Lessons that transfer:

- **Contextualize all chunks, code included** — the "it'll dilute identifiers" worry was
  wrong; code is exactly where it helps (prose is usually already near ceiling).
- **Keep the deterministic header** — dropping it regresses prose retrieval.
- **Serve the generator with vLLM** (NVFP4/FP8), not llama.cpp GGUF-Q8: ~25× faster for
  this bulk index-time pass (≈8 vs ≈0.3 chunk/s on a Blackwell GPU).
- It needs an index-time LLM, so it is **campaign-only**; the portable default stays CPU.

Method + numbers: `docs/benchmarks/2026-06-10/0014`–`0015` and the campaign harness
(`wave4_context.py`) under `docs/plans/2026-06-08/0008-…/`. Re-validate on YOUR corpus (§4).

### Other index-time techniques, measured on the same gold set

The **one rule** that explains all of them: index-time context helps only when it **sharpens** a
chunk's identity, and it must apply to **code**, not just prose.

- **Doc2Query / document expansion** (campaign, index-time LLM — `0018`): generate a few search
  queries each chunk answers and append them to a **separate BM25 field** (lexical only — leave
  dense and `raw_text` untouched). A real **code** win (held-out nDCG +0.030, sentinel +0.082) at
  ≈ contextual-retrieval quality, but it regresses some prose slices, so contextual retrieval is the
  cleaner default. Apply to **all** chunks — prose-only **regressed code**.
- **Session metadata capsule** (portable, deterministic, **no LLM** — `0017`): for session/coding
  **transcripts** (`…/coding-sessions/…`, `…/llm-sessions-history/…`), prepend `session <id>
<vendor> <date> — <name>; files: <files it touched>` to each chunk. The live signal is the
  **mentioned-file list** (the path already gives date/index/vendor). Optional, corpus-conditional —
  it drove transcript retrieval to near-perfect on a transcript-heavy repo; flat elsewhere. Enable +
  validate on a gold set; don't ship it as a forced default.
- **Late chunking / LLM-free contextual embedding** — **tested and rejected** (`0016`): pooling each
  chunk over whole-document context (bge-m3) **blurs** within-document discrimination and regressed
  every slice (nDCG −0.115). There is no cheap LLM-free substitute for contextual retrieval here.
- **Measurement caveat:** Qdrant HNSW re-indexing is non-deterministic at ~**0.03** per single
  slice — trust domain aggregates + cross-split replication, not a lone small per-slice delta.
