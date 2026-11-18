# Unified Lane Sessions

Initiative for #570. Spec: [docs/specs/unified-lane-sessions.spec.md](../specs/unified-lane-sessions.spec.md).

Host Parents and the Loop daemon each build one self-contained `BatchAgreement` (`confirmation`, `final_verification`, `return_policy`, `interaction_mode`) via `authorizeBatch` and drive execution through the `runtime/lane_sessions/` composition root (`startLanes` on creation, `advanceLanes` on re-entry and ticks, `observeLanes` for read-only waiting), which resolves a session provider once from `session_providers` through a role-indexed capability registry and lets `advanceBatch` + `child_session_reconciler.ts` reconcile every child's session through an injected `BatchSessionPort` with write-ahead `laneSessionKey` and `closeWithProof`; integrated children remove their own worktree and `imm-lane/` branch on exit proof while `return_policy` governs `imm/<slug>`, decisions and `lane_rebinds` work per child by `task_id`, the daemon gates PRs on `v3` Batch Record commits and `.imm/audit/` digests, `startBatch`, `LaneSupervisor` and `exit_recorder.ts` are deleted, and the `herdr` key is retired.

## S1: herdr is a retired key, session_providers parses, and Host single-task entries open a tab inside Herdr
Tasks:
- session-provider-config

## S2: session providers are role-indexed capability descriptors with bounded session keys, lookup, closeWithProof, and one conformance suite
Blocked by: session-provider-config
Tasks:
- session-provider-registry

## S3: a proven Initiative lane_rebinds and a self-contained BatchAgreement define batch_run_state v3 with no plan_source in execution modules
Blocked by: session-provider-registry
Tasks:
- batch-agreement-v3

## S4: advanceBatch and child_session_reconciler reconcile every child session over BatchSessionPort
Blocked by: batch-agreement-v3
Tasks:
- batch-session-port

## S5: Host entries run through authorizeBatch and runtime/lane_sessions/ with read-only await routing and next_action
Blocked by: batch-session-port
Tasks:
- host-entries-via-lane-sessions

## S6: two-tier proof-based cleanup removes integrated child Lanes and governs batch branches by return_policy
Blocked by: host-entries-via-lane-sessions
Tasks:
- session-lane-cleanup

## S7: literal-user decisions, stop, coordinator corrections, and lane_rebinds apply to any child by task_id
Blocked by: session-lane-cleanup
Tasks:
- per-child-lane-decisions

## S8: the Loop daemon drives via runtime/lane_sessions/, gates PRs on audit evidence, and deletes startBatch, LaneSupervisor, and exit_recorder
Blocked by: per-child-lane-decisions
Tasks:
- loop-daemon-drives-via-port
