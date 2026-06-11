#!/usr/bin/env bash
#
# Adapter for Google Antigravity JSON hooks.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=vcs-state.sh
. "$script_dir/vcs-state.sh"

action="${1:-}"
input="$(cat 2>/dev/null || true)"

usage() {
  cat <<'EOF'
usage: antigravity-hook.sh pre-invocation|pre-tool-use

Reads an Antigravity hook JSON payload on stdin and writes an Antigravity hook
JSON response on stdout.
EOF
}

json_get() {
  local field="$1"
  [[ -n "$input" ]] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 -c 'import json, sys
field = sys.argv[1]
try:
    cur = json.load(sys.stdin)
except Exception:
    sys.exit(0)
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

json_string() {
  command -v python3 >/dev/null 2>&1 || {
    printf '"%s"' "$(cat | sed 's/"/\\"/g')"
    return 0
  }
  python3 -c 'import json, sys; print(json.dumps(sys.stdin.read()))'
}

emit_injection() {
  local message="$1" behavior="${2:-}"
  local encoded
  encoded="$(printf '%s' "$message" | json_string)"
  if [[ -n "$behavior" ]]; then
    printf '{"injectSteps":[{"ephemeralMessage":%s}],"terminationBehavior":"%s"}\n' "$encoded" "$behavior"
  else
    printf '{"injectSteps":[{"ephemeralMessage":%s}]}\n' "$encoded"
  fi
}

emit_noop() {
  printf '{"injectSteps":[]}\n'
}

cd_workspace_from_payload() {
  vcs_detect_mode >/dev/null 2>&1 && return 0
  local workspace
  workspace="$(json_get workspacePaths.0)"
  [[ -n "$workspace" && -d "$workspace" ]] || return 0
  cd "$workspace" || return 0
}

case "$action" in
  pre-invocation)
    cd_workspace_from_payload
    output="$(printf '%s' "$input" | bash "$script_dir/session-start.sh" --hook agy --ide agy 2>&1)"
    status=$?
    if [[ "$status" -ne 0 ]]; then
      emit_injection "$output" terminate
      exit 0
    fi
    if [[ "$output" == *"NEXT_CWD="* ]]; then
      emit_injection "$output"
    else
      emit_noop
    fi
    ;;
  pre-tool-use)
    cd_workspace_from_payload
    output="$(printf '%s' "$input" | bash "$script_dir/vcs-check.sh" hook --agent agy 2>&1)"
    status=$?
    if [[ "$status" -eq 0 && -n "$output" ]]; then
      printf '%s\n' "$output"
    elif [[ "$status" -eq 0 ]]; then
      printf '{"decision":"allow"}\n'
    else
      encoded="$(printf '%s' "$output" | json_string)"
      printf '{"decision":"deny","reason":%s}\n' "$encoded"
    fi
    ;;
  -h | --help | "")
    usage
    [[ -n "$action" ]] && exit 0 || exit 3
    ;;
  *)
    encoded="$(printf 'unknown Antigravity vcs hook action: %s' "$action" | json_string)"
    printf '{"decision":"deny","reason":%s}\n' "$encoded"
    ;;
esac
