---
"immune-brain": minor
---

Loop leader resolve alignment with unified lane sessions (loop-leader ULS S5, D5 of docs/specs/loop-leader-uls-alignment.spec.md): `resume` now applies only to an escalated WorkItem with no batch blocker, while a `needs_human` batch or a child parked `lane_executor_no_progress` admits only `ask_owner` (the recorded amendment of loop-leader D4 and S4-AC1). A Lane dialog is asked once, as a labelled `lane_entry_blocked` escalation that a leader `ask_owner` annotates in place and that the briefing lists as a pending interaction. `lane_session_unavailable` never counts as a refusal or replan round, never changes the briefing fingerprint or leader wake count, and shows as `environment_blocked_items` in `imm-loop status --json`. Batch lookup goes through `findActiveLaneBatchForTask` (two active batches for one task refuse), and briefing batches carry each child's `v3` session generation, `no_progress` and `attention`.
