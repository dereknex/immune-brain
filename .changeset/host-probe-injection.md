---
"immune-brain": patch
---

Inject the Host probe at each adapter's composition root instead of dispatching on `parentHost` inside the Claude adapter. `ClaudeRuntimeOptions` and `McpRuntimeOptions` take an optional `probeHost` defaulting to the Claude probe; `AntigravityRuntime` and `createAntigravityMcpRuntime` supply the Antigravity probe. The shared MCP runtime's three authority gates judge the session with that probe and name the actual Host in their refusals while the environment version fallback stays disabled. The Claude adapter no longer imports `runtime/antigravity/capability`, and the host-to-host baseline in `tests/runtime-layering-boundary.test.ts` and `docs/reference/layering-rules.md` shrinks to four edges owned by #414.
