---
"immune-brain": patch
---

Align the retired file-store residue classification between `inspectStorageLayout` and the mutation guard: an empty `.imm/state/tasks` directory and an ownerless `.imm/state/workspace.json` (`current_working: null`) no longer fail every Kernel mutation closed in a worktree with a valid SQLite store, while any other residue — non-empty task directories, malformed or unknown workspace content, symlinks and unreadable paths — is now rejected consistently by both the inspection and the locked-mutation guard.
