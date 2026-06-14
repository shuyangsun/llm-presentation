<!-- markdownlint-disable MD013 MD024 -->

# Relax VCS hooks for Claude — fix the cwd-reset that triggers guard blocks

- **Date:** 2026-06-14
- **Repo:** llm-presentation (bookmark `claude-relax-vcs-hooks`, off `main`)
- **Author:** Shuyang Sun <shuyangsun10@gmail.com>
- **Agent:** Claude Code (Opus 4.8, 1M context, thinking: high)
- **Summary:** Diagnosed why the `vcs` PreToolUse guard kept blocking Claude's mutating Bash commands — the isolation workspace is a sibling directory outside the project root, so Claude Code reset the Bash cwd back to the shared root after every command, where the guard correctly refuses writes. Fixed the *cause* (not the guard) by adding the parent dir to `additionalDirectories` in `.claude/settings.local.json`, so one `cd` into the workspace now persists and the guard stops firing on normal work while isolation stays intact.

---

## User

/remote-control claude-hook-fix

Relax VCS hooks for Claude so you don't constantly run into permission errors. You are claude yourself, so test different commands and fix pain points.

## Assistant

Started by inspecting the active isolation and the hook configuration.

- Workspace: `…/llm-presentation-claude-pending-f7f91cfe` (jj mode), owned by this session.
- `.claude/settings.json` wires `vcs/scripts/session-start.sh` (SessionStart) and `vcs/scripts/vcs-check.sh hook --agent claude` on PreToolUse (Bash/Edit/Write/…), SubagentStart, and CwdChanged.
- `.claude/settings.local.json` already runs `bypassPermissions`, so the friction wasn't Claude's own permission prompts — it was the vcs guard returning exit 2.

Read `vcs-check.sh` in full. The guard blocks file/VCS-mutating commands when the cwd is the **shared jj default workspace**; when the session owns an isolated workspace it denies with a message telling me to `cd <workspace> && …`. It honors a leading `cd <dir> &&` and a `tool_input.cwd`.

Noticed immediately that the harness kept printing `Shell cwd was reset to /home/<user>/developer/llm-presentation` after any `cd` into the workspace.

## Assistant

Reproduced the pain points by simulating the hook with JSON payloads. My first probe command was itself blocked — because it contained `>` substrings inside quoted JSON, the guard's naive `is_file_mutating_command` substring match flagged my meta-command. Moved the probe into a script file so the invocation stayed clean, and ran it from the shared root:

- `Write`/`Edit` to absolute workspace paths → allowed (the edit check is path-aware).
- Bash mutating commands with a relative cwd from the shared root (`mkdir foo`, `echo … > f`, `jj describe -m …`) → **blocked, exit 2** (`owner check refused`).
- The same commands prefixed with `cd <workspace> &&`, or with `tool_input.cwd` set to the workspace → allowed.

So the guard is behaving correctly; the real problem was *where my shell runs*.

## Assistant

Pinned the root cause. Tested cwd persistence directly:

- `cd` into the **sibling** workspace (outside the project root) → reset back to project root on the next call.
- `cd` into an **in-project** subdir (`./web`) → persisted fine.

Conclusion: Claude Code anchors the persistent Bash shell to the project root and resets cwd whenever it lands outside the trusted directories. The vcs isolation workspace is a sibling *outside* the project root, so the shell bounced back to the shared root after every command — and every mutating command there hit the guard. PreToolUse hooks can only allow/deny (not rewrite the command), so the fix had to stop the reset rather than weaken the guard.

## Assistant

Checked the lever: Claude Code keeps cwd inside the project root + `permissions.additionalDirectories` + `--add-dir`. Added the stable parent dir to `.claude/settings.local.json` (machine-local, gitignored — the right place for an absolute path):

```json
"additionalDirectories": ["/home/<user>/developer"]
```

Verified live (Claude Code re-reads `settings.local.json` mid-session):

- `cd` into the workspace now **persists** across calls.
- Real mutating commands (`mkdir`, redirect-write, `jj status`) run from the persistent workspace cwd with **no `cd` prefix and no guard block**.
- The shared default workspace stays clean (the gitignored settings file isn't jj-tracked), so the guard's shared-root protection is unchanged — only the false friction is gone.

Cleaned up the probe artifacts, recorded the fix in project memory, and renamed the work to `claude-relax-vcs-hooks`.

## User

After you're done, /export-transcript, then integrate with /vcs

## Assistant

Exported this transcript under `docs/coding-sessions/2026-06-14/`, then integrated the work onto `main` via the `vcs` skill's `integrate.sh`.
