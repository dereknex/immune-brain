---
contract: immune_brain/claude_native_elicitation_conformance/v1
observed_at: 2026-09-04
platform: darwin-arm64
plugin_version: 3.4.0
claude_code_version: 2.1.236
minimum_supported_version: 2.1.236
mcp_protocol: 2025-06-18
evidence_class: real-host-conformance
---

# Claude native elicitation conformance

This report records a foreground run against the locally installed Claude Code
CLI and the source-built Immune-Brain plugin. It is release evidence, not a
Kernel attestation or user authority artifact. The interactive control choices
were driven through a PTY harness against an isolated temporary Git repository;
no result is represented as a human authorization for production work.

## Binding

- Claude Code: `2.1.236 (Claude Code)`
- Immune-Brain plugin: `3.4.0`
- MCP initialize negotiation: `2025-06-18`, client `claude-code/2.1.236`, `elicitation: {}` advertised
- Plugin runtime: `plugins/immune-brain/dist/claude/mcp-server.mjs`, freshly built from `runtime/claude/mcp_server.ts`
- Fixture task: `native-elicit-conformance` in an isolated temporary Git repository

The native prompt displayed `Operation: enroll` plus the bound task, risk,
intent revision, intent content hash, and preparation digest. The response was
a nested JSON-RPC response to the server-originated `elicitation/create`
request on the live MCP connection.

## Scenarios

| Scenario | Host mode | Observation | Authority result |
| --- | --- | --- | --- |
| Plan-only | `acceptEdits`, real `imm-planner` Skill | Candidate Spec was written; authoring stopped on a missing routing policy; no Enrollment Tool call occurred | No TaskRecord or claim |
| Accept | interactive `manual`, outer Tool allowlisted | Native prompt opened; PTY selected `Accept`; Enrollment returned TaskRecord v4 | One claim for the exact task/hash |
| Decline | interactive `manual`, outer Tool allowlisted | Native prompt opened; PTY selected `Decline`; Tool returned `user_denied` with one fresh-request recovery | Zero authority write |
| Cancel | interactive `manual`, outer Tool allowlisted | Native prompt opened; PTY sent `Esc`; Tool returned `user_cancelled` with one fresh-request recovery | Zero authority write |
| Process disconnect | interactive `manual`, outer Tool allowlisted | Native prompt opened; Host process was terminated before selection while `elicitation/create` remained pending | Zero authority write; clean fixture |
| Privileged operation: `stop` | interactive `manual`, outer Tool allowlisted | Native prompt opened for `Operation: stop`; PTY selected `Accept`; active task transitioned to `stopped` | Terminal `stopped` TaskRecord; claim released |
| Allowlisted headless | `manual`, outer Tool allowlisted | Nested interaction could not be answered and returned `user_cancelled` | Zero authority write |
| Auto | `auto`, outer Tool allowlisted | Mode did not accept nested elicitation; returned `user_cancelled` | Zero authority write |
| Accept edits | `acceptEdits`, outer Tool allowlisted | Mode did not accept nested elicitation; returned `user_cancelled` | Zero authority write |

The headless manual observation was session
`7a581464-62d7-48ee-a440-c67aa0723997`; the plan-only observation was session
`cfa7c3ff-4c8d-4869-aeb7-12ced9ad8dc9`. Interactive terminal logs were
sanitized before this report; temporary fixture and log paths are intentionally
not release inputs.

## Promotion decision

`2.1.236` is the lowest version supported by this release because it is the
version that completed the real interactive server-initiated elicitation run.
Earlier versions are not inferred compatible from manifest or Hook behavior and
fail the runtime version probe with `unsupported_host` before authority writes.
Future changes to the Claude authority transport, protocol revision, minimum
version, or compatibility claim require a fresh report.
