---
"immune-brain": patch
---

Antigravity `start_unattended_batch` and `retire_stale_batch` no longer refuse every call with `run_entry_required: A gated call needs exact Hook session and workspace correlation`. The shared MCP runtime required a Claude-only `.continuation-call` correlation before reading the `PreToolUse` admission, and only skipped that requirement when a test injected an admission port, so the production Antigravity server never reached its admission. The single-use admission, already bound to its call, operation, Hook session, live drive entry and workspace, is now the gated call's correlation on every Host, and the Claude admission names its Hook session. The redundant unversioned-Host check, the unused `true` admission, the duplicated `start_unattended_batch`/`retire_stale_batch` gate and the two Claude-only fields Antigravity's profile carried are removed. A trusted client with an unsupported Host version is now refused for its version before its interaction capability.

Antigravity's `PreToolUse` now denies a gated call that has no live drive entry, as Claude Code's hook does, instead of opening a `force_ask` confirmation that the server would refuse anyway. `force_ask` remains the native confirmation for an admitted call (ADR 0004, `antigravity-harness` spec §3).
