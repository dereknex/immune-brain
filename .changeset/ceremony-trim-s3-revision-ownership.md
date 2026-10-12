---
"immune-brain": minor
---

A session whose latest phase entry is a plan entry can no longer edit files inside the scope of a Managed task that is active in the workspace: both Hosts refuse the file-edit tool call with `revision_owner_required` and one recovery action (return the proposal to the executing session). The guard covers file-edit tools only, not shell commands, and leaves planning sidecars under `docs/plans` and `docs/specs`, paths outside the scope, runs without an active claim, and an unreadable entry store alone. `PhaseEntryState` now reports a latest plan entry without changing its run-entry transitions. The Planner and Loop contracts state that the Loop owner prepares scope and acceptance revisions in the executing session (#218).
