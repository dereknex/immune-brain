---
"immune-brain": patch
---

A claude-code reviewer and verifier now run with `--settings '{"disableAllHooks":true}'`. A user PreToolUse hook that rewrites shell commands (for example into `rtk git …`) made every `Bash(git …:*)` allow rule miss, so `dontAsk` denied all git reads and the Review ended with no inspected paths. The receipt still comes from the output file; user settings, plugins and the `authority-review` skill still load.
