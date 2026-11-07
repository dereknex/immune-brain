---
"immune-brain": patch
---

Ship Antigravity as an isolated, relocatable plugin at `plugins/immune-brain-antigravity/` with a native `.antigravity-plugin/plugin.json`, five native read-only role definitions, hooks that start without `PLUGIN_ROOT`, and the complete skill, CLI, runtime and role-prompt closure inside the directory. `agy plugin validate --strict` now passes. The shared-root Antigravity manifest, hooks, MCP config and bundle are retired: reinstall Antigravity from `plugins/immune-brain-antigravity/`. Pi and Claude Code roots are unchanged.
