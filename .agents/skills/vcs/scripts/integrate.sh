#!/usr/bin/env bash
#
# Script-first integration helper for the vcs skill.
#
# It owns the repeatable VCS mechanics:
# - detect jj vs git from the current workspace;
# - integrate a finished branch/bookmark onto main;
# - publish/advance main with retry guards;
# - delete the merged work ref when it is not remote-backed;
# - in jj, recover/park default and retire landed agent workspaces.
#
# It intentionally stops at semantic conflicts. Resolve the listed files by the
# vcs conflict etiquette, then rerun with --continue.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"
main_ref="main"
continue_mode=0
work_ref=""

usage() {
  cat <<'EOF'
usage: integrate.sh [--main main] [--continue] <work-branch-or-bookmark>

Examples:
  bash <skill-dir>/scripts/integrate.sh agent-2
  bash <skill-dir>/scripts/integrate.sh --continue agent-2

Exit codes:
  0  integrated, published, and cleaned up
  2  conflict needs agent resolution, then rerun with --continue
  3  setup or unexpected VCS failure
EOF
}

msg() { printf 'vcs-integrate: %s\n' "$*"; }
die() {
  printf 'vcs-integrate: %s\n' "$*" >&2
  exit 3
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --main)
      [[ $# -ge 2 ]] || die "--main requires a value"
      main_ref="$2"
      shift 2
      ;;
    --continue)
      continue_mode=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      if [[ -n "$work_ref" ]]; then
        die "only one work branch/bookmark may be supplied"
      fi
      work_ref="$1"
      shift
      ;;
  esac
done

if [[ -z "$work_ref" && $# -gt 0 ]]; then
  work_ref="$1"
fi

if [[ "$work_ref" == *$'\n'* || "$main_ref" == *$'\n'* ]]; then
  die "ref names must be single-line values"
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

mode="$(detect_mode)" || die "not inside a Git or jj repository"
"$script_dir/vcs-check.sh" pre-vcs-write --helper integrate "$work_ref" ||
  exit $?

# ---------------------------------------------------------------------------
# Git mode

git_remote_exists() {
  git remote get-url origin >/dev/null 2>&1
}

git_rebase_in_progress() {
  [[ -d "$(git rev-parse --git-path rebase-merge 2>/dev/null)" ||
    -d "$(git rev-parse --git-path rebase-apply 2>/dev/null)" ]]
}

git_conflict_files() {
  git diff --name-only --diff-filter=U 2>/dev/null
}

git_has_conflict_markers() {
  grep -Eq '^(<<<<<<<|=======|>>>>>>>|[|]{7})' "$1" 2>/dev/null
}

git_try_auto_conflicts() {
  local paths=() p backup valid=1 remaining resolved=()
  while IFS= read -r p; do
    [[ -n "$p" ]] && paths+=("$p")
  done < <(git_conflict_files)
  [[ "${#paths[@]}" -gt 0 ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1

  for p in "${paths[@]}"; do
    [[ -f "$p" ]] || continue
    case "$p" in
      *.json)
        if [[ -f "$script_dir/json-union-merge.py" ]] &&
          python3 "$script_dir/json-union-merge.py" "$p" >/dev/null 2>&1 &&
          python3 -m json.tool "$p" >/dev/null 2>&1; then
          git add "$p" >/dev/null 2>&1 && resolved+=("$p")
        fi
        ;;
      *.yaml | *.yml | *.toml | *.ini | *.env)
        if [[ -f "$script_dir/scalar-version-merge.py" ]] &&
          python3 "$script_dir/scalar-version-merge.py" "$p" >/dev/null 2>&1 &&
          ! git_has_conflict_markers "$p"; then
          git add "$p" >/dev/null 2>&1 && resolved+=("$p")
        fi
        ;;
      *)
        [[ -f "$script_dir/conflict-preview.py" ]] || continue
        backup="$(mktemp "${TMPDIR:-/tmp}/vcs-git-conflict.XXXXXX")" || continue
        cp "$p" "$backup" || {
          rm -f "$backup"
          continue
        }
        if python3 "$script_dir/conflict-preview.py" --write "$p" >/dev/null 2>&1 &&
          ! git_has_conflict_markers "$p"; then
          valid=1
          case "$p" in
            *.py) python3 -m py_compile "$p" >/dev/null 2>&1 || valid=0 ;;
          esac
          if [[ "$valid" -eq 1 ]] && git add "$p" >/dev/null 2>&1; then
            resolved+=("$p")
            rm -f "$backup"
          else
            cp "$backup" "$p" 2>/dev/null || true
            rm -f "$backup"
          fi
        else
          cp "$backup" "$p" 2>/dev/null || true
          rm -f "$backup"
        fi
        ;;
    esac
  done

  [[ "${#resolved[@]}" -gt 0 ]] || return 1
  remaining="$(git_conflict_files)"
  msg "AUTO_RESOLVED=git-additive paths=${resolved[*]}"
  [[ -z "$remaining" ]] || msg "AUTO_RESOLVED_PARTIAL=remaining-conflicts paths=$(printf '%s' "$remaining" | tr '\n' ' ')"
  [[ -z "$remaining" ]]
}

git_print_conflict_and_exit() {
  msg "VCS_CONFLICT=git"
  msg "Resolve these files by union; for single-valued fields keep the higher value:"
  git_conflict_files | sed 's/^/  - /'
  if command -v python3 >/dev/null 2>&1 && [[ -f "$script_dir/conflict-preview.py" ]]; then
    msg "additive text/JSON conflicts may have been auto-resolved already; inspect any remaining files only."
  fi
  msg "During git rebase, the HEAD side is already-landed main; compare values directly instead of choosing ours/theirs."
  msg "Then run: bash <skill-dir>/scripts/integrate.sh --continue $work_ref"
  exit 2
}

git_fetch_main() {
  if git_remote_exists; then
    git fetch origin >/dev/null 2>&1 || die "git fetch origin failed"
    printf 'origin/%s\n' "$main_ref"
  else
    git rev-parse --verify -q "$main_ref" >/dev/null ||
      die "local main ref '$main_ref' does not exist"
    printf '%s\n' "$main_ref"
  fi
}

git_cleanup_branch() {
  [[ -n "$work_ref" ]] || return 0
  git show-ref --verify --quiet "refs/heads/$work_ref" || return 0

  if git_remote_exists && git ls-remote --exit-code --heads origin "$work_ref" >/dev/null 2>&1; then
    msg "keeping '$work_ref' because a remote branch backs it"
    return 0
  fi

  current="$(git branch --show-current 2>/dev/null || true)"
  if [[ "$current" == "$work_ref" ]]; then
    git switch --detach >/dev/null 2>&1 || die "could not detach from '$work_ref'"
  fi
  git branch -d "$work_ref" >/dev/null 2>&1 ||
    die "could not delete '$work_ref'; it may not be fully merged"
  msg "deleted merged branch '$work_ref'"
}

git_publish_loop() {
  local upstream
  while :; do
    upstream="$(git_fetch_main)"

    if git_rebase_in_progress; then
      git add -A
      GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 || {
        if [[ -n "$(git_conflict_files)" ]]; then
          git_try_auto_conflicts && continue
          git_print_conflict_and_exit
        fi
        die "git rebase --continue failed"
      }
    else
      git rebase "$upstream" >/dev/null 2>&1 || {
        if [[ -n "$(git_conflict_files)" ]]; then
          git_try_auto_conflicts && continue
          git_print_conflict_and_exit
        fi
        die "git rebase $upstream failed"
      }
    fi

    if git_remote_exists; then
      if git push origin "HEAD:$main_ref" >/dev/null 2>&1; then
        git fetch origin >/dev/null 2>&1 || true
        git_cleanup_branch
        msg "published=origin/$main_ref; a local '$main_ref' checked out in another worktree may remain visually behind"
        msg "DONE mode=git main=$main_ref work=$work_ref"
        return 0
      fi
      msg "push was rejected; rebasing onto the latest origin/$main_ref"
      continue
    fi

    if git merge-base --is-ancestor "$main_ref" HEAD >/dev/null 2>&1; then
      git update-ref "refs/heads/$main_ref" HEAD ||
        die "could not fast-forward local '$main_ref'"
      git_cleanup_branch
      msg "DONE mode=git main=$main_ref work=$work_ref"
      return 0
    fi

    msg "local '$main_ref' moved; rebasing again"
  done
}

run_git() {
  if [[ -z "$work_ref" ]]; then
    work_ref="$(git branch --show-current 2>/dev/null || true)"
    [[ -n "$work_ref" ]] || die "pass the work branch name"
  fi

  if ! git_rebase_in_progress; then
    current="$(git branch --show-current 2>/dev/null || true)"
    if [[ "$current" != "$work_ref" ]]; then
      git switch "$work_ref" >/dev/null 2>&1 ||
        die "could not switch to work branch '$work_ref'"
    fi
  fi

  git_publish_loop
}

# ---------------------------------------------------------------------------
# jj mode

jj_conflict_list() {
  local out
  out="$(jj resolve --list 2>&1 || true)"
  if printf '%s\n' "$out" | grep -qi 'No conflicts found'; then
    return 0
  fi
  printf '%s\n' "$out" | sed '/^$/d'
}

jj_conflict_paths() {
  jj_conflict_list | awk '{print $1}'
}

jj_has_conflicts() {
  [[ -n "$(jj_conflict_list)" ]]
}

jj_try_auto_additive_conflicts() {
  local paths=() safe_paths=() p backup valid=1 remaining remaining_has_safe=0
  while IFS= read -r p; do
    [[ -n "$p" ]] && paths+=("$p")
  done < <(jj_conflict_paths)
  [[ "${#paths[@]}" -gt 0 ]] || return 1
  [[ -f "$script_dir/conflict-preview.py" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1

  for p in "${paths[@]}"; do
    case "$p" in
      *.yaml | *.yml | *.toml | *.ini | *.env)
        ;;
      *)
        safe_paths+=("$p")
        ;;
    esac
  done
  [[ "${#safe_paths[@]}" -gt 0 ]] || return 1

  backup="$(mktemp -d "${TMPDIR:-/tmp}/vcs-conflict-backup.XXXXXX")" || return 1
  for p in "${safe_paths[@]}"; do
    mkdir -p "$backup/$(dirname "$p")"
    cp "$p" "$backup/$p" || {
      rm -rf "$backup"
      return 1
    }
  done

  if ! python3 "$script_dir/conflict-preview.py" --write "${safe_paths[@]}" >/dev/null 2>&1; then
    for p in "${safe_paths[@]}"; do cp "$backup/$p" "$p" 2>/dev/null || true; done
    rm -rf "$backup"
    return 1
  fi

  for p in "${safe_paths[@]}"; do
    case "$p" in
      *.json)
        python3 -m json.tool "$p" >/dev/null 2>&1 || valid=0
        ;;
      *.py)
        python3 -m py_compile "$p" >/dev/null 2>&1 || valid=0
        ;;
    esac
  done

  if [[ "$valid" -ne 1 ]]; then
    for p in "${safe_paths[@]}"; do cp "$backup/$p" "$p" 2>/dev/null || true; done
    rm -rf "$backup"
    return 1
  fi

  jj_snapshot
  remaining="$(jj_conflict_paths)"
  for p in "${safe_paths[@]}"; do
    if printf '%s\n' "$remaining" | grep -qxF "$p"; then
      remaining_has_safe=1
      break
    fi
  done
  if [[ "$remaining_has_safe" -eq 1 ]]; then
    for p in "${safe_paths[@]}"; do cp "$backup/$p" "$p" 2>/dev/null || true; done
    jj_snapshot
    rm -rf "$backup"
    return 1
  fi

  rm -rf "$backup"
  msg "AUTO_RESOLVED=jj-additive-preview paths=${safe_paths[*]}"
  [[ -z "$remaining" ]] || msg "AUTO_RESOLVED_PARTIAL=remaining-conflicts paths=$(printf '%s' "$remaining" | tr '\n' ' ')"
  [[ -z "$remaining" ]]
}

jj_print_conflict_and_exit() {
  msg "VCS_CONFLICT=jj"
  msg "Resolve these files by union; for single-valued fields keep the higher value:"
  jj_conflict_list | sed 's/^/  - /'
  msg "jj uses diff-style conflict markers: drop marker/header lines (<<<<<<<, %%%%%%%, \\\\\\\\\\, +++++++, >>>>>>>)."
  msg "Inside a jj conflict, a leading '+' before a real content line means that line was added; keep the content without the marker prefix when unioning."
  if command -v python3 >/dev/null 2>&1 && [[ -f "$script_dir/conflict-preview.py" ]]; then
    msg "marker-stripped preview follows; verify it before copying into the files:"
    # The first field from `jj resolve --list` is the conflicted path.
    # shellcheck disable=SC2046
    python3 "$script_dir/conflict-preview.py" $(jj_conflict_list | awk '{print $1}') 2>/dev/null || true
    msg "For purely additive conflicts, you can apply that preview with:"
    # shellcheck disable=SC2046
    msg "python3 \"$script_dir/conflict-preview.py\" --write $(jj_conflict_list | awk '{print $1}' | tr '\n' ' ')"
    msg "After --write, inspect structured files and adjust any single-valued fields before --continue."
  fi
  msg "Do not run git add. After editing, run: bash <skill-dir>/scripts/integrate.sh --continue $work_ref"
  exit 2
}

jj_snapshot() {
  jj workspace update-stale >/dev/null 2>&1 || true
  jj status >/dev/null 2>&1 || die "jj status failed"
}

jj_conflicted_history() {
  jj log --no-graph -r '::@' \
    -T 'if(conflict, change_id.shortest(8) ++ "\n", "")' 2>/dev/null |
    sed '/^$/d'
}

jj_main_is_ancestor_of_at() {
  [[ -n "$(jj log --no-graph -r "$main_ref & ::@" -T 'commit_id ++ "\n"' 2>/dev/null | sed '/^$/d')" ]]
}

# Non-empty when main is an ancestor of (or equal to) the work bookmark — the
# work is already linear on top of main, so it can fast-forward with no merge.
jj_work_contains_main() {
  [[ -n "$(jj log --no-graph -r "$work_ref & descendants($main_ref)" -T 'commit_id ++ "\n"' 2>/dev/null | sed '/^$/d')" ]]
}

# `jj git push` rejects a commit that is empty AND has no description.
jj_is_pushable() {
  local rev="$1" empty desc
  empty="$(jj log --no-graph -r "$rev" -T 'if(empty,"1","0")' 2>/dev/null | head -n1)"
  desc="$(jj log --no-graph -r "$rev" -T 'description' 2>/dev/null)"
  [[ -n "${desc//[[:space:]]/}" ]] && return 0
  [[ "$empty" == "1" ]] && return 1
  return 0
}

# Described message for a real merge, so jj will push it (see COMMITS.md).
jj_merge_message() {
  local name email body
  name="$(jj config get user.name 2>/dev/null || true)"
  email="$(jj config get user.email 2>/dev/null || true)"
  body="chore(merge): integrate ${work_ref} into ${main_ref}"
  [[ -n "$name" && -n "$email" ]] && body+=$'\n\n'"Author: ${name} <${email}>"
  printf '%s' "$body"
}

# Land work onto main: fast-forward when linear, else form a described merge.
# Sets jj_landed_via to "ff" or "merge".
jj_landed_via=""
jj_land() {
  jj workspace update-stale >/dev/null 2>&1 || true
  jj bookmark list "$work_ref" >/dev/null 2>&1 ||
    die "bookmark '$work_ref' does not exist"

  if jj_work_contains_main; then
    jj bookmark set "$main_ref" -r "$work_ref" >/dev/null 2>&1 ||
      die "could not fast-forward '$main_ref' to '$work_ref'"
    jj_snapshot
    jj_landed_via="ff"
    msg "fast-forwarded '$main_ref' to linear work '$work_ref' (no merge needed)"
    return 0
  fi

  jj new "$main_ref" "$work_ref" -m "$(jj_merge_message)" >/dev/null 2>&1 ||
    die "could not create jj integration merge from '$main_ref' and '$work_ref'"
  jj_snapshot
  jj_landed_via="merge"
  if jj_has_conflicts; then
    jj_try_auto_additive_conflicts || jj_print_conflict_and_exit
  fi
}

# The default workspace's root — a stable repo anchor that survives retiring the
# agent's own (about-to-be-removed) workspace. Falls back to the current root.
jj_repo_anchor() {
  local root
  root="$(jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null |
    awk -F '\t' '$1=="default"{print $2; exit}')"
  [[ -n "$root" ]] || root="$(jj root 2>/dev/null || pwd)"
  printf '%s\n' "$root"
}

# Shared finish once main points at the landed commit: validate it would push,
# open a fresh working copy, then run the cleanup/retire/export steps.
jj_finish() {
  jj_is_pushable "$main_ref" ||
    die "refusing to finish: '$main_ref' points at an empty, description-less commit that 'jj git push' would reject"
  # Resolve a stable repo anchor BEFORE retiring this agent's workspace, whose
  # directory (and our cwd) may be removed by jj_retire_landed_workspaces.
  local anchor current_ws
  anchor="$(jj_repo_anchor)"
  current_ws="$(vcs_jj_workspace_name 2>/dev/null || true)"
  if [[ "$current_ws" != "$work_ref" ]]; then
    jj new "$main_ref" >/dev/null 2>&1 || true
  fi
  jj_cleanup_bookmark
  jj_retire_landed_workspaces
  jj_abandon_orphan_empty_heads "$anchor"
  jj_git_export_if_colocated
  jj_push_main_if_remote
  msg "DONE mode=jj main=$main_ref work=$work_ref"
}

# Sweep away cleanup residue: anonymous empty side-heads left after a
# workspace/bookmark lifecycle (jj abandons an empty working-copy commit when its
# workspace is forgotten ONLY if no bookmark pinned it; a bookmark created on the
# initial empty workspace commit — the isolate.sh path — survives the forget, and
# deleting the bookmark afterward strands it as an empty, unreferenced side-head;
# see docs/issues/0007). This abandons every commit that is, conservatively,
# empty AND description-less AND has no bookmark AND is not an ancestor of main
# AND is no live workspace's working copy — so real work, named commits,
# bookmarked commits, main, and active working copies are never touched.
jj_abandon_orphan_empty_heads() {
  local root="$1" wc_set="" ws cid flags abandoned=()
  [[ -n "$root" ]] || root="$(jj root 2>/dev/null || pwd)"
  # Our cwd may be a just-removed workspace dir; jj needs a live cwd even with -R.
  [[ -d "$root" ]] && cd "$root" 2>/dev/null || return 0
  for ws in $(jj -R "$root" --ignore-working-copy workspace list -T 'name ++ "\n"' 2>/dev/null); do
    cid="$(jj -R "$root" --ignore-working-copy log --no-graph -r "${ws}@" -T 'commit_id ++ "\n"' 2>/dev/null | head -1)"
    [[ -n "$cid" ]] && wc_set="$wc_set $cid "
  done
  while IFS=$'\t' read -r cid flags; do
    [[ -n "$cid" ]] || continue
    [[ "$flags" == "Ex" ]] || continue        # empty (E) + no description (x)
    [[ "$wc_set" == *" $cid "* ]] && continue  # a live workspace's working copy
    if jj -R "$root" --ignore-working-copy abandon "$cid" >/dev/null 2>&1; then
      abandoned+=("${cid:0:12}")
    fi
  done < <(jj -R "$root" --ignore-working-copy log --no-graph \
    -r 'heads(all()) ~ ::'"$main_ref"' ~ bookmarks()' \
    -T 'commit_id ++ "\t" ++ if(empty,"E","x") ++ if(description,"D","x") ++ "\n"' 2>/dev/null)
  [[ "${#abandoned[@]}" -gt 0 ]] &&
    msg "abandoned ${#abandoned[@]} orphan empty side-head(s): ${abandoned[*]}"
  return 0
}

jj_git_export_if_colocated() {
  [[ -d "$(jj root 2>/dev/null)/.git" ]] && jj git export >/dev/null 2>&1 || true
}

# Publish the landed main to its remote, mirroring git mode (git_publish_loop
# pushes; jj mode historically stopped at the local landing and left the push to
# the agent — but the agent's workspace is gone and the guard refuses VCS writes
# from the shared default it was dropped into, so it was stranded). Best-effort:
# skip when there is no remote (local-only repo), and on a rejected/failed push
# keep the manual fallback rather than failing the already-completed landing.
jj_push_main_if_remote() {
  [[ -n "$(jj git remote list 2>/dev/null)" ]] || return 0
  if jj git push --bookmark "$main_ref" >/dev/null 2>&1; then
    msg "published '$main_ref' to remote"
  else
    msg "could not auto-publish '$main_ref' (the remote may have moved); run from NEXT_CWD: jj git push --bookmark $main_ref"
  fi
}

jj_bookmark_remote_backed() {
  local remotes line remote
  remotes="$(jj git remote list 2>/dev/null | awk '{print $1}' | sed '/^$/d' || true)"
  [[ -n "$remotes" ]] || return 1
  line="$(jj bookmark list "$work_ref" 2>/dev/null || true)"
  for remote in $remotes; do
    if printf '%s\n' "$line" | grep -Eq "@${remote}([[:space:]]|$)"; then
      return 0
    fi
  done
  return 1
}

jj_cleanup_bookmark() {
  [[ -n "$work_ref" ]] || return 0
  if ! jj bookmark list "$work_ref" 2>/dev/null | grep -Eq "^${work_ref}:"; then
    return 0
  fi
  if jj_bookmark_remote_backed; then
    msg "keeping '$work_ref' because a real remote backs it"
    return 0
  fi
  jj bookmark delete "$work_ref" >/dev/null 2>&1 ||
    die "could not delete bookmark '$work_ref'"
  msg "deleted merged bookmark '$work_ref'"
}

jj_workspace_listing() {
  jj --ignore-working-copy workspace list -T 'name ++ "\t" ++ root ++ "\n"' 2>/dev/null
}

jj_bookmark_exists() {
  local name="$1"
  jj bookmark list "$name" 2>/dev/null | grep -Eq "^${name}:"
}

jj_retire_landed_workspaces() {
  local listing default_root current_root admin_root line name root should_retire
  listing="$(jj_workspace_listing || true)"
  default_root="$(printf '%s\n' "$listing" | awk -F '\t' '$1=="default"{print $2; exit}')"
  current_root="$(jj root 2>/dev/null || pwd)"
  admin_root="${default_root:-$current_root}"

  # jj reports canonical roots (e.g. /private/tmp/...); the shell PWD may be the
  # symlinked form (/tmp/...). Compare the PHYSICAL cwd too so we reliably detect
  # that we're standing in the workspace about to be removed and step out of it —
  # otherwise later jj commands run from a deleted directory and fail.
  local phys_pwd
  phys_pwd="$(pwd -P 2>/dev/null || printf '%s' "$PWD")"
  while IFS=$'\t' read -r name root; do
    [[ -n "$name" && "$name" != "default" ]] || continue
    [[ "$name" == "$work_ref" ]] || continue

    if [[ "$PWD" == "$root"* || "$phys_pwd" == "$root"* ]]; then
      msg "NEXT_CWD=$admin_root"
      msg "current jj workspace '$name' is being retired; run any later shell commands from NEXT_CWD"
      cd "$admin_root" 2>/dev/null || cd "$(dirname "$root")" || true
    fi
    jj -R "$admin_root" workspace update-stale >/dev/null 2>&1 || true
    jj -R "$admin_root" workspace forget "$name" >/dev/null 2>&1 || true
    if [[ -n "$root" && "$root" != "/" && -d "$root" ]]; then
      rm -rf "$root"
    fi
    # Remove the owner marker too: a marker that outlives its workspace keeps
    # vcs_session_owns_ref matching a workspace that no longer exists and leaves
    # stale state in agent-sessions/ that strands later guard checks.
    vcs_remove_owner_marker jj "$name"
    msg "retired jj workspace '$name'"
  done <<<"$listing"

  if [[ -n "$default_root" && -d "$default_root" ]]; then
    (cd "$default_root" &&
      jj workspace update-stale >/dev/null 2>&1 || true
      jj new "$main_ref" >/dev/null 2>&1 || true)
  fi
}

jj_publish_loop() {
  while :; do
    jj_snapshot
    if jj_has_conflicts; then
      jj_try_auto_additive_conflicts || jj_print_conflict_and_exit
    fi

    conflicted="$(jj_conflicted_history)"
    if [[ -n "$conflicted" ]]; then
      msg "jj commit history under @ is still conflicted: $conflicted"
      jj_print_conflict_and_exit
    fi

    if ! jj_main_is_ancestor_of_at; then
      msg "'$main_ref' moved; reforming the integration against the latest '$main_ref'"
      jj_land
      [[ "$jj_landed_via" == "ff" ]] && { jj_finish; return 0; }
      continue
    fi

    if jj bookmark set "$main_ref" -r @ >/dev/null 2>&1; then
      jj_finish
      return 0
    fi

    msg "bookmark set did not advance cleanly; reforming the integration"
    jj_land
    [[ "$jj_landed_via" == "ff" ]] && { jj_finish; return 0; }
  done
}

run_jj() {
  [[ -n "$work_ref" ]] || die "pass the work bookmark name"

  if [[ "$continue_mode" -eq 0 ]]; then
    jj_land
    if [[ "$jj_landed_via" == "ff" ]]; then
      jj_finish
      return 0
    fi
  fi
  jj_publish_loop
}

case "$mode" in
  git) run_git ;;
  jj) run_jj ;;
  *) die "unknown mode '$mode'" ;;
esac
