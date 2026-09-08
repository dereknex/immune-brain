---
"immune-brain": patch
---

Run one confirmed Initiative batch serially and resume it after a crash

A confirmed batch plan had no executor that could survive an interruption: a
child could be enrolled, settled and committed at three separate points, and
restarting the run re-derived none of them.

`startBatch` and `resumeBatch` now drive one eligible child at a time through
enroll → advance → commit, and a resumed run adopts whatever the previous
process had already persisted. Recovery shares the dependency-aware child
selection rule with the normal loop instead of re-implementing it, so a
reverse-ordered plan resumes identically to a forward-ordered one.

Renewed authorization no longer loses the consumption history of children that
were already committed. Before the next enrollment the driver verifies each
committed child against the batch commit ledger, so a stale or fabricated
`committed` flag cannot report a completed batch, and HEAD lineage stays
enforced for the first enrollment of a fresh authorization.

Persistence derives its path from a validated `batch_id` at every entrypoint,
so a caller cannot escape `.imm/state/batches/`, and the replan gate keeps
QA rework and Review rework on separate counters.
