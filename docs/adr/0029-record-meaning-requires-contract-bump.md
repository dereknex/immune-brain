---
status: accepted
---

# Record meaning requires a contract bump

A change in a persisted record's meaning requires a new contract id, even when its fields still parse. Readers must refuse a newer id of their own record family rather than skip it or infer its meaning from the fields.

The Parent-branch change kept `assurance_kernel/batch_run_state/v2` while changing what `branch` meant, so older runtimes accepted the record and reported misleading lineage failures. A separate minimum-runtime version would duplicate the contract boundary and would not repair readers that silently skip unknown contracts.

Deploy fail-closed readers before the next meaning change bumps the contract. This task does not write v3 or migrate v2: released readers still skip unknown contracts, so a bump now could let them offer a fresh batch beside an existing one. See [the bound Spec](../specs/batch-runtime-skew-refusal.spec.md).
