#!/usr/bin/env bash
#
# Cursor hook adapter for vcs guardrails.
#
# Cursor hook payloads and responses are not the same shape as Claude/Codex hook
# payloads. Keep the policy in vcs-check.sh and translate only the wire format
# here.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

event="${1:-}"
payload="$(cat 2>/dev/null || true)"

usage() {
  cat <<'EOF'
usage: cursor-hook.sh <sessionStart|beforeShellExecution|preToolUse|afterFileEdit>

Reads a Cursor hook JSON payload on stdin. For permission hooks, emits Cursor
JSON with permission=allow or permission=deny. For sessionStart, runs the vcs
session bootstrap with --ide cursor and returns its output as an agent message.
EOF
}

emit_json() {
  local permission="${1:-}" message="${2:-}"
  python3 - "$permission" "$message" <<'PY'
import json
import sys

permission = sys.argv[1]
message = sys.argv[2]
response = {"continue": True}
if permission:
    response["permission"] = permission
if message:
    # Cursor examples and builds have used both spellings; include both so the
    # visible explanation survives version skew.
    response["userMessage"] = message
    response["agentMessage"] = message
    response["user_message"] = message
    response["agent_message"] = message
print(json.dumps(response, separators=(",", ":")))
PY
}

compact_message() {
  awk 'NF { lines[++n] = $0 } END { for (i = 1; i <= n; i++) { print lines[i] } }'
}

run_session_start() {
  local out err status message
  out="$(mktemp)"
  err="$(mktemp)"
  if printf '%s' "$payload" | bash "$script_dir/session-start.sh" --hook cursor --ide cursor >"$out" 2>"$err"; then
    message="$(cat "$out" "$err" | compact_message)"
    rm -f "$out" "$err"
    emit_json "" "$message"
    return 0
  fi
  status=$?
  message="$(cat "$err" "$out" | compact_message)"
  rm -f "$out" "$err"
  [[ -n "$message" ]] || message="vcs session-start hook failed with status $status"
  emit_json "deny" "$message"
}

generic_payload() {
  python3 - "$event" "$payload" <<'PY'
import json
import sys

event = sys.argv[1]
raw = sys.argv[2]
try:
    data = json.loads(raw) if raw.strip() else {}
except Exception:
    data = {}


def path_get(obj, *parts):
    cur = obj
    for part in parts:
        if isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
    return cur


def first_string(paths):
    for path in paths:
        value = path_get(data, *path)
        if isinstance(value, str) and value:
            return value
    return ""


def find_tool_name():
    value = first_string(
        [
            ("tool_name",),
            ("toolName",),
            ("tool", "name"),
            ("tool",),
            ("name",),
            ("tool_call", "name"),
            ("toolCall", "name"),
        ]
    )
    return value or ""


def find_command():
    return first_string(
        [
            ("command",),
            ("cmd",),
            ("shell_command",),
            ("shellCommand",),
            ("tool_input", "command"),
            ("toolInput", "command"),
            ("input", "command"),
            ("args", "command"),
            ("arguments", "command"),
        ]
    )


def map_tool_name(name, hook_event):
    lowered = name.lower()
    if hook_event == "beforeShellExecution" or lowered in {
        "bash",
        "shell",
        "terminal",
        "run_terminal_cmd",
        "runterminalcmd",
    }:
        return "Bash"
    if any(
        token in lowered
        for token in (
            "write",
            "edit",
            "delete",
            "strreplace",
            "str_replace",
            "createfile",
            "apply_patch",
            "notebook",
        )
    ):
        return "Write"
    return name


tool = map_tool_name(find_tool_name(), event)
if event == "beforeShellExecution":
    tool = "Bash"
elif event == "afterFileEdit":
    tool = "Write"

out = {
    "hook_event_name": "PreToolUse",
    "tool_name": tool,
    "tool_input": {},
}
command = find_command()
if command:
    out["tool_input"]["command"] = command

print(json.dumps(out, separators=(",", ":")))
PY
}

run_guard() {
  local generic out err status message
  generic="$(generic_payload)"
  out="$(mktemp)"
  err="$(mktemp)"
  if printf '%s' "$generic" | bash "$script_dir/vcs-check.sh" hook --agent cursor >"$out" 2>"$err"; then
    message="$(cat "$out" "$err" | compact_message)"
    rm -f "$out" "$err"
    if [[ -n "$message" ]]; then
      emit_json "allow" "$message"
    else
      emit_json "allow" ""
    fi
    return 0
  fi
  status=$?
  message="$(cat "$err" "$out" | compact_message)"
  rm -f "$out" "$err"
  [[ -n "$message" ]] || message="vcs guard refused Cursor $event hook with status $status"
  emit_json "deny" "$message"
}

case "$event" in
  sessionStart)
    run_session_start
    ;;
  beforeShellExecution | preToolUse | afterFileEdit)
    run_guard
    ;;
  -h | --help | "")
    usage
    [[ -n "$event" ]] && exit 0 || exit 3
    ;;
  *)
    emit_json "deny" "vcs cursor hook: unsupported event '$event'"
    ;;
esac
