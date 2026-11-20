---
"@dereknex/immune-brain": minor
---

Make loop steering act on the item's unified-lane-sessions batch (Slice `S4` of
Spec `loop-leader-uls-alignment`). Abandoning a WorkItem now discards its batch:
each tick runs the new `discardLanes` until the record is terminal, stopping each
child session and closing it with `closeWithProof`, removing the Lane worktree and
`imm-lane/` branch of every child whose exit is proven and whose worktree is clean,
and deleting `imm/<slug>` only once every Lane is gone, then recording `discarded`.
A session whose ownership does not match, an unusable session provider or a dirty
worktree retains that Lane with a named `batch_lane_retained` condition and leaves
the record `discarding`, so the next tick retries only the retained parts. A
terminal batch's retained branch is never deleted, and Host `retire_stale_batch` is
unchanged.

`pause` now skips the item's batch on every drive pass and relayed advance, spending
no drive deadline and leaving sessions as they are. `resume` of an item with a batch
observes it first and exempts exactly one stall judgment, so an idle session at an
unchanged baseline is neither closed nor rotated on the first pass and is judged by
the normal `parent_relayed` rule on the second; an exited session is still handled
as exited.
