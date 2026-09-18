---
status: accepted
---

# Authority Uniqueness Keys

## Context

`mws-sqlite-authority` spent fourteen Review rounds on findings that read like four
independent acceptance failures: a missing workspace-revision binding, audit paths
that were not run-isolated, and delete or repair paths that did not re-check the
enrollment event or the intent hash. They were one design gap — identity and
uniqueness questions answered with a coarse key, then discovered one code path at
a time by the reviewer.

Where the same question was answered properly, the answer is already fine-grained:

- stale-claim repair requires the tombstone/record hash plus the claim's `task_id`,
  `intent_revision` and `intent_content_hash` to match before anything is removed;
- a Review verdict is bound to `run_id`, the intent content hash and one immutable
  Git revision (`review_commit`, `review_tree`, `manifest_digest`);
- a finding's anchor is the sha256 of `{violated.kind, violated.ref, caller_chain}`,
  so the same claim keeps one identity across rounds;
- terminal evidence has a per-run layout, `.imm/audit/<task-id>/<run-id>/`,
  precisely because two worktrees can run one logical task under distinct run
  identities.

The principle is therefore settled, not new. What was missing is a written rule
that stops new code from choosing the coarse key by default.

## Decision

Authority and audit judgments — "is this the same settlement", "is this fresh",
"may I delete or repair this" — key on run identity and intent binding: `run_id`
plus `enrollment_event_id`, `intent_revision` or `intent_content_hash` as the case
requires. `task_id` is a display label and a directory-grouping name. It is never
by itself a deduplication, freshness or deletion basis.

Code that needs to identify a settlement reads `run_id` or the terminal proof bound
to it. A path that can only read `task_id` is a bug to fix at the call site, not a
key to widen.

This ADR changes no code. It records the rule and the coarse-key sites that remain.

## Remaining coarse-key sites

Each entry names the site, its exit and the ceiling it accepts until then, per the
project transition-plan rule that any interim path needs an expiry.

1. **Flat historical audit pair** `.imm/audit/<task-id>/`
   (`runtime/kernel/storage_paths.ts`, `auditTaskDirPath`). The per-run helper
   above it already names `mws-migration-release` as the retirement owner.
   Ceiling: two worktrees that settle the same logical task overwrite each
   other's flat pair.
2. **Run-blind terminal reads.** `readAuditTaskPair(root, taskId)` is called
   without a run identity in `runtime/kernel/storage.ts` (the `terminal_owner`
   authority-projection fallback) and in
   `runtime/kernel/assurance_projection.ts` (the terminal read after claim loss).
   Both fall back to the flat pair from (1), so a settlement exported from
   another worktree can be read as this worktree's terminal evidence. Exit: pass
   the run identity once (1) retires the flat layout.
3. **One live run per task is a schema constraint, not a lookup.**
   `runs.task_id TEXT NOT NULL UNIQUE` is what makes the `readRunRowByTask`
   reads (roughly a dozen call sites in `runtime/kernel/`) safe today. Any feature
   that allows a second live run for one task — re-run, retry-as-new-run — must
   move those call sites to run identity instead of relaxing the constraint.

## Consequences

Recording the rule prevents the class, but it did not by itself stop the observed
behaviour: each round patched only the reported trigger. The process counterpart
lives in the Loop rework step and the reviewer prompt — a second rework on one
acceptance id or anchor is answered by a generalization argument over the whole
invariant, or by refuting the finding against the accepted contract boundary.
