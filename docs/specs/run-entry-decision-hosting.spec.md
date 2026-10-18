# Run-entry decision hosting

**Status**: candidate decomposition, pending the user's single decomposition confirmation before GitHub publication. This document grants no execution authority.
**Initiative name**: Run-entry decision hosting
**Immutable slug**: `run-entry-decision-hosting`
**Carrier**: GitHub, selected by root `CLAUDE.md` (`Initiative carrier default: github`).
**Planning baseline**: `ab8999f`; recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — the source of execution authority moves from a native confirmation gate to a Host-observed literal-user entry, on both Hosts, and critical Slices join unattended batches.
**Execution posture**: characterization-first for S1 and S3: pin the current gate-per-operation and critical-exclusion behavior at the public seam before changing it.
**Design views**: component interfaces, state transitions, data flow.
**Threat model and supported environment**: the adversary is the model itself (or injected text it reads) trying to obtain execution authority without the user, by emitting tool calls, forging hook payload files, or reusing an entry from another session or workspace. The user, the Host process, and the local filesystem owner are trusted. Supported: Claude Code with the plugin hooks installed, Pi with the bundled extension, macOS and Linux.

## Outcome

Inside the implementation phase, the user's literal `imm-run` entry is the whole authorization. One entry runs the requested task or Initiative to a terminal state with zero native authorization gates and zero chat confirmations, recovers by itself from side-effect-free rejections and deterministic preflight blockers, and stops for the user only on decisions that change external state or the confirmed goal. In the source session (refine `42408921-10dd-4606-9232-a33fa6cbbbd6`) the implementation phase drops from four literal entries, four native gates and one chat question to one literal entry. Grill and Planner behavior is unchanged.

## Sources

No Brainstorm manifest exists. Decisions were confirmed in the grill session of 2026-10-17 (Q1–Q14) and are recorded as Spec-local sources.

| Source | Evidence or decision |
| --- | --- |
| U1 | Q1/Q9: hosting covers only the implementation phase (`imm-run` and downstream); grill-me and imm-planner are not modified. |
| U2 | Q6 A + user constraint: a literal-user `imm-run` entry is the authorization; no native gate opens. A Host input event mints a one-shot entry token; the Kernel validates it. Overturns "Hooks never mint authority". Revised 2026-10-17 (rework of S1): because the token is forgeable by a same-uid model write, the owner kept one native gate for Enrollment and batch start; the token spares only the run's later steps. |
| U3 | Q12 A: token lifetime is event-based with no time limit — valid until the run is terminal, survives compaction and same-Host continuation, invalidated by session exit, workspace change, or a Stop-boundary pause. |
| U4 | Q7 B: the token covers every run-internal authority operation (Enrollment, `start_unattended_batch`, `retire_stale_batch`, same-Host recovery, automatic retry). Push, PR, credentials and `approve_breaking_intent_revision` keep their own confirmation. |
| U5 | Q2 C + Q8 A+B: critical children join batches with no special marking and no pre-execution stop; Review/QA, per-child bounded commits and never-push remain. Entry prints a non-blocking execution manifest. |
| U6 | Q3 B + Q11 B: a side-effect-free rejection is retried within the same entry, at most 2 times; the agent judges retryability from the rejection text and `recovery_action`; the contract names `plan_changed`, `head_moved` and claim conflicts as not retryable. No Kernel reason codes. |
| U7 | Q10 A: a deterministic preflight fix is applied by the agent, committed alone, disclosed in the manifest, then retried — a second exception to ADR 0024 `manual`. |
| U8 | Q5 A: `max_parallel <= 1` equals omitted and selects the serial runner. |
| U9 | Q13 A: the batch derives scope overlap at run time; overlapping children get an implicit dependency in Slice order, reusing the existing overlap projection; Planner output is unchanged. |
| E1 | `runtime/claude/run_continuation.ts` `UserPromptSubmit` already recognizes a literal entry through `recognizePhaseEntry` (`runtime/assurance/phase_entry.ts`); Pi does the same in `recordPiPhaseInput` (`.pi-extension/imm-canary-work.ts`), ignoring `source: "extension"` input. |
| E2 | Claude opens gates through MCP `elicitation/create` (`runtime/claude/mcp_server.ts`, `runtime/claude/kernel_ports.ts` `requestConfirmation`); Pi through `requestAuthorityDialog` (`.pi-extension/imm-canary-work.ts`, `.pi-extension/imm-unattended-batch.ts`). The returned `confirmation_ref` is what the Kernel binds. |
| E3 | `runtime/unattended/batch_plan.ts` classifies `risk: "critical"` children as `needs_human` / `critical`; `runtime/unattended/batch_git.ts` routes critical-only Parents to `native_parent` and `integrateSettledCriticalSlices`. |
| E4 | `runtime/unattended/batch_lanes.ts` `parseMaxParallel` accepts 1 as a Lane batch; `resolveLaneParallel` forwards it. |
| E5 | `runtime/unattended/batch_schedule.ts` `startableChildren` only refuses overlap with in-flight children, so a later overlapping child can start once an earlier one parks or fails. |
| E6 | `runtime/claude/run_continuation.ts` pauses the run on any native-operation failure ("no automatic native retry") and denies further native tool calls until a fresh entry. |
| E7 | `runtime/assurance/run_continuation.ts` pauses a run whose progress digest is unchanged after one Stop nudge; in this Initiative's own runs that paused the Loop while it waited on a 13-minute background regression, forcing a new typed entry. |
| E8 | `.pi-extension/pi-run-continuation.ts` `agent_before_settle` resets on a non-completed outcome or `canContinue: false` without ending the entry token (S2 Review advisory), so an interrupted run kept a live token. |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | Claude user | an approved Initiative | they type `imm-run <slug>` and confirm one batch dialog | the batch starts and a manifest lists children, risk and verification commands; a later stale-batch retirement in the same run opens no dialog | automated | S1 |
| SCN-2 | Pi user | an approved Initiative | they type `imm-run <slug>` and confirm one batch dialog | the same start and the same manifest as SCN-1; a later stale-batch retirement in the same run opens no dialog | automated | S2 |
| SCN-3 | user | an Initiative with a critical child that overlaps a later child | the batch runs | the critical child runs inside the batch and the later overlapping child waits for it to be done | automated | S3 |
| SCN-4 | user | a transient read failure on start | the agent retries | the run continues without user input; after 2 failed retries it pauses with the reason | automated | S4 |
| SCN-5 | user | the repository ignores `.imm/audit/` | preflight refuses | the agent commits only the ignore fix, lists it in the manifest, and the batch starts | automated | S4 |
| SCN-6 | user | a run in progress | the session exits and a new session calls an authority tool | the call is refused until the user types `imm-run` again | automated | S1 |
| SCN-7 | Claude user | a run waiting on background verification | the agent ends several turns with no new progress | the run stays live and resumes when progress changes, with no new typed entry | automated | S4 |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | A literal-user `imm-run` entry mints one entry token bound to Host, session id and workspace realpath (not the entry arguments; see ADR 0025 Deviations). Only the Host input event mints it (Claude `UserPromptSubmit`, Pi input with `source !== "extension"`); no MCP tool or tool argument can. A same-uid model write to the cache file can forge one (ADR 0025 Context), so D2 keeps a native gate on starting execution. | U2, E1 |
| D2 | `enroll` and `start_unattended_batch` keep one native gate per entry (revised 2026-10-17 after Review found the token forgeable). `retire_stale_batch`, the S4 bounded retries and same-Host recovery accept a valid token in place of a native confirmation; retirement records a `confirmation_ref` of kind `entry_token` with the plan digest binding unchanged. Without a live token (an admission recorded before tokens) retirement falls back to the native gate; a revoked or mismatched token is refused. | U2, U4, E2 |
| D3 | The token is valid until the bound run is terminal. It is invalidated by `SessionEnd`, a workspace realpath mismatch, or a Stop-boundary pause; compaction and same-Host continuation keep it. There is no time limit. A new literal entry replaces it. | U3 |
| D4 | Push, PR creation, credential use and `approve_breaking_intent_revision` are outside the token and keep their own confirmation. Gates that collect a user choice rather than a yes/no authorization — rework exits (`grant_rounds`, `accept_residual_risk`, `replan`) and Lane revision delegation — also stay. | U4, T1 |
| D5 | Batch planning classifies a valid critical child as `enrollable`. The child keeps its own TaskRecord, full Assurance, per-child bounded commit and never-push. The `native_parent` route is kept only for Parents whose remaining work is already delivered; critical-only branches are retired. | U5, E3, T2 |
| D6 | On a token-backed start the result carries a manifest — each child's task id, risk, scope summary and verification commands, plus any applied preflight fix commit — and the Loop prints it before working. It never blocks. | U5, U7 |
| D7 | `max_parallel` of 1 or less (after shape validation) is treated as absent: serial runner, no Lane record. | U8, E4 |
| D8 | When two children's scopes overlap, the later one in Slice order gains an implicit dependency on the earlier one: it starts only after the earlier one is done, both in the serial runner and in `startableChildren`. If the earlier child freezes, the later one is skipped as `skipped_blocked` just like a declared dependent, so the batch still terminates. Overlap uses the existing `overlappingScopeEntries`. | U9, E5 |
| D9 | The continuation hooks count native-operation failures per entry token: the first two leave the run live so the agent may retry; the third pauses the run as today. The Loop contract tells the agent to retry only side-effect-free rejections, to rerun preflight before each retry, and never to retry `plan_changed`, `head_moved` or a claim conflict. | U6, E6 |
| D10 | When preflight names a deterministic fix, the agent applies it, commits exactly the fixed files in one commit even under `Git integration: manual`, and retries. ADR 0025 records this as the second exception to ADR 0024 (the first is batch commits). | U7 |
| D12 | On Claude, after one Stop block with no progress, a further Stop with an unchanged progress digest is allowed: it yields the turn, never pauses the run, never revokes the token and does not count toward a pause; the next incomplete Stop after progress changes blocks again. Pi keeps its stall pause, because its settle boundary has no background-wait case. | E7 |
| D13 | A pause ends the entry token on both Hosts, and so does a Pi turn that settles with a non-completed outcome or `canContinue: false`. A paused Claude run is therefore refused at the phase-entry gate and at `tools/call` itself (`run_entry_required`), even when an admission was recorded before the pause. | E8, D3 |
| D11 | ADR 0025 records D1–D10, amends ADR 0005 §6 (critical in batch) and ADR 0019 (gate on entry: kept for starting execution, removed for retirement), and replaces the `hooks.json` invariant "Hooks never mint authority" with "Authority comes only from a literal-user entry or a native gate". | U2, U5, U7 |

Delegated technical choices:

| ID | Choice | Reason |
| --- | --- | --- |
| T1 | Choice-collecting gates (D4) stay. | They carry a user decision the confirmed set did not delegate; removing them would let the model choose residual risk. |
| T2 | Keep `native_parent` for delivered-only Parents. | It still settles Parents with no remaining work; only its critical branch loses its purpose. |
| T3 | Store the token beside the existing phase-entry state, keyed by session id, in the same private cache. | That state is already Host-written, session-keyed and dropped on `SessionEnd`. |

## Technical Design

### Component interfaces

- `runtime/assurance/phase_entry.ts`: entry recognition stays; add `mintEntryToken(host, session, workspace, args)` and `readEntryToken(session)` / `invalidateEntryToken(session, reason)` over the private cache.
- Claude `mcp_server.ts` / `kernel_ports.ts`: `requestConfirmation` for authorization-only operations becomes `admitEntryToken`; choice-collecting confirmations keep `elicitation/create`.
- Pi `imm-canary-work.ts` / `imm-unattended-batch.ts`: Enrollment and batch start keep `requestAuthorityDialog`; `retire_stale_batch` takes the same entry admission and, under a live token, records a `pi-entry-` confirmation reference instead of opening the dialog.
- `runtime/unattended/run_entry_manifest.ts`: the host-neutral D6 manifest both Hosts return from a confirmed batch start.
- `runtime/unattended/batch_plan.ts`, `batch_schedule.ts`, `batch_lanes.ts`, `batch_git.ts`: D5, D7, D8.
- Continuation hooks (`run_continuation.ts`, `pi-run-continuation.ts`): D3 invalidation, D9 retry counter.

### State transitions

`no_token → live` on literal entry; `live → live` on compaction or continuation; `live → spent` when the bound run is terminal; `live → invalid` on SessionEnd, workspace change or pause. Only `live` admits authority. The retry counter belongs to the token and is reset by a new entry.

### Data flow

Host input event → `mintEntryToken` → private cache → tool call → `admitEntryToken` (session + workspace + args match, state `live`) → Kernel operation with `confirmation_ref.kind = entry_token` → manifest in the result → Loop prints it.

## Devil's Advocate Audit

- *Can the model mint a token?* Only Host input events write it; extension-sourced Pi input is ignored (E1); tool arguments carrying any token field are refused, like `native_decision` today. Negative cases are in S1/S2 acceptance.
- *Does removing the gate lose the plan digest binding?* No: the digest is still computed and recorded; for retirement only the human click is replaced, and starting execution keeps its gate (D2).
- *Critical without a stop* is the user's explicit choice (U5); the manifest gives a trace and the safety net is unchanged.
- *Retry loops*: bounded at 2 per entry by the hook, not by the model (D9).

## Slices and acceptance mapping

| Slice | Task id | Result | Risk | Blocked by | Decisions | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | `run-entry-token-claude` | Claude literal entry mints the token; retire runs with no gate, enroll/batch keep one gate; manifest; invalidation; ADR 0025 | critical | — | D1–D4, D6, D11 | SCN-1, SCN-6 |
| S2 | `run-entry-token-pi` | Pi parity of S1 | critical | S1 | D1–D4, D6 | SCN-2 |
| S3 | `batch-critical-ordering` | critical children in batch; implicit overlap order; `max_parallel <= 1` serial | critical | — | D5, D7, D8 | SCN-3 |
| S4 | `run-entry-auto-recovery` | bounded retry in both hooks; preflight fix commit; Loop contract text | material | S1, S2 | D9, D10, D12, D13 | SCN-4, SCN-5, SCN-7 |

## Discovery evidence

Traced paths: E1–E6 above; tests `tests/phase-entry.test.ts`, `tests/claude-phase-entry-gate.test.ts`, `tests/claude-native-elicitation-promotion.test.ts`, `tests/claude-run-continuation.test.ts`, `tests/pi-phase-entry-gate.test.ts`, `tests/pi-run-continuation.test.ts`, `tests/unattended-batch-plan.test.ts`, `tests/unattended-batch-schedule.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/explicit-phase-entry-run-contract.test.ts`. Generated Claude bundle `plugins/immune-brain/dist/claude/mcp-server.mjs` (S1, S3); release changesets under `.changeset/`.

## Out of scope

Grill-me and imm-planner flows; Kernel reason codes for rejections; any time-based token expiry; push or PR automation.
