#!/usr/bin/env bash
#
# Rename a temporary session-start workspace/worktree once the task slug is known.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"

new_name=""

usage() {
  cat <<'EOF'
usage: rename-work.sh <ide-work>

<ide-work> must look like codex-fix-login or cursor-registry-refresh.
Run this from the temporary workspace/worktree created by session-start.sh.
EOF
}

msg() { printf 'vcs-rename-work: %s\n' "$*"; }
die() {
  printf 'vcs-rename-work: %s\n' "$*" >&2
  exit 3
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
    new_name="$1"
    ;;
esac

if [[ ! "$new_name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  die "name must follow <ide>-<work>, for example codex-fix-login"
fi

jj_bookmark_exists() {
  local name="$1"
  jj bookmark list "$name" 2>/dev/null | grep -Eq "^${name}:"
}

run_jj() {
  local root current old_marker new_marker parent_repo_root agent_id marker
  root="$(jj root 2>/dev/null)" || die "cannot find jj root"
  current="$(vcs_jj_workspace_name || true)"
  [[ -n "$current" ]] || die "could not determine current jj workspace"
  [[ "$current" != "default" ]] || die "refusing to rename the shared jj default workspace"
  if [[ "$current" == "$new_name" ]]; then
    marker="$(vcs_record_current_session "${new_name%%-*}" "$new_name" "$(vcs_jj_default_root)")" ||
      die "could not refresh owner marker"
    printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nRENAMED=no\n' "$root" "$new_name" "$marker"
    return 0
  fi
  jj --ignore-working-copy workspace list -T 'name ++ "\n"' | grep -qxF "$new_name" &&
    die "jj workspace '$new_name' already exists"
  jj_bookmark_exists "$new_name" &&
    die "jj bookmark '$new_name' already exists"

  old_marker="$(vcs_marker_path_for jj "$current" 2>/dev/null || true)"
  parent_repo_root="$(vcs_jj_default_root)"
  agent_id="${new_name%%-*}"

  if [[ -n "$old_marker" && -f "$old_marker" ]]; then
    # shellcheck disable=SC1090
    source "$old_marker" || true
    [[ -n "${agent_id:-}" ]] || agent_id="${new_name%%-*}"
    [[ -n "${parent_repo_root:-}" ]] || parent_repo_root="$(vcs_jj_default_root)"
    # Carry the original session id forward so the refreshed marker still matches
    # the owning session (vcs-check.sh keys ownership off session_id).
    [[ -n "${session_id:-}" ]] && export VCS_SESSION_ID="$session_id"
  fi

  jj workspace rename "$new_name" >/dev/null 2>&1 ||
    die "could not rename jj workspace '$current' to '$new_name'"
  if jj_bookmark_exists "$current"; then
    jj bookmark rename "$current" "$new_name" >/dev/null 2>&1 ||
      die "could not rename bookmark '$current' to '$new_name'"
  else
    jj bookmark create "$new_name" -r @ >/dev/null 2>&1 ||
      die "could not create bookmark '$new_name'"
  fi
  new_marker="$(vcs_record_current_session "$agent_id" "$new_name" "$parent_repo_root")" ||
    die "could not record owner marker"
  [[ -n "$old_marker" && "$old_marker" != "$new_marker" ]] && rm -f "$old_marker"
  msg "renamed jj workspace '$current' to '$new_name'"
  printf 'MODE=jj\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nRENAMED=yes\n' "$(jj root)" "$new_name" "$new_marker"
}

run_git() {
  local top current old_marker new_marker parent_repo_root agent_id marker
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || die "cannot find git top-level"
  vcs_git_is_linked_worktree || die "refusing to rename work in the shared primary git checkout"
  current="$(git branch --show-current 2>/dev/null || true)"
  [[ -n "$current" ]] || die "current git worktree is detached; cannot rename branch"
  [[ "$current" != "main" && "$current" != "master" && "$current" != "trunk" ]] ||
    die "refusing to rename shared branch '$current'"
  if [[ "$current" == "$new_name" ]]; then
    marker="$(vcs_record_current_session "${new_name%%-*}" "$new_name" "$top")" ||
      die "could not refresh owner marker"
    printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nRENAMED=no\n' "$top" "$new_name" "$marker"
    return 0
  fi
  git show-ref --verify --quiet "refs/heads/$new_name" &&
    die "git branch '$new_name' already exists"

  old_marker="$(vcs_marker_path_for git "$current" 2>/dev/null || true)"
  parent_repo_root="$top"
  agent_id="${new_name%%-*}"
  if [[ -n "$old_marker" && -f "$old_marker" ]]; then
    # shellcheck disable=SC1090
    source "$old_marker" || true
    [[ -n "${agent_id:-}" ]] || agent_id="${new_name%%-*}"
    [[ -n "${parent_repo_root:-}" ]] || parent_repo_root="$top"
    # Carry the original session id forward so the refreshed marker still matches
    # the owning session (vcs-check.sh keys ownership off session_id).
    [[ -n "${session_id:-}" ]] && export VCS_SESSION_ID="$session_id"
  fi

  git branch -m "$current" "$new_name" >/dev/null 2>&1 ||
    die "could not rename git branch '$current' to '$new_name'"
  new_marker="$(vcs_record_current_session "$agent_id" "$new_name" "$parent_repo_root")" ||
    die "could not record owner marker"
  [[ -n "$old_marker" && "$old_marker" != "$new_marker" ]] && rm -f "$old_marker"
  msg "renamed git branch '$current' to '$new_name'"
  printf 'MODE=git\nWORKSPACE=%s\nWORK_REF=%s\nOWNER_MARKER=%s\nRENAMED=yes\n' "$top" "$new_name" "$new_marker"
}

mode="$(vcs_detect_mode)" || die "not inside a Git or jj repository"
case "$mode" in
  git) run_git ;;
  jj) run_jj ;;
  *) die "unknown mode '$mode'" ;;
esac
