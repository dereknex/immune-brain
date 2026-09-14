---
"immune-brain": patch
---

A settled Initiative is no longer treated as a resume: `projectBatchPreflight` and `projectBatchDrift` now derive `is_resuming` once from the active batch record, so a fresh batch over a settled record issues the default 8h budget instead of inheriting an expired deadline from the old run (which made authorization impossible), while the settled record's children still replay from their own states instead of every child being reconstructed as `already_settled`.
