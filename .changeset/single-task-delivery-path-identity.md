---
"immune-brain": patch
---

Make single-task manual checkout delivery succeed per delivered path. A path that already sits in the coordinator checkout with identical index mode and blob, worktree bytes and executable bit (or a delivered deletion already absent) is satisfied and left untouched, so the coordinator can keep the task's own planning sidecar while the same file is part of the delivery. Every other path still blocks on a dirty overlap and is never overwritten; auto mode and whole-delivery replay semantics are unchanged.
