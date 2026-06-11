"""Process-level runtime fixes for local media and CUDA libraries."""

from __future__ import annotations

import os
import sys

SYSTEM_MEDIA_LIBRARY_PATHS = [
    "/lib/x86_64-linux-gnu",
    "/usr/lib/x86_64-linux-gnu",
]


def restart_with_system_media_libraries() -> None:
    """Restart once with Ubuntu FFmpeg libraries ahead of stale /usr/local copies."""

    if os.environ.get("ASR_SYSTEM_MEDIA_LIBS_FIRST") == "1":
        return

    current_paths = [
        path for path in os.environ.get("LD_LIBRARY_PATH", "").split(":") if path
    ]
    if current_paths[: len(SYSTEM_MEDIA_LIBRARY_PATHS)] == SYSTEM_MEDIA_LIBRARY_PATHS:
        os.environ["ASR_SYSTEM_MEDIA_LIBS_FIRST"] = "1"
        return

    env = os.environ.copy()
    env["ASR_SYSTEM_MEDIA_LIBS_FIRST"] = "1"
    env["LD_LIBRARY_PATH"] = ":".join(
        dict.fromkeys([*SYSTEM_MEDIA_LIBRARY_PATHS, *current_paths])
    )
    os.execvpe(sys.executable, [sys.executable, *sys.argv], env)
