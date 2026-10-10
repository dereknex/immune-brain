---
"immune-brain": patch
---

Inside a batch Lane, the Pi extension and a new Claude Code `PreToolUse` hook refuse file edits and writes whose target is outside the Lane (shell commands are not intercepted). Re-entering a lane batch with a dirty coordinator checkout restores the leaked files only when every one is provably a Lane's bytes, backing them up reversibly and recording the backup in the batch report; otherwise nothing is touched. The dirty-tree refusal no longer suggests `git add`.
