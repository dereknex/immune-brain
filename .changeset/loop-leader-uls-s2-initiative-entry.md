---
"immune-brain": minor
---

Loop daemon Initiative entry through the session port (loop-leader ULS S2, D2 of docs/specs/loop-leader-uls-alignment.spec.md): replaces the S1 `lane_initiative_entry_pending` refusal with a real `driveInitiativeLane` that authorizes one v3 batch via `authorizeBatch` (`retain_branch`, `parent_relayed`, required final verification from the project's `batch.final_verification` commands) and starts it with `startLanes`, then advances it with `advanceLanes` on every tick. The batch id is written to `WorkItem.binding.batch_id` once and re-entered, never re-minted; a completed batch settles only with a passing final verification, and a rejected start is refused with its reason and leaves no record. Widens `entry_kind`, `batch_lanes` and `lane_sessions` to carry `initiative` alongside `single_task`.
