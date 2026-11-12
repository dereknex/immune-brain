---
"immune-brain": patch
---

A claude-code reviewer now runs with `--plugin-dir` set to the Claude plugin root the Kernel runtime was loaded from. Without it the reviewer loaded the user-installed immune-brain, whose `authority-review` skill pinned an older review contract hash, so every Review was released as `review_contract_mismatch` whenever the Parent ran a different plugin build (for example through `claude --plugin-dir`). The Antigravity copy carries no Claude manifest and keeps the previous argv.
