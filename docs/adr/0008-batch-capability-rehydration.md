---
status: accepted
---

# Batch Capability Rehydration

## Context

A Batch Authorization is one literal-user confirmation that issues one Kernel
capability in memory; the capability is consumed child by child as each child
enrolls, and it never leaves the process that issued it. The durable facts a
crashed run leaves behind are the batch state record at
`.imm/state/batches/<batch_id>.json` (plan digest, branch, base head, budget,
and the authorization expiry), each child's TaskRecord, and the batch branch
with its commits.

The question this decision record settles is what a resumed run may reconstruct
from those facts. A resumed run rebuilds its projection from them and reuses the
authorization only while it still binds: unexpired, still running, same plan
digest, same branch, and the expected HEAD lineage. Anything else opens one
fresh native confirmation named with the reason, and the renewal rule requires a
strictly newer confirmation than the one it replaces.

## Decision

1. **Rebuild from durable facts and reuse only what still binds.** The binding
   is reconstructed from Kernel facts and the capability is re-issued in memory
   for the resumed process; nothing durable carries authority.
   `runtime/unattended/batch_preflight.ts` owns every decision on that path:
   `projectBatchPreflight` projects the durable facts into a resume or a fresh
   plan before any gate, `authorizeBatch` owns the reuse/expiry decision (it
   reuses an authorization only when no blocker among
   `batch_authorization_expired`, `batch_not_running`,
   `batch_plan_digest_changed`, `batch_branch_changed`, and
   `batch_head_lineage_moved` applies), and `projectBatchDrift` re-checks the
   live claim, the plan digest, and the HEAD lineage after the literal user
   confirmed. Both Host adapters call that shared flow and supply only their own
   gate, confirmation reference, and nonce; rendering stays Host-specific.
2. **The expiry is the deadline the literal user confirmed.** An intact running
   authorization keeps its own expiry, so a child parked on a foreground Review
   does not spend the budget twice; every other path takes the budget deadline
   confirmed by the gate it just opened.

## Rejected Alternatives

- **Persisting the capability, in whole or in encrypted form, as a resume aid.**
  The capability is a bearer token: a durable copy would be replayable authority
  at rest, and it would let a process that never saw the native confirmation mint
  authority from bytes. It would also make the strictly-newer-confirmation
  renewal rule unenforceable, because the old confirmation would still be valid
  material.
- **Widening the authorization window so resumes rarely trip the expiry check.**
  The expiry derives from the budget deadline the literal user confirmed, and
  lengthening it silently pre-authorizes work beyond the confirmed budget.
- **Treating a state file as proof that a literal user confirmed a plan**, and
  resuming without a gate on that basis.

## Consequences

- A crash costs at most one native confirmation, and only when something no
  longer binds; a resumed run never mints authority from bytes.
- The batch state record stays orchestration-only: it carries no authority
  material that a reader could mistake for a capability.
