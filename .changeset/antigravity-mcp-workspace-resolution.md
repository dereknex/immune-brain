---
"immune-brain": patch
---

Resolve the active Antigravity workspace per MCP tool call instead of the process `cwd`. `tools/call` `params._meta["antigravity.google/workspace_paths"][0]` wins, then the first `file://` root answered by MCP `roots/list` (cached until re-`initialize` or `notifications/roots/list_changed`), then `options.cwd ?? process.cwd()`, and the resolved path is bound on `ClaudeRuntime` before any tool runs. The Antigravity runtime trusts the `antigravity-client` and `antigravity` client names, `parseSemver` normalizes one optional leading `v`, and `serveStdio` delegates to the shared bidirectional transport so it can issue `roots/list`. Both bundled entrypoints now start only their own server, so `dist/antigravity/mcp-server.mjs` answers once per request.
