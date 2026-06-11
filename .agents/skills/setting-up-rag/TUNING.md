# TUNING — validate a config against YOUR corpus before trusting it

The defaults in [`scripts/rag-config.json`](scripts/rag-config.json) are a strong
start, not an oracle. Retrieval quality is corpus-specific: a chunk size, fusion,
or rerank choice that wins on one doc set can lose on another. So treat every
change as a hypothesis and **measure it**. The rule:

> Keep a knob change only if it **beats the current config on a held-out gold
> set**, on recall@k / nDCG / MRR. Otherwise revert. One change at a time, on a
> fresh index, so the effect is attributable.

## 1. Build a small gold set (the only manual part)

Enumerate **realistic queries** over your corpus and, for each, the doc(s) that
truly answer it. Keep it honest:

- **Paraphrase, don't echo.** The query must not quote the answer's unique
  string verbatim, or you measure string matching, not retrieval.
- **Anchor to a checkable fact.** Pick a "sentinel" — a unique token from the
  answer doc (an identifier, a number, a name) — so relevance is objective.
- **Split dev / held-out** by a stable hash of the query id (e.g. even = dev,
  odd = held-out). Tune on dev; confirm the win on held-out. Report the gap — a
  big dev-only gain is overfitting.
- **Aim for ≥ 30–50 queries** spanning easy/medium/hard; small sets give wide
  confidence intervals (honest, but noisy).

A gold record is just: `{query, relevant_doc_paths[], sentinels[], difficulty}`.

## 2. Score a config

Run each gold query through `query.py --json` and compare the returned `doc_id`s
to the gold relevant set:

- **recall@k** — of the relevant docs, how many appear in the top-k (recall@20 is
  the headline answerability signal).
- **precision@k** — of the top-k, how many are relevant.
- **nDCG@10** — rewards ranking the most-relevant doc highest (graded).
- **MRR** — 1/rank of the first relevant hit.

Always score against an **absolute floor** (no retrieval ⇒ every metric 0) and a
**naive baseline** (fixed chunking, dense-only, no rerank), so each number reads as
a _lift_: "is RAG worth it at all" and "is this config better than the dumb one".

## 3. The loop

1. Measure the current config on dev + held-out (fresh index).
2. Change **one** knob (chunk size, `min_words`, fusion, `prefetch`, rerank on/off,
   model). Re-index, re-score.
3. Keep it only if the headline metric holds-or-rises with the improvement clear of
   noise, latency/index cost stays acceptable, and it doesn't regress another
   slice (code vs prose, easy vs hard). Else revert.
4. Watch **both content types separately** if you index prose and code — they
   behave differently and averaging hides regressions.

## 4. Reference implementation

This repo ships a measurement harness that automates exactly this loop —
deterministic gold set, floor/baseline/skill cells, recall/nDCG/MRR, and a
keep/revert scoreboard — under
[`improving-context-retrieval-skills`](../improving-context-retrieval-skills/SKILL.md),
with example results in [`docs/benchmarks/`](../../../docs/benchmarks/). Use it (or
its gold-set + scorer scripts, `gold.py` / `check-retrieval.py`) as the template for
scoring your own corpus. The harness is for _authoring/validating this skill_; for
your own project, the method above is what matters.
