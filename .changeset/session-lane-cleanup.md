---
"immune-brain": minor
---

Add two-tier proof-based Lane cleanup (unified-lane-sessions S6, #570): for every integrated child `advanceBatch` calls `BatchSessionPort.closeWithProof(handle, key)`; only a proven `exited` bound to `(handle, key)` plus clean-Lane Git checks removes the worktree and `imm-lane/<slug>/<task_id>` recording `lane_removed` with the `SessionExitProof`, leaving siblings and `refs/heads/imm/<slug>` untouched; whole-batch `checkout_delivery` success deletes `refs/heads/imm/<slug>` (kept under `retain_branch`); any failed proof or Git condition retains with `batch_lane_retained`, parked/stopped/redo never removed; `session_closes` and `closeRecordUnproven` retire, `imm-session close` takes `--session-key`.
