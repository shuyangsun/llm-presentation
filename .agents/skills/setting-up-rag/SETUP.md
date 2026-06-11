# SETUP — provisioning local RAG (read only if `check-local-rag.sh` says NOT_READY)

Do not read this during normal use. The main [SKILL.md](SKILL.md) flow assumes
local RAG is already running. Open this only to provision a fresh host or to
troubleshoot. The one command that does everything:

```sh
bash <skill-dir>/scripts/setup-local-rag.sh          # venv + deps (+ Qdrant if Docker)
bash <skill-dir>/scripts/setup-local-rag.sh --warm   # also pre-download the models
```

It is idempotent — safe to re-run; each step is a no-op if already done.

## What "local RAG" is

Two pieces, both local and CPU-only:

- **Embeddings — [FastEmbed](https://github.com/qdrant/fastembed).** ONNX runtime,
  no PyTorch, no GPU, no cloud key. Dense (`BAAI/bge-small-en-v1.5`, 384-dim) +
  sparse (`Qdrant/bm25`) + an optional cross-encoder reranker
  (`Xenova/ms-marco-MiniLM-L-6-v2`). Models download once (~150 MB total) and cache.
- **Vector store — [Qdrant](https://qdrant.tech).** Either a **server** (Docker,
  persistent, fast) or **embedded on-disk mode** (`QdrantClient(path=…)`, no
  daemon). The scripts pick automatically: server if `$QDRANT_URL` answers, else
  embedded. The same `query_points` hybrid path runs in both.

## Manual steps (if you'd rather not use the helper)

```sh
# 1. Python deps (CPU-only; do NOT also install fastembed-gpu)
python3 -m venv ~/.cache/rag-skill/venv
~/.cache/rag-skill/venv/bin/pip install "qdrant-client[fastembed]"

# 2a. Qdrant as a server (recommended — persistent, has a dashboard at :6333/dashboard)
docker run -d --name rag-qdrant -p 6333:6333 -p 6334:6334 \
  -v "$HOME/.cache/rag-skill/qdrant-storage:/qdrant/storage" qdrant/qdrant
# 2b. …or do nothing: with no Docker the scripts use embedded on-disk mode.
```

Then re-run `check-local-rag.sh`; it should print `READY`.

## Environment variables

| Var           | Default                     | Purpose                                             |
| ------------- | --------------------------- | --------------------------------------------------- |
| `RAG_HOME`    | `~/.cache/rag-skill`        | venv, embedded Qdrant storage, model cache          |
| `RAG_PYTHON`  | `$RAG_HOME/venv/bin/python` | interpreter with the deps (else falls back to PATH) |
| `QDRANT_URL`  | `http://localhost:6333`     | live server; probed before falling back to embedded |
| `QDRANT_PATH` | `$RAG_HOME/qdrant`          | embedded on-disk store when no server               |

## Alternatives

- **Bigger/better dense model** — set `embedding.dense_model` to
  `BAAI/bge-base-en-v1.5` (768-dim, stronger, slower) and `dense_dim` to 768, then
  re-index with `--recreate`.
- **Learned sparse (SPLADE)** instead of bm25 — set `embedding.sparse_model` to
  `prithivida/Splade_PP_en_v1` (better recall, larger/slower). bm25 needs no model
  download beyond a tiny vocab and is the robust default for code/identifier-heavy
  corpora.
- **Ollama embeddings** — if you already run Ollama, `nomic-embed-text` (768-dim)
  is a fine local dense model; swap the embedding call in `rag_lib.py` and set
  `dense_dim` to 768. FastEmbed remains the zero-extra-infra default.

## Troubleshooting

- **`NOT_READY` after setup** — deps didn't install into the resolved interpreter.
  Check `RAG_PYTHON` points at the venv; re-run setup.
- **First query is slow** — model download on first use. Run setup with `--warm`,
  or just let the first call cache the models.
- **Docker daemon not running** — fine; the scripts use embedded on-disk mode.
  Start Docker only if you want the persistent server + dashboard.
- **"Storage folder already accessed by another instance"** — embedded on-disk
  mode is **single-writer**: don't run `index.py` and `query.py` against the same
  `$QDRANT_PATH` at once. Wait for indexing to finish, or run a Qdrant server
  (`$QDRANT_URL`) for concurrent access. (The scripts now report this clearly
  rather than tracebacking.)
- **bm25 ranking differs server vs embedded** — sparse IDF weighting (`Modifier.IDF`)
  is applied by whichever backend serves the query; parity across the two is
  qdrant-client-version-dependent. For a corpus you care about, index and query
  through the **server** (this skill is verified on `qdrant-client` 1.18 / `fastembed`
  0.8). Embedded mode is for dev and small/local corpora.
- **Offline host** — pre-warm on a connected host (`--warm`) and copy
  `$RAG_HOME` (or the FastEmbed cache) over; embeddings then run fully offline.
