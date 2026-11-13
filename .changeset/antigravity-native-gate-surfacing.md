---
"immune-brain": patch
---

Require `toolPermission` `"request-review"` in `~/.gemini/antigravity-cli/settings.json` and an interactive `agy` ancestor (without `--dangerously-skip-permissions`, `--print`, or `-p`) before Antigravity `PreToolUse` writes a confirmation grant or returns `force_ask`, failing closed with observed cause and remediation when native dialogs cannot surface.
