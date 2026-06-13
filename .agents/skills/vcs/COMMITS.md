# Commits

Use this format **every time you create or edit a commit message**, in any version-control system. No exceptions, including merge commits and rewrites you author.

## Format

```text
type(scope): subject under ~70 chars, imperative mood, no trailing period

Optional body wrapped at ~72 chars. Explain WHY the change exists and any
non-obvious tradeoff — not WHAT changed (the diff shows that). Skip the
body only for trivial one-liners (typo fixes, dep bumps, config tweaks).

Author: <Your Full Name> <your-git-email>
Co-Authored-By: <Model Name> <noreply-email>
```

- **type**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `style`, `build`, `ci`.
- **scope**: short area tag matching the codebase (`picker`, `consent`, `langfuse`, `setup`, `plan`, …). Skip parens if no natural scope.
- **subject**: imperative ("add", "fix", "route"), lowercase after the colon, no period.
- **body**: present only when it adds signal a reader can't get from the diff (motivation, constraint, follow-up). Never restate the file list.
- **session transcripts**: a change often ships with an exported `docs/transcripts/` transcript — describe the substantive change in the subject/scope/body and ignore the transcript, which accompanies nearly every change and is noise in the message. Prefer committing the transcript as its own `docs(transcripts): …` change.

## Author and Co-Authored-By trailers

End every commit with a trailer block: one blank line before it, no blank lines between trailers, `Author:` first and any `Co-Authored-By:` lines after.

**`Author` trailer (human owner).** Always include an `Author: Full Name <email>` trailer naming the human who owns the work, derived from the repo's VCS config — `git config user.name` / `git config user.email`, falling back to `jj config get user.name` / `jj config get user.email`. This keeps the human author explicit in the message itself, regardless of which identity the VCS records on the commit.

**`Co-Authored-By` trailer (LLM agents).** If you are an LLM agent **and** your tool/model has a known no-reply GitHub email, append a `Co-Authored-By` trailer naming **both the model and the coding-agent tool**.

Known identities:

| Agent / tool             | Trailer                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Claude Code CLI          | `Co-Authored-By: Claude <model name and version> (Claude Code) <noreply@anthropic.com>`                       |
| Cursor agent             | `Co-Authored-By: <model name and version> (Cursor) <cursoragent@cursor.com>`                                  |
| Codex CLI / Cloud        | `Co-Authored-By: <model name and version> (Codex) <codex@openai.com>`                                         |
| Gemini CLI / Antigravity | `Co-Authored-By: <model name and version> (<Gemini CLI / Antigravity>) <your verified GitHub no-reply email>` |

Examples (substitute the actual model you're running):

```text
Co-Authored-By: Claude Opus 4.7 (1M context) (Claude Code) <noreply@anthropic.com>
Co-Authored-By: Composer 2.5 (Cursor) <cursoragent@cursor.com>
Co-Authored-By: GPT-5.5 Codex (Codex CLI) <codex@openai.com>
Co-Authored-By: Gemini 3.5 Flash (Antigravity) <your verified GitHub no-reply email>
```

For Gemini CLI / Antigravity, fill in your tool's verified GitHub no-reply email (the `<id>+<account>@users.noreply.github.com` address tied to its GitHub account) so the commit links back to that agent. If you don't know your tool's no-reply email, **omit the trailer** rather than invent one. Human co-authors use their real GitHub email on their own line.

## Examples

Good — feature with motivation:

```text
feat(picker): equal cookie sizes, aligned baseline, mobile shrink

Make the three cookie choices visually equal and aligned on both
desktop and mobile, and let the hero illustration dominate on phones
again (cookies were taking most of the viewport).

Author: Shuyang Sun <shuyangsun10@gmail.com>
Co-Authored-By: Claude Opus 4.7 (1M context) (Claude Code) <noreply@anthropic.com>
```

Good — trivial change, no body needed:

```text
chore(setup): export local auth env vars
```

Bad — vague subject, no scope, no WHY:

```text
update stuff
fix bug
```

## Mechanics

- Pass the message via a HEREDOC so the blank lines and the trailer survive intact, whatever VCS you're using:

```sh
<commit command> -m "$(cat <<'EOF'
chore(setup): migrate repo workflow

Explain why the workflow moved and any non-obvious constraints.

Author: Shuyang Sun <shuyangsun10@gmail.com>
Co-Authored-By: GPT-5.1 Codex (Codex) <codex@openai.com>
EOF
)"
```

- Never edit someone else's existing commit just to graft a trailer onto it; author a new commit instead.
