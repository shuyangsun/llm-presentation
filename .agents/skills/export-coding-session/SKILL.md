---
name: export-coding-session
description: Export the current Claude Code / Codex / Gemini (agy) / Cursor agent session as a markdown transcript into docs/coding-sessions/. Run only when the user explicitly asks to export the session; never export proactively. This skill owns the export mechanics — filename, transcript collection, verbatim user turns, and redaction.
---

# Export agent session history

Save the current agent session as a markdown transcript under `docs/coding-sessions/`. Agent-neutral: the skill directory can be used directly from `.agents/skills/` or symlinked into another runtime directory (`.claude/skills/`, etc.), so the same copy serves every agent.

## Locating the bundled scripts

The two helper scripts (`next-index.sh`, `redaction-scan.sh`) live next to this `SKILL.md`. Run them from **this skill's own directory** — the path the runtime gave you when it loaded the skill (e.g. `.agents/skills/export-coding-session/`, `.claude/skills/export-coding-session/`, or wherever this skill directory was symlinked in the host project). Below this is written as `<skill-dir>/`; substitute the actual path. The scripts resolve the working repo root on their own (Git, then Jujutsu, then the current directory) and create any directories they need, so they work from any agent and any working directory.

## Steps

1. **Target dir + index** — run `bash <skill-dir>/next-index.sh`. It creates today's dated folder under `docs/coding-sessions/` (creating `docs/coding-sessions/` first if it doesn't exist) and prints both the dir and the next zero-padded index (e.g. `dir:   docs/coding-sessions/2026-05-23` / `index: 0003`); the index scans every date folder, so it's globally unique. Use those values directly — don't recompute the date or list the directory yourself.
2. **Name** — pick a concise kebab-case `short-name` describing the topic, prefixed with the agent's vendor slug: **`claude`**, **`codex`**, or **`gemini`** (Gemini / Antigravity / `agy`). Path: `<dir>/<index>-<vendor>-<short-name>.md` (e.g. `docs/coding-sessions/2026-05-23/0003-claude-prettier-hook.md`). Keep the model version out of the filename — it goes in the header (Step 4).
3. **Collect the transcript** for the running agent and render it as markdown with `## User` / `## Assistant` turns and briefly summarized tool calls:
   - **Claude Code** — newest `*.jsonl` in this repo's dir under `~/.claude/projects/` (the project path with slashes → dashes, e.g. a repo at `~/developer/website` becomes `-Users-you-developer-website`).
   - **Codex** — newest file under `~/.codex/sessions/` (fallback `~/.codex/history.jsonl`).
   - **Gemini / Antigravity (`agy`)** — newest `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl`.
   - If no raw log is readable, faithfully reconstruct from your current context.
     Preserve each `## User` turn exactly as the user wrote it: keep the user's wording, spelling, punctuation, Markdown, and line breaks, and do not summarize or paraphrase user input. The only allowed changes to user turns are required redactions and minimal work-friendly cleanup when a user message contains excessive profanity or hostile phrasing; in that case, rephrase only the offending words or sentence(s) while preserving the request's meaning and surrounding text as-is.
4. **Write the file** — start with a single markdownlint directive line, `<!-- markdownlint-disable MD013 MD024 -->`, then a blank line, then the `#` title. (The transcript format deliberately keeps long, unwrapped prose lines and repeats `## User` / `## Assistant` headings, which trip markdownlint's `MD013` and `MD024`; the per-file directive keeps the transcript lint-clean even in host projects that don't share this repo's `.markdownlint-cli2.jsonc`.) Always confirm that exact directive is the file's first line — if you're (re)writing or editing a transcript that lacks it, add it; never assume it's already there. After the title, add a metadata block recording the date, repo/branch (or current bookmark or change), the **author** (the human owner — `Full Name <email>` read from the repo's VCS config: `git config user.name` / `git config user.email`, falling back to `jj config get user.name` / `jj config get user.email`), and the **agent with precise model version and thinking/reasoning effort** (e.g. `Claude Code (Opus 4.7, 1M context, thinking: high)`) — that keeps the filename version-free — then a one-line summary and the transcript. Order the block `Date`, `Repo`, `Author`, `Agent`, `Summary`, so the human author sits directly above the AI agent. Never fabricate turns.

## Redact sensitive data (IMPORTANT)

**After saving but before committing**, scan the whole transcript (prompts, replies, tool output) and redact anything sensitive: secrets (passwords, API keys, tokens, private keys, connection strings), secret-manager references (such as 1Password `op://` URIs or commands that retrieve secrets), absolute paths outside the project root (e.g. user home directory files or other local workstation folders), network identifiers (IPs, internal hostnames/URLs), and PII (emails, phone numbers, addresses, other people's details). For absolute paths inside this repository, change them to relative paths (e.g. starting with `./`) rather than redacting them. First run the bundled scanner — it flags emails, phones, IPv4/IPv6, common token formats, and local paths by line number:

```sh
bash <skill-dir>/redaction-scan.sh "<file-you-just-wrote>"
```

**It's a first pass, not the whole job** — regexes miss novel or obfuscated secrets, so still read the transcript yourself; never rely on the script alone. Replace each hit with a labeled placeholder (e.g. `[REDACTED_TOKEN]`) rather than deleting it. Committed history is shared and effectively permanent. (Your own already-public contact info needn't be scrubbed — focus on credentials and third parties.)

## When to run this skill

Opt-in only: export when the user explicitly asks. Never proactively.

## Notes

- Numbering is global and strictly increasing across all date folders; always trust the script's output.
- The scripts create `docs/coding-sessions/` and the dated subfolder if they're missing, so a first export in a fresh repo works without setup.
