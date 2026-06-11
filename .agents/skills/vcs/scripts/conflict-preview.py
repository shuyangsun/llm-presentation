#!/usr/bin/env python3
"""Print or write a marker-stripped preview of conflicted files.

This is an aid for agents; it does not decide semantic correctness. By default it
prints a preview. With --write it applies the same marker-stripped text to the
file, which is appropriate only after the agent decides the conflict is purely
additive or will make any remaining semantic edits before continuing.
"""
from __future__ import annotations

import pathlib
import sys

MARKER_PREFIXES = (
    "<<<<<<<",
    "=======",
    ">>>>>>>",
    "|||||||",
    "%%%%%%%",
    "\\\\\\\\\\\\\\",
    "+++++++",
)


def preview_line(line: str) -> str | None:
    if line.startswith(MARKER_PREFIXES):
        return None
    if line.startswith("+"):
        return line[1:]
    # jj diff conflicts use '-' for removed base lines. Keep Markdown bullets
    # like "- item"; drop compact removals like "-version: 1.4.0".
    if line.startswith("-") and not line.startswith("- "):
        return None
    return line


def normalized_text(path: pathlib.Path) -> str:
    lines = path.read_text(encoding="utf-8").splitlines()
    out = []
    for line in lines:
        clean = preview_line(line)
        if clean is not None:
            out.append(clean)
    return "\n".join(out) + "\n"


def preview(path: pathlib.Path, max_lines: int = 180) -> None:
    print(f"--- {path} (marker-stripped preview; verify before copying) ---")
    try:
        text = normalized_text(path)
    except UnicodeDecodeError:
        print("<binary or non-UTF-8 file omitted>")
        return
    except OSError as exc:
        print(f"<could not read: {exc}>")
        return

    shown = 0
    omitted = 0
    for clean in text.splitlines():
        if shown < max_lines:
            print(clean)
            shown += 1
        else:
            omitted += 1
    if omitted:
        print(f"... {omitted} more preview line(s) omitted ...")


def write_preview(path: pathlib.Path) -> None:
    text = normalized_text(path)
    path.write_text(text, encoding="utf-8")
    print(f"wrote marker-stripped preview to {path}")


def main(argv: list[str]) -> int:
    write = False
    args = argv[1:]
    if args and args[0] == "--write":
        write = True
        args = args[1:]
    if not args:
        print("usage: conflict-preview.py [--write] <file> [<file> ...]", file=sys.stderr)
        return 2
    for raw in args:
        path = pathlib.Path(raw)
        if write:
            write_preview(path)
        else:
            preview(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
