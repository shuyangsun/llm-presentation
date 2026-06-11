"""CUDA shared-library setup for CTranslate2 wheels installed by uv."""

from __future__ import annotations

import ctypes
import importlib.util
import os
from pathlib import Path


def configure_cuda_shared_libraries() -> None:
    """Expose pip-installed NVIDIA libraries before importing faster-whisper."""

    library_dirs = _nvidia_library_dirs()
    if not library_dirs:
        return

    existing = os.environ.get("LD_LIBRARY_PATH")
    new_paths = [str(path) for path in library_dirs]
    if existing:
        new_paths.append(existing)
    os.environ["LD_LIBRARY_PATH"] = ":".join(dict.fromkeys(new_paths))

    for soname in _required_cuda_sonames():
        for library_dir in library_dirs:
            path = library_dir / soname
            if path.exists():
                ctypes.CDLL(str(path), mode=ctypes.RTLD_GLOBAL)
                break


def _nvidia_library_dirs() -> list[Path]:
    dirs: list[Path] = []
    for module_name in ("nvidia.cublas.lib", "nvidia.cudnn.lib"):
        spec = importlib.util.find_spec(module_name)
        if spec is None:
            continue

        locations = spec.submodule_search_locations
        if locations:
            dirs.extend(Path(location) for location in locations)
        elif spec.origin:
            dirs.append(Path(spec.origin).parent)

    return [path for path in dirs if path.exists()]


def _required_cuda_sonames() -> list[str]:
    return [
        "libcublas.so.12",
        "libcublasLt.so.12",
        "libcudnn.so.9",
    ]
