---
"@dereknex/immune-brain": patch
---

Restore compilation and the loop-daemon boundary contract after the unified Lane
session rebase (Slice `S1` of Spec `loop-leader-uls-alignment`). An
Initiative-shaped dispatch now fails its job with `lane_initiative_entry_pending`
and leaves the WorkItem retryable until the daemon's Initiative entry lands in
`S2`; the retired `executor_model` and `executor_effort` request fields leave
`loop_daemon/`. The loop-leader ADR is renumbered to ADR 0042 (it shared 0041
with the simplified-configuration ADR), and ADR 0041 no longer names the retired
judging role as a live one. No other user-visible change.
