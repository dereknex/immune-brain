---
"immune-brain": minor
---

Add BatchSessionPort and child session reconciler (unified-lane-sessions S4, #570): `runtime/unattended/batch_session_port.ts` owns `SessionObservation`, structural `SessionExitProof` and bounded `laneSessionKey` with `LANE_EXECUTOR_ENV=headless` for parent-relayed opens; `child_session_reconciler.ts` drives write-ahead keys, `find` recovery, dialog holds, revision progress and `interaction_mode`-dependent stalls with recorded instruction/correction handling; `advanceBatch` records `session_provider`, refuses provider mismatch with `lane_session_unavailable` and persists per-child sessions.
