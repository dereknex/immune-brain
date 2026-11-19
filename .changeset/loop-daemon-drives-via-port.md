---
"immune-brain": minor
---

Loop daemon drives via the session port (unified-lane-sessions S8, #570): daemon `drive` builds its agreement via `authorizeBatch` (`LOOP_DAEMON_ACTOR_ID`, `tracker_approval` or `policy_auto`, `return_policy` `retain_branch`, `interaction_mode` `parent_relayed`) plus `startLanes` on creation and `advanceLanes` on every tick, escalating startup-blocked and entry-unsubmitted dialogs via `planEscalation`, and gates pull requests on the settled v3 Batch Record commit plus the `.imm/audit/` verification digest; deletes `startBatch`, `batch_runner.ts`, `lane_supervisor.ts`, `exit_recorder.ts`, `tests/lane-supervisor.test.ts` and `.imm/state/lane-supervisors/`, renames `ExecutorPreferences` keys to `host`/`model`/`effort`, and surfaces `lane_decision_required` on engine reports.
