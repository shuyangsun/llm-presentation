---
name: update-agent-permissions
description: Procedure for adding or updating coding-agent permission/sandbox configs in
  this repo — run it when a target tool changes its settings format, a new agent/IDE is
  adopted, or the repo's command surface grows and the allowlists must catch up. Method
  only (understand the repo → research current syntax via subagents → write & verify);
  deliberately free of tool-specific syntax, command lists, or versions that would go stale.
---

# Update agent permissions

Bring every coding agent that operates in this repo under one checked-in permission
posture, and refresh those configs when a tool's settings format changes or a new agent
enters the workflow. This skill is the **method, not a snapshot**: the specifics —
commands, file names, syntax, versions — are re-derived every run because they drift.

## Intent (the durable part)

One posture, expressed in each agent's native config and checked into the repo:

- **Allow** safe, routine dev work — the repo's own build / test / format / VCS commands.
- **Deny** what should never happen unattended — reading secrets or credentials, and
  exfiltrating over the network from the shell.
- **Prompt** for outward-facing or hard-to-reverse actions — publishing, destructive
  deletes, history rewrites.

Personal or looser overrides belong in each tool's gitignored `*.local` file, never in a
shared config. Everything beyond the three buckets above is **derived from the repo**, not
fixed here — hardcoding the command list or a tool's syntax is exactly what goes out of date.

## When to run

- A target tool changed its permission/sandbox format, or you suspect the configs drifted.
- A new agent/IDE is adopted and needs a config matching the posture.
- The repo's toolchain or command surface expanded, so the allow set is now incomplete.
- Periodic re-verification — these tools move fast.

## Procedure

### 1. Understand the repo first — derive, don't assume

Learn the current reality from the repo, not from memory or this doc:

- **Canonical posture & command surface:** read the primary agent settings the repo already
  trusts (confirm which file is canonical today), plus the build/test/format scripts (package
  manifest, hook and lint config) and the VCS actually in use. The allow / deny / prompt sets
  follow from these, and they grow over time.
- **Secrets to protect:** the env-file, key, and cloud-credential patterns that must stay
  unreadable.
- **Targets:** enumerate the per-tool config directories already present, and add any
  newly-adopted tool to that set.

### 2. Research each tool's current mechanism — subagents, in parallel

For every target tool, spin up a research subagent (run them concurrently) to pull the
**current** permission model from that tool's **official docs**: file location, format, and
the exact allow / deny / sandbox syntax. Treat prior knowledge and this doc as stale by
default. Require each subagent to quote primary sources, cite URLs, and flag recency and
uncertainty.

Then **verify the load-bearing syntax yourself** against primary docs before writing anything
— summarizers and secondary blogs are unreliable, and confirmed false-negatives have happened
here. If a tool's committable config can't be verified, **document the gap rather than invent
syntax**.

### 3. Translate the posture into each tool's native config

Encode the same intent everywhere, using whatever each tool actually supports:

- Prefer **hard enforcement** (OS sandbox, network-off, real deny rules) over soft hints;
  where a tool offers only soft hints, use them but note the limit.
- **Scope, don't blanket** — list specific safe commands; avoid `tool *` wildcards that
  silently grant destructive or outward power.
- Protect secrets through the tool's ignore/deny mechanism.
- Make each config **self-documenting** (a short header comment stating its posture) so this
  skill never has to track per-file detail.
- Keep every target telling the **same story**, so they stay in sync with the canonical one.

### 4. Verify

- Each file parses, lints, and formats cleanly — run the repo's formatter and linter.
- Each file is **not** gitignored, so it actually gets checked in.
- The config lands where its tool discovers it.
- Don't commit unless asked.

## Principles

- **Intent over syntax** — encode the outcome; re-derive the specifics every run.
- **Never trust memory for tool syntax** — research current docs, then verify the risky parts.
- **Hard beats soft** — the durable protections are keeping secrets out of the tree and
  sandboxing with the network off, not bypassable deny-strings.
- **Honesty over completeness** — a documented gap beats a fabricated config.
- **One posture, many dialects** — every agent enforces the same intent in its own format.

## Tool Config Targets & Schema Learnings

- **Claude**: `.claude/settings.json` (`permissions` object with `allow` / `deny` array of `Bash(<cmd>)` / `Read(<glob>)` / `WebFetch(domain:<host>)`).
- **Cursor**: `.cursor/permissions.json` (`terminalAllowlist` array and `autoRun` block) and `.cursor/cli.json` (`permissions.allow` / `permissions.deny`).
- **Codex**: `.codex/config.toml` (sandbox configuration) and `.codex/rules/*.rules` (Starlark execution rules).
- **Antigravity & Gemini**: `.antigravity/settings.json` & `.gemini/settings.json` (`permissions` object with `allow` / `deny` arrays of `command(<prefix>)` / `read_file(<path>)` / `read_url(<host>)`); Antigravity workspace hooks live in `.agents/hooks.json`.
