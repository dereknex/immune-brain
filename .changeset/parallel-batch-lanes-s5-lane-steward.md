---
"immune-brain": minor
---

Add the `lane-steward` internal role and Lane release (`parallel-batch-lanes` S5). The role supplies a Lane on the named branch at the named base, starts one allowlisted Executor Host (`claude-code` or `pi`) there, and reports "cannot supply" instead of improvising. After a child is integrated, its Lane is clean and its audit pair is reachable from the batch branch, the lane-mode report carries a release handoff; a later tick that observes the Lane path gone records the child `released`. The runner still never creates, switches or removes a worktree, and no new public skill is added.
