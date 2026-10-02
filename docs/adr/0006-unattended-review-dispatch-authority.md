---
status: accepted
---

# Unattended Review Dispatch Authority

## Context

An opted-in serial batch cannot implement a newly enrolled child inside its
extension Tool callback: that callback cannot invoke a Parent Agent in the same
turn. Enrollment authorizes work; it does not prove that implementation exists.
The same foreground boundary applies to independent Review. Owning model
invocation inside the runtime would introduce another execution/authority path.

## Decision

1. **Implementation stays with the foreground Parent.** After child Enrollment,
   the driver returns a `running` report with an Executor handoff and keeps the
   child `enrolled`. The Parent implements and stages scoped changes and runs
   focused diagnostics before advancing Kernel Assurance. Re-entry while
   artifacts remain active returns the same handoff without invoking QA.
2. **Review stays a foreground obligation of the literal user's Host session.**
   The Kernel reserves Review and returns `agent_params`; the Parent dispatches
   that reviewer once in a later foreground turn and `submit_review` consumes
   the structured verdict against the frozen snapshot. The batch remains
   `running` with its child `enrolled` during an open reservation. Re-entry
   waits for that reservation rather than replacing or redispatching it.
3. **The runtime never invokes an Executor or reviewer model and never
   synthesizes reviewer receipts.** Host review authority and frozen snapshot
   binding remain unchanged. After Kernel settlement, the Parent stages the
   child's terminal audit evidence and re-enters the same batch. The shared
   driver reconciles settlement, adopts or creates exactly one scope-bound
   commit, and enrolls the next ready child under valid authorization.

## Rejected Alternatives

- **Runtime-invoked Executor or reviewer.** Owning model invocation adds an
  execution service; runtime-produced reviewer receipts undermine independent
  Host review authority.
- **Out-of-process reviewer service.** A second identity, transport and failure
  contract is unnecessary for this serial foreground handoff.
- **New persisted execution lifecycle.** Existing `running` batch and `enrolled`
  child states plus fresh Kernel obligations already describe recovery.
- **Treating every foreground handoff as `needs_human`.** Ordinary implementation
  and an open Review reservation need no additional literal-user decision.

## Consequences

- Batch throughput remains Parent-driven across implementation and Review; no
  recursive, parallel or detached Managed task dispatch is introduced.
- Ordinary handoff and below-limit QA repair reuse valid authorization. Genuine
  budget stops, user decisions, stale/foreign claims and identity drift retain
  their fail-closed recovery boundaries.
- A fresh settled projection reconciles an interrupted `enrolled` child at
  commit; an existing scope-bound commit is adopted instead of replayed.
