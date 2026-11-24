---
"immune-brain": patch
---

A non-`critical` single-task `drive` no longer inherits the project-wide `batch.final_verification`. It uses the new `batch.single_task_final_verification` list when configured and otherwise records no commands with final verification optional; `critical` tasks still inherit `batch.final_verification`, and commands passed by the caller still win. With no commands, declared derived-file checks still run and now block checkout delivery when they fail. The drive contract tells the Parent to pass only literally requested commands for a single task, leaving the full suite to the PR's CI.
