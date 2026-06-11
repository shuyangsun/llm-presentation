#!/usr/bin/env python3
"""query.py — hybrid retrieval over a Qdrant collection, with optional rerank.

Pipeline (see RETRIEVAL.md):
  1. embed the query (dense + sparse),
  2. Qdrant Query API: a dense prefetch and a sparse prefetch, fused with RRF,
  3. optional in-process cross-encoder rerank of the fused top_n,
  4. return top_k chunks (doc_id, score, snippet).

Usage:
  query.py "your question" [--collection docs] [--config rag-config.json]
           [--top-k 20] [--no-rerank] [--json]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_lib as R  # noqa: E402


def retrieve(client, coll: str, query: str, cfg: dict, top_k: int, do_rerank: bool):
    from qdrant_client import models

    dv, sv = R.embed_query(query, cfg)
    prefetch = int(cfg.get("hybrid", {}).get("prefetch", 60))
    rr = cfg.get("rerank", {})
    # fetch enough to feed the reranker when it is on, else just top_k
    fuse_limit = max(top_k, int(rr.get("top_n", 50))) if (do_rerank and rr.get("enabled")) else top_k
    fusion = models.Fusion.DBSF if cfg.get("hybrid", {}).get("fusion") == "dbsf" else models.Fusion.RRF

    hits = client.query_points(
        coll,
        prefetch=[
            models.Prefetch(query=dv, using="dense", limit=prefetch),
            models.Prefetch(query=R.to_sparse_vector(sv), using="sparse", limit=prefetch),
        ],
        query=models.FusionQuery(fusion=fusion),
        limit=fuse_limit,
        with_payload=True,
    ).points

    if do_rerank and rr.get("enabled") and hits:
        texts = [h.payload.get("text", "") for h in hits]
        scores = R.rerank(query, texts, cfg)  # aligned to `hits`
        order = sorted(range(len(hits)), key=lambda i: scores[i], reverse=True)
        ranked = [(hits[i], scores[i]) for i in order]
    else:
        ranked = [(h, h.score) for h in hits]
    return ranked[:top_k]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("query", help="the natural-language query")
    ap.add_argument("--collection")
    ap.add_argument("--config")
    ap.add_argument("--top-k", type=int, help="number of results (default: config top_k)")
    ap.add_argument("--no-rerank", action="store_true")
    ap.add_argument("--local", action="store_true", help="force embedded on-disk mode (skip the server probe)")
    ap.add_argument("--json", action="store_true", help="emit JSONL of {doc_id, score, text}")
    args = ap.parse_args(argv)

    cfg = R.load_config(args.config)
    coll = args.collection or cfg.get("collection", "docs")
    top_k = args.top_k if args.top_k is not None else int(cfg.get("top_k", 20))
    used_rerank = (not args.no_rerank) and bool(cfg.get("rerank", {}).get("enabled"))
    client, where = R.get_client(force_local=args.local)
    if not client.collection_exists(coll):
        sys.exit(f"query: collection '{coll}' not found ({where}). Run index.py first.")

    ranked = retrieve(client, coll, args.query, cfg, top_k, do_rerank=not args.no_rerank)

    if args.json:
        for hit, score in ranked:
            print(json.dumps({
                "doc_id": hit.payload.get("doc_id"),
                "chunk_idx": hit.payload.get("chunk_idx"),
                "score": float(score),
                "text": hit.payload.get("text", ""),
            }))
        return 0
    scale = "cross-encoder logits" if used_rerank else "RRF fused score"
    print(f"# {len(ranked)} results for: {args.query}  ({where}, collection '{coll}', scores: {scale})")
    for rank, (hit, score) in enumerate(ranked, 1):
        text = (hit.payload.get("text", "") or "").replace("\n", " ")
        snippet = text[:160] + ("…" if len(text) > 160 else "")
        print(f"{rank:>2}. [{score:+.4f}] {hit.payload.get('doc_id')}#{hit.payload.get('chunk_idx')}  {snippet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
