#!/usr/bin/env bash
# setup-local-rag.sh — provision local RAG (Qdrant + FastEmbed), idempotently.
# Run ONCE per host, only when check-local-rag.sh says NOT_READY. Details and
# alternatives (Ollama, manual install) are in SETUP.md.
#
# Does three things, each a no-op if already done:
#   1. create a venv under $RAG_HOME and install qdrant-client[fastembed] (CPU),
#   2. if Docker is available and no server is up, start a persistent Qdrant
#      container (otherwise the scripts use embedded on-disk mode, no daemon),
#   3. with --warm, pre-download the FastEmbed models so the first query is fast.
#
# Env: RAG_HOME (default ~/.cache/rag-skill), QDRANT_URL (default :6333).
set -euo pipefail

WARM=0
[ "${1:-}" = "--warm" ] && WARM=1

RAG_HOME="${RAG_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/rag-skill}"
VENV="$RAG_HOME/venv"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"
SK_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$RAG_HOME"

# 1. venv + deps -------------------------------------------------------------
if [ ! -x "$VENV/bin/python" ]; then
  echo "setup: creating venv at $VENV"
  python3 -m venv "$VENV"
fi
PY="$VENV/bin/python"
if ! "$PY" -c 'import qdrant_client, fastembed' >/dev/null 2>&1; then
  echo "setup: installing qdrant-client[fastembed] (CPU; this can take a few minutes)"
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet "qdrant-client[fastembed]"
fi
echo "setup: deps OK ($("$PY" -c 'import importlib.metadata as m; print("qdrant-client", m.version("qdrant-client"), "fastembed", m.version("fastembed"))' 2>/dev/null || echo installed))"

# 2. qdrant server (optional; embedded on-disk mode works without it) --------
if command -v curl >/dev/null 2>&1 && curl -fsS -m 2 "$QDRANT_URL/healthz" >/dev/null 2>&1; then
  echo "setup: Qdrant server already up at $QDRANT_URL"
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ -z "$(docker ps -q -f name=^rag-qdrant$)" ]; then
    echo "setup: starting Qdrant container 'rag-qdrant'"
    docker rm -f rag-qdrant >/dev/null 2>&1 || true
    docker run -d --name rag-qdrant -p 6333:6333 -p 6334:6334 \
      -v "$RAG_HOME/qdrant-storage:/qdrant/storage" qdrant/qdrant >/dev/null
    echo "setup: Qdrant starting on $QDRANT_URL (storage: $RAG_HOME/qdrant-storage)"
  else
    echo "setup: Qdrant container 'rag-qdrant' already running"
  fi
else
  echo "setup: no Docker daemon — scripts will use embedded on-disk mode (\$QDRANT_PATH=$RAG_HOME/qdrant)"
fi

# 3. warm models (optional) --------------------------------------------------
if [ "$WARM" = 1 ]; then
  echo "setup: warming FastEmbed models (downloads ONNX weights once)"
  "$PY" - "$SK_DIR" <<'PY'
import json, sys
from pathlib import Path
cfg = json.loads((Path(sys.argv[1]) / "rag-config.json").read_text())
from fastembed import TextEmbedding, SparseTextEmbedding
list(TextEmbedding(cfg["embedding"]["dense_model"]).embed(["warm"]))
list(SparseTextEmbedding(cfg["embedding"]["sparse_model"]).embed(["warm"]))
if cfg.get("rerank", {}).get("enabled"):
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    list(TextCrossEncoder(cfg["rerank"]["model"]).rerank("warm", ["warm"]))
print("setup: models warmed")
PY
fi

echo "setup: done. RAG_PYTHON=$PY"
echo "setup: verify with  bash \"$SK_DIR/check-local-rag.sh\""
