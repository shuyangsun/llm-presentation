#!/usr/bin/env bash
#
# Gemini CLI hook adapter for vcs guardrails.
#
# Gemini hooks require stdout to contain exactly one JSON object. Keep the
# policy in vcs-check.sh/session-start.sh and translate only the wire format.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

action="${1:-}"
payload="$(cat 2>/dev/null || true)"

usage() {
  cat <<'EOF'
usage: gemini-hook.sh session-start|before-tool

Reads a Gemini CLI hook JSON payload on stdin and writes a Gemini hook JSON
response on stdout.
EOF
}

json_message() {
  local kind="$1" message="$2"
  python3 - "$kind" "$message" <<'PYJSON'
import json
import sys

kind, message = sys.argv[1], sys.argv[2]
if kind == "session":
    response = {
        "systemMessage": message,
        "hookSpecificOutput": {"additionalContext": message},
        "suppressOutput": False,
    }
elif kind == "deny":
    response = {"decision": "deny", "reason": message}
else:
    response = {"decision": "allow"}
print(json.dumps(response, separators=(",", ":")))
PYJSON
}

compact_message() {
  awk 'NF { lines[++n] = $0 } END { for (i = 1; i <= n; i++) { print lines[i] } }'
}

run_session_start() {
  local out err status message
  out="$(mktemp)"
  err="$(mktemp)"
  if printf '%s' "$payload" | bash "$script_dir/session-start.sh" --hook agy --ide gemini >"$out" 2>"$err"; then
    message="$(cat "$out" "$err" | compact_message)"
    rm -f "$out" "$err"
    json_message session "$message"
    return 0
  fi
  status=$?
  message="$(cat "$err" "$out" | compact_message)"
  rm -f "$out" "$err"
  [[ -n "$message" ]] || message="vcs session-start hook failed with status $status"
  json_message deny "$message"
}

run_before_tool() {
  local out err status message
  out="$(mktemp)"
  err="$(mktemp)"
  if printf '%s' "$payload" | bash "$script_dir/vcs-check.sh" hook --agent gemini >"$out" 2>"$err"; then
    if [[ -s "$out" ]]; then
      cat "$out"
    else
      json_message allow ""
    fi
    rm -f "$out" "$err"
    return 0
  fi
  status=$?
  message="$(cat "$err" "$out" | compact_message)"
  rm -f "$out" "$err"
  [[ -n "$message" ]] || message="vcs guard refused Gemini BeforeTool hook with status $status"
  json_message deny "$message"
}

case "$action" in
  session-start)
    run_session_start
    ;;
  before-tool)
    run_before_tool
    ;;
  -h | --help | "")
    usage >&2
    [[ -n "$action" ]] && exit 0 || exit 3
    ;;
  *)
    json_message deny "unknown Gemini vcs hook action: $action"
    ;;
esac
