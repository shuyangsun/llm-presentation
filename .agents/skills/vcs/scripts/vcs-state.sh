#!/usr/bin/env bash
#
# Shared local-state helpers for the vcs skill scripts.
#
# State is deliberately stored outside the tracked worktree. In colocated jj/Git
# repos and plain Git repos, use the common Git admin dir. In non-colocated jj
# repos, fall back to the user's XDG state dir keyed by the repo path.

vcs_state_skill_version="vcs-guardrails-v1"

vcs_detect_mode() {
  if command -v jj >/dev/null 2>&1 && jj root >/dev/null 2>&1; then
    printf 'jj\n'
  elif git rev-parse --show-toplevel >/dev/null 2>&1; then
    printf 'git\n'
  else
    return 1
  fi
}

vcs_abs_dir() {
  local dir="$1"
  (cd "$dir" 2>/dev/null && pwd -P) || return 1
}

vcs_next_path() {
  local base="$1" candidate="$1" n=2
  while [[ -e "$candidate" ]]; do
    candidate="${base}-${n}"
    n=$((n + 1))
  done
  printf '%s\n' "$candidate"
}

vcs_short_id() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-' | cut -c1-8
  else
    printf '%s%05d' "$(date +%s)" "$$" | tail -c 9
  fi
}

vcs_env_quote() {
  local key="$1" value="$2"
  printf '%s=%q\n' "$key" "$value"
}

vcs_marker_key() {
  printf '%s' "$1" | sed 's#[^A-Za-z0-9._-]#_#g'
}

vcs_assigned_workspace_hint() {
  if [[ -n "${VCS_ASSIGNED_WORKSPACE:-}" ]]; then
    printf '%s\n' "$VCS_ASSIGNED_WORKSPACE"
    return 0
  fi

  local dir="$PWD" value
  while [[ "$dir" != "/" && -n "$dir" ]]; do
    if [[ -f "$dir/manifest.env" ]]; then
      value="$(sed -n 's/^ASSIGNED_WS=//p' "$dir/manifest.env" | head -1)"
      if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return 0
      fi
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

vcs_git_common_dir() {
  local top common
  top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  case "$common" in
    /*) ;;
    *) common="$top/$common" ;;
  esac
  vcs_abs_dir "$common"
}

vcs_git_is_linked_worktree() {
  local git_dir common_dir
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || return 1
  common_dir="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [[ "$git_dir" != "$common_dir" ]]
}

vcs_jj_workspace_name() {
  local root listing cur path
  root="$(jj root 2>/dev/null)" || return 1
  listing="$(jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null || true)"
  while IFS=$'\t' read -r cur path; do
    [[ "$path" == "$root" ]] && {
      printf '%s\n' "$cur"
      return 0
    }
  done <<<"$listing"
  return 1
}

vcs_jj_default_root() {
  local root
  root="$(jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null |
    awk -F '\t' '$1=="default"{print $2; exit}')"
  [[ -n "$root" ]] || root="$(jj root 2>/dev/null || pwd)"
  printf '%s\n' "$root"
}

vcs_current_workspace_name() {
  local mode="${1:-}"
  [[ -n "$mode" ]] || mode="$(vcs_detect_mode)" || return 1
  case "$mode" in
    jj)
      vcs_jj_workspace_name
      ;;
    git)
      local branch top
      branch="$(git branch --show-current 2>/dev/null || true)"
      if [[ -n "$branch" ]]; then
        printf '%s\n' "$branch"
      else
        top="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
        basename "$top"
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

vcs_state_dir() {
  local mode="${1:-}"
  [[ -n "$mode" ]] || mode="$(vcs_detect_mode)" || return 1

  if [[ "$mode" == "jj" ]]; then
    local default_root
    default_root="$(vcs_jj_default_root 2>/dev/null || true)"
    if [[ -n "$default_root" && -d "$default_root/.git" ]]; then
      printf '%s/agent-sessions\n' "$default_root/.git"
      return 0
    fi
  fi

  if git rev-parse --git-common-dir >/dev/null 2>&1; then
    printf '%s/agent-sessions\n' "$(vcs_git_common_dir)"
    return 0
  fi

  local root hash state_home
  root="$(jj root 2>/dev/null || pwd)"
  if command -v shasum >/dev/null 2>&1; then
    hash="$(printf '%s' "$root" | shasum -a 256 | awk '{print $1}' | cut -c1-16)"
  else
    hash="$(printf '%s' "$root" | cksum | awk '{print $1}')"
  fi
  state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
  printf '%s/coding-agent-skills/vcs-sessions/%s\n' "$state_home" "$hash"
}

vcs_marker_path_for() {
  local mode="$1" workspace="$2" dir key
  dir="$(vcs_state_dir "$mode")" || return 1
  key="$(vcs_marker_key "$workspace")"
  printf '%s/%s.env\n' "$dir" "$key"
}

vcs_current_marker_path() {
  local mode workspace
  mode="$(vcs_detect_mode)" || return 1
  workspace="$(vcs_current_workspace_name "$mode")" || return 1
  vcs_marker_path_for "$mode" "$workspace"
}

# Remove the owner marker for (mode, workspace), if present. The symmetric
# counterpart to vcs_record_current_session: integrate.sh calls this when it
# retires a landed workspace so the marker can't outlive the workspace it
# describes. A stale marker otherwise lingers in agent-sessions/ and keeps
# vcs_session_owns_ref matching a workspace that no longer exists, which
# confuses later guard checks. Best-effort: never fails the caller.
vcs_remove_owner_marker() {
  local mode="$1" workspace="$2" marker
  [[ -n "$mode" && -n "$workspace" ]] || return 0
  marker="$(vcs_marker_path_for "$mode" "$workspace" 2>/dev/null)" || return 0
  [[ -n "$marker" && -f "$marker" ]] && rm -f "$marker" 2>/dev/null
  return 0
}

vcs_session_id() {
  if [[ -n "${VCS_SESSION_ID:-}" ]]; then
    printf '%s\n' "$VCS_SESSION_ID"
  elif [[ -n "${CODEX_SESSION_ID:-}" ]]; then
    printf '%s\n' "$CODEX_SESSION_ID"
  elif [[ -n "${CLAUDE_SESSION_ID:-}" ]]; then
    printf '%s\n' "$CLAUDE_SESSION_ID"
  else
    printf 'local-%s\n' "$(vcs_short_id)"
  fi
}

vcs_record_current_session() {
  local agent_id="$1" work_ref="$2" parent_repo_root="${3:-}"
  local mode root workspace dir marker created_at session_id
  mode="$(vcs_detect_mode)" || return 1
  if [[ "$mode" == "jj" ]]; then
    root="$(jj root 2>/dev/null)" || return 1
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  fi
  workspace="$(vcs_current_workspace_name "$mode")" || return 1
  dir="$(vcs_state_dir "$mode")" || return 1
  marker="$(vcs_marker_path_for "$mode" "$workspace")" || return 1
  mkdir -p "$dir" || return 1
  created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  session_id="$(vcs_session_id)"
  # Never overwrite a real, previously-recorded session id with a freshly
  # synthesized local- one (a plain helper invocation has no session id in its
  # env). Keeps the owner marker matched to the session that created it.
  if [[ "$session_id" == local-* && -f "$marker" ]]; then
    local prior_session_id
    prior_session_id="$(sed -n 's/^session_id=//p' "$marker" | head -1)"
    prior_session_id="${prior_session_id%\'}"
    prior_session_id="${prior_session_id#\'}"
    [[ -n "$prior_session_id" ]] && session_id="$prior_session_id"
  fi
  [[ -n "$parent_repo_root" ]] || parent_repo_root="$root"

  {
    vcs_env_quote session_id "$session_id"
    vcs_env_quote agent_id "$agent_id"
    vcs_env_quote mode "$mode"
    vcs_env_quote workspace_name "$workspace"
    vcs_env_quote workspace_root "$root"
    vcs_env_quote work_ref "$work_ref"
    vcs_env_quote parent_repo_root "$parent_repo_root"
    vcs_env_quote created_at "$created_at"
    vcs_env_quote skill_version "$vcs_state_skill_version"
  } >"$marker"
  printf '%s\n' "$marker"
}

vcs_current_marker_matches() {
  local expected_ref="${1:-}" mode root workspace marker
  mode="$(vcs_detect_mode)" || return 1
  if [[ "$mode" == "jj" ]]; then
    root="$(jj root 2>/dev/null)" || return 1
  else
    root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 1
  fi
  workspace="$(vcs_current_workspace_name "$mode")" || return 1
  marker="$(vcs_marker_path_for "$mode" "$workspace")" || return 1
  [[ -f "$marker" ]] || return 1

  # shellcheck disable=SC1090
  source "$marker" || return 1
  [[ "${workspace_name:-}" == "$workspace" ]] || return 1
  [[ "${workspace_root:-}" == "$root" ]] || return 1
  [[ "${mode:-}" == "$(vcs_detect_mode)" ]] || return 1
  if [[ -n "$expected_ref" ]]; then
    [[ "${work_ref:-}" == "$expected_ref" || "${workspace_name:-}" == "$expected_ref" ]] || return 1
  fi
}

# --- isolated-session awareness helpers (used by the guard hook) ---
# These let vcs-check.sh tell "editing the shared checkout" apart from "editing
# an isolated sibling workspace", and recognize a session that already isolated
# via session-start.sh / isolate.sh even when the shell cwd has drifted back to
# the shared root. See docs/issues/0008 for the trap this removes.

# Absolute path of the shared/default checkout root (the jj `default` workspace,
# or the primary git checkout). Empty when it cannot be determined.
vcs_shared_root_abs() {
  local mode root common
  mode="$(vcs_detect_mode 2>/dev/null)" || return 1
  case "$mode" in
    jj)
      root="$(vcs_jj_default_root 2>/dev/null)" || return 1
      ;;
    git)
      common="$(vcs_git_common_dir 2>/dev/null)" || return 1
      root="$(dirname "$common")"
      ;;
    *)
      return 1
      ;;
  esac
  vcs_abs_dir "$root"
}

# Return 0 when $1 is the shared root itself or lives anywhere under it.
vcs_path_in_shared_root() {
  local target="$1" shared dir base abs
  [[ -n "$target" ]] || return 1
  shared="$(vcs_shared_root_abs 2>/dev/null)" || return 1
  [[ -n "$shared" ]] || return 1
  if [[ -d "$target" ]]; then
    abs="$(vcs_abs_dir "$target" 2>/dev/null)" || abs="$target"
  else
    dir="$(dirname "$target")"
    base="$(basename "$target")"
    if [[ -d "$dir" ]]; then
      abs="$(vcs_abs_dir "$dir" 2>/dev/null)/$base"
    else
      abs="$target"
    fi
  fi
  [[ "$abs" == "$shared" || "$abs" == "$shared"/* ]]
}

# Return 0 when the current session (VCS_SESSION_ID) owns at least one
# non-default workspace whose root still exists. Lets the guard trust a correctly
# isolated session even when the shell cwd has drifted back to the shared root.
vcs_session_owns_isolated_workspace() {
  local sid dir f
  sid="$(vcs_session_id)"
  [[ -n "$sid" ]] || return 1
  case "$sid" in local-*) return 1 ;; esac
  dir="$(vcs_state_dir 2>/dev/null)" || return 1
  [[ -d "$dir" ]] || return 1
  for f in "$dir"/*.env; do
    [[ -f "$f" ]] || continue
    if (
      # shellcheck disable=SC1090
      source "$f" 2>/dev/null || exit 1
      [[ "${session_id:-}" == "$sid" ]] || exit 1
      [[ -n "${workspace_name:-}" && "${workspace_name}" != "default" ]] || exit 1
      [[ -n "${workspace_root:-}" && -d "${workspace_root}" ]] || exit 1
      exit 0
    ); then
      return 0
    fi
  done
  return 1
}

# Return 0 when the current hook/session id owns the named workspace or work ref.
# Unlike vcs_session_owns_isolated_workspace, this intentionally does not require
# the workspace root to still exist; post-integration cleanup may forget a
# workspace before deleting its same-named bookmark.
vcs_session_owns_ref() {
  local ref="$1" sid dir f
  [[ -n "$ref" ]] || return 1
  sid="$(vcs_session_id)"
  [[ -n "$sid" ]] || return 1
  case "$sid" in local-*) return 1 ;; esac
  dir="$(vcs_state_dir 2>/dev/null)" || return 1
  [[ -d "$dir" ]] || return 1
  for f in "$dir"/*.env; do
    [[ -f "$f" ]] || continue
    if (
      # shellcheck disable=SC1090
      source "$f" 2>/dev/null || exit 1
      [[ "${session_id:-}" == "$sid" ]] || exit 1
      [[ "${workspace_name:-}" == "$ref" || "${work_ref:-}" == "$ref" ]] || exit 1
      exit 0
    ); then
      return 0
    fi
  done
  return 1
}
