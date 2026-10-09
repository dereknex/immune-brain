---
"immune-brain": minor
---

Run several Lanes at once (`parallel-batch-lanes` S4). With `max_parallel` above 1 the lane-mode batch keeps up to that many scope-disjoint children in flight, reports one `provision` or `executor` handoff per child in `handoffs[]`, and integrates settled children serially. A child whose scope overlaps an in-flight Lane waits; a parked, lost (`batch_lane_lost`) or QA-exhausted child ends only itself and its dependents while disjoint siblings keep moving; `qa_failure_limit` counts each child separately. `batch_parallel_unsupported` no longer occurs. A batch without `max_parallel` stays the serial v1 run.
