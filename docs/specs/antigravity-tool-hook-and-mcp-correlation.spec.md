# Antigravity tool-hook dispatch and MCP correlation

**Status**: Candidate; planning only.
**Design risk**: High — this repairs Host hook routing, subagent observation, and the native-authority correlation boundary shared by Claude and Antigravity; a false match could authorize the wrong conversation, while an omitted fix leaves native tools unusable.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: Inputs are local Antigravity lifecycle hook JSON and MCP JSON-RPC messages. The trusted local Host may supply `lastUserInput`, `toolCall`, `conversationId`, `stepIdx`, `antigravity.google/conversation_id`, and `antigravity.google/workspace_paths`; model-controlled tool arguments and unrelated MCP clients are untrusted. A missing or ambiguous conversation correlation, a different conversation or workspace, a repeated pending operation, and replay must fail closed. Supported environment: Antigravity v8.0.0 as reported by #469 and the compatible CLI protocol represented by local agy 1.5.4, Bun and Node.js on darwin/linux. Herdr process supervision is not an MCP authority channel.
**Design views**: service/component interfaces; data flow; temporal sequence. No persisted-state or state-machine view is needed: admission remains a private, single-use file protocol.
**Execution posture**: test-first — reproduce the reported mixed-field hook payload, Claude-only metadata refusal, and lazy-MCP mismatch before changing the adapter.

## Outcome

Issue #469. Antigravity tool hooks containing `lastUserInput` dispatch to the correct tool response instead of `PreInvocation`; subagent completion is observed. Lazy `call_mcp_tool` calls for Immune-Brain are admitted using the same conversation as the subsequent MCP request. Privileged Antigravity operations no longer require Claude-only metadata, while literal-user entry, workspace binding, native confirmation, and single-use admission remain enforced. Claude Code keeps its existing `claudecode/toolUseId` contract. Herdr continues to supervise Executor processes and is unchanged.

## User scenarios

| ID | Scenario | Tag |
| --- | --- | --- |
| BR-SCN-1 | Source: confirmed Brainstorm manifest `BR-SCN-1`. Actor: Antigravity user. Given: a valid literal-user `drive` entry and an authorized Immune-Brain task. When: the user invokes a workflow requiring file edits, subagent review, and a privileged batch operation. Then: Antigravity executes the native tools and reaches the operation's authorized confirmation path without a hook protojson error or Claude-only correlation error. | automated: AC1, AC2, AC3 |

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | `plugins/immune-brain/runtime/antigravity/mcp_server.ts:55-63` checks `lastUserInput` before `toolCall`, although `plugins/immune-brain/runtime/antigravity/lane_guard.ts:49-77` permits `lastUserInput` on both tool payloads. This explains the #469 `injectSteps` protojson failure and lost `PostToolUse` observation. |
| E2 | `plugins/immune-brain-antigravity/hooks.json:11` omits `call_mcp_tool`; `plugins/immune-brain/runtime/antigravity/lane_guard.ts:24,214-232` only recognizes direct tool names and writes admission under `${conversationId}:${stepIdx}:${operation}`. The actual lazy call carries `ServerName`, `ToolName`, and `Arguments`. |
| E3 | `plugins/immune-brain/runtime/claude/mcp_server.ts:437-441,544-557` unconditionally requires `claudecode/toolUseId` for every privileged operation before selecting `message.id` as the fallback call ID. Antigravity instead supplies workspace metadata. |
| E4 | A live, isolated, read-only agy 1.5.4 probe (`/tmp/agy-correlation-probe.t9flbh/events.jsonl`) observed two sequential calls. PreToolUse carried `conversationId` and `stepIdx` 2 then 4; the corresponding MCP `tools/call` carried the same `antigravity.google/conversation_id` and `progressToken` suffix `:2` then `:4`, while JSON-RPC IDs were 4 then 5. Both calls included `lastUserInput`. PostToolUse carried an empty-string `error`, not a duplicate PreToolUse. `progressToken` is therefore the exact per-call correlation evidence; JSON-RPC `message.id` is not. The probe made no protected Immune-Brain mutation. |
| E5 | `plugins/immune-brain/runtime/claude/mcp_server.ts:228,245-263` imports Claude admission consumption by default and separately tracks the correlated Hook session. Antigravity needs an injected conversation-scoped consumer; the shared runtime must not import the Antigravity adapter. Existing `parentHost: "antigravity"` is already supplied by `createAntigravityMcpRuntime`. |
| E6 | `docs/agents/derived-files.json:4-105` declares both generated runtime bundles and the Antigravity mirror. `plugins/immune-brain-antigravity/hooks.json` is canonical input, not generated from `plugins/immune-brain/hooks/hooks.json`. `tests/antigravity-host-package.test.ts:170-224` executes packaged hooks; `tests/antigravity-assurance-conformance.test.ts` exercises adapter/runtime behavior; `tests/runtime-layering-boundary.test.ts:25-30` owns the existing cross-adapter baseline. |

## Decisions and provenance

| ID | Decision | Exactly one source |
| --- | --- | --- |
| D1 | In `runHook`, dispatch a non-null object `toolCall` first, then Stop markers, then `PreInvocation`. Within tool dispatch, retain the existing `stepIdx` plus `error`/`result` PostToolUse distinction. Preserve the `{}` PostToolUse response and append the existing `invoke_subagent` event. | BR-REQ-1 |
| D2 | Add `call_mcp_tool` to the canonical Antigravity PreToolUse matcher. Resolve a gated operation from a direct Immune-Brain tool name, or from `args.ToolName` only when the lazy call's `args.ServerName` is exactly `immune-brain` or `immune-brain_immune-brain`. All other lazy calls receive the ordinary allow result and never consume admission. | BR-REQ-2 |
| D3 | Key an Antigravity admission by `(conversationId, stepIdx, operation)`. Require a non-empty `_meta["antigravity.google/conversation_id"]` matching the hook conversation and a `progressToken` whose final `:` suffix is exactly the decimal `stepIdx`. Retain the full progress token as evidence, but do not treat its prefix as a session credential. JSON-RPC `message.id` remains the operation call ID, not proof of Hook correlation. Missing or malformed correlation metadata refuses; distinct sequential steps coexist safely. | E4 |
| D4 | Keep `hostCallIdentity` Claude-only. For Antigravity, parse D3 conversation/step identity and inject the Antigravity admission consumer through the existing `McpRuntimeOptions.consumePhaseAdmission` composition seam. The shared adapter receives no import from `runtime/antigravity/`, and Claude continues to require its tool-use ID and exact Hook correlation. | BR-OUT-1 |
| D5 | Consuming an Antigravity admission verifies its operation, current conversation, current entry token, and entry workspace realpath. Consumption is single-use; replay, absent conversation metadata, a different conversation, a second pending operation, and workspace mismatch refuse before batch start or retirement. The accepted conversation becomes the runtime Hook session rather than the transport connection ID. | BR-DEC-1 |
| D6 | All privileged Antigravity operations pass D3/D4 identity handling. `start_unattended_batch` and `retire_stale_batch` additionally require D5 admission; the other privileged operations continue through their existing native-confirmation authority paths and never manufacture a batch admission. | BR-REQ-3 |
| D7 | Extend `tests/antigravity-host-package.test.ts` for real bundled hook responses and observation, and `tests/antigravity-assurance-conformance.test.ts` for admission and MCP authority behavior. Retain focused Claude authority coverage, regenerate both affected bundles with the existing build scripts, and add a patch changeset. Do not change Herdr or supervised-session contracts. | E6 |

## Technical Design

**Interfaces and ownership.**

- The Antigravity hook owns conversion of a native tool payload into `(conversationId, operation)` and private pending-admission storage.
- The Antigravity composition root injects that store's consumer. The shared MCP transport selects the Host identity rule using its existing `parentHost` option; it has no Antigravity import.
- Claude's identity remains `{ toolCallId: meta["claudecode/toolUseId"] }`. Antigravity's identity contains the non-empty Host conversation ID and the transport call ID derived from JSON-RPC `message.id`.
- `requireRunEntry` receives the Host admission identity separately from the display/audit call ID. For Antigravity it passes the original `${conversationId}:${stepIdx}:${operation}` key, so the existing admission storage can be reused without a migration. It uses the injected consumer and records the admitted conversation as the Hook session. This is an internal interface correction, not a new Port or Kernel contract.

**Data flow and temporal sequence.**

1. `PreInvocation` records a literal-user `drive` entry and its workspace-bound entry token.
2. `PreToolUse` resolves a direct or lazy gated operation. It admits only when the conversation has a live entry, `stepIdx` is present, and no same-operation admission is pending for that conversation. It writes the operation, token, workspace, and conversation into the private admission.
3. Antigravity sends `tools/call` with `antigravity.google/conversation_id`, `progressToken` ending in the originating `stepIdx`, and optional workspace paths, without Claude metadata.
4. The shared transport applies the Host identity rule. Missing identity refuses before elicitation. For the two gated batch operations, the injected consumer takes exactly the matching pending admission, validates its token/workspace, and prevents replay.
5. The existing runtime authority path proceeds. Other privileged operations use their existing native gate; a declined or cancelled gate performs no protected mutation.
6. A later call without a fresh admitted operation refuses. A different conversation cannot consume the admission.

**Invariants.**

- I1: Tool hooks never return `PreInvocation` output merely because `lastUserInput` is present; PostToolUse observation and response are preserved.
- I2: An unrelated lazy MCP call creates no admission. Sequential steps receive distinct admissions; only the exact `(conversationId, stepIdx, operation)` admission is consumed.
- I3: No admission is selected by recency, workspace alone, JSON-RPC ID guessing, or a shared cross-conversation key.
- I4: Removing Claude-only metadata checks for Antigravity does not bypass entry-token, workspace, native-gate, or one-time-consumption checks.
- I5: Kernel ← Port/coordinator ← Adapter dependency direction and the existing cross-adapter baseline remain unchanged. Herdr owns process supervision only.

**False-compromise check.** No false compromise detected. The live `progressToken` step suffix replaces the unsupported `stepIdx == message.id` assumption without selecting a recent/global grant or serializing independent steps. Segmentation would split the three defects but leave an unusable or partially authorized intermediate path; extraction of a new shared Host abstraction would add unrelated #414 work. The single-use file protocol is the existing, minimal intermediary.

## Devil's Advocate Audit

- **Rollback resilience**: Revert the runtime, hook matcher, tests, changeset, and regenerated bundles together. There is no Kernel schema or TaskRecord migration. An unconsumed temporary admission remains harmless after rollback because its old/new key namespaces differ and no authority is persisted in Kernel state.
- **Verification vanity**: AC1 fails on the current `PreInvocation`-first routing and missing lazy matcher. AC2 fails on the current Claude metadata check and mismatched admission key. Its negative controls prove that simply deleting the metadata guard cannot pass: missing/wrong conversation, duplicate pending calls, replay, and workspace mismatch still refuse. AC3 covers the remaining privileged tools so the fix is not limited to two batch tools. AC4 detects stale packaged output and Claude regressions.
- **Spec dilution**: Hook routing, subagent observation, lazy MCP recognition, privileged metadata, and exact admission correlation are all delivered. No requirement is deferred, and Herdr is excluded only because repository architecture places it outside this authority path.

## Acceptance and verification mapping

| AC | Source | Seam and controls |
| --- | --- | --- |
| AC1 | BR-REQ-1 | `tests/antigravity-host-package.test.ts` › `Antigravity hook dispatch and observation`. Done looks like: the packaged hook answers native tool payloads correctly and records the subagent result. Positive: PreToolUse payloads with `lastUserInput` and `write_file` or `call_mcp_tool` return `{decision:"allow"}`; PostToolUse with `invoke_subagent`, `result`, `stepIdx`, and `lastUserInput` returns `{}` and appends the expected event; Stop still wins over PreInvocation. Negative: a lazy call with another `ServerName`, and a pure PreInvocation payload, retain their existing behavior. Bound: the matcher includes `call_mcp_tool`, and no `injectSteps` response occurs for tool payloads. |
| AC2 | E4 | `tests/antigravity-assurance-conformance.test.ts` › `Antigravity privileged MCP correlation`. Done looks like: after a literal-user drive and one lazy gated hook, `start_unattended_batch` and `retire_stale_batch` calls with Antigravity conversation/workspace metadata and a matching `progressToken` step suffix reach their existing authorized confirmation path without `claudecode/toolUseId`. Positive: matching conversation, step, operation, and workspace succeeds once; two sequential steps receive distinct admissions. Negative: missing/empty or different conversation, missing/malformed or wrong-step progressToken, replay, and workspace mismatch refuse. Bound: an unrelated lazy call creates no admission; JSON-RPC ID need not equal `stepIdx`; the admitted conversation is the runtime Hook session. |
| AC3 | BR-REQ-3 | `tests/antigravity-assurance-conformance.test.ts` › `Antigravity privileged native gates`. Done looks like: `request_authorization`, `approve_breaking_intent_revision`, and `stop` accept Antigravity conversation metadata and reach their existing native gate. Positive: a valid interactive request reaches elicitation without Claude metadata. Negative: decline/cancel performs no authority mutation; missing conversation identity refuses before elicitation. Bound: these operations neither create nor consume batch admission. |
| AC4 | BR-OUT-1 | `tests/antigravity-host-package.test.ts`, `tests/runtime-layering-boundary.test.ts`, and focused `tests/claude-host-authority.test.ts` coverage, plus both build checks. Done looks like: generated Antigravity/Claude bundles are current, package behavior is preserved, and Claude still rejects a privileged call without `claudecode/toolUseId` while accepting its established exact correlation. No new cross-adapter import appears. |

Final local checks beyond acceptance: `bun run typecheck` and focused `bun test tests/antigravity-assurance-conformance.test.ts tests/antigravity-host-package.test.ts tests/claude-host-authority.test.ts tests/runtime-layering-boundary.test.ts`. Each acceptance command uses QA-host Bun and the repository's existing dependencies; no installation, network access, production credential, or live protected mutation is required.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D1; AC1 |
| BR-REQ-2 | D2; AC1 |
| BR-REQ-3 | D6; AC3 |
| BR-DEC-1 | D3, D5; AC2 |
| BR-DEC-2 | D3-D6; AC2 and AC3 deliver the complete chain, not just removal of `correlation_missing` |
| BR-OUT-1 | D4 and D7 preserve Claude/Pi and exclude unrelated Host work; AC4 |
| BR-Q-1 | Resolved by E4 and D3/D4 using the live Host conversation plus `progressToken` step correlation; no `stepIdx`/JSON-RPC equality assumption |
| BR-SCN-1 | Automated by AC1, AC2, and AC3 |

## Completeness and remaining gap

One cohesive TaskIntent delivers the complete #469 outcome and all upstream items. Splitting hook routing from authority correlation would produce a working native-tool surface with privileged operations still broken; splitting Claude compatibility into another task would duplicate the same transport rollback. No phase is excluded or deferred.

Remaining gap at handoff: implementation, generated bundle updates, and deterministic acceptance execution are pending under `drive`. The live agy 1.5.4 probe proved conversation and `progressToken` correlation for two sequential read-only MCP calls; it did not execute a privileged Immune-Brain operation.

## Rollback

Revert the delivering change as one unit: canonical Antigravity hook configuration, Antigravity and shared MCP runtime sources, focused tests, changeset, and generated bundles. No persisted data migration or Herdr rollback is needed.
