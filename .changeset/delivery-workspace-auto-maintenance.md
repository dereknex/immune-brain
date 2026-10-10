---
"immune-brain": patch
---

Deterministic QA no longer fails intermittently with `protected_input_or_output_drift` on newer Git. The delivery workspace's Git commands now run with `maintenance.auto=false`, so `git fetch` no longer leaves a detached `git maintenance run --auto` that removes `.git/objects/maintenance.lock` after the workspace seal was taken.
