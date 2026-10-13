---
status: accepted
---

# Deterministic QA Runs In Place

Accepted on 2026-10-13 by the repository owner (user decisions U1, U2, U7 and
U8 in `docs/specs/host-owned-environment.spec.md`), for Issue #228.

## Context

Task QA materialized the staged delivery tree into a temporary directory and
ran `prepare` and every check there. The copy had no installed dependencies, so
every run reinstalled them, and tools bound to the working directory's path did
not behave as they do for the user. The Executor had already run the same code
in the working directory with the user's full environment, so the copy did not
shield anything the task had not already touched. What the copy did provide was
one guarantee: the commands saw exactly the frozen snapshot.

## Decision

1. **Task QA runs in the task's working directory.** `runDeterministicQa`
   executes `prepare` and every check with the project root as the root and
   creates no directory of its own.
2. **Equality with the frozen snapshot replaces the copy.** Before the first
   command and after every command, the tracked content inside the task's
   `scope_hint` is compared with the frozen tree, ignoring the paths the
   snapshot already treats as non-delivery. A difference fails with the
   existing reason `protected_input_or_output_drift`.
3. **Only in-scope content is compared.** Tracked content outside the scope,
   and untracked or ignored files, are the user's environment.
4. **Differing paths are returned and never stored.** They travel as
   `prepare_observation.drift_paths` in the direct Tool result, capped at 64,
   and appear in no TaskRecord, diagnostic or audit file.
5. **`environment.writable_paths` stays parsed and has no effect.** The
   descriptor contract version does not change.
6. **The Lane batch integration recheck keeps the materialized copy.** It
   verifies a merge candidate commit that is never checked out, so it has no
   working directory to run in.
7. **The Git repository-binding variables stay filtered** from the child
   environment.

## Consequences

- A QA result now depends on the working directory's untracked and ignored
  content, such as installed dependencies, build output and local
  configuration. A pass no longer shows that a clean checkout would pass.
- A tracked change outside the task's scope can influence a QA result without
  being detected. Review stays bound to the frozen snapshot.
- A command that rewrites an in-scope tracked file fails the run, where it
  previously only changed a discarded copy.
- `runtime/assurance/delivery_workspace.ts` remains for the batch integration
  recheck only.
