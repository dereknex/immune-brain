---
"immune-brain": patch
---

Resolve packaged internal role prompts from the shipped bundle layout

`loadRolePrompt` walked one directory up from the module that contains it and
looked for `dist/role-prompts/`. That is correct from source, where the module
sits in `runtime/` beside `dist/`, but the Claude Code Host loads the bundle at
`dist/claude/mcp-server.mjs`, where the same walk computes a `dist/dist/` that
never exists. Every internal role prompt therefore failed to load on the Claude
Host, blocking Review delegation. The resolver now searches both layouts.
