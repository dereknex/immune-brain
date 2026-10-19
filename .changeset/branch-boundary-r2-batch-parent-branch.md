---
"immune-brain": minor
---

Run new Lane batches on a Parent branch without modifying the coordinator checkout. Create child worktrees at the Parent tip, remove clean integrated Lanes, retain and report dirty Lanes, and run final verification in a disposable detached worktree. Retire lane_offers for new batches while preserving existing hidden-ref and legacy branch runs.
