---
"immune-brain": minor
---

Pi now refuses `imm_canary_enrollment` and `start_unattended_batch` with `run_entry_required` before the authority dialog unless the user entered `imm-run` in the session; a later planner or brainstorm entry revokes it. Both Hosts return the same reason code and recovery action (ADR 0019).
