---
"immune-brain": minor
---

Report parallel start groups in the unattended Batch Plan and add the pure scheduling function behind them (`parallel-batch-lanes` S1). The new `runtime/unattended/batch_schedule.ts` returns the startable children for a batch: a pending child starts when every dependency is done, its scope is provably disjoint from every in-flight child, and the in-flight count stays below `max_parallel`. Identical, prefix-nested, wildcard and unprovable scopes are treated as overlapping and serialize, and with a limit of 1 the choice is exactly the serial runner's. `projectBatchPlan` additively reports `parallel_groups` (start waves) and `scope_conflicts` (children held back by an overlapping sibling); `plan_digest` and every existing plan field are unchanged. No tool parameter and no persisted-state change, so serial batches behave as before.
