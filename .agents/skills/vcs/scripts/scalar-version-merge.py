#!/usr/bin/env python3
"""Resolve simple scalar version conflicts in text config files.

The only supported shape is a Git conflict where each side contains one
same-key assignment with a numeric/version-like value, for example:

    <<<<<<< HEAD
    version: 1.5.1
    =======
    version: 1.5.3
    >>>>>>> feature

The output keeps the higher value. Any other conflict shape exits nonzero so the
agent still handles semantic resolution.
"""
from __future__ import annotations

import pathlib
import re
import sys

ASSIGNMENT = re.compile(
    r"^(?P<indent>\s*)(?P<key>[A-Za-z0-9_.-]+)(?P<sep>\s*[:=]\s*)"
    r"(?P<value>\d+(?:\.\d+)*)(?P<trail>\s*)$"
)


class Unresolved(ValueError):
    pass


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def resolve_block(ours: list[str], theirs: list[str]) -> str:
    if len(ours) != 1 or len(theirs) != 1:
        raise Unresolved("only one-line scalar conflicts are supported")
    left = ASSIGNMENT.match(ours[0])
    right = ASSIGNMENT.match(theirs[0])
    if not left or not right:
        raise Unresolved("conflict sides are not version assignments")
    if left.group("key") != right.group("key"):
        raise Unresolved("conflict sides assign different keys")
    if left.group("indent") != right.group("indent"):
        raise Unresolved("conflict sides use different indentation")

    left_value = left.group("value")
    right_value = right.group("value")
    winner = left_value if version_tuple(left_value) >= version_tuple(right_value) else right_value
    return f"{left.group('indent')}{left.group('key')}{left.group('sep')}{winner}{left.group('trail')}"


def resolve_text(text: str) -> str:
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    resolved = 0
    while i < len(lines):
        line = lines[i]
        if not line.startswith("<<<<<<<"):
            out.append(line)
            i += 1
            continue

        i += 1
        ours: list[str] = []
        while i < len(lines) and not lines[i].startswith("======="):
            ours.append(lines[i])
            i += 1
        if i >= len(lines):
            raise Unresolved("missing conflict separator")
        i += 1

        theirs: list[str] = []
        while i < len(lines) and not lines[i].startswith(">>>>>>>"):
            theirs.append(lines[i])
            i += 1
        if i >= len(lines):
            raise Unresolved("missing conflict end marker")
        i += 1

        out.append(resolve_block(ours, theirs))
        resolved += 1

    if resolved == 0:
        raise Unresolved("no conflict blocks found")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: scalar-version-merge.py <conflicted-path>", file=sys.stderr)
        return 2
    path = pathlib.Path(argv[1])
    try:
        merged = resolve_text(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, Unresolved) as exc:
        print(f"scalar-version-merge.py: unresolved {path}: {exc}", file=sys.stderr)
        return 1
    path.write_text(merged, encoding="utf-8")
    print(f"scalar-version-merge.py: resolved {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
