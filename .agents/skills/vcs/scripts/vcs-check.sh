#!/usr/bin/env bash
#
# Guard checks for vcs helpers and agent hooks.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"

cmd="${1:-}"
[[ $# -gt 0 ]] && shift || true
helper=""
agent="agent"
hook_mode=0
main_ref="${VCS_MAIN_REF:-main}"

usage() {
  cat <<'EOF'
usage:
  vcs-check.sh pre-edit
  vcs-check.sh pre-vcs-write [--helper isolate|integrate|session-start|rename-work] [work-ref]
  vcs-check.sh pre-publish [--helper integrate] [work-ref]
  vcs-check.sh assert-owner <work-ref>
  vcs-check.sh hook [--agent codex|claude|cursor|agy]

The hook form reads an agent hook JSON object on stdin and blocks risky
default-workspace edits or raw VCS writes. Claude/Codex hooks use the
agent-native exit-code contract (exit 2 blocks); Antigravity hooks receive a
JSON decision response. Cursor hooks should call cursor-hook.sh, which adapts
Cursor payloads and emits Cursor JSON.
EOF
}

is_antigravity_agent() {
  case "$agent" in
    agy | antigravity | gemini) return 0 ;;
    *) return 1 ;;
  esac
}

json_string() {
  command -v python3 >/dev/null 2>&1 || {
    printf '"%s"' "$(cat | sed 's/"/\\"/g')"
    return 0
  }
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --helper)
      [[ $# -ge 2 ]] || {
        echo "vcs-check: --helper requires a value" >&2
        exit 3
      }
      helper="$2"
      shift 2
      ;;
    --agent)
      [[ $# -ge 2 ]] || {
        echo "vcs-check: --agent requires a value" >&2
        exit 3
      }
      agent="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

ref="${1:-}"

deny() {
  local reason="$1"
  local dir="$PWD"
  while [[ "$dir" != "/" && -n "$dir" ]]; do
    if [[ -f "$dir/manifest.env" ]]; then
      printf '%s\t%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$reason" >>"$dir/guard-blocks.log" 2>/dev/null || true
      break
    fi
    dir="$(dirname "$dir")"
  done
  if [[ "$hook_mode" -eq 1 ]]; then
    if is_antigravity_agent; then
      local encoded
      encoded="$(printf 'vcs-check: %s' "$reason" | json_string)"
      printf '{"decision":"deny","reason":%s}\n' "$encoded"
      exit 0
    fi
    printf 'vcs-check: %s\n' "$reason" >&2
    exit 2
  fi
  printf 'vcs-check: %s\n' "$reason" >&2
  exit 3
}

current_mode() {
  vcs_detect_mode 2>/dev/null || true
}

current_shared_reason() {
  local mode current
  mode="$(current_mode)"
  case "$mode" in
    jj)
      current="$(vcs_jj_workspace_name 2>/dev/null || true)"
      [[ "$current" == "default" ]] && {
        printf "current cwd is the shared jj default workspace"
        return 0
      }
      ;;
    git)
      if ! vcs_git_is_linked_worktree; then
        printf "current cwd is the shared primary git checkout"
        return 0
      fi
      ;;
  esac
  return 1
}

ensure_not_shared() {
  local action="$1" reason
  reason="$(current_shared_reason || true)"
  [[ -z "$reason" ]] && return 0
  if vcs_session_owns_isolated_workspace; then
    deny "$action refused: $reason, but this session already owns an isolated workspace. Prefix the command with: cd <your-workspace> && ... (or target an absolute path inside it)."
  fi
  deny "$action refused: $reason. Run session-start.sh or isolate.sh, cd to NEXT_CWD, then retry."
}

ensure_owner_marker() {
  local expected="${1:-}"
  vcs_current_marker_matches "$expected" || {
    if [[ -n "$expected" ]]; then
      deny "owner check refused: no matching session owner marker for '$expected' in this workspace"
    else
      deny "owner check refused: no session owner marker for this workspace"
    fi
  }
}

shared_workspace_clean_on_main() {
  local mode current state branch status
  mode="$(current_mode)"
  case "$mode" in
    jj)
      current="$(vcs_jj_workspace_name 2>/dev/null || true)"
      [[ "$current" == "default" ]] || return 1
      state="$(jj log --no-graph -r @ \
        -T 'if(empty,"empty","nonempty") ++ "\t" ++ if(description,"described","undescribed") ++ "\n"' 2>/dev/null | head -1)" || return 1
      [[ "$state" == $'empty\tundescribed' ]] || return 1
      jj log --no-graph -r "(@ | @-) & $main_ref" -T 'commit_id ++ "\n"' 2>/dev/null | grep -q .
      ;;
    git)
      vcs_git_is_linked_worktree && return 1
      branch="$(git branch --show-current 2>/dev/null || true)"
      [[ "$branch" == "$main_ref" ]] || return 1
      status="$(git status --porcelain 2>/dev/null)" || return 1
      [[ -z "$status" ]]
      ;;
    *)
      return 1
      ;;
  esac
}

maybe_chdir_owned_workspace_for_hook() {
  local root
  current_shared_reason >/dev/null 2>&1 || return 1
  root="$(vcs_session_owned_workspace_root 2>/dev/null)" || return 1
  cd "$root" 2>/dev/null || return 1
}

is_helper_name() {
  case "$1" in
    isolate | integrate | session-start | rename-work) return 0 ;;
    *) return 1 ;;
  esac
}

check_pre_edit() {
  local target="${1:-}"
  [[ "${VCS_GUARD_ALLOW_SHARED:-}" == "1" ]] && return 0
  # Path-aware: only refuse edits whose target lives inside the shared checkout's
  # working copy. Edits to an isolated sibling workspace are always fine, even
  # when the shell cwd has drifted back to the shared root.
  if [[ -n "$target" ]]; then
    if vcs_path_in_shared_root "$target"; then
      ensure_not_shared "edit"
    fi
    return 0
  fi
  # No target path available: trust a session that owns an isolated workspace,
  # otherwise fall back to the shell-cwd signal.
  vcs_session_owns_isolated_workspace && return 0
  ensure_not_shared "edit"
}

simple_command_words() {
  local c="$1"
  case "$c" in
    *$'\n'* | *";"* | *"|"* | *"&"* | *">"* | *"<"*) return 1 ;;
  esac
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$c" <<'PY'
import shlex
import sys

try:
    words = shlex.split(sys.argv[1], posix=True)
except ValueError:
    sys.exit(1)

for word in words:
    print(word)
PY
}

is_safe_jj_main_push_command() {
  local c="$1" words=() word i arg next seen_bookmark=0
  [[ "$(current_mode)" == "jj" ]] || return 1
  while IFS= read -r word; do
    words+=("$word")
  done < <(simple_command_words "$c")
  while [[ "${#words[@]}" -gt 0 ]]; do
    case "${words[0]}" in
      env | *=*) words=("${words[@]:1}") ;;
      *) break ;;
    esac
  done
  [[ "${#words[@]}" -ge 3 ]] || return 1
  [[ "${words[0]}" == "jj" && "${words[1]}" == "git" && "${words[2]}" == "push" ]] || return 1

  i=3
  while [[ "$i" -lt "${#words[@]}" ]]; do
    arg="${words[$i]}"
    case "$arg" in
      --bookmark | -b)
        next="${words[$((i + 1))]:-}"
        [[ "$next" == "$main_ref" ]] || return 1
        seen_bookmark=1
        i=$((i + 2))
        ;;
      --bookmark=* | -b=*)
        [[ "${arg#*=}" == "$main_ref" ]] || return 1
        seen_bookmark=1
        i=$((i + 1))
        ;;
      --remote | -r)
        [[ -n "${words[$((i + 1))]:-}" ]] || return 1
        i=$((i + 2))
        ;;
      --remote=* | -r=* | --dry-run | --allow-new)
        i=$((i + 1))
        ;;
      *)
        return 1
        ;;
    esac
  done

  [[ "$seen_bookmark" -eq 1 ]]
}

is_safe_jj_main_describe_command() {
  local c="$1"
  [[ "$(current_mode)" == "jj" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$main_ref" "$c" <<'PYDESCRIBE'
import shlex
import sys

main_ref = sys.argv[1]
command = sys.argv[2]

try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    words = list(lexer)
except ValueError:
    sys.exit(1)

if any(word and set(word) <= set(";|&<>") for word in words):
    sys.exit(1)

while words:
    first = words[0]
    if first == "env" or ("=" in first and not first.startswith("-")):
        words = words[1:]
        continue
    break

if len(words) < 4 or words[:2] != ["jj", "describe"]:
    sys.exit(1)

seen_revision = False
seen_message = False
i = 2
while i < len(words):
    arg = words[i]
    if arg in ("-r", "--revision"):
        i += 1
        if i >= len(words) or words[i] != main_ref:
            sys.exit(1)
        seen_revision = True
        i += 1
    elif arg.startswith("-r=") or arg.startswith("--revision="):
        if arg.split("=", 1)[1] != main_ref:
            sys.exit(1)
        seen_revision = True
        i += 1
    elif arg in ("-m", "--message"):
        i += 1
        if i >= len(words) or not words[i]:
            sys.exit(1)
        seen_message = True
        i += 1
    elif arg.startswith("--message="):
        if not arg.split("=", 1)[1]:
            sys.exit(1)
        seen_message = True
        i += 1
    else:
        sys.exit(1)

sys.exit(0 if seen_revision and seen_message else 1)
PYDESCRIBE
}


jj_bookmark_exists() {
  local name="$1"
  jj --ignore-working-copy bookmark list "$name" 2>/dev/null | grep -Eq "^${name}:"
}

jj_bookmark_remote_backed() {
  local name="$1" remotes line remote
  remotes="$(jj --ignore-working-copy git remote list 2>/dev/null | awk '{print $1}' | sed '/^$/d' || true)"
  [[ -n "$remotes" ]] || return 1
  line="$(jj --ignore-working-copy bookmark list "$name" 2>/dev/null || true)"
  for remote in $remotes; do
    if printf '%s\n' "$line" | grep -Eq "@${remote}([[:space:]]|$)"; then
      return 0
    fi
  done
  return 1
}

jj_ref_is_empty_descriptionless() {
  local rev="$1" state
  state="$(jj --ignore-working-copy log --no-graph -r "$rev" \
    -T 'if(empty,"empty","nonempty") ++ "\t" ++ if(description,"described","undescribed") ++ "\n"' 2>/dev/null | head -1)" || return 1
  [[ "$state" == $'empty\tundescribed' ]]
}

jj_ref_is_ancestor_of_main() {
  local rev="$1"
  jj --ignore-working-copy log --no-graph -r "($rev) & ::$main_ref" -T 'commit_id ++ "\n"' 2>/dev/null | grep -q .
}

jj_ref_is_safe_for_shared_cleanup() {
  local rev="$1"
  jj_ref_is_ancestor_of_main "$rev" || jj_ref_is_empty_descriptionless "$rev"
}

is_owned_safe_jj_cleanup_command() {
  local c="$1" words=() word target
  [[ "$(current_mode)" == "jj" ]] || return 1
  while IFS= read -r word; do
    words+=("$word")
  done < <(simple_command_words "$c")
  while [[ "${#words[@]}" -gt 0 ]]; do
    case "${words[0]}" in
      env | *=*) words=("${words[@]:1}") ;;
      *) break ;;
    esac
  done
  [[ "${#words[@]}" -eq 4 ]] || return 1
  [[ "${words[0]}" == "jj" ]] || return 1

  case "${words[1]} ${words[2]}" in
    "bookmark delete")
      target="${words[3]}"
      jj_bookmark_exists "$target" || return 1
      if vcs_session_owns_ref "$target"; then
        jj_ref_is_safe_for_shared_cleanup "$target"
        return $?
      fi
      jj_bookmark_remote_backed "$target" && return 1
      vcs_agent_workspace_name "$target" || return 1
      jj_ref_is_ancestor_of_main "$target"
      ;;
    "workspace forget")
      target="${words[3]}"
      if vcs_session_owns_ref "$target"; then
        jj_ref_is_safe_for_shared_cleanup "${target}@"
        return $?
      fi
      vcs_agent_workspace_name "$target" || return 1
      jj_ref_is_ancestor_of_main "${target}@"
      ;;
    *)
      return 1
      ;;
  esac
}

check_pre_vcs_write() {
  local command="${1:-}"
  [[ "${VCS_GUARD_ALLOW_SHARED:-}" == "1" ]] && return 0
  if [[ -n "$command" && "$command" == "jj git export" ]]; then
    return 0
  fi
  if [[ -n "$command" ]] && is_safe_jj_main_describe_command "$command"; then
    return 0
  fi
  if [[ -n "$command" ]] && is_owned_safe_jj_cleanup_command "$command"; then
    return 0
  fi
  if is_helper_name "$helper"; then
    case "$helper" in
      isolate | session-start | rename-work)
        return 0
        ;;
      integrate)
        ensure_not_shared "integration"
        return 0
        ;;
    esac
  fi
  ensure_not_shared "VCS write"
  ensure_owner_marker "$ref"
}

check_pre_publish() {
  local command="${1:-}"
  [[ "${VCS_GUARD_ALLOW_SHARED:-}" == "1" ]] && return 0
  if [[ -n "$command" ]] && is_safe_jj_main_push_command "$command"; then
    return 0
  fi
  if [[ "$helper" == "integrate" ]]; then
    ensure_not_shared "publish"
    return 0
  fi
  ensure_not_shared "publish"
  ensure_owner_marker "$ref"
}

is_vetted_helper_command() {
  local c="$1"
  [[ "$c" == *".agents/skills/vcs/scripts/isolate.sh"* ||
    "$c" == *".agents/skills/vcs/scripts/integrate.sh"* ||
    "$c" == *".agents/skills/vcs/scripts/session-start.sh"* ||
    "$c" == *".agents/skills/vcs/scripts/rename-work.sh"* ]]
}

is_read_only_command() {
  local c="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$c" <<'PYREADONLY'
import os
import shlex
import sys

command = sys.argv[1]
try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    lexer.commenters = ""
    tokens = list(lexer)
except ValueError:
    sys.exit(1)

if not tokens:
    sys.exit(0)

segments = []
current = []
for token in tokens:
    if token in {"&&", "||", ";", "|"}:
        if current:
            segments.append(current)
            current = []
        continue
    if token and set(token) <= set("&;|<>"):
        sys.exit(1)
    current.append(token)
if current:
    segments.append(current)

simple = {
    "cat",
    "cut",
    "date",
    "df",
    "du",
    "echo",
    "false",
    "free",
    "head",
    "hostname",
    "id",
    "ls",
    "lsof",
    "nl",
    "nvidia-smi",
    "pgrep",
    "printf",
    "ps",
    "pwd",
    "rg",
    "sort",
    "tail",
    "true",
    "uname",
    "uniq",
    "wc",
    "which",
    "whoami",
}


def strip_safe_redirs(words):
    out = []
    i = 0
    while i < len(words):
        token = words[i]
        if token.isdigit() and i + 2 < len(words) and words[i + 1] in {">", ">>"} and words[i + 2] == "/dev/null":
            i += 3
            continue
        if token in {">", ">>"} and i + 1 < len(words) and words[i + 1] == "/dev/null":
            i += 2
            continue
        if token in {"2>/dev/null", "1>/dev/null", ">/dev/null", "2>&1"}:
            i += 1
            continue
        if any(ch in token for ch in "<>"):
            return None
        out.append(token)
        i += 1
    return out


def strip_env(words):
    words = list(words)
    while words:
        first = words[0]
        if first == "env":
            words = words[1:]
            continue
        if "=" in first and not first.startswith("-"):
            words = words[1:]
            continue
        break
    return words


def has_dangerous_expansion(words):
    return any("$(" in word or "`" in word for word in words)


def read_only_segment(words):
    words = strip_safe_redirs(words)
    if words is None or has_dangerous_expansion(words):
        return False
    words = strip_env(words)
    if not words:
        return True

    cmd = os.path.basename(words[0])
    args = words[1:]

    if cmd == "cd":
        return len(args) <= 1
    if cmd in simple:
        return True
    if cmd == "find":
        return not any(arg in {"-delete", "-exec", "-execdir", "-ok", "-okdir"} for arg in args)
    if cmd in {"grep", "egrep", "fgrep"}:
        return True
    if cmd == "sed":
        return not any(arg == "-i" or arg.startswith("-i") for arg in args)
    if cmd == "command":
        return not args or args[0] in {"-v", "-V"}
    if cmd == "type":
        return all(arg in {"-a", "-p", "-P", "-t"} or not arg.startswith("-") for arg in args)
    if cmd in {"curl", "wget"}:
        write_flags = {"-o", "--output", "-O", "--remote-name", "--upload-file", "-T", "--post-file"}
        return not any(arg in write_flags or arg.startswith("--output=") for arg in args)
    if cmd in {"bash", "sh"}:
        return "-c" not in args and any(arg in {"-n", "--help", "-h"} for arg in args)
    if cmd == "git":
        if not args:
            return False
        if args[0] == "--version":
            return True
        if args[0] in {"status", "log", "diff", "show", "rev-parse"}:
            return True
        if args[0] == "branch":
            return all(arg in {"--show-current", "-v", "-vv", "--list"} or not arg.startswith("-") for arg in args[1:])
        if args[0] == "remote":
            return len(args) >= 2 and args[1] in {"-v", "show", "get-url"}
        if args[0] == "worktree":
            return len(args) >= 2 and args[1] == "list"
        return False
    if cmd == "jj":
        if not args:
            return False
        if args[0] in {"--version", "version", "root", "status", "st", "log", "diff", "show"}:
            return True
        if len(args) >= 2 and args[0] == "workspace" and args[1] in {"list", "update-stale"}:
            return True
        if len(args) >= 2 and args[0] == "bookmark" and args[1] == "list":
            return True
        if len(args) >= 2 and args[0] == "resolve" and args[1] == "--list":
            return True
        if len(args) >= 3 and args[0] == "git" and args[1] == "remote" and args[2] == "list":
            return True
        return False
    return False

sys.exit(0 if all(read_only_segment(segment) for segment in segments) else 1)
PYREADONLY
    return $?
  fi

  c="${c#"${c%%[![:space:]]*}"}"
  case "$c" in
    "" | pwd | "pwd "* | date | "date "* | true | "true "* | false | "false "* | "git --version"* | "jj --version"*)
      return 0
      ;;
    ls | "ls "* | rg | "rg "* | grep | "grep "* | "sed -n "* | cat | "cat "* | head | "head "* | tail | "tail "* | wc | "wc "* | find | "find "*)
      return 0
      ;;
    "git status"* | "git log"* | "git diff"* | "git show"* | "git branch --show-current"* | "git rev-parse"* | "git remote get-url"* | "git ls-remote"* | "git worktree list"*)
      return 0
      ;;
    "jj status"* | "jj st"* | "jj log"* | "jj diff"* | "jj show"* | "jj root"* | "jj workspace list"* | "jj bookmark list"* | "jj resolve --list"* | "jj git remote list"*)
      return 0
      ;;
    "jj workspace update-stale" | "jj workspace update-stale "*)
      return 0
      ;;
    "bash "*"/scripts/"*" --help"* | "bash "*"/scripts/"*" -h"*)
      return 0
      ;;
  esac
  return 1
}


is_publish_command() {
  local c="$1"
  [[ "$c" =~ (^|[[:space:];|&])git[[:space:]]+push([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])jj[[:space:]]+git[[:space:]]+push([[:space:]]|$) ]]
}

is_vcs_mutating_command() {
  local c="$1"
  [[ "$c" =~ (^|[[:space:];|&])jj[[:space:]]+(describe|commit|new|rebase|squash|split|abandon)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])jj[[:space:]]+bookmark[[:space:]]+(set|create|delete|move|rename)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])jj[[:space:]]+workspace[[:space:]]+(add|forget|rename|update-stale)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])jj[[:space:]]+git[[:space:]]+(push|export|import)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])git[[:space:]]+(add|commit|merge|rebase|reset|checkout|switch)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])git[[:space:]]+branch[[:space:]]+(-D|-d)([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])git[[:space:]]+worktree[[:space:]]+(add|remove|prune)([[:space:]]|$) ]]
}

is_file_mutating_command() {
  local c="$1"
  [[ "$c" =~ (^|[[:space:];|&])(rm|mv|cp|touch|mkdir|rmdir)([[:space:]]|$) ||
    "$c" == *" >"* ||
    "$c" == *">>"* ||
    "$c" =~ (^|[[:space:];|&])tee([[:space:]]|$) ||
    "$c" =~ (^|[[:space:];|&])sed[[:space:]]+-i ||
    "$c" =~ (^|[[:space:];|&])perl[[:space:]]+-pi ||
    "$c" =~ (^|[[:space:];|&])find[[:space:]].*[[:space:]]-(delete|exec|execdir|ok|okdir)([[:space:]]|$) ||
    "$c" == *" --write"* ||
    "$c" == *" run format"* ]]
}

json_field() {
  local input="$1" field="$2"
  [[ -n "$input" ]] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import json, sys
field = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cur = data
for part in field.split("."):
    if isinstance(cur, list) and part.isdigit():
        idx = int(part)
        cur = cur[idx] if idx < len(cur) else None
    elif isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
    if cur is None:
        break
if cur is not None:
    print(cur)
' "$field" <<<"$input" 2>/dev/null || true
}

hook_warn_if_shared() {
  local event="$1" reason
  vcs_session_owns_isolated_workspace && return 0
  reason="$(current_shared_reason || true)"
  [[ -n "$reason" ]] || return 0
  cat <<EOF
vcs guard: $event is running from a shared checkout ($reason).
Before editing or publishing, run:
  bash <skill-dir>/scripts/session-start.sh
Then cd to NEXT_CWD and continue there.
EOF
}

# If a Bash command leads with `cd <dir> &&` / `cd <dir>;` (or is a bare
# `cd <dir>`), chdir into <dir> here so the rest of the command is judged against
# the directory it will actually run in. Sets VCS_REST_COMMAND to the remainder
# ("" for a bare cd). Returns 0 only when it chdir'd successfully. Handles
# unquoted directory paths (the common agent case).
VCS_REST_COMMAND=""
maybe_chdir_leading_cd() {
  local c="$1" dir rest
  c="${c#"${c%%[![:space:]]*}"}"
  case "$c" in
    "cd "*) : ;;
    *) return 1 ;;
  esac
  c="${c#cd }"
  c="${c#"${c%%[![:space:]]*}"}"
  dir="${c%%[ ;&]*}"
  [[ -n "$dir" ]] || return 1
  rest="${c#"$dir"}"
  rest="${rest#"${rest%%[![:space:]]*}"}"
  case "$rest" in
    "&&"*) rest="${rest#&&}" ;;
    ";"*) rest="${rest#;}" ;;
    "") rest="" ;;
    *) return 1 ;;
  esac
  rest="${rest#"${rest%%[![:space:]]*}"}"
  cd "$dir" 2>/dev/null || return 1
  VCS_REST_COMMAND="$rest"
  return 0
}

check_hook() {
  hook_mode=1
  local input event tool command file_path session_id tool_cwd target_file target_dir
  input="$(cat 2>/dev/null || true)"
  event="$(json_field "$input" hook_event_name)"
  [[ -n "$event" ]] || event="$(json_field "$input" event)"
  tool="$(json_field "$input" tool_name)"
  [[ -n "$tool" ]] || tool="$(json_field "$input" toolCall.name)"
  command="$(json_field "$input" tool_input.command)"
  file_path="$(json_field "$input" tool_input.file_path)"
  session_id="$(json_field "$input" session_id)"
  [[ -n "$session_id" ]] || session_id="$(json_field "$input" conversationId)"
  [[ -n "$session_id" ]] && export VCS_SESSION_ID="$session_id"
  [[ -n "$command" ]] || command="$(json_field "$input" tool_input.commandLine)"
  [[ -n "$command" ]] || command="$(json_field "$input" tool_input.CommandLine)"
  [[ -n "$command" ]] || command="$(json_field "$input" toolCall.args.command)"
  [[ -n "$command" ]] || command="$(json_field "$input" toolCall.args.commandLine)"
  [[ -n "$command" ]] || command="$(json_field "$input" toolCall.args.CommandLine)"
  tool_cwd="$(json_field "$input" tool_input.cwd)"
  [[ -n "$tool_cwd" ]] || tool_cwd="$(json_field "$input" tool_input.Cwd)"
  [[ -n "$tool_cwd" ]] || tool_cwd="$(json_field "$input" toolCall.args.cwd)"
  [[ -n "$tool_cwd" ]] || tool_cwd="$(json_field "$input" toolCall.args.Cwd)"
  target_file="$(json_field "$input" toolCall.args.AbsolutePath)"
  [[ -n "$target_file" ]] || target_file="$(json_field "$input" toolCall.args.TargetFile)"
  [[ -n "$file_path" ]] || file_path="$target_file"
  if [[ -z "$tool_cwd" && "$target_file" == /* ]]; then
    target_dir="$(dirname "$target_file")"
    [[ -d "$target_dir" ]] && tool_cwd="$target_dir"
  fi
  if [[ -n "$tool_cwd" && -d "$tool_cwd" ]]; then
    cd "$tool_cwd" 2>/dev/null || true
  elif [[ -z "$tool_cwd" ]]; then
    maybe_chdir_owned_workspace_for_hook || true
  fi

  case "$event" in
    SubagentStart | CwdChanged)
      is_antigravity_agent && return 0
      hook_warn_if_shared "$event"
      return 0
      ;;
  esac

  case "$tool" in
    apply_patch | Edit | Write | MultiEdit | NotebookEdit | write_to_file | replace_file_content | multi_replace_file_content)
      check_pre_edit "$file_path"
      return 0
      ;;
    Bash | run_command)
      # Honor a leading `cd <dir> &&|;` (or a bare `cd <dir>`): evaluate the rest
      # of the command from <dir>, the directory it will actually run in.
      if maybe_chdir_leading_cd "$command"; then
        command="$VCS_REST_COMMAND"
      fi
      if [[ -z "${command//[[:space:]]/}" ]]; then
        return 0
      fi
      if is_vetted_helper_command "$command"; then
        return 0
      fi
      if is_read_only_command "$command"; then
        return 0
      fi
      if is_publish_command "$command"; then
        check_pre_publish "$command"
        return 0
      fi
      if is_vcs_mutating_command "$command" || is_file_mutating_command "$command"; then
        check_pre_vcs_write "$command"
        return 0
      fi
      if current_shared_reason >/dev/null 2>&1 && ! shared_workspace_clean_on_main; then
        check_pre_vcs_write "$command"
        return 0
      fi
      ;;
  esac
}
case "$cmd" in
  pre-edit)
    check_pre_edit
    ;;
  pre-vcs-write)
    check_pre_vcs_write
    ;;
  pre-publish)
    check_pre_publish
    ;;
  assert-owner)
    [[ -n "$ref" ]] || deny "assert-owner requires a work ref"
    ensure_owner_marker "$ref"
    ;;
  hook)
    check_hook
    if is_antigravity_agent; then
      printf '{"decision":"allow"}\n'
    fi
    ;;
  -h | --help | "")
    usage
    [[ -n "$cmd" ]] && exit 0 || exit 3
    ;;
  *)
    deny "unknown command: $cmd"
    ;;
esac
