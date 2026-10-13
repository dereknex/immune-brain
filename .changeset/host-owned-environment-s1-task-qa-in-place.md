---
"immune-brain": patch
---

Deterministic QA for a task now runs `prepare` and every check in the task's own working directory instead of a disposable copy, so a dependency already installed there is used as is. Before the first command and after each one, the tracked content inside the task's scope must equal the frozen snapshot; a difference fails as `protected_input_or_output_drift`, and the differing paths come back as `prepare_observation.drift_paths` in the direct Tool result only. Content outside the scope, and untracked or ignored files, are not compared. `environment.writable_paths` is still parsed and no longer restricts writes. The Lane batch integration recheck keeps the isolated copy, because its merge candidate is never checked out.
