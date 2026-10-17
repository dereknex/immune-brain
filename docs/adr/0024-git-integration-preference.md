---
status: accepted
---

# Git Integration Preference

Accepted on 2026-10-16 by the repository owner (user decision U2 and delegated
technical choice T3 in `docs/specs/content-delivery-authority.spec.md`), for
Issue #257. It supersedes [ADR 0023](0023-silent-precondition-commit.md): the
silent precondition commits that ADR introduced become the opt-in `auto`
preference, and the default writes no runtime commit to the user's branch.

## Context

ADR 0023 let the runtime commit its own preconditions silently: Enrollment's
TaskIntent and Spec, the unborn-HEAD scope, and each storage-layout migration
phase. It never asked the user to commit by hand, but it put commits the user
did not write on the user's branch. Slice S1 of the same Spec made delivery
independent of Git: a Slice that settled `done` with an unchanged TaskIntent is
delivered wherever its bytes live. Once no gate needs a runtime commit, the
commits that remain are a preference about the user's history, not a
precondition.

## Decision

1. **One preference decides.** The first line `- Git integration: manual` or
   `- Git integration: auto` in the tracked repository root `AGENTS.md`, else
   in the tracked root `CLAUDE.md`, sets it
   (`runtime/git_integration_preference.ts`). Absent means `manual`. Any other
   value means `manual` and the status Tool reports an
   `invalid_git_integration` warning naming the file and the value. An
   untracked instruction file declares nothing.
2. **`manual` (the default) writes no runtime commit outside batches.**
   Enrollment stages its TaskIntent and the Spec its binding names instead of
   committing them; staging is all tracking requires. With an unborn HEAD the
   in-scope staged and untracked changes are claimed as task work, and the
   Enrollment gate says so. Storage-layout migration writes its evidence but
   leaves each phase's diff in the working tree: the explicit command reports
   `migration_uncommitted` with the affected paths for the user to commit
   however they prefer, then rerun.
3. **`auto` keeps ADR 0023's commits and adds a settle commit.** Every
   precondition commit ADR 0023 describes is unchanged. When a task settles
   `done` in the user's working tree, both Hosts commit exactly its settled
   scoped paths, and nothing else, through `commitWorkflowPaths`, with the
   subject `imm(<task-id>): settled delivery`. The commit is made only while
   the scoped identity still equals the one the last attestation settled, so an
   in-scope edit made after settlement is never swept in. Content the user
   already committed yields no commit. A refused commit is reported beside the
   completion result and never undoes the settlement.
4. **Unchanged in both modes:** the confirmed empty root commit for an unborn
   HEAD (ADR 0019), every rule of `commitWorkflowPaths` (literal paths, hooks
   run, no `--no-verify`, `--amend`, `-a`, push or Git config write), and the
   Kernel's refusal of a dirty scope the gate did not list.
5. **Batches are out of this ADR's scope.** Batch precondition commits keep
   ADR 0023 Decision 7 until the batch work of the same Spec (D10) moves batch
   progress onto a hidden ref.
6. **The status Tool reports the resolved mode** as `git_integration`
   (`mode` and the declaring `source`) on both Hosts.

## Consequences

- A repository that says nothing gets no runtime commit from Enrollment or
  migration. Its user commits when and how they like; delivery does not wait
  for it (S1).
- A repository that wants the old behavior declares `auto` once and gains a
  commit per settled task.
- BASELINE no longer describes a silent commit as the one exception to the
  separate commit grant; it describes this preference. Commit stays a
  separately granted effect for everything else.
