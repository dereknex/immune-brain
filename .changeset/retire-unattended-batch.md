---
"immune-brain": major
---

Retire the unattended batch, Lane supervision, and in-repo Loop daemon subsystems under ADR 0043 (Slices 1 and 3), restoring single-task in-place `/drive` as the sole Managed execution loop:

- Restore single-task in-place `enroll` across `HostRuntime`, Claude Code MCP, Antigravity MCP, and the Pi `.pi-extension` under literal-user `drive` phase entry and native confirmation, enforcing strict `singleTaskEnrollmentDirt` clean-workspace checks (`workspace_not_clean` outside the task's `TaskIntent` and bound `Spec`) before any Kernel write while preserving `imm-session` + `runtime/session/` for Herdr Authority Review, `imm-kernel intent overlap`, and settled parent completion for `imm-tracker`.
- Physically delete `runtime/unattended/`, `runtime/lane_sessions/`, `runtime/kernel/batch_authority.ts`, `.pi-extension/imm-unattended-batch.ts`, `dist/drive-batch.md`, and `lane-steward`; remove `start_unattended_batch`, `retire_stale_batch`, and `imm-session --batch` across Hosts, hooks, and CLI routing; and strictly retire `batch` and `session_providers` from `v2` config (`config_invalid`, stripped by `imm-kernel config migrate --write`, while keeping `agents.executor` accepted-but-unused).
- Document ADR 0043 Slice 1 breaking retirement (since `v10.0.0`): remove the in-repo Loop daemon (`runtime/loop_daemon/`, `bin/imm-loop`, `skills/imm-loop/`, `runtime/decision_model/`), remove `loop_interactions` / `answer_loop_interaction` / `steer_loop_work_item` and live `tracker_approval` / `policy_auto` confirmation sources, and strictly retire `loop` and `decision_models` from `v2` config (`config_invalid`, stripped by `imm-kernel config migrate --write`).
