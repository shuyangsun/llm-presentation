#!/usr/bin/env bash
#
# Session-start bootstrap for local coding-agent sessions.
#
# It moves a local jj session out of the shared default workspace before the
# agent has enough task context to name the work. The temporary workspace can be
# renamed later with rename-work.sh once the agent knows the task slug.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"

hook="plain"
ide="${VCS_AGENT_ID:-}"

usage() {
  cat <<'EOF'
usage: session-start.sh [--hook codex|claude|cursor|agy|plain] [--ide codex|claude|cursor|agy]

Creates a temporary per-session workspace/worktree when the current checkout is a
local shared VCS root. Prints NEXT_CWD when the agent must move there before
editing.
EOF
}

msg() { printf 'vcs-session-start: %s\n' "$*"; }
die() {
  printf 'vcs-session-start: %s\n' "$*" >&2
  exit 3
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hook)
      [[ $# -ge 2 ]] || die "--hook requires a value"
      hook="$2"
      shift 2
      ;;
    --ide)
      [[ $# -ge 2 ]] || die "--ide requires a value"
      ide="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

case "$hook" in codex | claude | cursor | agy | plain) : ;; *) die "--hook must be codex, claude, cursor, agy, or plain" ;; esac
[[ -n "$ide" ]] || ide="$hook"
[[ "$ide" == "plain" ]] && ide="agent"
if [[ ! "$ide" =~ ^[A-Za-z][A-Za-z0-9._-]*$ ]]; then
  die "--ide must be a short tool token like codex, claude, cursor, or agy"
fi

hook_input="$(cat 2>/dev/null || true)"
json_get() {
  local field="$1"
  [[ -n "$hook_input" ]] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import json, sys
field = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
value = data.get(field)
if value is not None:
    print(value)
' "$field" <<<"$hook_input" 2>/dev/null || true
}

session_from_hook="$(json_get session_id)"
[[ -n "$session_from_hook" ]] || session_from_hook="$(json_get conversationId)"
[[ -n "$session_from_hook" ]] && export VCS_SESSION_ID="$session_from_hook"

emit_next_cwd() {
  local path="$1" mode="$2" ref="$3" marker="$4"
  cat <<EOF
vcs session isolation is active.
MODE=$mode
WORK_REF=$ref
OWNER_MARKER=$marker
NEXT_CWD=$path
Run the next shell command from NEXT_CWD before editing or publishing. Once the
task is clear, rename this temporary work with:
  bash <skill-dir>/scripts/rename-work.sh <ide>-<work>
EOF
}

maybe_use_assigned_workspace() {
  local mode="$1" assigned assigned_abs root root_abs assigned_mode assigned_ref marker
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
  assigned_ref="$(cd "$assigned_abs" && vcs_current_workspace_name "$assigned_mode" 2>/dev/null)" || assigned_ref="$ide"
  marker="$(cd "$assigned_abs" && vcs_record_current_session "$ide" "$assigned_ref" "$root_abs")" ||
    die "could not record session ownership for assigned workspace '$assigned_abs'"
  msg "assigned workspace already exists; use it instead of creating another"
  printf 'MODE=%s\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$assigned_mode" "$assigned_abs" "$assigned_ref" "$marker"
  emit_next_cwd "$assigned_abs" "$assigned_mode" "$assigned_ref" "$marker"
  return 0
}

maybe_reuse_session_workspace() {
  local expected_mode="$1" dir marker want_session marker_path
  local session_id agent_id workspace_root work_ref workspace_name mode
  want_session="$(vcs_session_id)"
  dir="$(vcs_state_dir "$expected_mode" 2>/dev/null || true)"
  [[ -n "$dir" && -d "$dir" ]] || return 1

  for marker in "$dir"/*.env; do
    [[ -f "$marker" ]] || continue
    session_id=""
    agent_id=""
    workspace_root=""
    work_ref=""
    workspace_name=""
    mode=""
    # shellcheck disable=SC1090
    source "$marker" 2>/dev/null || continue
    [[ "$session_id" == "$want_session" && "$agent_id" == "$ide" ]] || continue
    [[ "$mode" == "$expected_mode" ]] || continue
    [[ -n "$workspace_root" && -d "$workspace_root" ]] || continue
    marker_path="$marker"
    [[ -n "$work_ref" ]] || work_ref="$workspace_name"
    msg "session workspace already exists; use it instead of creating another"
    printf 'MODE=%s\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$expected_mode" "$workspace_root" "$work_ref" "$marker_path"
    emit_next_cwd "$workspace_root" "$expected_mode" "$work_ref" "$marker_path"
    return 0
  done
  return 1
}

run_git() {
  local top git_dir common_dir branch repo_name parent base name path marker
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || die "cannot find git top-level"
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || die "cannot find git dir"
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || die "cannot find git common dir"
  branch="$(git branch --show-current 2>/dev/null || true)"

  maybe_use_assigned_workspace git && return 0

  if [[ "$git_dir" != "$common_dir" ]]; then
    [[ -n "$branch" ]] || branch="$(basename "$top")"
    marker="$(vcs_record_current_session "$ide" "$branch" "$top")" ||
      die "could not record session ownership for linked worktree"
    msg "already in a linked git worktree"
    printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$top" "$branch" "$marker"
    return 0
  fi

  maybe_reuse_session_workspace git && return 0
  name="$ide-pending-$(vcs_short_id)"
  repo_name="$(basename "$top")"
  parent="$(dirname "$top")"
  path="$(vcs_next_path "$parent/$repo_name-$name")"

  if git remote get-url origin >/dev/null 2>&1; then
    git fetch origin >/dev/null 2>&1 || true
    base="origin/main"
  else
    base="main"
  fi

  git worktree add "$path" -b "$name" "$base" >/dev/null 2>&1 ||
    die "could not create git worktree '$path' on branch '$name'"
  marker="$(cd "$path" && vcs_record_current_session "$ide" "$name" "$top")" ||
    die "could not record session ownership for '$name'"
  msg "created git worktree"
  printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=yes\n' "$path" "$name" "$marker"
  emit_next_cwd "$path" git "$name" "$marker"
}

run_jj() {
  local root default_root current repo_name parent name path marker work_ref
  jj workspace update-stale >/dev/null 2>&1 || true
  root="$(jj root 2>/dev/null)" || die "cannot find jj root"
  default_root="$(vcs_jj_default_root)"
  maybe_use_assigned_workspace jj && return 0
  current="$(vcs_jj_workspace_name 2>/dev/null || true)"
  if [[ -n "$current" && "$current" != "default" ]]; then
    work_ref="$current"
    if ! jj bookmark list "$work_ref" 2>/dev/null | grep -Eq "^${work_ref}:"; then
      jj bookmark create "$work_ref" -r @ >/dev/null 2>&1 ||
        die "could not create bookmark '$work_ref'"
    fi
    marker="$(vcs_record_current_session "$ide" "$work_ref" "$default_root")" ||
      die "could not record session ownership for '$work_ref'"
    msg "already in a jj workspace"
    printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=no\n' "$root" "$work_ref" "$marker"
    return 0
  fi
  maybe_reuse_session_workspace jj && return 0
  name="$ide-pending-$(vcs_short_id)"
  repo_name="$(basename "$root")"
  parent="$(dirname "$root")"
  path="$(vcs_next_path "$parent/$repo_name-$name")"

  jj workspace add --name "$name" -r main "$path" >/dev/null 2>&1 ||
    die "could not create jj workspace '$name'"
  (cd "$path" && jj bookmark create "$name" -r @ >/dev/null 2>&1) ||
    die "could not create bookmark '$name'"
  marker="$(cd "$path" && vcs_record_current_session "$ide" "$name" "$default_root")" ||
    die "could not record session ownership for '$name'"
  msg "created jj workspace"
  printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nCREATED=yes\n' "$path" "$name" "$marker"
  emit_next_cwd "$path" jj "$name" "$marker"
}

mode="$(vcs_detect_mode 2>/dev/null || true)"
case "$mode" in
  git) run_git ;;
  jj) run_jj ;;
  "")
    msg "not inside a Git or jj repository; no workspace created"
    ;;
  *) die "unknown mode '$mode'" ;;
esac
