---
"immune-brain": patch
---

Order implicit scope-overlap dependencies topologically along the declared blocked_by edges, with Slice order only breaking ties, so a plan whose Slice numbering disagrees with its dependencies no longer projects a cycle and is accepted by batch authorization.
