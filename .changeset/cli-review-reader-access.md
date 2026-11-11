---
"immune-brain": patch
---

The claude-code CLI reviewer now reads its own Review packet and evidence directories and runs its allowlisted git commands. `reviewArguments` passes `--add-dir` for the packet directory and the evidence directory, placed before `--max-turns` so the variadic flag never swallows the prompt, and `--settings` with `disableAllHooks: true`, so a user PreToolUse hook that rewrites `git diff` no longer falls outside `--allowedTools` under `dontAsk`, and `BASH_MAX_OUTPUT_LENGTH` of 150000, so a whole reviewed file fits. The packet directory is resolved to its real path. Pi and Antigravity reviewer arguments are unchanged (#447).
