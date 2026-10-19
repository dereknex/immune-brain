---
status: proposed
---

# Branch Boundary with Frozen Acceptance

Proposed on 2026-10-18 by the repository owner (decisions Q1–Q20′ in
`docs/specs/branch-boundary.spec.md`). It becomes accepted when Slice S3 of
Initiative `batch-unblock` settles. It amends
[ADR 0005](0005-unattended-initiative-batch-run.md) (what a batch
authorization binds) and narrows
[ADR 0019](0019-explicit-run-entry-owns-enrollment.md)'s Enrollment identity
for batch children only. It names
[ADR 0018](0018-delegated-in-lane-intent-revision.md) and
[ADR 0021](0021-same-directory-scope-extension.md) for supersession when
Round 2 removes delegated reseal and scope envelopes.

## Context

A batch authorization binds every child's whole TaskIntent: its content
hash and revision enter the plan digest, and any byte change refuses the
child or fails the whole batch with `plan_changed`. In the session that
motivated this ADR four of five Tasks revised their intent while running,
each only adding same-directory test files to `scope_hint`; every one of
those revisions would have wedged a batch and needed a fresh entry and gate.
Meanwhile the parts of an intent that decide whether work is accepted — the
acceptance assertions and the commands that check them — were the weakest
bound: a descriptor-only change was a compatible revision.

Mainstream agent workflows bound the work by a branch and review it at the
end; they rarely freeze acceptance. This project's value is the reverse:
acceptance and evidence are governed. The direction keeps that and drops the
rest of the intent from the authority subject.

## Decision

1. **The authority subject is frozen acceptance.** A TaskIntent's authority
   subject is its contract, task id, goal, owner, bound Spec path, and every
   acceptance item's id, assertion, and verification command executable,
   argv and working directory. `scope_hint`, revision, risk, timeouts, output
   limits and environment preparation are working parameters outside it.
2. **Batches bind the subject.** The plan digest, child enrollment identity,
   drift checks, reconfirmation, delegated reseal and delivery checks compare
   the authority subject. A scope-only revision leaves the batch running.
   Single-task TaskRecord, Review and QA snapshots keep the whole content hash.
3. **A subject change stops one child.** A child whose subject changed after
   confirmation is parked and its dependents are skipped; independent
   children finish. A change to the child set, order or dependencies still
   fails the batch.
4. **Acceptance changes are breaking.** A revision that changes a
   verification command, its arguments or working directory, or adds an
   acceptance item, needs the user's breaking-revision approval.
5. **Branch boundary (Round 2).** Batches run on a Parent branch with one
   worktree branch per child, integrate through merge-queue semantics, and
   return to main by the Git integration preference. Until then the serial
   runner and Lanes keep their current integration.

## Consequences

- Planner scope estimates stop costing a batch; an Executor's own scope
  additions stay visible in Review evidence.
- Strengthening acceptance mid-run now needs the user, which costs a stop
  that used to be free.
- Batch records written before this ADR keep whole-intent comparison; no
  migration runs.
