---
"immune-brain": minor
---

Claude Code now refuses `enroll` and `start_unattended_batch` with `run_entry_required` unless the user entered `imm-run` in the session, and refuses a model Skill call for `imm-planner`, `imm-brainstorm` or `imm-run` with `phase_entry_required` unless the user's latest prompt entered that phase (ADR 0019).
