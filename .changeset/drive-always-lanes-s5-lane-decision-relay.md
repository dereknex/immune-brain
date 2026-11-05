---
"immune-brain": minor
---

Answer a single-task Lane's literal-user decision (resolve a user decision, authorize rework or review retry, approve a breaking revision, or stop) at the Parent Host's native gate: the runtime applies it to the Lane store, rebinds the batch's approved identity for a breaking revision, and starts the next Executor generation. Initiative batch children keep their behavior.

Also fix four defects the relay exposed in single-task Lane supervision: the batch report no longer drops `lane_decision_required` when the Executor exits, Pi mutations no longer fail layout checks once a Lane Executor has run (`.imm/state/lane-supervisors/` is a recognised state path), a Parent poll retries a transient `Kernel recovery projection changed` instead of aborting, and an Executor exit between two calls is recorded as handled so the next call starts generation N+1.
