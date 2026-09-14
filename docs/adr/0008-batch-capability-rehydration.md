---
status: proposed
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

Today a resumed run rebuilds its projection from those facts and reuses the
authorization only while it still binds: unexpired, still running, same plan
digest, same branch, and the expected HEAD lineage. Anything else opens one
fresh native confirmation named with the reason, and the renewal rule requires a
strictly newer confirmation than the one it replaces.

## Decision

Not settled. The options are:

1. **Rebuild from durable facts and reuse only what still binds (shipped).**
   The binding is reconstructed from Kernel facts; the capability itself is
   re-issued in memory for the resumed process. Both Host adapters share the
   preflight that decides this in `runtime/unattended/batch_preflight.ts`, and
   the expiry follows the literal user's confirmed budget deadline.
2. **Persist the capability so a crash rehydrates it directly.** The capability
   is a bearer token: a durable copy would be replayable authority at rest, and
   it would let a process that never saw the native confirmation mint authority
   from bytes. It would also make the strictly-newer-confirmation renewal rule
   unenforceable, because the old confirmation would still be valid material.
3. **Widen the authorization window so resumes rarely trip the expiry check.**
   This was already settled against: the expiry derives from the budget deadline
   the literal user confirmed, and lengthening it silently pre-authorizes work
   beyond the confirmed budget.

Recommendation: keep option 1. The evidence that must survive a crash is exactly
the durable set above, every element of which the Kernel already owns; anything
that does not survive it opens one fresh gate rather than reconstructing
authority from a file.

## Rejected Alternatives

- Persisting the capability, in whole or in encrypted form, as a resume aid.
- Treating a state file as proof that a literal user confirmed a plan, and
  resuming without a gate on that basis.
- Extending the expiry on resume to avoid a second gate.

## Consequences

- A crash costs at most one native confirmation, and only when something no
  longer binds; a resumed run never mints authority from bytes.
- The batch state record stays orchestration-only: it carries no authority
  material that a reader could mistake for a capability.
