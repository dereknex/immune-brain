---
"immune-brain": patch
---

Exclude a batch Child at planning time when its TaskIntent cannot name its bound Spec pair, instead of offering it for confirmation and having enrollment refuse it later. The batch plan reuses the same shared `spec_binding` predicate enrollment uses and reports a stable reason that names every path the intent must add; critical-child exclusion, dependency order, skipping, and the plan digest are unchanged.
