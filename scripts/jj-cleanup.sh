#!/usr/bin/env bash
set -euo pipefail

YES=0
DELETE_WORKSPACE_DIRS=0

usage() {
  cat <<'EOF'
Usage:
  ./scripts/jj-clean-empty-workspaces-and-bookmarks.sh [--yes] [--delete-workspace-dirs]

Deletes/forgets:
  - local bookmarks pointing at mutable empty undescribed revisions
  - workspaces whose working-copy commit is mutable, empty, and undescribed
  - the revisions those refs pointed at, via `jj abandon`

By default, workspace directories are NOT deleted from disk.
Use --delete-workspace-dirs to rm -rf the forgotten workspace directories.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes)
      YES=1
      ;;
    --delete-workspace-dirs)
      DELETE_WORKSPACE_DIRS=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

command -v jj >/dev/null 2>&1 || {
  echo "error: jj is not on PATH" >&2
  exit 127
}

# Resolve project root from this script's location, so this works when run as:
#   ./scripts/jj-clean-empty-workspaces-and-bookmarks.sh
# from the project root.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

BASE_JJ=(jj --no-pager -R "$PROJECT_ROOT")

JJ_ROOT="$("${BASE_JJ[@]}" root 2>/dev/null || true)"
if [[ -z "$JJ_ROOT" ]]; then
  echo "error: $PROJECT_ROOT is not a jj workspace root" >&2
  exit 1
fi

if [[ "$JJ_ROOT" != "$PROJECT_ROOT" ]]; then
  echo "error: expected script parent to be the jj workspace root" >&2
  echo "script parent: $PROJECT_ROOT" >&2
  echo "jj root:       $JJ_ROOT" >&2
  exit 1
fi

ADMIN_DIR=""
ADMIN_NAME="jj-cleanup-admin-$$"

cleanup_admin() {
  if [[ -n "${ADMIN_DIR:-}" && -d "$ADMIN_DIR" ]]; then
    jj --no-pager -R "$ADMIN_DIR" workspace forget "$ADMIN_NAME" >/dev/null 2>&1 || true
    rm -rf -- "$ADMIN_DIR"
  fi
}
trap cleanup_admin EXIT

ADMIN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jj-cleanup-admin.XXXXXXXX")"

# Create a temporary workspace outside the project root, with no checked-out files
# and a non-empty description, so it will not match the cleanup criteria.
"${BASE_JJ[@]}" workspace add \
  --name "$ADMIN_NAME" \
  --sparse-patterns empty \
  -r 'trunk()' \
  -m 'temporary jj cleanup admin workspace' \
  "$ADMIN_DIR" >/dev/null

JJ=(jj --no-pager -R "$ADMIN_DIR")

JUNK='mutable() & empty() & description("") & (working_copies() | bookmarks()) & ~root()'

mapfile -t REV_IDS < <(
  "${JJ[@]}" log --no-graph -r "$JUNK" -T 'commit_id ++ "\n"'
)

mapfile -t BOOKMARKS < <(
  "${JJ[@]}" bookmark list -r "$JUNK" -T 'if(!self.remote(), self.name() ++ "\n")'
)

mapfile -t WORKSPACE_ROWS < <(
  "${JJ[@]}" workspace list -T '
    if(
      self.target().empty()
      && self.target().description() == ""
      && !self.target().immutable()
      && !self.target().root(),
      self.name() ++ "\t" ++ self.root() ++ "\n"
    )
  '
)

WORKSPACES=()
WORKSPACE_ROOTS=()

for row in "${WORKSPACE_ROWS[@]}"; do
  [[ -z "$row" ]] && continue
  name="${row%%$'\t'*}"
  root="${row#*$'\t'}"

  # The admin workspace has a description, so it should not match. This is just
  # a belt-and-suspenders guard.
  [[ "$name" == "$ADMIN_NAME" ]] && continue

  WORKSPACES+=("$name")
  WORKSPACE_ROOTS+=("$root")
done

echo "Project root:"
echo "  $PROJECT_ROOT"
echo

echo "Matching revisions:"
if ((${#REV_IDS[@]})); then
  "${JJ[@]}" log -r "$JUNK"
else
  echo "  none"
fi
echo

echo "Local bookmarks to forget:"
if ((${#BOOKMARKS[@]})); then
  printf '  %s\n' "${BOOKMARKS[@]}"
else
  echo "  none"
fi
echo

echo "Workspaces to forget:"
if ((${#WORKSPACES[@]})); then
  for i in "${!WORKSPACES[@]}"; do
    printf '  %s\t%s\n' "${WORKSPACES[$i]}" "${WORKSPACE_ROOTS[$i]}"
  done
else
  echo "  none"
fi
echo

if (( ${#REV_IDS[@]} == 0 && ${#BOOKMARKS[@]} == 0 && ${#WORKSPACES[@]} == 0 )); then
  echo "Nothing to clean."
  exit 0
fi

if (( YES == 0 )); then
  read -r -p "Proceed with cleanup? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || {
    echo "Aborted."
    exit 1
  }
fi

for bookmark in "${BOOKMARKS[@]}"; do
  # Use exact: so bookmark names are not interpreted as globs.
  "${JJ[@]}" bookmark forget "exact:${bookmark}"
done

for workspace in "${WORKSPACES[@]}"; do
  "${JJ[@]}" workspace forget "$workspace"
done

if ((${#REV_IDS[@]})); then
  "${JJ[@]}" abandon "${REV_IDS[@]}"
fi

if (( DELETE_WORKSPACE_DIRS == 1 )); then
  for root in "${WORKSPACE_ROOTS[@]}"; do
    if [[ -n "$root" && "$root" != "/" && -d "$root" ]]; then
      rm -rf -- "$root"
    fi
  done
fi

echo "Done."

