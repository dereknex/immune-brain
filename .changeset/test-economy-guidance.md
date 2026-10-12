---
"immune-brain": patch
---

Executor now pins each added test to one acceptance invariant or finding at its public seam, reuses existing tests before adding new ones, and retires tests for behavior a change retires; Code Review treats test-suite growth as advisory only, while weakened or missing acceptance tests stay blocking (#205).
