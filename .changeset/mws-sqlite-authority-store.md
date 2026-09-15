---
"immune-brain": patch
---

Move worktree authority to one SQLite transaction boundary (`.imm/state/kernel.sqlite`). Runs, lifecycle, revisions, findings, attestations and operation outcomes now commit atomically, so a lost response replays from committed facts and an interrupted audit export stays retryable instead of reactivating a settled task. The workspace owner is derived from the single active run, execution identity is bound per run, and each worktree keeps its own owner, so a store copied from another worktree is refused. The retired file-store writer (`active-claim.json`, `workspace.json`, `tasks/`, transaction markers) is never read or written again: a leftover derived file is inert, real authority in the retired store fails closed with one recovery action.
