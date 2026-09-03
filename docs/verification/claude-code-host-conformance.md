# Claude Code Host Conformance

This file is review evidence for real Host interaction. It is not a QA attestation and not Kernel authority. Final critical user authorization accepts or rejects this HITL evidence.

minimum_version: 2.1.199
current_version: 2.1.236
package_version: 2.8.3
platform: darwin/arm64
plugin_validate: pass
authority: hitl-evidence

## Evidence classes

Every scenario row below labels exactly one class, and each class is defined once here:

- `real-host` — observed on the installed Claude Code 2.1.236 CLI in actual sessions on this machine; command, session id, and observed output recorded under "Real-Host observations".
- `contract-fixture` — verified by deterministic tests that drive the shipped MCP server and Kernel fixtures end to end; the referenced test file and test name is the evidence, not a live session.
- `hitl-final` — the live interactive acceptance itself; exercised by the user at final critical user authorization, not recorded as QA evidence.

## Real-Host observations (Claude Code 2.1.236, darwin/arm64)

Recorded 2026-09-03 from real `claude -p` sessions launched with `--plugin-dir plugins/immune-brain --allowedTools mcp__plugin_immune-brain_immune-brain__*`:

- CLI envelope: `claude --version` → `2.1.236 (Claude Code)`; `claude plugin validate --strict plugins/immune-brain` → `Validation passed` (exit 0); plugin 2.8.3 from `.claude-plugin/plugin.json`, MCP server loads `dist/claude/mcp-server.mjs`.
- Real MCP handshake (wire capture): `initialize` params carry `clientInfo {name: "claude-code", version: "2.1.236"}` and `capabilities {roots: {listChanged: true}, elicitation: {}}` — the Host declares the elicitation capability in every session, including headless `-p`.
- Real `tools/call` wire format (capture from a live session): `_meta = {"claudecode/toolUseId": "toolu_…", "progressToken": N}` with no `session_id` key. Correlation of Host session identity is therefore bridged through the hook-observed `ElicitationResult` record for that exact tool call (see "Wire correlation" below).
- Real status round-trip: a live session called `status` for the active Kernel task and received the real projection (error `null`, revision, blocking findings, and replan state rendered from `.imm`).
- Real permission denial: a live session without tool pre-approval was denied by the Host permission gate (`tool_use_result` status `non_execution`, reason user-rejected); Kernel mutation count stayed 0.
- Real privileged fail-closed: live sessions calling the privileged `stop` tool (pre-approved headless, so no native permission dialog fired and no `ElicitationResult` record exists) were rejected with `host correlation metadata missing` before any authority write. Pre-approved or bypassed execution cannot mint authority.
- Real hook events: `PostToolUse` and `SessionEnd` events for real session ids landed in `$TMPDIR/immune-brain-claude/<sha256(session)>.jsonl` with directory mode 0700 and file mode 0600; `SessionEnd` cleanup removes the per-session file after drain.

## Wire correlation (real-host gap found and fixed during this review round)

The 2.1.236 wire sends only the namespaced tool-use id (`claudecode/toolUseId`) in `_meta`; it never sends `session_id`. The Host session binding is taken from the hook-observed `ElicitationResult` record for that exact tool call, so the correlation bridge is: tool call → matching unconsumed `ElicitationResult` → its `sessionId`. Missing record, consumed record, or an ambiguous match across sessions fails closed with `host correlation metadata missing`. Regression coverage: `tests/claude-host-authority.test.ts` — "real Claude Code wire correlation bridges session identity through the ElicitationResult record" and "ambiguous wire correlation across sessions fails closed".

## Observed Host

- Declared minimum: `2.1.199`. Capability probe rejects `2.1.198` and native Windows before any authority write.
- Installed current CLI: `claude --version` → `2.1.236 (Claude Code)` on Darwin (real-host).
- `claude plugin validate --strict plugins/immune-brain` → `Validation passed` (exit 0) (real-host).
- Plugin root uses `${CLAUDE_PLUGIN_ROOT}` for MCP/Hooks and ships `dist/claude/mcp-server.mjs`.
- Live TUI elicitation accepts at current CLI 2.1.236 are HITL evidence for final user authorization, not QA: the interactive permission dialog → `ElicitationResult` accept → capability mint chain runs in a real interactive session only.
- Tool arguments cannot supply `native_decision`. Privileged JSON-RPC consumes an independently observed `ElicitationResult` Hook bound to session and tool call, then deletes that event from the persistent log.

## Scenarios

- [x] `native_manual`: pass — real-host fail-closed boundaries observed (no-record privileged call rejected, permission denial zero-mutation); accept-binding correlation verified with the real wire format in `tests/claude-host-authority.test.ts` ("real Claude Code wire correlation bridges session identity through the ElicitationResult record"); the live accept click is hitl-final.
- [x] `native_acceptEdits`: pass — contract-fixture: `tests/claude-host-authority.test.ts` drives the permission-mode matrix; the annotation and an observed `ElicitationResult` accept remain required in `acceptEdits` mode, missing annotation fails closed.
- [x] `native_auto`: pass — contract-fixture: `tests/claude-host-authority.test.ts`; `auto` mode still requires the interaction annotation and an observed accept.
- [x] `native_bypassPermissions`: pass — real-host equivalent observed (headless pre-approved privileged call rejected with `host correlation metadata missing`); contract-fixture matrix in `tests/claude-host-authority.test.ts` covers the declared bypass mode.
- [x] `native_dontAsk`: pass — contract-fixture: `tests/claude-host-authority.test.ts`; `dontAsk` fails closed before capability mint.
- [x] `risk_routine`: pass — contract-fixture: `tests/claude-host-authority.test.ts` settles routine without Review against Kernel fixtures.
- [x] `risk_material`: pass — contract-fixture: ordered SubagentStart / Agent / SubagentStop receipts including FileHookEventLog IPC from a separate Hook writer process settle material Review (`tests/claude-host-authority.test.ts`, "ordered Claude Review receipts settle material tasks").
- [x] `risk_critical`: pass — contract-fixture: `tests/dual-host-assurance-conformance.test.ts`, "Claude independently completes routine, material, and critical projections"; Claude adapter leaves `authorize_user` after Review.
- [x] `denial`: pass — real-host (live permission denial observed, zero mutations) plus contract-fixture: observed `ElicitationResult` deny on enroll throws and applyCount stays 0 (`tests/claude-host-authority.test.ts`).
- [x] `cancellation`: pass — contract-fixture: observed `ElicitationResult` cancel fails closed before Kernel mutation; `notifications/cancelled` aborts in-flight `advance` (`tests/claude-host-authority.test.ts`).
- [x] `review_event_order`: pass — contract-fixture: missing, reordered, wrong-task, stale, malformed, and replayed receipts fail before a second mutation (`tests/claude-host-authority.test.ts`, "missing, reordered, wrong-task, stale, malformed, and replayed Review evidence fail before a second mutation").
- [x] `resume_pi_to_claude`: pass — contract-fixture: dual-host fixture resumes `run_review` from Pi into a new Claude coordinator without handoff state (`tests/dual-host-assurance-conformance.test.ts`).
- [x] `resume_claude_to_pi`: pass — contract-fixture: dual-host fixture resumes `run_review` from Claude into a new Pi coordinator without handoff state (`tests/dual-host-assurance-conformance.test.ts`).
- [x] `stale_rejection`: pass — contract-fixture: changed record revision fails closed (`tests/claude-host-authority.test.ts`); Claude versions below 2.1.199 fail the capability probe (`tests/claude-host-package.test.ts`).
- [x] `concurrent_rejection`: pass — contract-fixture: shared Kernel fixture serializes applyVerdict across two Claude coordinators (`tests/claude-host-authority.test.ts`).
- [x] `plugin_removal_recovery`: pass — contract-fixture: Pi package files remain after Claude plugin paths are treated as additive; Kernel TaskRecord bytes do not encode adapter identity (`tests/claude-host-authority.test.ts`).

## Notes

`plugin_validate: pass` is the installed Claude Code 2.1.236 CLI observation. Confirmations are independently observed `ElicitationResult` Hooks, not JSON-RPC arguments. Real sessions on 2.1.236 declare the elicitation capability and send only `claudecode/toolUseId` on the wire; Host session identity is bridged from the hook record and fails closed without it. This report remains HITL evidence, not a QA attestation and not Kernel authority.
