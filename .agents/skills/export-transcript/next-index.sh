#!/usr/bin/env bash
# Prepare the next session export under docs/transcripts/ and print what the
# agent needs, so it doesn't have to derive either value on its own:
#   dir:   today's dated folder (local-time YYYY-MM-DD), created if missing
#   index: next zero-padded number = (max existing + 1), scanned across ALL date
#          folders so session numbers are globally unique and strictly increasing
# Bundled with the export-transcript skill; resolves the repo root from the
# current working directory (Git or Jujutsu), so it works from any agent and any
# working directory, and creates every directory it needs.
set -euo pipefail

# Resolve the working repo root, preferring Git, then Jujutsu, then CWD.
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$root" ]]; then
  root="$(jj root 2>/dev/null || true)"
fi
if [[ -z "$root" ]]; then
  root="$(pwd)"
fi

rel_base="docs/transcripts"
hist="$root/$rel_base"
date_dir="$rel_base/$(date +%F)" # %F = local-time YYYY-MM-DD
mkdir -p "$root/$date_dir"        # creates docs/transcripts/<date>/ if missing

max=-1
while IFS= read -r f; do
  n="$(basename "$f" | grep -oE '^[0-9]+' || true)"
  if [[ -n "$n" ]] && ((10#$n > max)); then max=$((10#$n)); fi
done < <(find "$hist" -type f -name '[0-9]*-*.md')
printf 'dir:   %s\n' "$date_dir"
printf 'index: %04d\n' "$((max + 1))"
