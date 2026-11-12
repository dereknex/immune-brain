---
"immune-brain": patch
---

`restoreStagedIntent` now refreshes the whole Git index with `update-index -q --refresh` instead of `--refresh -- <sidecar>`. The path form exited 1 whenever any other tracked file had an unstaged change, so a failed or cancelled Intent revision, and the Antigravity `approve_breaking_intent_revision` preview, failed in a dirty worktree. The Parent final-verification decision (changed commands, `verify`/`repair`, whether a fresh native gate is needed) is now one function, `nativeParentFinalDecision`, shared by the real Parent entry and the Hook preview. A Hook preview that throws reports its cause on stderr before failing closed. A runtime refuses a second concurrent confirmation preview.

The Preparation digest no longer includes `generated_at` (8.1.3), so a digest issued by 8.1.2 no longer matches: an enrollment or batch confirmation that was open across the upgrade reports `enrollment preparation digest mismatch` and must be confirmed again.
