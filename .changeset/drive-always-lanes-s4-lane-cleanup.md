---
"immune-brain": minor
---

Remove a delivered single-task Lane, its `imm-lane/` branch and `imm/<task_id>` only on a runtime-observed normal exit of the current Executor generation and a clean Lane; otherwise retain it and report `batch_lane_retained` with the failed condition.
