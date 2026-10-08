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
   and the produced commit chain, so an interrupted run resumes from durable
   facts. The budget is `max_children` and `qa_failure_limit`; neither it nor the
   authorization carries a deadline, so a confirmed run stays authorized for as
   long as its plan, branch, and HEAD lineage hold. A record written before this
   rule may still carry `authorization_expires_at` and `budget.deadline_at`;
   both are ignored on read and dropped on the next write. That record owns
   batch progress only. Every
   authority fact it references — enrollment, claim, settlement, tombstone —
   remains a per-child TaskRecord owned by the Kernel.
4. Batch state transitions live only in `runtime/unattended/` and
   `runtime/kernel/batch_authority.ts`. Host adapters derive the plan, render the
   native confirmation, issue one Kernel capability, and call the shared
   `startBatch`; they are callers, never owners (Invariant H-1).
5. The confirmation is bound to the `plan_digest` of the ordered child
   identities and to the repository `base_head`. A plan that drifts after
   confirmation is refused rather than reconciled. HEAD lineage is a guard,
   not a state: a HEAD on the same batch branch that descends from the recorded
   head, with every recorded child commit still reachable, is a fast-forward and
   is adopted as the new expected head, recorded in the batch run state, with
   no gate. The adopted commit is never attributed to a child and never
   rewritten, and the next batch commit parents on it. A different branch, a
   detached HEAD, a recorded head that is not an ancestor of HEAD, and an
   unreachable recorded child commit stay fatal (`batch_head_lineage_broken`).
   When a child's foreground terminal mutation reaches Kernel `done`, the same
   Host call re-enters the shared `startBatch` with a capability rebuilt from
   durable facts and opens no gate: the runner commits the child, then enrolls
   the next child or settles the batch record as `completed`. A reserved
   Review, a parked child and a stopped child end the sequence where they do
   today. A failure of that re-entry never changes the Kernel result; it is
   reported beside it with one retry action, `start_unattended_batch`.
6. `critical` children are never batched, the runner never pushes, opens a pull
   request, resolves a user decision, or creates, switches, or deletes a Git
   worktree, and default `imm-run` behavior is unchanged when the batch tool is
   not invoked.

## Rejected Alternatives

- A batch-scoped authority record or a second plan ledger. A batch-scoped
  execution record is not an alternative, it is this decision.
- Parallel child execution, or a generic scheduler framework. Superseded for
  an explicit opt-in only: ADR 0013 adds optional Lane execution selected by
  `max_parallel`; a batch started without it stays strictly serial.
- Deriving execution authority from GitHub Issue state.
- Auto-opening a pull request for the batch branch, or auto-resolving parked
  children.

## Consequences

- Batch progress is observable through the same Assurance Projection and
  TaskRecord surface as single-task work; per-child Review remains a foreground
  obligation.
- Deferred with explicit owners, not silently dropped: scheduled or cron-driven
  batches, headless and CI-hosted runs, batches spanning multiple worktrees (ADR 0013 adopts Lanes the runner never creates, as an opt-in), and
  automatic PR creation for a completed batch branch.
- The bound Spec is archived byte-preserving with the settled task; the contract
  text in `IMMUNE.md`, `CONTEXT.md`, and `dist/imm-run.md` remains the living
  description of the shipped behavior.
