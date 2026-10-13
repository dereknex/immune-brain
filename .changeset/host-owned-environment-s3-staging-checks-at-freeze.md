---
"immune-brain": minor
---

The staging area is inspected when a snapshot is frozen, not before. The `status` Tool on both Hosts now returns the task projection while the scope holds unstaged or untracked paths and lists them in a `warnings` entry; `advance_assurance` and every other freeze still refuse them, and an in-scope path with a skip-worktree or assume-unchanged flag still refuses both. The Enrollment gate lists in-scope paths that are already staged, modified or untracked, and confirming it claims exactly those paths as task work instead of requiring a clean scope; an in-scope path dirtied after the gate text was built refuses the Enrollment. A scope revision made only of previous entries is now compatible and needs no confirmation.
