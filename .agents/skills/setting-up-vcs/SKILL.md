---
name: setting-up-vcs
description: Wire the mechanical hooks and guardrails that make the `vcs` skill's
  isolation automatic for every coding agent in a repo (Claude Code, Codex, Cursor,
  Antigravity, Gemini), and install Jujutsu when it is missing. Run it when setting
  up a fresh clone or host project, adopting a new agent/IDE, or after a tool changes
  its hook format. Method, not a snapshot — re-derive each tool's current hook syntax
  and jj's current install command every run; never pin a Jujutsu version.
---

# Set up VCS guardrails

Make the [`vcs`](../vcs/SKILL.md) skill's discipline **mechanical**. `vcs` tells an
agent the rule — isolate before you edit, touch only your own work, publish through
the helper. This skill wires that rule into each coding tool's native **hooks** so
the rule is enforced even when the agent forgets it, and ensures the version control
the guardrails depend on (Jujutsu) is actually installed.

Like [`update-agent-permissions`](../update-agent-permissions/SKILL.md), this is a
**method, not a snapshot**: hook formats and install commands drift, so re-derive the
specifics every run. The two skills are companions — `setting-up-vcs` wires the _hooks_
that enforce isolation; `update-agent-permissions` sets the _permission posture_ they
ride on. Run both when standing up a repo.

## Why this exists (the incentive)

The `vcs` skill already has the right rule. The damaging failures happen in the moment
_before_ an agent reliably applies it — and advisory text loses every one of them:

- A parent agent starts in the shared jj `default` workspace (or the primary Git
  checkout) and begins reading and **editing there** before it isolates.
- An agent runs `isolate.sh`, treats workspace creation as a checklist tick, and keeps
  working from the **original checkout** anyway.
- A sub-agent inherits the parent's cwd and runs VCS commands against the **real repo**
  instead of its assigned sandbox.
- A concurrent agent **commits and pushes another agent's** dirty tree, or moves a
  shared ref (`jj bookmark set main`, `jj git push --bookmark main`) from the wrong
  workspace.

A guard you have to _remember to call_ cannot fix a failure that **is** forgetting.
That is the chicken-and-egg problem. So the enforcement is **defense in depth**, and
the design goal is blunt: forgetting `vcs` should become _hard to act on_, not just
easy to diagnose later.

Two complementary moves, neither of which relies on the model remembering anything:

- **Proactive — remove the decision.** A session-start hook carves out a fresh
  per-session workspace _before the agent has any task context_, then prints `NEXT_CWD`.
  Isolation happens for free; the agent never has to choose to do it.
- **Reactive — block the damage.** A pre-tool-use hook refuses edits and VCS writes
  that target the shared checkout, raw publishes that skip the helper, and ref moves
  from a workspace this session does not own — while staying silent for read-only work
  so context-gathering is never slowed.

Hooks are the _only_ place this can live. An IDE's "create worktree" feature is
Git-only and useless for jj; and the agent itself is exactly the component that
forgets. Permissions stay fast on purpose (pushes are allowed without an approval
prompt — slow gates get disabled); the **hook** is what makes a wrong-cwd or
wrong-owner write impossible.

## What you are wiring (the enforcement model)

The `vcs` skill bundles the enforcement scripts; this skill wires them into each tool.
Do not reimplement policy — point the tools at these:

- **`session-start.sh`** — the proactive bootstrap. Detects the mode, creates a
  temporary `<ide>-pending-<id>` workspace/worktree off the trunk (`main`, or
  `origin/main` for a Git repo with a remote), records an owner marker, and prints
  `NEXT_CWD`. Renamed later by `rename-work.sh <ide>-<work>` once the task is named.
- **`vcs-check.sh hook --agent <name>`** — the reactive guard. Reads a hook payload on
  stdin and blocks shared-checkout edits, un-owned VCS writes, and helper-skipping
  publishes.
- **`cursor-hook.sh`** / **`antigravity-hook.sh`** — thin adapters that translate one
  tool's hook wire-format to and from `vcs-check.sh`/`session-start.sh`. Policy stays in
  `vcs-check.sh`; the adapter only reshapes JSON.

Three things make this robust, and you should preserve all three when wiring a new
tool:

1. **Two events, minimum, per tool.** A **session-start** event → `session-start.sh`
   (proactive isolate), and a **pre-tool-use** event → the guard (reactive block).
   Where a tool offers them, also re-check on **subagent-start** and **cwd-changed**.
2. **Ownership lives outside the tracked tree.** Markers are written to the repo's Git
   admin dir (e.g. `<repo>/.git/agent-sessions/<name>.env`) for Git and colocated jj, or
   an XDG state dir for non-colocated jj. They are never committed, and they let the
   guard be **owner-aware and path-aware**, not merely cwd-based: editing a sibling
   workspace by absolute path is allowed even if the shell cwd drifted back to the shared
   root, a session that owns an isolated workspace is trusted, and a bare `cd` is always
   allowed. (This path/owner-awareness exists because an earlier pure-cwd guard deadlocked
   agents whose shell cwd had merely drifted back to the shared root — don't regress to a
   cwd-only check.)
3. **Three response dialects, one policy.** Each tool's hook expects a different reply
   shape, so route through the matching contract:

   | Contract             | Tools             | How it answers                                                                 |
   | -------------------- | ----------------- | ------------------------------------------------------------------------------ |
   | **Exit-code**        | Claude, Codex     | `vcs-check.sh hook --agent <name>` directly; exit `2` blocks, stderr explains. |
   | **Cursor JSON**      | Cursor            | `cursor-hook.sh <event>` emits `{permission: allow\|deny, ...}`.               |
   | **Antigravity JSON** | Antigravity (agy) | `antigravity-hook.sh <action>` emits `{decision}` / `{injectSteps, ...}`.      |

Resolve the repo root inside the hook command so it works from any cwd
(`repo="$(jj root 2>/dev/null || git rev-parse --show-toplevel)"`), or use the tool's
own project-dir variable (Claude exposes `${CLAUDE_PROJECT_DIR}`). Reference the
scripts at the path the `vcs` skill is actually installed — do not hardcode `.agents/`
or `.claude/`; either may be the install location in a host project.

## Prerequisite: install Jujutsu (no pinned version)

The strongest guardrail — a private per-session jj workspace that shares history with
the shared checkout — needs `jj`. Ensure it is present before wiring hooks:

- **Detect**: `command -v jj`. If found, confirm with `jj --version` and move on.
- **Install when missing**: install the **current** Jujutsu through the system's own
  package manager — prefer whatever manager the machine already uses (e.g. Homebrew,
  Cargo, the platform's native packager, or jj's official installer). **Never pin or
  hardcode a version**, a versioned download URL, or a single OS's command — Jujutsu
  releases often and the right command differs per platform. Re-derive the current,
  recommended install command from Jujutsu's official docs each run.
- **Verify**: `jj --version` succeeds afterward.
- **Fall back honestly**: if no package manager is available or the install fails, say
  so plainly and proceed with **Git-only** guardrails (a Git worktree per session) —
  they are weaker but real. Do not fabricate a working jj install.
- **Colocation is opt-in**, not forced: in an existing Git repo, `jj git init
--colocate` makes jj available alongside Git, but only do it when the user wants jj
  for that repo.

## When to run

- Standing up the guardrails in a **fresh clone or a host project** that just adopted
  the `vcs` skill.
- A **new agent/IDE** enters the workflow and needs the hooks wired to its config.
- A target tool **changed its hook format** (event names, payload shape, response
  contract) and the wiring drifted.
- `jj` is **missing** on the machine.
- Periodic re-verification — these tools move fast.

## Procedure

### 1. Understand the repo and locate the `vcs` scripts — derive, don't assume

Find where the `vcs` skill is installed in this project and confirm its enforcement
entry points exist: `session-start.sh`, `vcs-check.sh`, `rename-work.sh`, and the
adapters `cursor-hook.sh` / `antigravity-hook.sh`. Wire tools to _these_ paths.
Enumerate the per-tool config directories already present (`.claude/`, `.codex/`,
`.cursor/`, `.antigravity/`, `.gemini/`, the agent-neutral `.agents/`) and add any
newly-adopted tool to that set. Note the VCS actually in use.

### 2. Ensure Jujutsu is installed

Run the install/verify steps in **Prerequisite** above. If you end up Git-only, record
that — later steps still wire the same hooks; the bootstrap simply creates a worktree
instead of a jj workspace.

### 3. Research each tool's current hook mechanism — subagents, in parallel

For every target tool, spin up a research subagent (run them concurrently) to pull the
**current** hook model from that tool's **official docs**: which lifecycle events exist
(session-start, pre-tool-use, subagent-start, cwd-changed equivalents), the config file
location and format, the matcher syntax, and the **payload + response contract** the
hook must satisfy. Treat prior knowledge and the snapshot at the bottom of this file as
stale by default; require each subagent to quote primary sources and cite URLs.

Then **verify the load-bearing syntax yourself** against primary docs before writing —
the response contract especially (exit code vs JSON, and the exact JSON keys), because a
wrong contract fails open silently. If a tool's hook config cannot be verified,
**document the gap rather than invent syntax**, and leave that tool at the permission
layer only.

### 4. Wire the two events into each tool's native config

Encode the same model everywhere, in each tool's own format:

- A **session-start** event → `session-start.sh --hook <dialect> --ide <ide>` (or the
  adapter's session action). Surface its `NEXT_CWD` to the agent.
- A **pre-tool-use** event matching the tool's edit/write/run commands → the guard via
  the right contract (exit-code direct, or the Cursor/Antigravity adapter).
- Where supported, **subagent-start** and **cwd-changed** → the guard, so background
  agents and drifted shells are re-checked.

Make each command resolve the repo root portably (see the enforcement-model note), keep
the policy in `vcs-check.sh`, and give each config a short self-documenting header
comment so this skill never has to track per-file detail. Keep every tool telling the
**same story**.

### 5. Align permissions so the guard isn't fighting approval prompts

Defer the posture to [`update-agent-permissions`](../update-agent-permissions/SKILL.md),
but ensure it leaves the guardrails fast: **allow** the vetted helpers
(`isolate.sh` / `integrate.sh` / `session-start.sh` / `rename-work.sh`) and routine
read-only VCS commands; **allow** `git push` / `jj git push` by default (the hook, not a
human prompt, is what blocks a wrong-cwd or wrong-owner push); **allow** the narrow
owned-cleanup commands the guard itself vets (deleting/forgetting _your own_ already-landed
work — the guard's owned-safe-cleanup path lets these through, so a permission prompt would
only get in the way); **prompt or forbid** raw dangerous mutations (`jj describe` / `new` /
`bookmark set` / `workspace add`, `git reset` / `checkout` / `branch -D`) so they only run
through helpers; and **deny** secret reads and shell network access.

### 6. Verify

- **Hooks fire and answer correctly.** Feed each hook a sample payload and confirm the
  contract: a shared-checkout edit/write is **blocked**, an isolated-workspace edit is
  **allowed**, a read-only command passes, and session-start emits `NEXT_CWD`. For the
  adapters, confirm the emitted JSON has the keys that tool expects.
- **End-to-end**: a fresh session lands in its own workspace; an edit to the shared root
  is refused with an actionable message; the same edit inside the owned workspace
  succeeds.
- Each config **parses, lints, and formats** cleanly (run the repo's formatter/linter),
  is **not gitignored**, and lands where its tool discovers it.
- Don't commit unless asked.

## Principles

- **Mechanical over advisory** — enforce the rule in hooks; never rely on the agent
  remembering it.
- **Proactive + reactive** — isolate before the agent has context _and_ block the
  damaging write. Either alone leaks.
- **Owner/path-aware, not cwd-only** — durable out-of-tree markers decide ownership; a
  transient cwd must never trap a correctly-isolated session, and a bare `cd` always
  passes.
- **Fast by default, blocked when wrong** — keep pushes prompt-free; let the guard, not
  a human gate, stop the wrong-workspace write.
- **One model, many dialects** — same policy in `vcs-check.sh`; per-tool adapters only
  reshape the wire format.
- **Never pin versions or trust memory for syntax** — re-derive the current jj install
  command and each tool's hook format every run.
- **Honesty over completeness** — a documented gap (or an honest Git-only fallback)
  beats a fabricated config or a faked jj install.

## Current wiring reference (snapshot — verify before reuse)

How the tools are wired today, to **mirror, not copy blindly**. Event names, matchers,
and contracts drift; re-confirm in step 3 before writing.

- **Claude Code** — `.claude/settings.json` `hooks`. `SessionStart` (matcher `startup`)
  → `${CLAUDE_PROJECT_DIR}/.../session-start.sh --hook claude --ide claude`;
  `PreToolUse` (matcher `Bash|Edit|Write|MultiEdit|NotebookEdit`), `SubagentStart`, and
  `CwdChanged` → `.../vcs-check.sh hook --agent claude`. **Exit-code** contract.
- **Codex** — `.codex/config.toml` `[[hooks.*]]`. `SessionStart` (matcher `^startup$`)
  → session-start `--hook codex --ide codex`; `PreToolUse` (matcher
  `^(Bash|apply_patch|Edit|Write)$`) and `SubagentStart` → `vcs-check.sh hook --agent
codex`. Each command resolves `repo="$(jj root 2>/dev/null || git rev-parse
--show-toplevel)"` first. **Exit-code** contract. Execution gating
  (allow/prompt/forbidden) lives alongside in `.codex/rules/*.rules` (Starlark) — that's
  the permissions layer.
- **Cursor** — `.cursor/hooks.json`. `sessionStart`, `beforeShellExecution`,
  `preToolUse`, `afterFileEdit` all route through `cursor-hook.sh <event>`, which adapts
  Cursor's payload and emits Cursor's **`{permission: allow|deny}`** JSON (wrapped with
  `continue: true` and the explanation under several message keys for version skew).
  Permissions in `.cursor/permissions.json` + `.cursor/cli.json`.
- **Antigravity** — `.agents/hooks.json` (`vcs-session-isolation`). `PreInvocation` →
  `antigravity-hook.sh pre-invocation` (runs session-start, replies with
  `injectSteps`/`terminationBehavior`); `PreToolUse` (matcher
  `run_command|write_to_file|replace_file_content|multi_replace_file_content`) →
  `antigravity-hook.sh pre-tool-use` (replies `{decision: allow|deny, reason}`).
  Permissions in `.antigravity/settings.json`. The guard treats `agy`/`antigravity`/
  `gemini` as the Antigravity JSON dialect.
- **Gemini** — `.gemini/settings.json` carries the permission posture only; hook wiring
  is **not** present today (the file is currently a byte-for-byte copy of
  `.antigravity/settings.json`, i.e. Antigravity's posture rather than a Gemini-CLI-specific
  one). Research Gemini CLI's current hook support before wiring it; the guard already
  speaks its JSON dialect, so only the event registration is missing.
