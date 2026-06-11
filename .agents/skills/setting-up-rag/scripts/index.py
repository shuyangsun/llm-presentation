#!/usr/bin/env python3
"""index.py — chunk a doc set, embed (dense + sparse), and upsert into Qdrant.

Builds a hybrid collection with two named vectors: a dense vector (FastEmbed,
e.g. bge-small) and a sparse vector (FastEmbed, e.g. bm25). The retrieval method
is in RETRIEVAL.md; chunking is in CHUNKING.md; knobs live in rag-config.json.

Usage:
  index.py --corpus docs/ [--kind md|code] [--collection docs]
           [--config rag-config.json] [--recreate]

Reads QDRANT_URL (live server) or falls back to embedded on-disk mode
($QDRANT_PATH / $RAG_HOME). See check-local-rag.sh / setup-local-rag.sh.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rag_lib as R  # noqa: E402
from snowflake import Snowflake  # noqa: E402


def sparse_modifier(model: str):
    from qdrant_client import models
    # bm25 / bm42 emit raw term frequencies; Qdrant applies IDF server-side.
    # Learned sparse (SPLADE) already encodes weighting -> no modifier.
    if "bm25" in model.lower() or "bm42" in model.lower():
        return models.Modifier.IDF
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--corpus", required=True, help="directory of docs to index")
    ap.add_argument("--kind", choices=["md", "code"], default="md")
    ap.add_argument("--collection")
    ap.add_argument("--config")
    ap.add_argument("--recreate", action="store_true", help="drop the collection first")
    ap.add_argument("--local", action="store_true", help="force embedded on-disk mode (skip the server probe)")
    ap.add_argument("--batch", type=int, default=256)
    args = ap.parse_args(argv)

    cfg = R.load_config(args.config)
    coll = args.collection or cfg.get("collection", "docs")
    client, where = R.get_client(force_local=args.local)
    from qdrant_client import models

    # chunk every doc
    docs = R.load_corpus(args.corpus, kind=args.kind)
    chunks: list[str] = []
    meta: list[dict] = []
    for doc_id, text in docs.items():
        for i, c in enumerate(R.chunk(text, cfg, args.kind)):
            chunks.append(c)
            meta.append({"doc_id": doc_id, "chunk_idx": i, "kind": args.kind})
    if not chunks:
        sys.exit(f"index: no chunks produced from {args.corpus} (kind={args.kind})")

    # (re)create the hybrid collection
    emb = cfg["embedding"]
    doc_ids = sorted({m["doc_id"] for m in meta})
    existed = client.collection_exists(coll)
    if args.recreate and existed:
        client.delete_collection(coll)
        existed = False
    if not existed:
        client.create_collection(
            coll,
            vectors_config={"dense": models.VectorParams(
                size=int(emb["dense_dim"]),
                distance=getattr(models.Distance, emb.get("distance", "cosine").upper()),
            )},
            sparse_vectors_config={"sparse": models.SparseVectorParams(
                modifier=sparse_modifier(emb["sparse_model"]),
            )},
        )
    else:
        # Snowflake ids are time-based, not content-addressed, so re-indexing would
        # otherwise APPEND fresh-id duplicates of every chunk. Delete each doc's
        # prior points (by doc_id) first, so re-indexing a changed/added doc
        # replaces rather than duplicates. (Fully *removed* docs still need a
        # --recreate; noted in SKILL.md.) This delete is load-bearing here.
        client.delete(coll, points_selector=models.FilterSelector(filter=models.Filter(
            must=[models.FieldCondition(key="doc_id", match=models.MatchAny(any=doc_ids))]
        )))

    # embed + upsert in batches. Point ids are Snowflakes (64-bit, time-ordered,
    # epoch 2026-06-08) — see snowflake.py.
    sf = Snowflake()
    n = len(chunks)
    print(f"index: {len(docs)} docs -> {n} chunks -> collection '{coll}' ({where})")
    for start in range(0, n, args.batch):
        batch = chunks[start:start + args.batch]
        dense, sparse = R.embed_documents(batch, cfg)
        points = [
            models.PointStruct(
                id=sf.next_id(),
                vector={"dense": dense[j], "sparse": R.to_sparse_vector(sparse[j])},
                payload={**meta[start + j], "text": batch[j]},
            )
            for j in range(len(batch))
        ]
        client.upsert(coll, points=points)
        print(f"  upserted {min(start + args.batch, n)}/{n}")
    print(f"index: done — {n} chunks in '{coll}'")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
