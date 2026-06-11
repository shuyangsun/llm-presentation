<!-- markdownlint-disable MD013 MD024 -->

# Codex Repository Docs And Skill Symlink

Date: 2026-06-11
Repo: llm-presentation, jj bookmark `codex-docs-session-export`, change `nowpxltt`
Author: Shuyang Sun <shuyangsun10@gmail.com>
Agent: Codex (GPT-5, reasoning: not exposed)
Summary: Added root repository docs, pointed Claude instructions at the shared agent guide, symlinked Claude skills to `.agents/skills`, exported this transcript, and prepared local jj integration without pushing.

## User

Add documentation. A brief @README.md, a brief @AGENTS.md, then one-liner @CLAUDE.md that points to @AGENTS.md. Then create symlinks between @.claude/skills and @.agents/skills/, with @.agents/skills/ being the source of truth. Once you're done, export session transcript and integrate with the $vcs skill. Don't push, there is no remote yet. Clean up bookmarks and workspaces after you're done.

## Assistant

Loaded the requested `vcs` skill and the repo-local `updating-docs` and `export-coding-session` skills. The `updating-docs` skill referenced a `retrieving-context` helper that was not present in this checkout, so the search-before-writing step used direct `rg`, `find`, and README inspection.

Renamed the temporary jj workspace from `codex-pending-25b133b6` to `codex-docs-session-export`, then inspected the repo docs, `pyproject.toml`, `.agents/skills`, `.claude/settings.json`, and existing coding-session transcripts. The repo already had `docs/README.md`, `src/README.md`, and `src/asr/README.md`, but no root `README.md`, root `AGENTS.md`, or root `CLAUDE.md`. `.agents/skills` already contained the shared skill tree, while `.claude` only contained settings.

Added `README.md` with a short project summary, `uv` quick-start commands, and links to `docs/README.md`, `src/README.md`, and `AGENTS.md`.

Added `AGENTS.md` with the repository workflow for coding agents: use the `vcs` skill for jj workspace and integration work, use `updating-docs` before writing docs, export requested transcripts under `docs/coding-sessions/`, treat `.agents/skills` as the source of truth, and verify docs-only work with link/status checks and redaction scans when applicable.

Added `CLAUDE.md` as a one-line pointer to `AGENTS.md`.

Created `.claude/skills` as a symlink to `../.agents/skills`, so Claude uses the shared skills without creating a second editable skill tree.

The first `apply_patch` call wrote the three root docs into the shared checkout instead of the owned jj workspace. Those were this session's own files, so the same content was added to the owned workspace and the accidental shared-checkout files were removed. Verified the shared checkout had no changes afterward.

The VCS guard rejected shell commands unless the command text explicitly changed into the owned workspace, so later shell commands used that required workspace prefix. Verified `.claude/skills -> ../.agents/skills`, generated transcript slot `docs/coding-sessions/2026-06-11/0004-codex-docs-session-export.md`, recorded this session for the requested export, and ran the transcript redaction scan. The next steps are to describe/integrate the jj change and avoid pushing because the repo has no remote.
