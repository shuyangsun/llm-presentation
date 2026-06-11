#!/usr/bin/env bash
#
# Create (or confirm) a per-agent working copy before starting new work.
# Run from the repository checkout the agent was handed.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"

name=""

usage() {
  cat <<'EOF'
usage: isolate.sh <ide-work>

<ide-work> must look like codex-fix-login or cursor-registry-refresh.

The script prints WORKSPACE=<path> and WORK_REF=<branch-or-bookmark>. If it
created a new worktree/workspace, cd to WORKSPACE before editing.
EOF
}

msg() { printf 'vcs-isolate: %s\n' "$*"; }
die() {
  printf 'vcs-isolate: %s\n' "$*" >&2
  exit 3
}

# A fresh isolated checkout was created; the agent MUST move into it before
# touching any file, or edits land in the shared checkout it was handed.
emit_next_cwd() {
  msg "NEXT_CWD=$1"
  msg "cd to NEXT_CWD now; do every edit and command for this work from there, not the checkout you started in"
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  "")
    usage >&2
    exit 3
    ;;
  *)
    name="$1"
    ;;
esac

if [[ ! "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  die "name must follow <ide>-<work>, for example codex-fix-login"
fi

detect_mode() {
  if command -v jj >/dev/null 2>&1 && jj root >/dev/null 2>&1; then
    printf 'jj\n'
  elif git rev-parse --show-toplevel >/dev/null 2>&1; then
    printf 'git\n'
  else
    return 1
  fi
}

next_path() {
  local base="$1" candidate="$1" n=2
  while [[ -e "$candidate" ]]; do
    candidate="${base}-${n}"
    n=$((n + 1))
  done
  printf '%s\n' "$candidate"
}

mode="$(detect_mode)" || die "not inside a Git or jj repository"

maybe_use_assigned_workspace() {
  local assigned assigned_abs root root_abs assigned_mode assigned_ref marker
  assigned="$(vcs_assigned_workspace_hint 2>/dev/null || true)"
  [[ -n "$assigned" && -d "$assigned" ]] || return 1
  assigned_abs="$(vcs_abs_dir "$assigned")" || return 1
  if [[ "$mode" == "jj" ]]; then
    root="$(jj root 2>/dev/null || true)"
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi
  root_abs="$(vcs_abs_dir "$root" 2>/dev/null || true)"
  [[ -n "$root_abs" && "$root_abs" != "$assigned_abs" ]] || return 1

  assigned_mode="$(cd "$assigned_abs" && vcs_detect_mode 2>/dev/null)" || return 1
  assigned_ref="$(cd "$assigned_abs" && vcs_current_workspace_name "$assigned_mode" 2>/dev/null)" || assigned_ref="$name"
  marker="$(cd "$assigned_abs" && vcs_record_current_session "${name%%-*}" "$assigned_ref" "$root_abs")" ||
    die "could not record session ownership for assigned workspace '$assigned_abs'"
  msg "assigned workspace already exists; use it instead of creating another"
  printf 'MODE=%s\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$assigned_mode" "$assigned_abs" "$assigned_ref" "$marker"
  emit_next_cwd "$assigned_abs"
  return 0
}

run_git() {
  local top git_dir common_dir branch base repo_name parent path marker
  top="$(git rev-parse --show-toplevel)" || die "cannot find git top-level"
  git_dir="$(git rev-parse --git-dir)" || die "cannot find git dir"
  common_dir="$(git rev-parse --git-common-dir)" || die "cannot find git common dir"
  branch="$(git branch --show-current 2>/dev/null || true)"

  if [[ "$git_dir" != "$common_dir" ]]; then
    if [[ -z "$branch" || "$branch" == "main" || "$branch" == "master" || "$branch" == "trunk" ]]; then
      git switch -c "$name" >/dev/null 2>&1 ||
        die "already in a worktree, but could not create branch '$name'"
      branch="$name"
    fi
    marker="$(vcs_record_current_session "${name%%-*}" "$branch" "$top")" ||
      die "could not record session ownership for '$branch'"
    msg "already in a linked git worktree"
    printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$top" "$branch" "$marker"
    return 0
  fi

  repo_name="$(basename "$top")"
  parent="$(dirname "$top")"
  maybe_use_assigned_workspace && return 0
  path="$(next_path "$parent/$repo_name-$name")"

  if git remote get-url origin >/dev/null 2>&1; then
    git fetch origin >/dev/null 2>&1 || true
    base="origin/main"
  else
    base="main"
  fi

  git worktree add "$path" -b "$name" "$base" >/dev/null 2>&1 ||
    die "could not create git worktree '$path' on branch '$name'"
  marker="$(cd "$path" && vcs_record_current_session "${name%%-*}" "$name" "$top")" ||
    die "could not record session ownership for '$name'"
  msg "created git worktree"
  printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=yes\n' "$path" "$name" "$marker"
  emit_next_cwd "$path"
}

jj_workspace_name() {
  local root listing cur
  root="$(jj root)"
  listing="$(jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null || true)"
  while IFS=$'\t' read -r cur path; do
    [[ "$path" == "$root" ]] && {
      printf '%s\n' "$cur"
      return 0
    }
  done <<<"$listing"
  return 1
}

jj_bookmark_exists() {
  local b="$1"
  jj bookmark list "$b" 2>/dev/null | grep -Eq "^${b}:"
}

run_jj() {
  local root current repo_name parent path work_ref marker
  jj workspace update-stale >/dev/null 2>&1 || true
  root="$(jj root)" || die "cannot find jj root"
  current="$(jj_workspace_name || true)"

  if [[ -n "$current" && "$current" != "default" ]]; then
    work_ref="$current"
    if ! jj_bookmark_exists "$work_ref"; then
      jj bookmark create "$work_ref" -r @ >/dev/null 2>&1 ||
        die "could not create bookmark '$work_ref'"
    fi
    marker="$(vcs_record_current_session "${name%%-*}" "$work_ref" "$(vcs_jj_default_root)")" ||
      die "could not record session ownership for '$work_ref'"
    msg "already in a jj workspace"
    printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$root" "$work_ref" "$marker"
    return 0
  fi

  repo_name="$(basename "$root")"
  parent="$(dirname "$root")"
  maybe_use_assigned_workspace && return 0
  path="$(next_path "$parent/$repo_name-$name")"
  jj workspace add --name "$name" -r main "$path" >/dev/null 2>&1 ||
    die "could not create jj workspace '$name'"
  (cd "$path" && jj bookmark create "$name" -r @ >/dev/null 2>&1) ||
    die "could not create bookmark '$name'"
  marker="$(cd "$path" && vcs_record_current_session "${name%%-*}" "$name" "$root")" ||
    die "could not record session ownership for '$name'"
  msg "created jj workspace"
  printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=yes\n' "$path" "$name" "$marker"
  emit_next_cwd "$path"
}

case "$mode" in
  git) run_git ;;
  jj) run_jj ;;
  *) die "unknown mode '$mode'" ;;
esac
