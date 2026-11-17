# Review receipt submitted through an MCP tool

## Status, ownership, and outcome

- Owner: user. TaskIntent: `docs/plans/review-receipt-mcp-submission.intent.json` (one Slice).
- Output language: English (project document default; the chat reply language does not apply).
- Outcome: a Claude Code or Antigravity authority Review session, and the findings-verification session that follows it, deliver their JSON receipt by calling one Immune-Brain MCP tool. The runtime validates the payload and writes it into the session's existing result slot. The reviewer no longer holds any file-write permission, so a Lane worktree under `<repo>/.git/imm/worktrees/` no longer makes the receipt unwritable.

**Design risk**: High. The change moves the authority receipt channel from an agent file write to a runtime tool, changes the reviewer permission boundary on Claude Code, adds a tool to the MCP surface shared by the Claude and Antigravity servers, and amends an ADR addendum.

**Design views**: service interface (the new MCP tool and the reviewer session arguments) and data flow (receipt bytes from the reviewer to `readSlotResult`). State transitions are omitted: no reservation, release or Kernel state changes. Temporal sequence is omitted: the reservation, await and `submit_review` order is unchanged.

**Execution posture**: test-first. The argv and refusal controls pass vacuously unless the assertions exist before the change.

## Threat model and supported environment

Threat model and supported environment: the tool input comes from a reviewer or verifier model running as the same OS user in the task's own working directory. It is semi-trusted: it may send a wrong slot id, a path-like id, a second submission, or non-JSON text, but it is not an adversary with other local access. Any process with that access could already write the ignored slot file directly, so the tool adds no authority. The receipt stays transport: the coordinator still validates it (strict JSON, snapshot digest, tree guard, ADR 0017 byte binding). Supported environment: macOS and Linux, UTF-8 JSON text, the Herdr session transport already required for CLI Review. Windows is out of scope as for the rest of CLI Review.

## Evidence and discovery closure

- Failure evidence (handoff, 2026-11-17): botline sessions `cc6910ed…` and `1391ad33…` were denied every `Write` of `result.json` because the Lane cwd is `<repo>/.git/imm/worktrees/<initiative>/<task>` and Claude Code treats `.git` as a protected directory; the `Edit(//<abs>)` rule never matches there. Worktree root: `plugins/immune-brain/runtime/unattended/batch_worktrees.ts:38`.
- Probe (2026-11-17, scratchpad, `claude -p`): a session started in `<repo>/.git/imm/worktrees/x` with `--settings {"disableAllHooks":true}`, `--plugin-dir plugins/immune-brain`, `--tools Read,Grep,Glob,Bash`, `--allowedTools mcp__plugin_immune-brain_immune-brain__loop_interactions` and `--permission-mode dontAsk` called the MCP tool successfully with `permission_denials: []`; the server's workspace was the session cwd. This resolves `BR-Q-1`. Interactive trust-dialog behaviour for opening the worktree itself is unchanged by this work and was not probed.
- Reviewer arguments: `plugins/immune-brain/runtime/assurance/cli_review.ts:271-292` (`sessionHostArguments`), `:87` (`claudeOutputWriteRule`), `:65` (`REVIEW_GIT_ALLOWED_TOOLS`), `:256` (`writeToOutput`, the entry sentence), `:368` (verifier call without `pluginDir`), `:438` (reviewer call with `pluginDir`), `:397` and `:478` (aborted reasons), `:250` (`sessionPending`).
- Slot: `plugins/immune-brain/runtime/session_result_slot.ts` (`SLOT_ID`, `allocateResultSlot`, `readSlotResult`); allocation ids `review-<operationId>` and `verify-<operationId>`.
- MCP surface: `plugins/immune-brain/runtime/host-core/mcp_runtime.ts:138` (`TOOLS`, shared by `runtime/claude/mcp_server.ts` and the Antigravity server), `listMcpTools` input schemas, `callTool` dispatch with `loop_interactions` handled before the trusted-host check (`:486`).
- Contract text: `plugins/immune-brain/skills/authority-review/SKILL.md:163-166,188` tell the reviewer to write the output file. `tests/packaged-contract-tool-surface.test.ts` rejects a Host-specific tool name in shared contract text, so the tool is named only in the Host-specific session entry.
- Decision history: `docs/adr/0038-supervised-session-port.md` "Addendum: #565 result slot"; `docs/reference/supervised-session-port.md:47,126,156`; the marked terminal block was rejected in `docs/specs/explicit-port-review-session.spec.md` line 24.
- Derived outputs: `plugins/immune-brain/dist/claude/mcp-server.mjs` and the `plugins/immune-brain-antigravity/**` mirror (`docs/agents/derived-files.json`), checked by `scripts/build-claude-plugin.ts --check` and `scripts/build-antigravity-plugin.ts --check`.
- Tests with prior art: `tests/cli-review-dispatch.test.ts:973-1000` (argv, aborted reason at `:932`), `tests/session-result-slot.test.ts`, `tests/claude-host-package.test.ts:247` (tool list order), `tests/loop-sched-interaction-local.test.ts:119,273` (`createMcpRuntime` + `callTool` seam).

## Decisions

| ID | Decision | Source |
|---|---|---|
| D1 | Claude Code and Antigravity reviewer and verifier sessions submit the receipt through the MCP tool `submit_session_result`; Pi keeps its `write` tool. | `BR-REQ-1`, `BR-DEC-1`, `BR-DEC-3` |
| D2 | Tool input is `{ slot_id: string, result: string }`. `result` is the exact JSON text, written byte for byte, so the ADR 0017 sha256 binding reads the same bytes the reviewer produced. | delegated technical choice |
| D3 | The tool resolves the slot as `<workspace>/.imm/state/sessions/<slot_id>/` from the MCP call's resolved workspace, accepts only a `SLOT_ID`-valid id that is an existing real directory (not a symlink) holding a brief and no result file, requires `result` to be one strict JSON object, and creates `result.json` exclusively. Every refusal writes nothing. | `BR-REQ-3` |
| D4 | The tool is not privileged (no native gate, which `dontAsk` would deny), takes no `task_id`, refuses supplied authority fields like `loop_interactions`, and is dispatched before the trusted-host check. It is appended after `answer_loop_interaction` in `TOOLS`. | delegated technical choice |
| D5 | Claude Code reviewer arguments: `--tools Read,Grep,Glob,Bash`; `--allowedTools` is `REVIEW_GIT_ALLOWED_TOOLS` plus `mcp__plugin_immune-brain_immune-brain__submit_session_result`; `claudeOutputWriteRule` is removed. The verifier session also receives `--plugin-dir` so the tool exists there. | `BR-REQ-1`; verifier gap from `cli_review.ts:368` |
| D6 | `REVIEW_GIT_ALLOWED_TOOLS` adds `Bash(git grep:*)` and `Bash(git --no-pager grep:*)`. | `BR-REQ-5` |
| D7 | Downstream receipt handling is unchanged: `readSlotResult`, strict-JSON check, tree guard, release decisions, `submit_review`, `submit_verification`, slot location and release. | `BR-REQ-2` |
| D8 | Missing-receipt reporting stays `review_session_aborted` / `verification_session_aborted` (no counter, no new state). Their reason text says the session ended without submitting its receipt, and to inspect the session's tab for a denied or failed tool call before dispatching another session. The pending reason no longer says the agent "writes" the file. | user decision 2026-11-17 (draw-up supplement, option 2), revising `BR-REQ-4` |
| D9 | The authority-review skill text stays Host-neutral: the receipt is delivered the way the session entry instructs, and the reviewer creates no file. The Host-specific instruction lives in the generated entry. | `tests/packaged-contract-tool-surface.test.ts` (repository evidence) |
| D10 | ADR 0038 "Addendum: #565 result slot" is amended: on Claude Code and Antigravity the runtime writes the result through `submit_session_result`, because Lane worktrees live under `.git/` where Claude Code refuses agent writes; the slot location, its ignore file and its transport-not-authority role stay. `docs/reference/supervised-session-port.md` is updated to match. | `BR-DEC-2` |
| D11 | `plugins/immune-brain-antigravity/**` and `dist/claude/mcp-server.mjs` are regenerated by the build scripts, never hand-edited. A changeset records the runtime change. | `BR-REQ-6` |

## Technical design

**Service interface.** `submit_session_result`:

- Input: `slot_id` (required string), `result` (required string). Any other authority field is refused as for `loop_interactions`.
- Output on success: `{ contract: "immune_brain/session_result/v1", slot_id, sha256 }` where `sha256` is over the written bytes.
- Errors (tool error, nothing written): `session_result_slot_invalid` for an id failing `SLOT_ID` or containing `..`; `session_result_slot_unknown` for an id whose directory is absent, is not a real directory, or holds no brief; `session_result_already_submitted` when `result.json` exists; `session_result_not_json` when `result` is not one strict JSON object.
- Owner: the slot writer lives in `session_result_slot.ts` beside `readSlotResult`; `mcp_runtime.ts` only parses arguments and calls it. `runtime/assurance` still imports nothing from `runtime/session`.

**Data flow.** `prepareReview` / `prepareVerification` allocate the slot as today → the entry (Claude Code, Antigravity) tells the agent to call `submit_session_result` with the slot id and the JSON text, and that it may create no file; the Pi entry keeps the write sentence → the tool validates (D3) and creates `result.json` with flag `wx` → `inspectReview` / verification inspection reads the bytes exactly as before. A refused call leaves the slot empty, so the agent may retry within its session; a session that ends without a successful call follows D8.

## User scenarios

- `BR-SCN-1` (automated: RRS-A1, RRS-A3). Actor: User. Given: a claude-code Authority Review runs in a Lane whose worktree is under `.git/imm/worktrees/`. When: the reviewer finishes. Then: the Review round settles with the reviewer's PASS or REWORK verdict, and the session shows no denied Write. The automated half asserts that the reviewer holds no Write tool or Edit rule and that a receipt submitted through the tool settles; the live Herdr session itself is not automated.
- `BR-SCN-2` (automated: RRS-A4), revised by D8. Actor: User. Given: a Review session ends without submitting a receipt. When: the Parent submits the round. Then: the user sees `review_session_aborted` with a reason that says no receipt was submitted and to inspect the session's tab before dispatching another reviewer. The "at most one re-dispatch" guarantee is withdrawn by the user's option-2 decision.

## Acceptance mapping

| Acceptance | Decisions | Seam | Done looks like |
|---|---|---|---|
| RRS-A1 | D1, D5, D6, D3 (entry) | `tests/cli-review-dispatch.test.ts` (`sessionHostArguments`, prepared reservations) | claude-code argv has no `Write` and no `Edit(` rule, allows the git grep rules and exactly one MCP tool; the verifier argv carries `--plugin-dir`; Pi and Antigravity argv unchanged; entries name the tool or the write per Host |
| RRS-A2 | D2, D3, D4 | `tests/session-result-slot.test.ts` via `createMcpRuntime().callTool`; `tests/claude-host-package.test.ts` tool list | a valid call writes the exact bytes; each negative case returns its error and leaves the slot as it was |
| RRS-A3 | D7 | `tests/cli-review-dispatch.test.ts` | a receipt submitted through the slot writer for a reserved Review and a reserved verification settles with exactly those bytes |
| RRS-A4 | D8 | `tests/cli-review-dispatch.test.ts` (existing `:932` and `:954` cases) | the aborted reasons name the missing receipt and the inspect-before-redispatch step |
| RRS-A5 | D9, D10, D11 | `tests/packaged-contract-tool-surface.test.ts`, `tests/skill-dist-consistency.test.ts`, build `--check` scripts | skill text no longer grants a file write and names no Host-only tool; ADR addendum and reference say the runtime writes the slot; derived outputs match |

## Devil's Advocate Audit

- **Rollback resilience.** The change is one runtime commit plus regenerated derived outputs. Reverting it restores the Write rule path, which works outside `.git`. A partial implementation that ships the tool but keeps `Write` in `--tools` still passes old behaviour, so RRS-A1 pins the absence of `Write` and of every `Edit(` rule. A partial one that removes `Write` but does not pass `--plugin-dir` to the verifier leaves verification unable to submit; RRS-A1 pins that argument.
- **Verification vanity.** A happy-path write test alone would not prove D3, so RRS-A2 names each negative case (traversal id, unknown slot, symlinked slot, second submission, non-JSON and fenced text) and checks the slot afterwards. The MCP seam is exercised through `callTool`, not the private writer, so a missing dispatch branch or schema fails. Whether a live Claude Code session reaches the tool under `dontAsk` is covered by the recorded probe, not by a descriptor; the argv test pins the exact allow rule the probe used.
- **Spec dilution.** Every `BR-*` item maps below. `BR-REQ-4` is narrowed by an explicit user decision (D8), not silently; `BR-SCN-2` is revised to match and the withdrawn guarantee is stated.

## Brainstorm Trace

| Item | Mapping |
|---|---|
| `BR-REQ-1` | D1, D5 → RRS-A1, RRS-A2 |
| `BR-REQ-2` | D7 → RRS-A3 |
| `BR-REQ-3` | D3 → RRS-A2 |
| `BR-REQ-4` | Revised by user decision (option 2) to D8 → RRS-A4 |
| `BR-REQ-5` | D6 → RRS-A1 |
| `BR-REQ-6` | D11 → RRS-A5 |
| `BR-DEC-1` | D1 (captured decision) |
| `BR-DEC-2` | D10 → RRS-A5 |
| `BR-DEC-3` | D1 → RRS-A1 (Pi argv unchanged) |
| `BR-OUT-1` | Excluded: `batch_worktrees.ts` is not in scope |
| `BR-DEFER-1` | Deferred: Spec committed into the reviewed revision |
| `BR-DEFER-2` | Deferred: deterministic authority-review blocking rule |
| `BR-DEFER-3` | Deferred: reviewer `--setting-sources` isolation |
| `BR-Q-1` | Resolved by the 2026-11-17 probe (Evidence) |
| `BR-SCN-1` | User scenarios → RRS-A1, RRS-A3 |
| `BR-SCN-2` | User scenarios (revised by D8) → RRS-A4 |
