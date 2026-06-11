#!/usr/bin/env python3
"""rag_lib.py — shared helpers for the `setting-up-rag` skill's local Qdrant pipeline.

Local-first by design: embeddings run on CPU via FastEmbed (ONNX, no torch, no
cloud); the vector store is Qdrant, reached over HTTP when a server is up
($QDRANT_URL, default http://localhost:6333) or falling back to qdrant-client's
embedded on-disk mode ($QDRANT_PATH) so the skill still works with no daemon.

Nothing here is repo-specific: callers pass a corpus directory and a config path.
`index.py` and `query.py` are thin CLIs over these helpers; the retrieval method
they implement is documented in RETRIEVAL.md and CHUNKING.md.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

# --- config -----------------------------------------------------------------
DEFAULT_CONFIG = Path(__file__).with_name("rag-config.json")


def load_config(path: str | None = None) -> dict:
    p = Path(path) if path else DEFAULT_CONFIG
    return json.loads(p.read_text(encoding="utf-8"))


def _need_deps():
    """Import the optional heavy deps lazily with a friendly message so that
    `--help` and config errors do not require a provisioned environment."""
    try:
        import fastembed  # noqa: F401
        import qdrant_client  # noqa: F401
    except ImportError as exc:  # pragma: no cover - environment dependent
        sys.exit(
            f"rag: missing dependency ({exc.name}). Local RAG is not set up yet.\n"
            f"     Run:  bash {Path(__file__).resolve().parent}/setup-local-rag.sh\n"
            f"     (or:  pip install 'qdrant-client[fastembed]')"
        )


# --- corpus loading ---------------------------------------------------------
# Language-aware code set. The C/C++/CUDA/CMake/shell/config extensions (and the
# extensionless build files below) were added 2026-06-09: the original JS/TS/Python
# list silently skipped every `.cc`/`.h`/`.cuh`/`CMakeLists.txt`, so on a C++/CUDA
# repo the `code` corpus loaded almost nothing. (`.md` stays here so `--kind code`
# co-indexes a repo's docs with its code — they are one retrieval task.)
CODE_EXTS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
             ".py", ".go", ".rs", ".java", ".rb",
             ".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".hh", ".hxx", ".cu", ".cuh",
             ".cmake", ".sh", ".bash", ".zsh", ".yml", ".yaml", ".toml",
             ".css", ".scss", ".less", ".html", ".json", ".jsonc", ".wgsl", ".glsl",
             ".md", ".mdx")
# Extensionless / fixed-name build files that are code by filename, not extension.
CODE_FILENAMES = frozenset({"CMakeLists.txt", "Makefile", "Dockerfile"})
SKIP_DIRS = {"node_modules", "dist", "build", ".output", ".vite", ".nitro",
             ".git", ".jj", ".turbo", "coverage", ".cache", "__pycache__", ".venv"}
SKIP_FILES = {"bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"}
VCS_BOUNDARY_MARKERS = (".git", ".jj")


def _is_vcs_root(path: Path) -> bool:
    return any((path / marker).exists() for marker in VCS_BOUNDARY_MARKERS)


def _git_unignored_files(base: Path) -> set[str] | None:
    """Paths under `base` that git does NOT ignore (tracked + untracked-but-unignored),
    base-relative POSIX. None when `base` is not inside a git work tree or git is
    unavailable, so the caller falls back to a plain walk.

    This makes the corpus respect `.gitignore`: generated/build output (an ML repo's
    git-ignored `artifacts/` of multi-MB training traces, a `dist/`/`build/` tree, model
    checkpoints, logs) is never indexed — it is retrieval noise that also blows up index
    time. `-co --exclude-standard` keeps new untracked source you have not committed yet,
    dropping only what `.gitignore` (and global/info excludes) actually ignore.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(base), "ls-files", "-co", "--exclude-standard", "-z"],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return {p for p in out.stdout.split("\0") if p}


def _iter_corpus_files(base: Path, kind: str):
    """Yield indexable files without crossing into nested VCS workspaces.

    The corpus root itself may be a Git worktree or Jujutsu workspace. Only VCS
    roots strictly below it are pruned, so indexing a workspace directly still
    works while indexing its parent does not duplicate that workspace's files.
    """
    if kind == "md":
        def wanted(name: str) -> bool:
            return name.endswith(".md")
    elif kind == "code":
        def wanted(name: str) -> bool:
            return name.endswith(CODE_EXTS) or name in CODE_FILENAMES
    else:
        sys.exit(f"rag: unknown corpus kind {kind!r} (use md|code)")

    for dirpath, dirnames, filenames in os.walk(base):
        current = Path(dirpath)
        if current != base and _is_vcs_root(current):
            dirnames[:] = []
            continue

        kept_dirs = []
        for dirname in sorted(dirnames):
            child = current / dirname
            if dirname in SKIP_DIRS or _is_vcs_root(child):
                continue
            kept_dirs.append(dirname)
        dirnames[:] = kept_dirs

        for filename in sorted(filenames):
            if wanted(filename):
                yield current / filename


def load_corpus(root: str, kind: str = "md") -> dict[str, str]:
    """Map corpus-root-relative POSIX path -> document text.

    kind="md"   : every *.md under root (prose: docs, notes, transcripts).
    kind="code" : every CODE_EXTS file, skipping dependency/build dirs + lockfiles.
    """
    base = Path(root).expanduser().resolve()
    if not base.is_dir():
        sys.exit(f"rag: corpus dir not found: {base}")
    unignored = _git_unignored_files(base)  # respect .gitignore; None => not a git repo
    docs: dict[str, str] = {}
    for path in _iter_corpus_files(base, kind):
        rel = path.relative_to(base).as_posix()
        if path.name in SKIP_FILES:
            continue
        if unignored is not None and rel not in unignored:
            continue  # git-ignored generated/build output — never indexed
        try:
            docs[rel] = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:  # pragma: no cover - defensive
            print(f"rag: warning: cannot read {rel}: {exc}", file=sys.stderr)
    return docs


# --- chunking (see CHUNKING.md) ---------------------------------------------
_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+", re.MULTILINE)


def _words(text: str) -> list[str]:
    return text.split()


def _fixed(text: str, size: int, overlap: int) -> list[str]:
    w = _words(text)
    if not w:
        return []
    if len(w) <= size:
        return [" ".join(w)]
    step = max(1, size - overlap)
    return [" ".join(w[i:i + size]) for i in range(0, len(w), step) if w[i:i + size]]


def chunk_markdown(text: str, size: int, overlap: int, min_words: int) -> list[str]:
    """Heading-aware: split on Markdown headings, then (a) fall back to fixed
    windows for over-long sections and (b) merge consecutive tiny sections up to
    `min_words` so a heading-dense doc does not explode into one-line chunks."""
    # split into heading-led sections
    sections: list[str] = []
    cur: list[str] = []
    for line in text.splitlines():
        if _HEADING.match(line) and cur:
            sections.append("\n".join(cur))
            cur = [line]
        else:
            cur.append(line)
    if cur:
        sections.append("\n".join(cur))
    # merge tiny adjacent sections up to the min-words floor
    merged: list[str] = []
    buf = ""
    for sec in sections:
        if not sec.strip():
            continue
        buf = f"{buf}\n\n{sec}".strip() if buf else sec
        if len(_words(buf)) >= min_words:
            merged.append(buf)
            buf = ""
    if buf:
        if merged:
            merged[-1] = f"{merged[-1]}\n\n{buf}"
        else:
            merged.append(buf)
    # split any still-too-long section into fixed windows
    out: list[str] = []
    for sec in merged:
        out.extend(_fixed(sec, size, overlap) if len(_words(sec)) > size else [sec])
    return out or _fixed(text, size, overlap)


def chunk_code(text: str, size: int, overlap: int) -> list[str]:
    """Code: pack blank-line-separated blocks up to `size` words (keeps small
    functions/configs whole), splitting any over-long block into fixed windows."""
    blocks = [b for b in re.split(r"\n\s*\n", text) if b.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    n = 0
    for b in blocks:
        bw = len(_words(b))
        if n + bw > size and buf:
            chunks.append("\n\n".join(buf))
            buf, n = [], 0
        buf.append(b)
        n += bw
    if buf:
        chunks.append("\n\n".join(buf))
    out: list[str] = []
    for c in chunks:
        out.extend(_fixed(c, size, overlap) if len(_words(c)) > size else [c])
    return out or _fixed(text, size, overlap)


def chunk(text: str, cfg: dict, kind: str) -> list[str]:
    ch = cfg.get("chunker", {})
    if kind == "code":
        return chunk_code(text, int(ch.get("code_size", 120)), int(ch.get("code_overlap", 20)))
    return chunk_markdown(
        text,
        int(ch.get("size", 350)),
        int(ch.get("overlap", 40)),
        int(ch.get("min_words", 80)),
    )


# --- embedding (FastEmbed, CPU) ---------------------------------------------
@lru_cache(maxsize=4)
def _dense(model: str):
    from fastembed import TextEmbedding
    return TextEmbedding(model)


@lru_cache(maxsize=4)
def _sparse(model: str):
    from fastembed import SparseTextEmbedding
    return SparseTextEmbedding(model)


@lru_cache(maxsize=4)
def _reranker(model: str):
    from fastembed.rerank.cross_encoder import TextCrossEncoder
    return TextCrossEncoder(model)


def embed_documents(texts: list[str], cfg: dict):
    """Return (dense_vectors[list[list[float]]], sparse_embeddings[list])."""
    emb = cfg["embedding"]
    dense = [v.tolist() for v in _dense(emb["dense_model"]).embed(texts)]
    sparse = list(_sparse(emb["sparse_model"]).embed(texts))
    return dense, sparse


def embed_query(text: str, cfg: dict):
    """Return (dense_vector[list[float]], sparse_embedding) for a query.
    FastEmbed exposes query_embed for asymmetric models (e.g. bm25)."""
    emb = cfg["embedding"]
    dv = list(_dense(emb["dense_model"]).query_embed(text))[0].tolist()
    sv = list(_sparse(emb["sparse_model"]).query_embed(text))[0]
    return dv, sv


def to_sparse_vector(sparse_embedding):
    """FastEmbed SparseEmbedding -> qdrant SparseVector."""
    from qdrant_client import models
    return models.SparseVector(
        indices=sparse_embedding.indices.tolist(),
        values=sparse_embedding.values.tolist(),
    )


def rerank(query: str, texts: list[str], cfg: dict) -> list[float]:
    rr = cfg.get("rerank", {})
    return list(_reranker(rr["model"]).rerank(query, texts))


# --- Qdrant client ----------------------------------------------------------
def qdrant_url() -> str:
    return os.environ.get("QDRANT_URL", "http://localhost:6333")


def qdrant_path() -> str:
    home = os.environ.get("RAG_HOME") or str(
        Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "rag-skill"
    )
    return os.environ.get("QDRANT_PATH", str(Path(home) / "qdrant"))


def server_up(url: str | None = None, timeout: float = 1.5) -> bool:
    import urllib.request
    base = (url or qdrant_url()).rstrip("/")
    # /healthz on current builds; / returns version JSON on every build (older
    # Qdrant lacks /healthz) — so probe both before declaring the server down.
    for ep in ("/healthz", "/"):
        try:
            with urllib.request.urlopen(f"{base}{ep}", timeout=timeout) as r:
                if r.status == 200:
                    return True
        except Exception:
            continue
    return False


def get_client(force_local: bool = False):
    """A live Qdrant server ($QDRANT_URL) if reachable (unless force_local), else
    embedded on-disk mode ($QDRANT_PATH). The on-disk fallback needs no daemon —
    local-first."""
    _need_deps()
    from qdrant_client import QdrantClient
    if not force_local and server_up():
        return QdrantClient(url=qdrant_url()), f"server:{qdrant_url()}"
    path = qdrant_path()
    Path(path).mkdir(parents=True, exist_ok=True)
    try:
        return QdrantClient(path=path), f"local:{path}"
    except RuntimeError as exc:
        # Embedded mode is single-writer: it takes an exclusive lock on the dir.
        msg = str(exc).lower()
        if "already accessed" in msg or "lock" in msg:
            sys.exit(
                f"rag: embedded Qdrant store at {path} is in use by another rag "
                f"process (embedded mode is single-writer). Wait for indexing to "
                f"finish, or run a Qdrant server (set QDRANT_URL) for concurrent access."
            )
        raise
