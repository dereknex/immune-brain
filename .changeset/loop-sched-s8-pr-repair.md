---
"immune-brain": minor
---

Give PR repair sessions the inputs they need. CI repair now receives the failing check's bounded log excerpt and its details URL; a conflicted rebase keeps the conflicted tree, resolves it in a repair session, and pushes back with `--force-with-lease` only to a branch the daemon created; the review comments of one PR head are batched into a single session and a single push that carries each comment's path, line and diff hunk; and the PR worktree is fetched and reset to the PR head before any repair. No user-visible change: only the repair path differs; pushes look the same.
