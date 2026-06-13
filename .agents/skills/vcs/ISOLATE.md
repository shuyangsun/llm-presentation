# Starting new work: isolate first (parallel-agent safety)

If the prompt gives you an explicit assigned workspace/worktree path, `cd` there
immediately and work in place. That path is already your isolation; creating
another workspace/worktree is wrong.

Otherwise, before you start changing files, give yourself your **own working
copy** so you don't collide with other agents/teammates working in the same
repository at the same time. Two agents editing, building, or switching branches
in the _same_ working directory trample each other; a per-agent workspace (jj) /
worktree (Git) prevents that. Isolate **unless you are already isolated** — don't
nest a second working copy inside one you already have.

**When this applies:** you're on a **local machine** doing **new** work in a repo
that other agents may also be working in concurrently. **When to skip it:** a
dedicated cloud / CI / PR session already gives you your own clone or checkout —
you're isolated by construction, so just do the work and land it
([INTEGRATE.md](INTEGRATE.md)). Detect the mode first ([SKILL.md](SKILL.md)).

The objective is what matters, not a specific command: **a filesystem-isolated,
cleanly-removable place to work, on your own branch/bookmark.** Anything that
achieves that is correct.

**Name it `<ide>-<work>`.** Name your workspace/worktree **and** its
branch/bookmark for who is doing the work and what it is: `<ide>-<work>`, where
`<ide>` is the coding tool you are running in — `claude`, `codex`, `agy`,
`cursor`, etc. — and `<work>` is a short, intuitive, hyphenated description of
the task (e.g. `claude-streaming-export`, `codex-fix-auth-retry`). This makes it
obvious at a glance which agent owns which working copy when several share a
machine. The examples below use `<ide>-<work>` as that placeholder — substitute
your own tool name and task.

## Session-start bootstrap (before the task name is known)

Local agent hooks may run the startup helper before you have enough context to
choose `<work>`:

```sh
bash <skill-dir>/scripts/session-start.sh --hook <agent> --ide <ide>
```

In a local jj `default` workspace this creates a temporary workspace such as
`codex-pending-1a2b3c4d`, creates the same-name bookmark, writes a local owner
marker outside the tracked tree, and prints `NEXT_CWD=...`. In an existing
non-`default` jj workspace or linked Git worktree it records the owner marker and
works in place; in a Git primary checkout it creates a temporary worktree. If
`NEXT_CWD` is printed, `cd` there before editing or publishing. Repeated startup
hooks for the same session reuse the existing temporary workspace instead of
creating another one.

Cursor project hooks are guard-only and do not create this temporary workspace
automatically, because Cursor sessions are often used for read-only questions.
When using Cursor for implementation work, run isolation manually once the task
is clear, then continue from the printed workspace path before using file-edit
tools or publishing.

When the task is clear, rename the temporary owner to the normal convention:

```sh
bash <skill-dir>/scripts/rename-work.sh <ide>-<work>
```

The marker is local admin state (`.git/agent-sessions/` when a Git admin dir is
available, otherwise XDG state for non-colocated jj). It is not tracked and is
used only by guards to reject edits or publishes from a shared checkout or a
workspace this session does not own. If an agent runtime forgets to include the
tool cwd, the guard may use this marker to evaluate relative actions from the
session's single live, agent-named workspace/worktree instead of requiring every
shell command to spell out `cd <workspace> && ...`. Explicit default-checkout
writes are still blocked.

## Fast path: let the helper decide whether to isolate

If the user, orchestrator, IDE, or harness explicitly gives you an assigned
workspace/worktree path that is already yours, **go there first and work in
place**. Do not run `isolate.sh` from the shared checkout and create a second
workspace. The assigned path is the isolation; creating another one is
over-isolation and leaves cleanup residue.

Run this from the checkout you were handed, before editing:

```sh
bash <skill-dir>/scripts/isolate.sh <ide>-<work>
```

The helper detects Git vs jj, checks whether you are already in a linked
worktree/non-`default` workspace, creates a correctly named worktree/workspace
only when needed, and prints `WORKSPACE=` plus `WORK_REF=`. If `CREATED=yes`,
`cd` to `WORKSPACE` before editing. Use the manual recipes below only if the
helper is missing or reports an unexpected setup problem.

## Git mode

First check whether the tool already started you in a linked worktree (some
agentic tools do this by default):

```sh
[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] && echo "linked worktree" || echo "primary checkout"
```

(A linked worktree's `.git` is a _file_ and its git-dir lives under
`.git/worktrees/<name>`; the primary checkout's git-dir **is** the common dir.)

- **Already in a linked worktree → you're isolated.** Don't create another. Just
  make sure you're on your **own** branch (if you're sitting on a shared branch
  like `main`, `git switch -c <ide>-<work>` first), do the work, and clean up the
  branch when you finish.
- **In the primary checkout → carve out your own worktree before working:**

  ```sh
  git fetch origin                                   # if there's a remote
  git worktree add ../<repo>-<ide>-<work> -b <ide>-<work> origin/main   # or `main` if local-only
  cd ../<repo>-<ide>-<work>
  ```

  Work there, then integrate ([INTEGRATE.md](INTEGRATE.md)) and clean up (below).

## jj mode

jj's per-agent isolation primitive is a **workspace** (each has its own
working-copy commit); the shared one is named `default`. List every workspace and
its on-disk path with
`jj workspace list -T 'name ++ ": " ++ root ++ "\n"'` — handy to find (or `cd`
back to) the path of yours.

- **Already in your own (non-`default`) workspace → work in place**, make your
  bookmark, clean up at the end.
- **Otherwise → add your own workspace before working:**

  ```sh
  jj workspace add --name <ide>-<work> -r main ../<repo>-<ide>-<work>
  cd ../<repo>-<ide>-<work>
  ```

  Work there, then advance `main` ([INTEGRATE.md](INTEGRATE.md)) and clean up.

## The judgement case: already in a Git worktree **and** jj is available

A Git worktree of a colocated repo does **not** carry its own `.jj` — jj cannot
operate from inside it (`jj root` there fails with "There is no jj repo", which is
also why mode detection run from the worktree reports _git_). You already have
filesystem isolation from the worktree, so the parallel-safety goal is **already
met**. Don't try to force jj against a worktree that has no `.jj`. Pick whichever
of these keeps your work isolated and cleanly removable:

- **Simplest — use Git in the worktree you're in.** You're already isolated; work
  on your own branch, integrate, and delete the branch + remove the worktree when
  done. The worktree + branch + cleanup achieves exactly the parallel-safe outcome
  a jj workspace would.
- **Or, if you specifically want the jj workflow,** step back to the **main repo**
  (where `.jj` lives) and `jj workspace add` a fresh workspace to work in instead —
  operate jj from there, not from the git worktree.

Either way you end with isolated, removable work; choose by which is less friction
in your environment.

## Cleanup (when you finish)

Removing your isolated working copy is part of a clean finish, alongside deleting
your merged branch/bookmark (see
[INTEGRATE.md → Finish](INTEGRATE.md#finish-delete-the-merged-branch-then-stop)):

- **Git worktree you created:** from outside it,
  `git worktree remove ../<repo>-<ide>-<work>` (then delete the branch per Finish).
- **jj workspace you created:** `jj workspace forget <ide>-<work>` and remove its
  directory (then delete the bookmark per Finish).
- If the tool started you in a worktree you didn't create, leave its removal to
  the tool; just delete your branch/bookmark.

**Scope your cleanup to your own artifacts.** An unqualified "clean up residual
workspaces/bookmarks" means the `<ide>-<work>` ones **you** created — not every
non-`default` entry you can see. Don't enumerate-and-investigate another agent's
workspace (`codex-*`, `cursor-*`, …), reason about whether it's safe to delete, or
ask the user about it: skip it silently and leave it alone unless the user names it
explicitly. Ask only to clarify scope _within your own_ work, never to request
permission to touch someone else's.

The **one** exception — narrow and automatic: during an explicit integration/
consolidation task, `INTEGRATE.md` may identify a sibling jj workspace as _retired_
because its work has already **landed on `main`** and it backs no open review work.
That is merged residue, not in-progress work, so you forget it and remove its
directory even if another agent created it (`integrate.sh` does this for the
ref you integrate). Confirm with
`jj workspace list -T 'name ++ ": " ++ root ++ "\n"'`, move outside the directory
being removed, then forget and delete it. A sibling workspace whose work is **not**
yet on `main` is off-limits — never abandon another agent's unmerged work.

Skip deletion only when a **remote branch backs it** (an open PR) — same carve-out
as Finish.
