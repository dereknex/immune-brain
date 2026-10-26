---
"immune-brain": patch
---

A running Lane batch on the Parent branch no longer re-integrates a critical task settled before the batch, commit and lookup treat refs/heads/imm/<slug> as a progress ref, and retire_stale_batch reads a Lane child's run from its own Lane store, so a stopped Lane child no longer blocks disposition.
