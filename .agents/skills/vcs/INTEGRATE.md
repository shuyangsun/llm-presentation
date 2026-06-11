# Integrating work & resolving conflicts

How to land your committed change onto a shared `main` and resolve the conflicts
that arise when teammates touched the same files. First [detect the
mode](SKILL.md); then follow that mode's steps. The conflict etiquette is the
same in both modes; the mechanics differ.

## Fast path: let the helper run the mechanics

For the standard "land my branch/bookmark on `main`" flow, run the bundled helper
instead of reconstructing the command chain:

```sh
bash <skill-dir>/scripts/integrate.sh <branch-or-bookmark>
```

This is the standard publish path, not an optional convenience wrapper. Do not
finish a normal local-agent integration with raw `git push`, `jj bookmark set`,
or `jj git push`: those commands can land the content while skipping the
stale-ref, workspace, and `default` lifecycle cleanup the helper owns. Use the
manual recipes below only when the helper is missing or reports an unexpected
setup problem.

In jj mode, the helper lands and cleans up local `main`; it does not replace a
final remote sync when one is required. After the helper has finished, run exactly
`jj git push --bookmark main` from the live `NEXT_CWD`/`default` workspace to
publish the already-landed `main` bookmark. Do not use a raw push before the
helper finishes.

If it stops with `VCS_CONFLICT=...`, resolve only the listed files using the
etiquette below, then continue:

```sh
bash <skill-dir>/scripts/integrate.sh --continue <branch-or-bookmark>
```

The helper handles mode detection, Git fetch/rebase/push retry, safe additive
Git conflict cleanup for text/JSON files, deterministic higher-version scalar
tie-breaks in config files, jj merge formation, stale workspace recovery, `main`
movement checks, `jj git export`, merged branch/bookmark deletion when no real
remote backs it, parking jj `default` on `main`, and retiring landed jj agent
workspaces. Use the manual recipes below only when the helper is missing or
reports an unexpected setup problem.

## The model (read once)

You have a finished change on your branch/bookmark. Several teammates are landing
their own changes on the same `main`. Your job: **integrate your change with the
current `main` and publish the union.** You do not hunt down teammates' branches —
you integrate against `main` as it is _now_ and resolve whatever conflicts that
produces. Two no-conflict outcomes are equally valid — don't manufacture work:
if you arrive **first**, your change lands as a clean fast-forward with nothing to
union; if `main` already contains everyone's work, there's nothing to resolve.
Either way, verify and stop.

## Conflict etiquette (both modes)

- **Union every additive change.** Keep every changelog entry, every list/array
  element, every code block any side added — yours _and_ every teammate's. Never
  drop one.
- **Single-valued field set two different ways** (e.g. a `version:` line): keep
  the **higher** value. Decide by the value itself, never by which side a marker
  puts it on — under `git rebase` the sides are _inverted_ (the `HEAD`/`<<<<<<<`
  side is the teammates' already-landed work, the `>>>>>>>` side labeled with your
  commit is yours), so "keep mine" is the wrong heuristic; compare and keep the
  larger.
- **Never resolve a whole file by taking one side** ("ours"/"theirs",
  `-X ours`, `git checkout --theirs`) — that silently discards the other side's
  additions. Resolve hunk by hunk, keeping both.
- **Leave no conflict markers** (`<<<<<<<`, `=======`, `>>>>>>>`, `|||||||`).
- **Verify before you publish** (see each mode's verify step).

## Git mode

Your work is on branch `agent-K`, checked out in your worktree. `main` is the
shared line — usually a remote `origin` (a worktree team pushes to it; a cloud/PR
session publishes to it). Do **not** `git checkout main`: in a worktree `main` is
often checked out elsewhere and the checkout fails. Publish by pushing `HEAD:main`.

1. `git fetch origin` — get the current shared `main`.
2. Integrate it into your branch: `git rebase origin/main` (or
   `git merge origin/main`). Either is fine; be consistent.
3. If it stops on conflicts, resolve each per the etiquette above, then
   `git add -A` and `git rebase --continue` (or, for a merge, `git commit`).
   Repeat until clean. (`git rebase --continue` keeps the existing message and
   won't take `-m`; if it tries to open an editor, prefix `GIT_EDITOR=true`.)
4. Publish: `git push origin HEAD:main`.
5. If the push is **rejected (non-fast-forward)** — a teammate landed first —
   re-run from step 1 (`git fetch` then rebase onto the new `origin/main`) and
   push again. Repeat until it lands.
6. **Verify:** `git show origin/main:docs/CHANGELOG.md` (or `git log origin/main`)
   shows your change _and_ the teammates' already there, with no markers.
7. **Finish:** delete `agent-K` _unless a remote branch backs it_ — if
   `git ls-remote --heads origin agent-K` prints nothing, `git switch --detach &&
git branch -d agent-K`; if it prints a ref, keep it (open PR). Details in
   [Finish](#finish-delete-the-merged-branch-then-stop).

## jj mode (Jujutsu, usually on a Git backend)

Your work is on bookmark `agent-K`. `main` is a local bookmark (jj sessions are
typically local — there may be no remote; "publish" means advancing the `main`
bookmark). jj records conflicts as **commit state**, so it will happily _commit_ a
conflict — you must resolve it _in the commit_, not paper over it in a child.

1. If jj says `The working copy is stale`, treat it as routine workspace
   lifecycle, not repo corruption. Run `jj workspace update-stale` in that
   workspace, then continue. Do not retry random jj commands first; stale
   workspaces block them until this command reconciles the working copy.
2. Create the integration commit as a merge of `main` and your work:
   `jj new main agent-K`. (Equivalently `jj rebase -b agent-K -d main` then edit
   that commit.) The new commit `@` becomes your merge.
3. If `@` is conflicted, jj writes conflict markers into the working-copy files.
   **Let the working copy settle first** (the `jj new`/`jj status` already did
   this) — then edit the files to resolve per the etiquette, removing every
   marker. jj records your resolution into `@` on its next snapshot; you don't run
   `git add`. (`jj resolve --list` shows the conflicted paths if you want help.)
4. **Confirm no conflict remains in the commit**, not just in the text. Run
   `jj log -r '::@'` and check the merge `@` is not marked `conflict`; or list
   conflicts explicitly with
   `jj log -r '::@' -T 'if(conflict, change_id.shortest(8) ++ " CONFLICT\n", "")'`
   (it must print nothing). A clean working tree on top of a still-conflicted
   commit is the #1 jj integration failure — fix the conflict _in_ the commit
   (step 3), don't leave it behind.
5. Advance `main` to your resolved merge — **but first re-check that `main` didn't
   move under you.** With no server to reject a bad update, `jj bookmark set` will
   silently **clobber** a teammate who advanced `main` after your step 2. Look at
   `main` now (`jj log -r main`): your merge `@` must be a **descendant of the
   current `main`** (it already contains main's latest commit). If `main` moved and
   `@` no longer descends from it, your merge is stale — **re-form** it against the
   new `main` with `jj new main agent-K` (re-merging your `agent-K` work with the
   updated `main`), then re-resolve any conflict and re-run the step-4 check before
   advancing. Do **not** try to recover with `jj rebase -r @ -d main`: if `@` is a
   bare merge with no changes of its own, rebasing just that commit drops your
   `agent-K` parent's work — re-forming from `agent-K` keeps it. Only when `@`
   descends from the current `main`:
   `jj bookmark set main -r @` (use `--allow-backwards` only if jj asks and you've
   confirmed it's correct), then `jj new` for a clean working copy. Under
   contention, loop this re-check until `main` is unchanged at the moment you set
   it — this is the jj equivalent of Git's non-fast-forward retry.
6. If the repo is colocated with Git tooling, run `jj git export` so the Git
   `main` ref matches.
7. **Verify** with jj (not git): `jj log -r '::main'` shows no conflicted commit;
   the files on `main` contain your change and the teammates' (no markers); and
   `jj resolve --list` reports nothing to resolve. In a local (non-colocated) jj
   repo the `main` _bookmark_ is the shared line — a missing plain-git `main` ref
   is expected, not a publish failure.
8. **Finish:** delete `agent-K` _unless a **real** remote backs it_ (`jj git
remote list` is non-empty and the bookmark tracks one of those — `agent-K@git`
   is the local backend, **not** a remote, so it doesn't count):
   `jj bookmark delete agent-K` then `jj git export`. Details in
   [Finish](#finish-delete-the-merged-branch-then-stop).

9. **If this repo has sibling jj workspaces, finish the `default` workspace
   lifecycle.** This is the consolidate-and-push bookend for local multi-agent
   work:
   - Find `default` and the siblings:
     `jj workspace list -T 'name ++ ": " ++ root ++ "\n"'`.
   - In `default`, expect stale state after sibling workspace operations. Run
     `jj workspace update-stale`; if it reports the workspace was not stale, that
     is fine. Then run `jj new main` so `default@` is parked on current `main`.
   - For each sibling workspace whose work is already on `main` and does **not**
     back open PR/review work, retire the workspace too:
     `jj workspace forget <name>` and remove its on-disk directory. Skip
     workspaces that still contain unlanded work or whose branch/bookmark is kept
     because a real remote backs it.
   - If you are currently inside the workspace being retired, first `cd` to
     `default` (or another directory outside it), then forget it and remove its
     directory.

## Finish: delete the merged branch, then stop

Once your work is verified on `main`, your `agent-K` branch/bookmark is merged and
redundant — leaving it behind is a **stale ref** that clutters the repo. Decide
its fate with **one check, run first**: does a branch of that name still exist on a
remote?

- **git:** `git ls-remote --heads origin agent-K`
- **jj:** first list real remotes with `jj git remote list`; a branch is
  remote-backed only if it tracks one of _those_ — `agent-K@<remote-name>` in
  `jj bookmark list`. **`agent-K@git` does NOT count:** `@git` is jj's local
  colocated Git backend, not a network remote, and it's present for _every_
  bookmark in a git-backed repo. If `jj git remote list` is empty, there is **no**
  remote, so nothing is remote-backed — always delete.

**If a real remote ref backs it → KEEP the local branch.** A remote branch is
what a pull request is built on, so deleting your local copy throws away a ref a
reviewer may still need. A bare / self-hosted remote still counts — don't try to
judge whether a PR is "really" open (you usually can't from the CLI, and the
remote branch itself _is_ the PR's head). But a purely local backend (`@git`, or a
jj repo with no remotes at all) is **not** a remote — delete in that case.

**If it prints nothing → the branch is purely local and merged, so DELETE it:**

- **git:** detach first (the branch is checked out in your worktree), then delete:
  `git switch --detach && git branch -d agent-K` (or `git checkout --detach`). The
  lowercase `-d` refuses a branch that isn't fully merged — a safety net; if it
  refuses, the branch didn't land, so fix the integration rather than forcing `-D`.
- **jj:** `jj bookmark delete agent-K`; in a colocated repo follow with
  `jj git export` so the Git ref disappears too.

If you created your **own** jj workspace or Git worktree to do this work
([ISOLATE.md](ISOLATE.md)), remove it now too so it doesn't linger — from outside
it, `jj workspace forget <name>` / `git worktree remove <path>` (and delete its
directory). Leave a workspace/worktree the _tool_ started you in for the tool to
clean up.

In jj repos where several local workspaces share the same repo, also do the
`default` lifecycle bookend above: recover stale `default` if needed, park it on
`main`, and remove retired sibling workspaces whose work has landed and does not
back open review work. This cleanup prevents the next agent from hitting a stale
`default` before it can consolidate or push.

Finally, sweep away **orphan empty side-heads** — anonymous empty,
description-less commits with no bookmark, not on `main`, that no workspace's
working copy points at. These are residue from a workspace/bookmark lifecycle (jj
auto-abandons an empty working copy on `forget` only when no bookmark pinned it; a
bookmark created on an initial empty workspace commit survives the forget, and
deleting the bookmark afterward strands the commit). `integrate.sh` abandons them
automatically at the end of a finish; if you are doing this by hand, `jj abandon`
each such commit. The predicate is conservative — empty **and** description-less
**and** unbookmarked **and** not on `main` **and** not any live workspace's working
copy — so real work, named commits, and active working copies are never touched.

Then **stop.** You are done the moment your work is on `main`, the union is
preserved, the verify step is clean, and the merged branch is resolved (deleted,
or kept because a remote backs it), `default` is usable if this is a jj
multi-workspace repo, and any retired workspace/worktree you are responsible for
is removed. Do not write new code, run builds/tests/formatters, or amend the
committed change — integration is the whole job.
