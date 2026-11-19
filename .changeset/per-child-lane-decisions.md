---
"immune-brain": minor
---

Add per-child Lane decisions (unified-lane-sessions S7, #570): `findActiveLaneBatchForTask(root, taskId)` fails closed on corrupt or ambiguous matches so `findLaneRelayTarget` and breaking-revision approval reach any child of a single-task or Initiative batch through `rebindBatchChildIdentity` and `hasContiguousLaneRebind`; relayed decisions trigger `advanceLanes` resetting `no_progress` while siblings are untouched, native-gated stop closes only that child's session via `BatchSessionPort.stop` parking `lane_executor_stopped` and retaining its Lane, and `coordinator: correct` rotates to `g(n+1)`. Also persist the entry kind opaquely through the session composition root so single-task re-entry matches, and resume parked batches against the fresh authorization and the record's identities.
