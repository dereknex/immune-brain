---
"immune-brain": minor
---

Add Lane sessions composition root (unified-lane-sessions S5, #570): `runtime/lane_sessions/` (`startLanes`, `advanceLanes`, `observeLanes`, `SessionPortAdapter`) is the sole module importing both `runtime/session/` and `runtime/unattended/`; Host entries switch to `authorizeBatch` plus `startLanes` on creation and `advanceLanes` on continuation, removing Host calls to `startBatch` and `executor_mode`; `v4_runtime.ts` routes read-only `imm-session await --batch` with D20 `next_action` (`advance`, `relay_dialog`, `ask_user`, `wait`, `complete`) while rejecting ungated `send|stop --batch`; `SessionPortAdapter` maps provider `pane_not_found` to `exited` and other failures to `unknown`.
