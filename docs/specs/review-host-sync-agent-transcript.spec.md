# Review host sync Agent transcript

**Status**: Candidate; planning only.
**Design risk**: Medium — one trust-boundary invariant in one module: which bytes become the Claude Review receipt when the `Agent` tool returns synchronously. The hook event shape gains two optional fields. No Kernel, state-machine, persistence or batch change.
**Output language**: English.
**Execution posture**: test-first at the existing recorded-shape seam `tests/claude-review-host-async-agent.test.ts`.
**Source**: GitHub Issue #425 and its Brainstorm manifest.

## Outcome

In a Lane whose Claude Code Executor runs under `claude --print`, a reviewer that returns a verdict synchronously settles Review the same way the async path does. The receipt is the reviewer's own final report, read from its own transcript and bound to the correlated `agentId`. It is never the "delivered to you as a message" pointer notice, never `tool_response.content`, and never `handbackReport`. When no readable report exists, the receipt fails closed with a specific reason. The same fix applies to verifier receipts.

## Evidence

| ID | Concrete source |
| --- | --- |
| E1 | `plugins/immune-brain/runtime/claude/review_host.ts:557` — when `parseAsyncAgentLaunch` returns null, `inspectReview` returns `postEvent.result` as the receipt. |
| E2 | Executor transcript `a53c58a2-3fda-451c-848c-b557ece87f41` (Issue #425): `entrypoint: "sdk-cli"`; each Agent `toolUseResult` has keys `agentId, agentType, content, handback, handbackReport, prompt, resolvedModel, status, …`. `content[0].text` is `This agent's report was delivered to you as a message from "<agentId>" (its SubagentHandback call). Read it there; it is not repeated here.` |
| E3 | The same session holds `<session dir>/<sessionId>/subagents/agent-<agentId>.jsonl` (mode `0600`, owned by the user) plus `agent-<agentId>.meta.json`. Every assistant record carries `agentId`, and the last record is a `SubagentHandback` `tool_use`. `readAgentTranscriptResult` (`review_host.ts:192`) already extracts that report. |
| E4 | `review_host.ts:562-579` — the async branch reads the transcript the launch envelope names through `readAgentTranscript` (realpath + `readPrivate`). It fails closed with `async Agent transcript is not readable` / `async Agent transcript carries no reviewer result` (`release: false`) and refuses any Parent-supplied fallback. |
| E5 | `review_host.ts:359-363` — `inspectVerification` delegates to `inspectReview`, so verifier receipts share the sync branch. |
| E6 | `review_host.ts:603-701` — `parseHookStdin` keeps only `session_id`, `agent_id`, prompt, ids and the `tool_response` text. It reads neither `transcript_path` nor `agent_transcript_path`. `run_continuation.ts:114` shows Claude Code hook payloads carry `transcript_path`. |
| E7 | Tests that settle a Claude Review or verification with a sync `PostToolUse.result` verdict and no transcript: `tests/claude-host-authority.test.ts` (helpers at `:197`, `:315`; inline at `:633`, `:670`, `:1192`, `:1307`, `:2064`, `:2142`), `tests/dual-host-assurance-conformance.test.ts:510,959`, `tests/goal-driven-run-recovery.test.ts:83`, `tests/host-neutral-assurance-coordinator.test.ts:299`. |
| E8 | `tests/claude-host-authority.test.ts:1186-1191` records that no Claude Code build returns the verdict in `tool_response.content`; the sync branch exists only for that hypothetical Host. |
| E9 | `docs/agents/derived-files.json` lists `plugins/immune-brain/dist/claude/mcp-server.mjs` and the Antigravity artifact, which includes `plugins/immune-brain-antigravity/runtime/claude/review_host.ts` and `dist/antigravity/mcp-server.mjs`, as generated outputs. |
| E10 | `plugins/immune-brain/runtime/unattended/batch_runner.ts:263` — "Keep the recorded execution mode across re-entry; an existing runtime child is never replaced." |

## Decisions

| ID | Decision | Exactly one source |
| --- | --- | --- |
| D1 | The sync branch takes the receipt only from the reviewer's own transcript. `tool_response.content` never becomes a receipt, even when it parses as a verdict. | BR-DEC-1 |
| D2 | `handbackReport` is never read, in `parseHookStdin` or in `inspectReview`. | BR-DEC-2 |
| D3 | Transcript locator. Use SubagentStop `agent_transcript_path` when it was observed. Otherwise derive the path `join(dirname(T), basename(T, ".jsonl"), "subagents", "agent-" + agentId + ".jsonl")` from the PostToolUse `transcript_path` `T`. A locator that is present but unreadable never falls back to the other one. | BR-DEC-3 |
| D4 | Read the transcript with the async path's checks: `realpathSync`, then `readPrivate` (ownership, mode, `O_NOFOLLOW`, `MAX_TRANSCRIPT_BYTES`). Then call `readAgentTranscriptResult` with the correlated `postEvent.agentId`. | E4 |
| D5 | Fail-closed reasons mirror the async ones: `sync Agent transcript is not readable` (no locator, a non-absolute path, an `agentId` outside `[A-Za-z0-9_-]+` when deriving, a missing file, or a failed ownership/mode/symlink check) and `sync Agent transcript carries no reviewer result`. Both use `release: false`, like the async branch. | Delegated technical choice (mirror E4) |
| D6 | The receipt model stays `postEvent.model` for the sync branch. The verifier model check is unchanged. | Delegated technical choice (no behavior change requested) |
| D7 | The hook event shape grows additively. `PostToolUse` gains optional `transcriptPath`, and `SubagentStop` gains optional `transcriptPath` and `agentTranscriptPath`. Each is taken only from Host hook stdin, only as a non-empty absolute string. Older hook-log lines without the fields fail closed under D5. | E6 |
| D8 | Existing settlement tests that relied on a sync content verdict switch to a reviewer transcript fixture through one shared test helper. Settle-path assertions keep their meaning, and only the receipt source changes. The `:1192` test is rewritten so that a content verdict with no transcript does not settle. | BR-DEC-1 |
| D9 | Regenerate the Claude bundle and the Antigravity artifact with their own generators. Do not edit generated outputs by hand. | E9 |

## Threat model and supported environment

Inputs are Claude Code hook stdin payloads, which the Host writes, and the reviewer transcript JSONL on local disk. The adversary is a Parent model that tries to settle Review with bytes it authored or relayed: tool-result text, `handbackReport`, or a `submit_review` verdict argument. A same-uid process rewriting the reviewer transcript is outside scope; the async path has the same exposure today (E4). Supported: Claude Code 2.1.x under `--print` (`sdk-cli`) and interactive sessions, macOS and Linux, UTF-8 JSONL transcripts.

## Technical Design

**Design views**: data flow (hook payload → event → receipt) and the component interface of `ClaudeHookEvent`. No state transition or sequence changes.

**Data shape first.** `ClaudeHookEvent` changes:
- `PostToolUse` gains `transcriptPath?: string`.
- `SubagentStop` gains `transcriptPath?: string` and `agentTranscriptPath?: string`.

`parseHookStdin` fills them from `payload.transcript_path` and `payload.agent_transcript_path`, but only when the value is a non-empty string and `isAbsolute`. Nothing else in the payload changes meaning. The only consumers are `ClaudeReviewHost.observe` and `kernel_ports.ts:359`, which passes events through. `FileHookEventLog` stores events as JSON lines, so the new fields persist with no schema change.

**Flow in the `!launch` branch of `inspectReview`:**
1. Correlation is unchanged. Start, Post and Stop must agree on session and `agentId` before this branch runs.
2. Locate per D3. With no locator, or an invalid derived `agentId`, return `sync Agent transcript is not readable`.
3. Read per D4. If the read is unreadable, return the same reason.
4. Call `readAgentTranscriptResult(transcript, postEvent.agentId)`. A blank result returns `sync Agent transcript carries no reviewer result`.
5. Return `{ actorId, result: verdict, model: postEvent.model }`. `postEvent.result` is never returned.

**Failure and compatibility.** Every failure is a non-settling receipt with a stable reason, and nothing persists. A pending reservation observed through an older hook log without the new fields fails closed, and a fresh dispatch under the fixed runtime settles. The async branch and correlation rules are byte-for-byte unchanged in behavior.

**Out of design.** Moving an existing `--print` Lane record to interactive mode (E10) is not part of this design (BR-OUT-1).

## User scenarios

| Scenario | Observable result | Mapping |
| --- | --- | --- |
| BR-SCN-1 | Given a single-task Lane whose Executor runs under `claude --print` and a reviewer that hands back a `pass` verdict, when the Executor calls `submit_review`, then `submit_review` returns `completed` and the task status shows Review passed. | automated: AC1 |
| BR-SCN-2 | Given the same Lane where the reviewer transcript cannot be read, when the Executor calls `submit_review`, then the rejection reason names the unreadable sync reviewer transcript instead of `reviewer receipt is not a valid verdict`. | automated: AC2 |

## Acceptance and verification

The checks are local Bun tests that use installed repository dependencies. Fixtures write reviewer transcripts with mode `0600` under the system temporary directory and remove them. No network, credential, model call or real session store is used. A skipped or zero-match run fails.

| ID | Exactly one source | Seam and controls |
| --- | --- | --- |
| AC1 | BR-REQ-1 | `tests/claude-review-host-async-agent.test.ts`. Use the recorded `sdk-cli` shape from E2: `parseHookStdin` of a PostToolUse payload with the pointer-notice `content`, a `handbackReport`, `resolvedModel` and `transcript_path`, plus SubagentStart/Stop, and a reviewer transcript at the derived path whose last record is a `SubagentHandback` `pass`. `inspectReview` returns that report as the receipt, and the coordinator submit returns `completed`. The same result holds when SubagentStop carries `agent_transcript_path` to a transcript at a non-derived location. |
| AC2 | BR-REQ-2 | Same file. Each case returns a non-settling result whose reason is the named one, and a coordinator submit returns that reason rather than `reviewer receipt is not a valid verdict`: (a) derived transcript absent → `sync Agent transcript is not readable`; (b) neither `transcript_path` nor `agent_transcript_path` observed → not readable; (c) transcript mode `0644` → not readable; (d) `agent_transcript_path` present but missing while a readable derived file exists → not readable (no fallback); (e) derived `agentId` containing `/` → not readable; (f) transcript with only another `agentId`'s records → `sync Agent transcript carries no reviewer result`; (g) `handbackReport` holding a valid `pass` with no readable transcript → not readable; (h) `tool_response.content` holding a valid `pass` with no readable transcript → not readable. |
| AC3 | BR-REQ-3 | `tests/host-neutral-assurance-coordinator.test.ts`. The Claude verifier receipt binds through the sync branch: with a verifier transcript it completes with `verifier_actor: "claude:agent"` as today; without one it does not complete a valid attestation. |
| AC4 | BR-DEC-1 | `tests/claude-host-authority.test.ts`, `tests/dual-host-assurance-conformance.test.ts`, `tests/goal-driven-run-recovery.test.ts`. The settlement tests listed in E7 pass with transcript-backed fixtures. The rewritten `:1192` native-shape test asserts that a content verdict with no transcript does not settle. |
| AC5 | BR-REQ-5 | `tests/claude-host-package.test.ts`: the checked-in Claude bundle matches a fresh generate. `bun scripts/build-antigravity-plugin.ts --check` reports no drift. |

Completion diagnostics beyond acceptance: `bun run typecheck` and the full `bun test`.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | AC1; D3, D4 |
| BR-REQ-2 | AC2; D5 |
| BR-REQ-3 | AC3 (E5) |
| BR-REQ-4 | AC1, AC2 (recorded-shape fixtures, positive and blocked) |
| BR-REQ-5 | AC5; D9 |
| BR-DEC-1 | D1, D8; AC2(h), AC4 |
| BR-DEC-2 | D2; AC2(g) |
| BR-DEC-3 | D3; AC1, AC2(d) |
| BR-OUT-1 | Out: the `--print` → interactive migration of existing records (E10) is left to a separate Issue. |
| BR-OUT-2 | Out: Pi and the Antigravity adapter source (`runtime/antigravity/`) are untouched. The Antigravity `runtime/claude/` mirror is regenerated only (D9). |
| BR-SCN-1 | AC1 |
| BR-SCN-2 | AC2 |

## Completeness and remaining gap

The whole confirmed outcome is one slice: sync receipt from the transcript, fail-closed reasons, verifier coverage, recorded-shape tests and regenerated mirrors. Every upstream item maps exactly once above, and no phase is excused.

Remaining gap at handoff: implementation and every check are pending. Whether Claude Code 2.1.319 emits `agent_transcript_path` on SubagentStop is not verified. D3 does not depend on it, because the derived locator is evidenced by E3 and E6. An existing `--print` Lane recovers only after its Executor loads the fixed runtime; that is not verified here and is not claimed.

## Devil's Advocate Audit

- **Rollback resilience**: one source module plus generated outputs. Reverting them together restores the previous behavior. The new event fields are optional, so a reverted runtime ignores them in already-written hook logs. Nothing persists beyond the hook log.
- **Verification vanity**: a naive "read whatever file exists" would pass AC1. AC2 pins mode, symlink-free path validity, no cross-locator fallback, foreign `agentId`, and both Parent-visible byte sources (`handbackReport`, `content`). AC4 keeps the existing correlation and replay guards running on the new receipt source rather than retiring them.
- **Spec dilution detection**: any of the following fails a named case: returning `postEvent.result` for a parseable content verdict, reading `handbackReport`, falling back between locators, skipping `readPrivate`, or dropping the verifier path.
