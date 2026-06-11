"""Download ASR models through /tmp before storing them on the NAS model volume."""

from __future__ import annotations

import argparse
import inspect
import os
import shutil
from pathlib import Path

from huggingface_hub import snapshot_download

DEFAULT_MODEL_DIR = Path("/mnt/nas/home/ml/model")
DEFAULT_DOWNLOAD_DIR = Path("/tmp/asr-model-downloads")

MODEL_ALIASES = {
    "parakeet": "nvidia/parakeet-tdt-0.6b-v3",
    "parakeet-tdt-0.6b-v3": "nvidia/parakeet-tdt-0.6b-v3",
    "tiny": "Systran/faster-whisper-tiny",
    "tiny.en": "Systran/faster-whisper-tiny.en",
    "base": "Systran/faster-whisper-base",
    "base.en": "Systran/faster-whisper-base.en",
    "small": "Systran/faster-whisper-small",
    "small.en": "Systran/faster-whisper-small.en",
    "medium": "Systran/faster-whisper-medium",
    "medium.en": "Systran/faster-whisper-medium.en",
    "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    "distil-large-v3": "Systran/faster-distil-whisper-large-v3",
}


def ensure_model_cached(
    model: str,
    *,
    model_dir: Path = DEFAULT_MODEL_DIR,
    download_dir: Path = DEFAULT_DOWNLOAD_DIR,
    revision: str | None = None,
    refresh: bool = False,
) -> Path:
    """Return a local model path, downloading to /tmp and moving to model_dir if needed."""

    local_path = Path(model).expanduser()
    if local_path.exists():
        return local_path

    repo_id = resolve_model_repo(model)
    destination = model_destination(repo_id, model_dir)

    if refresh and destination.exists():
        shutil.rmtree(destination)

    if is_complete_model_dir(destination):
        return destination

    if destination.exists():
        raise RuntimeError(
            f"Model destination exists but does not look complete: {destination}. "
            "Pass --refresh to replace it."
        )

    download_dir.mkdir(parents=True, exist_ok=True)
    temp_parent = download_dir / "snapshots"
    temp_parent.mkdir(parents=True, exist_ok=True)
    temp_local = temp_parent / f"{safe_repo_dir(repo_id)}.tmp-{os.getpid()}"
    temp_cache = download_dir / "hf-cache"

    if temp_local.exists():
        shutil.rmtree(temp_local)

    try:
        _snapshot_download(repo_id, temp_local, temp_cache, revision)
        if not is_complete_model_dir(temp_local):
            raise RuntimeError(f"Downloaded snapshot does not look complete: {temp_local}")

        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = destination.with_name(f"{destination.name}.tmp-{os.getpid()}")
        if staging.exists():
            shutil.rmtree(staging)

        shutil.move(str(temp_local), str(staging))
        os.replace(staging, destination)
    finally:
        if temp_local.exists():
            shutil.rmtree(temp_local)

    return destination


def resolve_model_repo(model: str) -> str:
    return MODEL_ALIASES.get(model, model)


def model_destination(repo_id: str, model_dir: Path = DEFAULT_MODEL_DIR) -> Path:
    parts = repo_id.split("/")
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Invalid Hugging Face repo id: {repo_id}")

    return model_dir / "huggingface" / Path(*parts)


def is_complete_model_dir(path: Path) -> bool:
    return (
        path.is_dir()
        and (path / "config.json").is_file()
        and (
            (path / "model.bin").is_file()
            or (path / "pytorch_model.bin").is_file()
            or (path / "model.safetensors").is_file()
            or any(path.glob("*.nemo"))
        )
    )


def find_nemo_checkpoint(path: Path) -> Path:
    checkpoints = sorted(path.glob("*.nemo"))
    if not checkpoints:
        raise RuntimeError(f"No .nemo checkpoint found in {path}")
    if len(checkpoints) > 1:
        names = ", ".join(checkpoint.name for checkpoint in checkpoints)
        raise RuntimeError(f"Expected one .nemo checkpoint in {path}, found: {names}")
    return checkpoints[0]


def safe_repo_dir(repo_id: str) -> str:
    return repo_id.replace("/", "__")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", help="Model alias, Hugging Face repo id, or local model path.")
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=DEFAULT_MODEL_DIR,
        help=f"NAS model directory. Default: {DEFAULT_MODEL_DIR}",
    )
    parser.add_argument(
        "--download-dir",
        type=Path,
        default=DEFAULT_DOWNLOAD_DIR,
        help=f"Temporary download root. Default: {DEFAULT_DOWNLOAD_DIR}",
    )
    parser.add_argument("--revision", help="Optional Hugging Face model revision.")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Replace an incomplete or stale cached copy for this model.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    model_path = ensure_model_cached(
        args.model,
        model_dir=args.model_dir,
        download_dir=args.download_dir,
        revision=args.revision,
        refresh=args.refresh,
    )
    print(model_path)


def _snapshot_download(
    repo_id: str,
    local_dir: Path,
    cache_dir: Path,
    revision: str | None,
) -> None:
    kwargs = {
        "repo_id": repo_id,
        "local_dir": str(local_dir),
        "cache_dir": str(cache_dir),
        "revision": revision,
    }

    signature = inspect.signature(snapshot_download)
    if "local_dir_use_symlinks" in signature.parameters:
        kwargs["local_dir_use_symlinks"] = False

    snapshot_download(**kwargs)


if __name__ == "__main__":
    main()
