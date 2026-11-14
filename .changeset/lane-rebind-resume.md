---
"immune-brain": patch
---

Recompute `plan_digest` and record `lane_rebinds` on single-task Lane identity rebinds so resuming a parked single-task batch reads the rebound identity from the record instead of refusing `plan_changed`.
