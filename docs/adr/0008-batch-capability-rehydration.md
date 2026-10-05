---
status: accepted
---

# Batch Capability Rehydration

## Context

A Batch Authorization is one literal-user confirmation that issues one Kernel
capability in memory; the capability is consumed child by child as each child
enrolls, and it never leaves the process that issued it. The durable facts a
crashed run leaves behind are the batch state record at
`.imm/state/batches/<batch_id>.json` (plan digest, branch, base head, and
budget), each child's TaskRecord, and the batch branch with its commits.

The question this decision record settles is what a resumed run may reconstruct
from those facts. A resumed run rebuilds its projection from them and reuses the
authorization only while it still binds: still running, same plan digest, same
branch, and the expected HEAD lineage. Elapsed time is not one of the
conditions. Anything else opens one
fresh native confirmation named with the reason, and the renewal rule requires a
strictly newer confirmation than the one it replaces.

## Decision

1. **Rebuild from durable facts and reuse only what still binds.** The binding
   is reconstructed from Kernel facts and the capability is re-issued in memory
   for the resumed process; nothing durable carries authority.
   `runtime/unattended/batch_preflight.ts` owns every decision on that path:
   `projectBatchPreflight` projects the durable facts into a resume or a fresh
   plan before any gate, `authorizeBatch` owns the reuse decision (it reuses an
   authorization only when no blocker among `batch_not_running`,
   `batch_plan_digest_changed`, `batch_branch_changed`, and
   `batch_head_lineage_moved` applies), and `projectBatchDrift` re-checks the
   live claim, the plan digest, and the HEAD lineage after the literal user
   confirmed. Both Host adapters call that shared flow and supply only their own
   gate, confirmation reference, and nonce; rendering stays Host-specific.
2. **A changed plan is not repaired by confirmation alone.** A first
   reconfirmation is eligible only before any batch commit, with the original
   ordered tasks/Slices/dependencies and branch/HEAD unchanged. The committed
   base Intents must reconstruct the old digest; a revised, already-settled
   in-flight child must have exact local-run terminal evidence and fresh
   assurance matching its current reviewed delivery. Pending children remain
   unchanged. Corrupt, historical, moved-HEAD and committed cases still refuse.
   Preflight captures read-only observations and rechecks them after the native
   answer. Those observations live only in the current process, associated with
   the fresh nonce; they grant no authority and disappear on application or
   process exit. The runner independently validates the capability and a
   strictly newer confirmation, then the existing state owner compares expected
   state bytes under its lock and atomically replaces only the orchestration
   binding. Completion reconciliation and the scope-bound commit follow that
   replacement. There is no durable receipt, authority reset, replayed
   Enrollment, or permission to widen topology or child/failure limits. A crash
   before replacement requires a new confirmation; after replacement, ordinary
   same-digest resume applies. This does not recover any prior failed live run.
3. **An authorization has no clock.** The literal user confirms a plan digest,
   a branch, a base head, `max_children`, and `qa_failure_limit`; those are the
   whole bound. A child parked on a foreground Review, or a gate left
   unanswered, waits for the user for as long as it takes: the native
   confirmation settles only on the user's answer or the caller's cancellation
   signal, and a resume reuses the authorization however much time has passed.
   A deadline added no protection the remaining bounds lack — the work a run
   may do is fixed by the digest and the child limit, not by when it happens —
   and it failed exactly the runs that were waiting on a human. Single-step
   Kernel and Enrollment capabilities follow the same rule: they are one-use
   and bound to their task, operation, record hash, and nonce, with no expiry.

## Rejected Alternatives

- **Persisting the capability, in whole or in encrypted form, as a resume aid.**
  The capability is a bearer token: a durable copy would be replayable authority
  at rest, and it would let a process that never saw the native confirmation mint
  authority from bytes. It would also make the strictly-newer-confirmation
  renewal rule unenforceable, because the old confirmation would still be valid
  material.
- **Keeping an expiry and widening the window so resumes rarely trip it.** Any
  finite window still turns a slow human answer into a failed run, and the
  window bounds nothing the plan digest, branch, HEAD lineage, and child limit
  do not already bound. The earlier form of this record kept the expiry as the
  budget deadline the literal user confirmed; that deadline is retired with it.
- **Treating a state file as proof that a literal user confirmed a plan**, and
  resuming without a gate on that basis.

## Consequences

- A crash costs at most one native confirmation, and only when something no
  longer binds; a resumed run never mints authority from bytes.
- The batch state record stays orchestration-only: it carries no authority
  material that a reader could mistake for a capability.
