---
status: proposed
---

# Parked-Child Claim Release

## Context

The backend claim is single-owner: `runtime/kernel/storage.ts` reconciles
exactly one active owner per task, and an unattended batch run is strictly
serial, so a child parked on a foreground obligation holds the claim that its
siblings would need. Observed behavior confirms the cost: a child that pauses at
Review, or that lands in `needs_human` after a failed enrollment, stops the run
until a foreground turn resolves it, even when the remaining children are
independent and already authorized by the same Batch Authorization.

The claim is also the fact the Kernel uses to refuse concurrent mutation, to
attribute a task to one Host session, and to distinguish a live worker from a
stale tombstone, so releasing it is not a bookkeeping change.

## Decision

Not settled. The options are:

1. **Keep the claim while parked (shipped).** A parked child keeps its claim,
   its TaskRecord, and its terminal obligations. Siblings wait. The single-owner
   invariant, the claim owner matrix in `runtime/kernel/storage.ts`, and batch
   settlement all stay as they are; the cost is serial throughput.
2. **Release the claim behind a durable re-entry record.** The parked child
   would release the claim so siblings continue, and a durable record would let
   it re-acquire exactly the obligation it left. This needs answers this ADR
   does not have: who owns the task while parked, how a re-acquisition avoids
   racing a stale worker, and what the projection shows in between. The facts
   that would have to survive are the Review reservation identity, the frozen
   snapshot digest, the intent identity, and the CAS revision of the record.
3. **Add a parked claim lifecycle state.** A third claim state would make the
   park first-class, but it would also give the Kernel two records of the same
   fact — the claim and the parked obligation — which is the dual-authority
   shape `runtime/kernel/backend_claim.ts` was consolidated to remove.

Recommendation: keep option 1 until a batch run's wall-clock is genuinely
bounded by parked children rather than by the work itself, and design option 2
against the claim owner matrix before adding any state.

## Rejected Alternatives

- Releasing the claim without a durable re-entry record: a task with no owner
  and no obligation is indistinguishable from an abandoned one.
- Letting a sibling adopt a parked child's claim: that would silently transfer
  the obligation, including its Review reservation, to a different task.

## Consequences

- A batch run's progress is bounded by the slowest parked child, and a parked
  child is always visible as `needs_human` with its reason rather than as an
  apparently finished run.
- Independent single-task work is unaffected: the claim is only contended
  between children of the same batch.
