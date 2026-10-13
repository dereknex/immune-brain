---
status: accepted
---

# Silent Precondition Commit

Accepted on 2026-10-13 by the repository owner (user decisions BR-4 and BR-5 in
`docs/specs/run-only-gates.spec.md`), for Issue #231. It replaces the
fail-closed outcome of the TaskIntent `enrollment-dirty-scope-fail-closed`:
the dirty-scope invariant stays, and the Host now satisfies it instead of
handing it to the user. It narrows one BASELINE rule, that commit always needs
its own grant, for the single case described here.

## Context

Enrollment refused a task whose scope held staged, modified or untracked paths,
and told the user to commit, stash or revert them. In practice those paths were
the Spec and TaskIntent the Planner had just drafted and staged, plus files the
user had already touched for this very task. The refusal protected a real
invariant: paths dirty at Enrollment are recorded in the baseline as user dirt
and can never be delivered by the task. It asked the user to do by hand a step
with one obvious answer.

The unborn-HEAD flow of ADR 0019 already has the runtime create a commit. It
discloses that commit in the Enrollment confirmation. The repository owner
chose not to follow that precedent here: the commit is silent.

## Decision

1. **One module owns every runtime-made precondition commit.**
   `runtime/assurance/workflow_autocommit.ts` exposes `commitWorkflowPaths`.
   A caller passes an explicit path list and a subject; the module derives no
   paths. It commits with `git commit --only -- <paths>` after `git add --` of
   the untracked ones, so index content outside the list is neither committed
   nor unstaged. Pathspecs are literal.
2. **A commit is made only when a precondition would otherwise fail.** Two
   states fail Enrollment: a dirty path inside the task `scope_hint`, and an
   untracked TaskIntent. A TaskIntent that is staged over a clean scope fails
   nothing, so it produces no commit and no empty commit. The Planner still
   stages its artifacts and never commits.
3. **The Enrollment committable set**, when one of those states holds, is the
   dirty paths inside `scope_hint` plus the task's own TaskIntent and the Spec
   its binding names, each only when dirty. Dirt outside the set is not
   committed and does not block Enrollment.
4. **The commit precedes the binding.** Both Hosts commit before preparing the
   Enrollment binding, so the native confirmation binds the resulting HEAD.
   With an unborn HEAD the empty root commit is created first, after the
   confirmation as before, and this commit follows it; the preparation read
   after it must equal the confirmed one in everything but the Git base, or
   Enrollment is refused and the result names the commit that remains.
   A commit is made only for an Enrollment the owner checks would admit: when
   a claim, a TaskRecord or a workspace owner already exists, nothing is
   committed and the owner's undelivered work stays uncommitted.
5. **Hooks run and nothing is bypassed.** `--no-verify`, `--amend`, `-a`,
   `git add -A` and `git add .` are never used. A refused commit fails the
   operation with Git's message. Identity follows the unborn-HEAD rule:
   existing environment or config, then the automation fallback, never a
   config write. The module refuses an unmerged index, a listed path flagged
   assume-unchanged or skip-worktree, and a path that leaves the repository.
6. **The Kernel refusal stays.** `enrollWithPreconditions` still refuses a
   dirty scope. It is the last line of defence, reachable when a path changed
   after the commit, and its text no longer tells the user to commit.

## Consequences

- **Accepted risk: unfinished user work inside the scope is committed.** A
  half-written file the user left inside `scope_hint` lands in a commit
  subject-lined `chore(imm): commit Enrollment preconditions for <task-id>`
  without being shown first. The user must split or revert it afterwards. The
  repository owner accepted this in exchange for never being asked.
- A commit made before a declined, cancelled or failed Enrollment remains in
  history. The result names it. A retry finds a clean set and makes no second
  commit.
- Commit is no longer always a separately granted effect. BASELINE states the
  exception and its limits: no push, publication, history rewrite, or commit of
  a path outside the committable set.
- The batch and storage-migration preconditions reuse the same module in later
  Slices of the same Initiative; this ADR is amended only if their behaviour
  differs from the rules above.
