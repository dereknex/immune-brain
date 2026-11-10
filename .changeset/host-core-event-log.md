---
"immune-brain": patch
---

Adapter machinery both Hosts share now lives once in the new host-neutral layer `plugins/immune-brain/runtime/host-core/`, which ADR 0038 and the layering reference record under `kernel ← assurance ← host-core ← adapter`. Slice S1 moves the hook event log and its private-file helpers there: the Claude Code and Antigravity adapters keep no copy, so the Antigravity log gains the ownership check, the `0700`/`0600` modes and the `O_NOFOLLOW` open it lacked, and its `sessions()` returns session ids instead of file-name hashes. Antigravity's `--hook` also appends the start event of an allowed `invoke_subagent` / `Subagent` dispatch, which the matching `PostToolUse` already terminated. `tests/runtime-layering-boundary.test.ts` gains a rule refusing a `kernel/` or `assurance/` import of `host-core`. Verifier state machines, runtimes, the MCP runtime and run continuation are unchanged; no user-visible behavior changes (#414).
