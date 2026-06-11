#!/usr/bin/env python3
"""snowflake.py — 64-bit Snowflake IDs for Qdrant points (epoch 2026-06-08).

A Twitter-style Snowflake: a 63-bit time-ordered integer laid out as

    [ 41 bits: ms since epoch ][ 10 bits: node id ][ 12 bits: sequence ]

It fits Qdrant's unsigned-integer point-id type and sorts by creation time. The
epoch is pinned to 2026-06-08T00:00:00Z so the timestamp bits stay small.

NOTE — these IDs are time-based, NOT content-addressed: re-indexing a doc mints
new IDs. index.py therefore deletes a doc's prior points (by `doc_id`) before
re-upserting, so re-indexing replaces rather than duplicates. Don't rely on the
id alone to overwrite a chunk in place.

CLI (sanity check): `python3 snowflake.py [n]` prints n ids and decodes the first.
"""
from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timezone

# Pinned epoch: 2026-06-08T00:00:00Z, in ms since the Unix epoch.
EPOCH_MS = int(datetime(2026, 6, 8, tzinfo=timezone.utc).timestamp() * 1000)

NODE_BITS = 10
SEQ_BITS = 12
MAX_NODE = (1 << NODE_BITS) - 1
MAX_SEQ = (1 << SEQ_BITS) - 1
NODE_SHIFT = SEQ_BITS
TIME_SHIFT = NODE_BITS + SEQ_BITS


class Snowflake:
    """Monotonic, thread-safe Snowflake generator.

    node_id distinguishes concurrent generators on one host (default: the pid,
    overridable via $RAG_NODE_ID). The sequence disambiguates ids minted within
    the same millisecond; if it overflows, generation waits for the next ms.
    """

    def __init__(self, node_id: int | None = None, epoch_ms: int = EPOCH_MS):
        if node_id is None:
            node_id = int(os.environ.get("RAG_NODE_ID", os.getpid()))
        self.node_id = node_id & MAX_NODE
        self.epoch_ms = epoch_ms
        self._lock = threading.Lock()
        self._last_ms = -1
        self._seq = 0

    @staticmethod
    def _now_ms() -> int:
        return int(time.time() * 1000)

    def _wait_next_ms(self, after: int) -> int:
        ts = self._now_ms()
        while ts <= after:
            ts = self._now_ms()
        return ts

    def next_id(self) -> int:
        with self._lock:
            ts = self._now_ms()
            if ts < self._last_ms:
                # clock moved backwards — clamp so ids stay monotonic
                ts = self._last_ms
            if ts == self._last_ms:
                self._seq = (self._seq + 1) & MAX_SEQ
                if self._seq == 0:  # sequence exhausted this ms
                    ts = self._wait_next_ms(self._last_ms)
            else:
                self._seq = 0
            self._last_ms = ts
            delta = ts - self.epoch_ms
            if delta < 0:
                raise ValueError("current time is before the Snowflake epoch (2026-06-08)")
            return (delta << TIME_SHIFT) | (self.node_id << NODE_SHIFT) | self._seq


def decode(sid: int, epoch_ms: int = EPOCH_MS) -> dict:
    """Unpack a Snowflake id into its parts (for debugging/inspection)."""
    return {
        "timestamp_ms": (sid >> TIME_SHIFT) + epoch_ms,
        "node_id": (sid >> NODE_SHIFT) & MAX_NODE,
        "sequence": sid & MAX_SEQ,
    }


if __name__ == "__main__":
    import sys

    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    gen = Snowflake()
    ids = [gen.next_id() for _ in range(n)]
    for i in ids:
        print(i)
    d = decode(ids[0])
    iso = datetime.fromtimestamp(d["timestamp_ms"] / 1000, tz=timezone.utc).isoformat()
    print(f"# epoch_ms={EPOCH_MS}  decoded[0]: node={d['node_id']} seq={d['sequence']} ts={iso}")
    print(f"# monotonic_increasing={all(ids[i] < ids[i + 1] for i in range(len(ids) - 1))}")
