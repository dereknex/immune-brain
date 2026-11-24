---
"immune-brain": patch
---

`/immune-brain:revisit` no longer counts Claude Code's Stop hook feedback, `<bash-stdout>`/`<bash-stderr>` frames or `[Request interrupted by user]` markers as human input, and a bare `submit_review` whose Kernel result is `completed` or `rework` (the CLI Review path, where the verdict comes from the reviewer's result slot) is no longer reported as `review_without_verdict`.
