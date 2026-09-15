---
status: accepted
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

1. **Keep the claim while parked (shipped).** A parked child keeps its claim,
   its TaskRecord, and its terminal obligations. Siblings wait, so a batch run's
   progress is bounded by its slowest parked child; the single-owner invariant,
   the claim owner matrix in `runtime/kernel/storage.ts`, and batch settlement
   all stay as they are.
2. **No second record of the park is introduced.** A parked claim lifecycle
   state would give the Kernel two records of the same fact — the claim and the
   parked obligation — which is the dual-authority shape
   `runtime/kernel/backend_claim.ts` was consolidated to remove, and a released
   claim has to answer who owns the task while parked, how re-acquisition avoids
   racing a stale worker, and what the projection shows in between. The facts
   such a design would have to carry are the Review reservation identity, the
   frozen snapshot digest, the intent identity, and the CAS revision of the
   record.

Revisit this decision when a batch run's wall-clock is genuinely bounded by
parked children rather than by the work itself, and design a release against the
claim owner matrix before adding any state.

## Rejected Alternatives

- **Releasing the claim behind a durable re-entry record.** A task with no owner
  and no obligation is indistinguishable from an abandoned one, and the record
  would have to preserve exactly the four facts Decision 2 lists.
- **Adding a parked claim lifecycle state.** Two records of the same fact, which
  the claim owner matrix was consolidated to avoid.
- Letting a sibling adopt a parked child's claim: that would silently transfer
  the obligation, including its Review reservation, to a different task.

## Consequences

- A batch run's progress is bounded by the slowest parked child, and a parked
  child is always visible as `needs_human` with its reason rather than as an
  apparently finished run.
- Independent single-task work is unaffected: the claim is only contended
  between children of the same batch.
