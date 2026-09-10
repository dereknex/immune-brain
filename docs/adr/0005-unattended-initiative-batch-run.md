---
status: accepted
---

# Unattended Initiative Batch Run

## Context

Executing a multi-TaskIntent Initiative required repeated manual enrollment and
recovery decisions even after the decomposition, order, budgets, and boundaries
had already been reviewed. Six Slices were planned against
`docs/specs/archive/unattended-initiative-batch-run.spec.md`: a deterministic
read-only batch plan, a crash-resumable serial driver, per-child bounded
commits, a Claude Code confirmation gate, a Pi gate with dual-host conformance,
and the contract text in this ADR's scope.

The reopened question was whether one literal-user act may authorize more than a
single TaskIntent — that is, whether a batch needs its own authority tier above
the enrolled TaskIntent.

## Decision

1. A Batch Authorization is one literal-user Enrollment act covering a confirmed
   ordered child list. It is a coverage decision, not a new authority tier:
   every child is still enrolled, assured, settled, and recorded by the Kernel
   under its own TaskRecord and tombstone.
2. TaskRecord v4 already supplies the identity, atomicity, and recovery a batch
   needs — `intent_ref` plus `intent_snapshot` bind each child to its exact
   intent revision and content hash, workspace transactions make each enrollment
   atomic and recoverable, and the backend claim plus tombstones make ownership
   and terminality observable. No batch-scoped *authority* record, ledger, or
   second settlement state machine is introduced.
3. Orchestration state is separate from authority and is deliberately batch
   scoped: `runtime/unattended/batch_state.ts` persists one
   `BatchRunStateRecord` per run at `.imm/state/batches/<batch_id>.json` with the
   ordered child states, the confirmed plan digest, the base head, the budget,
   the produced commit chain, and the authorization expiry, so an interrupted
   run resumes from durable facts. That record owns batch progress only. Every
   authority fact it references — enrollment, claim, settlement, tombstone —
   remains a per-child TaskRecord owned by the Kernel.
4. Batch state transitions live only in `runtime/unattended/` and
   `runtime/kernel/batch_authority.ts`. Host adapters derive the plan, render the
   native confirmation, issue one Kernel capability, and call the shared
   `startBatch`; they are callers, never owners (Invariant H-1).
5. The confirmation is bound to the `plan_digest` of the ordered child
   identities and to the repository `base_head`. A plan that drifts after
   confirmation, or a HEAD that moves, is refused rather than reconciled.
6. `critical` children are never batched, the runner never pushes, opens a pull
   request, resolves a user decision, or creates, switches, or deletes a Git
   worktree, and default `imm-loop` behavior is unchanged when the batch tool is
   not invoked.

## Rejected Alternatives

- A batch-scoped authority record or a second plan ledger. A batch-scoped
  execution record is not an alternative, it is this decision.
- Parallel child execution, or a generic scheduler framework.
- Deriving execution authority from GitHub Issue state.
- Auto-opening a pull request for the batch branch, or auto-resolving parked
  children.

## Consequences

- Batch progress is observable through the same Assurance Projection and
  TaskRecord surface as single-task work; per-child Review remains a foreground
  obligation.
- Deferred with explicit owners, not silently dropped: scheduled or cron-driven
  batches, headless and CI-hosted runs, batches spanning multiple worktrees, and
  automatic PR creation for a completed batch branch.
- The bound Spec is archived byte-preserving with the settled task; the contract
  text in `IMMUNE.md`, `CONTEXT.md`, and `dist/imm-loop.md` remains the living
  description of the shipped behavior.
