# Loop Leader on Unified Lane Sessions

Initiative aligning the loop leader (`loop-leader.spec.md`) with Unified Lane Sessions v4.1 (#570). Spec: `loop-leader-uls-alignment.spec.md`. ADR 0043 removed the Loop daemon and both Specs; see Git history.

The rebased loop leader compiles and passes its boundary tests; an Initiative-shaped work item runs as one `v3` batch through `startLanes` / `advanceLanes` with batch final verification, records its `batch_id` on the WorkItem and opens exactly one PR from `imm/<slug>` gated on every child's audit digest; `abandon` discards the batch with proof-based session and branch cleanup while `pause` freezes daemon reconciliation; and leader resolve follows the ULS recovery rules, asks each Lane dialog once, and ignores environmental `lane_session_unavailable` refusals in its counters.

## S1: the rebased loop leader compiles, passes its boundary tests, refuses Initiative drives pending S2, and cites ADR 0042
Tasks:
- loop-leader-uls-s1-compile-contract

## S2: an Initiative-shaped work item runs as one v3 batch re-entered every tick with batch final verification
Blocked by: loop-leader-uls-s1-compile-contract
Tasks:
- loop-leader-uls-s2-initiative-entry

## S3: a completed Initiative batch opens one PR from imm/<slug> gated on every child's audit digest
Blocked by: loop-leader-uls-s2-initiative-entry
Tasks:
- loop-leader-uls-s3-initiative-pr-gate

## S4: abandon discards the batch with proof-based cleanup and pause freezes its reconciliation
Blocked by: loop-leader-uls-s2-initiative-entry
Tasks:
- loop-leader-uls-s4-discard-pause

## S5: leader resolve follows ULS recovery, asks each Lane dialog once, and ignores environmental refusals
Blocked by: loop-leader-uls-s1-compile-contract
Tasks:
- loop-leader-uls-s5-resolve-alignment
