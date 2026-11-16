---
"immune-brain": patch
---

Cut redundant `git` subprocesses in the batch git port: `readTrackedDeclaration` no longer shells out to `git status` (trust rests on `ls-tree` + `git show HEAD:path` + byte comparison per ADR 0023 item 4; a staged-only drift is now correctly judged present), `rev-parse --git-common-dir` is memoized per worktree root, and selected `rev-parse` calls in preflight and workspace snapshots are merged with fallback to the original calls. Measured on `tests/unattended-batch-lanes.test.ts`: 12,435 → 9,672 git invocations (−22.2%, about 5.5 s per file on the local VM).
