#!/usr/bin/env python3
"""Resolve a conflicted JSON file by structurally unioning Git stages.

This is intentionally conservative: it reads the base/ours/theirs blobs from the
Git index, merges object keys recursively, unions arrays, and treats arrays of
objects with `id` fields as keyed collections. Scalar conflicts are resolved only
when one side did not change from base or when the values are numeric/version-like
and can be ordered. Otherwise the script exits nonzero and leaves the file for
manual resolution.
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
from collections.abc import Iterable
from typing import Any


class Unresolved(ValueError):
    pass


def git_stage(stage: int, path: str) -> Any:
    proc = subprocess.run(
        ["git", "show", f":{stage}:{path}"],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(proc.stdout)


def ordered_keys(*dicts: dict[str, Any]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for dct in dicts:
        for key in dct:
            if key not in seen:
                seen.add(key)
                out.append(key)
    return out


def stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def version_tuple(value: Any) -> tuple[int, ...] | None:
    if isinstance(value, (int, float)):
        return (int(value),)
    if not isinstance(value, str):
        return None
    if not re.fullmatch(r"\d+(?:\.\d+)*", value):
        return None
    return tuple(int(part) for part in value.split("."))


def merge_scalar(base: Any, ours: Any, theirs: Any) -> Any:
    if ours == theirs:
        return ours
    if ours == base:
        return theirs
    if theirs == base:
        return ours

    ours_version = version_tuple(ours)
    theirs_version = version_tuple(theirs)
    if ours_version is not None and theirs_version is not None:
        return ours if ours_version >= theirs_version else theirs

    raise Unresolved(f"conflicting scalar values: {ours!r} vs {theirs!r}")


def merge_dict(base: dict[str, Any], ours: dict[str, Any], theirs: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    sentinel = object()
    for key in ordered_keys(base, ours, theirs):
        b = base.get(key, sentinel)
        o = ours.get(key, sentinel)
        t = theirs.get(key, sentinel)
        if b is not sentinel:
            if o is sentinel and t is sentinel:
                continue
            if o is sentinel or t is sentinel:
                raise Unresolved(f"key {key!r} was deleted on one side")
            merged[key] = merge(b, o, t)
        elif o is sentinel:
            merged[key] = t
        elif t is sentinel:
            merged[key] = o
        else:
            merged[key] = merge(None, o, t) if o != t else o
    return merged


def keyed_by_id(items: Iterable[Any]) -> bool:
    materialized = list(items)
    return bool(materialized) and all(isinstance(item, dict) and "id" in item for item in materialized)


def merge_list(base: list[Any], ours: list[Any], theirs: list[Any]) -> list[Any]:
    if ours == theirs:
        return ours
    if ours == base:
        return theirs
    if theirs == base:
        return ours

    if keyed_by_id(base + ours + theirs):
        base_by_id = {item["id"]: item for item in base}
        ours_by_id = {item["id"]: item for item in ours}
        theirs_by_id = {item["id"]: item for item in theirs}
        ordered_ids: list[Any] = []
        seen: set[Any] = set()
        for source in (base, ours, theirs):
            for item in source:
                item_id = item["id"]
                if item_id not in seen:
                    seen.add(item_id)
                    ordered_ids.append(item_id)

        out: list[Any] = []
        for item_id in ordered_ids:
            in_base = item_id in base_by_id
            in_ours = item_id in ours_by_id
            in_theirs = item_id in theirs_by_id
            if in_base and not in_ours and not in_theirs:
                continue
            if in_base and (not in_ours or not in_theirs):
                raise Unresolved(f"array item id={item_id!r} was deleted on one side")
            b = base_by_id.get(item_id, {})
            o = ours_by_id.get(item_id)
            t = theirs_by_id.get(item_id)
            if o is None:
                out.append(t)
            elif t is None:
                out.append(o)
            else:
                out.append(merge(b, o, t))
        return out

    base_items = {stable_json(item) for item in base}
    ours_items = {stable_json(item) for item in ours}
    theirs_items = {stable_json(item) for item in theirs}
    if not base_items.issubset(ours_items) or not base_items.issubset(theirs_items):
        raise Unresolved("array item was deleted on one side")

    out: list[Any] = []
    seen_json: set[str] = set()
    for source in (ours, theirs):
        for item in source:
            marker = stable_json(item)
            if marker not in seen_json:
                seen_json.add(marker)
                out.append(item)
    return out


def merge(base: Any, ours: Any, theirs: Any) -> Any:
    if isinstance(base, dict) and isinstance(ours, dict) and isinstance(theirs, dict):
        return merge_dict(base, ours, theirs)
    if isinstance(base, list) and isinstance(ours, list) and isinstance(theirs, list):
        return merge_list(base, ours, theirs)
    return merge_scalar(base, ours, theirs)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: json-union-merge.py <conflicted-json-path>", file=sys.stderr)
        return 2
    path = argv[1]
    try:
        base = git_stage(1, path)
        ours = git_stage(2, path)
        theirs = git_stage(3, path)
        merged = merge(base, ours, theirs)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError, Unresolved) as exc:
        print(f"json-union-merge.py: unresolved {path}: {exc}", file=sys.stderr)
        return 1

    pathlib.Path(path).write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    print(f"json-union-merge.py: resolved {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
