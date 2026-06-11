#!/usr/bin/env bash
# check-local-rag.sh — is local RAG already set up? The gate the SKILL.md uses to
# decide whether to read SETUP.md / run setup-local-rag.sh.
#
# "Ready" = the Python deps (qdrant-client + fastembed) import. Qdrant then runs
# either as a live server ($QDRANT_URL) or, with no daemon, in embedded on-disk
# mode — so deps alone are enough to retrieve. Server status is reported as a
# bonus (persistence + speed), never required.
#
# Exit 0 + prints READY when deps are present; exit 1 + NOT_READY otherwise.
set -euo pipefail

RAG_HOME="${RAG_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/rag-skill}"
PY="${RAG_PYTHON:-$RAG_HOME/venv/bin/python}"
[ -x "$PY" ] || PY="$(command -v python3 || true)"
QDRANT_URL="${QDRANT_URL:-http://localhost:6333}"

deps=missing
if [ -n "$PY" ] && "$PY" -c 'import qdrant_client, fastembed' >/dev/null 2>&1; then
  deps=ok
fi
server=down
if command -v curl >/dev/null 2>&1 && curl -fsS -m 2 "$QDRANT_URL/healthz" >/dev/null 2>&1; then
  server=up
fi

echo "RAG_HOME=$RAG_HOME"
echo "PYTHON=${PY:-<none>}"
echo "DEPS=$deps"
echo "QDRANT_SERVER=$server ($QDRANT_URL)"
if [ "$deps" = ok ]; then
  [ "$server" = up ] && echo "STATUS=READY (server)" || echo "STATUS=READY (embedded on-disk mode; no server)"
  exit 0
fi
echo "STATUS=NOT_READY — run: bash \"$(cd "$(dirname "$0")" && pwd)/setup-local-rag.sh\""
exit 1
