---
"immune-brain": patch
---

Add `retire_stale_batch`: one literal-user disposition that retires a batch record the plan moved past, preserving its children, commits, lane bindings, and report while granting no handoff and no approval. A mid-flight child, a record that moved during the gate, and a non-interactive Host are refused with zero writes.
