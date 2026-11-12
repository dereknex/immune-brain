# Tri-host capability alignment

**Status**: Candidate; no execution authority.
**Initiative**: `tri-host-capability-alignment`; GitHub carrier, eight Slices S1–S8, approved by the literal user on 2026-11-11.
**Design risk**: High — the work changes three Host composition roots, two run-continuation state-machine adapters, private persisted authority-correlation files, CLI Review process boundaries, generated packages and live-Host certification.
**Design views**: architecture layers (Kernel/assurance/host-core/adapters); service/component interfaces (capability declarations and Host profiles); data flow (Hook/tool events into continuation and verifier observation); state transitions (run continuation); temporal sequence (live Antigravity certification). Static package topology has no independent runtime behavior beyond these views.
**Diagram decision**: required
**Diagram reason**: one continuation state diagram makes the shared event sources, non-authoritative observations, pause limits and Kernel-owned settlement boundary explicit across all three Hosts.
**Document language**: English, following Planner's default document policy.

## Outcome

Deliver one declarative Host capability contract and align the confirmed gaps without introducing a registry or changing Kernel authority. Antigravity private state uses the shared private-file protections; Pi uses the shared verifier observation, `HostRuntime` and run-continuation machinery while keeping its in-process tools and native UI; Antigravity adopts the complete shared continuation state machine; Pi CLI Review disables ambient extensions, skills and MCP and narrows its tool set; Antigravity's CLI Review remains explicitly guard-only; and a real Antigravity run certifies the complete Managed lifecycle and resolves the P8/Skill-entry capability questions.

The complete confirmed outcome includes live certification. Conformance fixtures, generated documentation and a disclosure are not substitutes for that phase. S8 remains incomplete until its real-Host evidence exists and passes.

## Sources

- Brainstorm manifest `BR-REQ-1` through `BR-REQ-8`, `BR-DEC-1` through `BR-DEC-6`, `BR-OUT-1` through `BR-OUT-3`, `BR-Q-1`, and `BR-SCN-1` through `BR-SCN-4` from the preceding `clarify` result.
- The user's decomposition answer `5. B 其他采用推荐` and subsequent approval of the Initiative name, slug and eight-Slice decomposition.
- Repository evidence below, read at HEAD `85c553f5`; Pi CLI loading behavior additionally checked against installed Pi 1.5.2.

## Threat model and supported environment

Hook payloads and MCP metadata come from the installed Host and are trusted for shape, not content. Cache files under the OS temporary directory face a local adversary able to plant a symlink, foreign-owned file, non-regular file or incorrectly permissioned file; these inputs must fail closed. Review CLI processes are trusted to return verdict bytes but not to preserve the checkout: the existing tracked-tree guard remains mandatory, and untracked files remain outside its coverage. Live evidence names the exact Host version and commands; an absent executable, skipped step, failed step or stale report is not certification. Supported environment is macOS/Linux, Bun for tests, Node for packaged bundles, Git with UTF-8 paths, and Antigravity on its declared supported versions for S8. No new network provider or credential channel is introduced; S8 uses the user's installed Antigravity and existing GitHub projection only.

## Discovery evidence

- ADR 0038 and `docs/reference/layering-rules.md:11-17` establish `kernel ← assurance ← host-core ← adapters`; `tests/runtime-layering-boundary.test.ts:20-33` names Claude, Antigravity and Pi as adapters and forbids host-to-host and inner-layer violations.
- `runtime/antigravity/lane_guard.ts:345,356,441,467,598` uses ordinary file reads/writes for entry, admission and confirmation state. `host-core/private_file.ts` supplies ownership, mode and `O_NOFOLLOW` checks through `appendPrivate` and `readPrivate`.
- `host-core/run_continuation_session.ts:168-305` owns typed events, persisted correlation, native-failure pause and the seven-Stop bound; `:313-320` retains Antigravity's simplified decision, explicitly recording old Spec D11. `.pi-extension/pi-run-continuation.ts` separately owns the same binding/review/failure concerns.
- `.pi-extension/pi-canary-assurance-progression.ts:74-126` forks verifier observation, while `host-core/verifier_observation.ts` already owns the neutral state machine. `HostRuntime` already includes `withSettleCommit` and terminal tracker handling at `host-core/runtime.ts:567-590,646-668`.
- `.pi-extension/imm-unattended-batch.ts` duplicates the batch flow owned by `HostRuntime.startUnattendedBatch`/`retireStaleBatch`; `.pi-extension/imm-canary-work.ts:1735` also calls that duplicate for continuation.
- `assurance/cli_review.ts:64-90` gives Claude preventive restrictions but Pi and Antigravity no ambient-configuration or tool restrictions. `tests/cli-review-dispatch.test.ts:368` pins the old Pi behavior. Installed Pi 1.5.2 supports `--no-extensions`, `--no-mcp`, `--no-skills`, explicit `--skill`, and `--tools`; its resource loader merges explicit skill paths even when discovery is disabled. `scripts/review-eval/run.ts:87` is existing restricted-Pi prior art. Pi `--tools` cannot constrain Bash arguments.
- `docs/specs/review-cli-stage.spec.md` D9 and ADR 0037 decision 4 record the deliberate old Pi choice. `docs/specs/antigravity-harness.spec.md` D11 records the deliberate old Antigravity continuation choice; this Initiative supersedes both under the confirmed Brainstorm decisions.
- `antigravity/mcp_server.ts` already supplies `resolveHostCall`, `consumePhaseAdmission`, `readRunToolSession` and `requestConfirmation`; `antigravity/review_host.ts` already treats PostToolUse `result` as terminal. The earlier analysis's claims that these seams are absent are stale (BR-DEC-6).
- `antigravity/lane_guard.ts:519-523` returns empty PreInvocation steps. Repository evidence does not establish whether Antigravity exposes model-invoked Skill tools or supports active-task injection; S8 must probe these rather than assume parity.
- `plugins/immune-brain-antigravity/README.md:31-39` discloses shell-less native Review roles and no complete lifecycle certification. Open issues #451 and #469 track the live verifier and privileged-gate evidence. `which agy` returned no executable in the planning environment, resolving BR-Q-1 as an environment blocker for S8, not as a passed check.
- Generated/runtime mirrors are owned by `scripts/build-claude-plugin.ts`, `scripts/build-antigravity-plugin.ts`, `scripts/sync-dist-docs.ts`, `scripts/dist-sync-manifest.ts` and `docs/agents/derived-files.json`; no generated output is hand-edited.

## Decisions and technical design

### D1 — Capability declaration, not dispatch (source: BR-REQ-1)

`host-core/capability.ts` defines the nine port IDs P1–P9 and the levels `certified`, `conformance-only`, `guard-only` and `unsupported`, with a short evidence/limitation record per cell. Each adapter exports exactly one declaration at its composition root: Claude in `runtime/claude/capability.ts`, Antigravity in `runtime/antigravity/capability.ts`, and Pi in `.pi-extension/pi-capability.ts`. `scripts/render-host-capability.ts` explicitly imports those declarations and renders `docs/reference/host-capability.md`; it performs no runtime lookup or dispatch. Conformance checks reject an unknown port, duplicate/missing cell, unsupported level and stale generated table. Later Slices update their own adapter's declaration and regenerate the same table.

Port meanings: P1 call correlation/phase admission; P2 native confirmation; P3 verifier observation; P4 run continuation; P5 Review/Verify CLI isolation; P6 Lane Executor spawn; P7 private cache storage; P8 active-task/model-entry Host integration; P9 background wake. `unsupported` carries a reason. A native in-process implementation with no filesystem trust boundary may mark P7 `certified` with that evidence rather than inventing a not-applicable level.

### D2 — No registry or autonomous dispatcher (source: BR-DEC-4)

ADR 0004 remains authoritative. The renderer and tests may enumerate the three composition roots explicitly; production control flow never selects a Host through the capability declaration. Existing profile wiring remains the only adapter selection mechanism.

### D3 — Antigravity private state (source: BR-REQ-2)

Entry logs use `appendPrivate`/`readPrivate`. Admission and confirmation grants use a shared private write helper with `O_NOFOLLOW`, regular-file, ownership and `0600` checks, and are consumed once through `readPrivate` plus the existing private drop behavior. `ensurePrivateDir` remains mandatory. A planted symlink, foreign-owned file, non-regular file, wrong mode or unreadable/truncated grant produces the existing null/refusal path, never a fallback ordinary read. Cache names and the admission ID `${conversationId}:${stepIdx}:${operation}` remain unchanged. The same helper set serves every adapter; no Antigravity copy is introduced.

### D4 — Pi verifier observation (source: BR-REQ-6)

Pi binds `VerifierObservation` with an in-memory typed event log, `terminal: "result"`, `actorPrefix: "pi"`, and the exact existing Agent dispatch envelope. The Pi adapter retains its pre-dispatch reservation/marker/parameter equality guard, then maps an accepted Agent call to `start` and its observed bytes to `result`, keyed by Pi's tool call ID. Unknown reservations, altered prompts/parameters, duplicate dispatch and conflicting result bytes fail closed. Only the coordinator's `submit_verification` consumes an `ok` inspection; observation alone settles nothing.

### D5 — Pi HostRuntime composition (source: BR-REQ-6)

A Pi composition root owns one `HostRuntime` with `hostId: "pi"`, its ReviewHost, probe, confirmation reference, Lane runtime factory and selected-parent port. The Pi extension translates Extension API tool calls and contexts to `ToolMeta` and renders results/UI. `AssuranceProgression extends AssuranceCoordinator`, the standalone Pi batch execution flow and their duplicate settle/tracker code are retired; no compatibility copy remains. Existing public Pi tool names and schemas, native confirmation dialogs, Task Rail, foreground Agent dispatch and result rendering remain adapter concerns. Pi does not gain an MCP stdio transport (BR-OUT-2).

### D6 — Shared continuation semantics (source: BR-DEC-5)

Pi and Antigravity map native input/tool/agent/stop events into `RunContinuationEvent` and call `applyRunContinuationEvent`; native adapters own only parsing and rendering. Claude behavior remains unchanged. The pause text names the actual Host rather than hard-coding Claude. Thresholds are three native-operation failures, one unchanged continuation observation, and seven consecutive active Stop/settle boundaries. A stalled no-progress observation yields the turn without spending the entry; a pause or terminal settlement revokes it. Pi's in-memory entry tokens remain non-authoritative session memory, while shared continuation metadata is private cache state and is dropped when no live entry exists.

```mermaid
stateDiagram-v2
    [*] --> Unbound
    Unbound --> BoundTask: correlated status observes active claim + run_id
    Unbound --> BoundParent: confirmed batch receipt with persisted identity
    BoundTask --> BoundTask: tool/reviewer/stop events; re-read Kernel projection
    BoundParent --> BoundParent: tool/reviewer/stop events; observe batch and Parent Git
    BoundTask --> Paused: third native failure / decision pause / seventh boundary
    BoundParent --> Paused: third native failure / decision pause / seventh boundary
    BoundTask --> Unbound: terminal settlement / unbound / no live entry
    BoundParent --> Unbound: terminal settlement / unbound / no live entry
    Paused --> [*]: entry revoked; literal same-Host drive required
```

Trigger sources are literal prompts, correlated tool calls/results, reviewer dispatch/return/stop, Stop or Pi settle boundaries, and session shutdown. States are unbound, bound task, bound Parent, waiting/no-progress, paused and terminal-unbound. Promise resolution, process exit, elapsed time, Hook text and child acknowledgement are observations only. Kernel projection and persisted batch/TaskRecord facts own continuation decisions; Kernel settlement alone owns terminal authority; literal same-Host `drive` owns recovery from pause. Same-state-machine owners are `host-core/run_continuation_session.ts`, `assurance/run_continuation.ts`, the three adapter continuation modules, the Pi phase-entry ports, and the coordinator/batch projection readers they call.

### D7 — Antigravity continuation mapping (source: BR-REQ-3)

Antigravity uses its `conversationId` as the continuation session and `${conversationId}:${stepIdx}` as the correlated tool ID. PreToolUse/PostToolUse map privileged MCP calls and reviewer dispatches; Stop maps to a boundary only when the payload carries a usable transcript/execution identity, otherwise it fails closed to no automatic continuation. Batch Parent binding uses the persisted batch identity exactly as on Claude. `decideAutomatedStop` and its old D11 exemption are deleted, not retained as a fallback. BR-SCN-2 is exercised through the real Antigravity Hook rendering seam with a live-entry fixture and seven real typed Stop events.

### D8 — Pi CLI Review restrictions (source: BR-REQ-4)

The Pi reviewer argv adds `--no-extensions --no-mcp --no-skills`, an explicit `--skill <absolute authority-review/SKILL.md>`, and `--tools read,grep,find,ls,bash`, retaining `--print --no-session`, model and effort. The explicit skill path resolves from the package root in both source and bundled layouts. This disables ambient user configuration while preserving the Review protocol and immutable-Git capability. Bash arguments cannot be restricted to Git, so this is narrowed privilege plus the tree guard, not a preventive read-only sandbox; P5 stays `guard-only` and the limitation is disclosed. ADR 0037 decision 4 is amended; this Spec supersedes `review-cli-stage` D9 by explicit reference without binding that historical Spec as a second execution baseline. BR-SCN-3 asserts the exact observable argv, including the explicit skill exception and the absence of discovered configuration.

### D9 — Antigravity Review residual risk (source: BR-REQ-5)

`review_host: antigravity` remains supported and `guard-only`: `agy --print` has no restriction flag, the shell-less native roles cannot perform the shared immutable-Git checks, and the tree guard does not cover untracked files. ADR 0037, the capability table and the Antigravity README state this residual risk explicitly. This Slice does not remove a configured Host or pretend the guard is prevention.

### D10 — Antigravity P8 and model-entry probe (source: BR-REQ-7)

S8 records live payloads/capabilities for PreInvocation injection and model-invoked Skill entry. If injection is supported, PreInvocation emits the same host-neutral active-task notice used by Claude; if not, P8 remains `unsupported` with the observed reason. If a model-callable Skill tool exists, its gated phase operations use the existing `admitPhaseOperation` and deny model self-entry without a live phase; if no such tool exists, the declaration records that absence rather than adding a fictitious Hook matcher. Probe output and any implementation enter the live evidence report.

### D11 — Live certification and evidence (source: BR-REQ-8)

A project-owned `scripts/verify-antigravity-live.ts` drives or validates a real installed `agy` run through literal-user Enrollment, deterministic QA, Review, verification when applicable, and completion. It records Host version, plugin digest, Task ID, exact commands, native-gate observations, verifier start/result correlation, continuation/pause observations, final `done` projection and P8/Skill probe results in `docs/reports/antigravity-live-certification.md`. A missing executable, absent report, skipped phase, non-terminal task or failed command fails the focused evidence test. Only after that evidence passes may the README and declaration claim certification and may S8 close #451 and #469 with links to the evidence. BR-SCN-4 remains manual because real Host/model interaction cannot be proven by a fixture.

### D12 — ADR and architecture convergence (source: BR-DEC-1)

ADR 0039 records the capability contract and tri-host profile composition. ADR 0038 is amended to remove `Pi stays outside`; the direction remains `kernel ← assurance ← host-core ← adapters (claude, antigravity, pi)`. When Pi composition lands, `CONTEXT.md` and `docs/reference/layering-rules.md` describe the current three-adapter reality. Historical Spec decisions are superseded by explicit references in this Spec and the ADRs; the historical files remain read-only and are not added as second bound Specs, so the old choice remains visible rather than being silently rewritten.

### D13 — Packaging and generated evidence (source: repository evidence `docs/agents/derived-files.json`)

Each runtime Slice regenerates the Claude bundle, Antigravity inventory and packaged documentation affected by its sources, adds any new generated path to the owning manifest, and carries one changeset. Focused acceptance runs the owning package checks and `bun run typecheck`; it never treats generated-file presence alone as behavior evidence.

## Slices

| Slice | Task | Result when it alone has landed | Remaining gap | Depends on |
| --- | --- | --- | --- | --- |
| S1 | `host-capability-contract` | Maintainer sees a machine-checked P1–P9 table for all three Hosts; ADR 0039 forbids dispatch use. | Security, migration, continuation, CLI and live levels still need their owning Slices. | — |
| S2 | `antigravity-private-state` | Antigravity cache state refuses planted/foreign/wrong-mode files while normal admission and confirmation still work. | AG continuation and live certification remain open. | S1 |
| S3 | `pi-verifier-observation` | Pi uses the shared observation machine with unchanged dispatch guards and receipt behavior. | Pi runtime/batch and continuation forks remain. | S1 |
| S4 | `pi-host-runtime-composition` | Pi task and Batch tools compose `HostRuntime`; duplicate coordinator/batch implementations are gone and UI is unchanged. | Pi continuation still needs shared events. | S3 |
| S5 | `pi-shared-continuation` | Pi uses shared continuation persistence/events and the common limits; pause still requires literal same-Host entry. | Other-Host and CLI gaps are unaffected. | S4 |
| S6 | `antigravity-shared-continuation` | AG Stop supports task/Parent binding, retry/stall handling and the seven-boundary pause. | Real Host behavior remains uncertified. | S2 |
| S7 | `reviewer-cli-isolation` | Pi Review argv disables ambient configuration and names its narrowed tools; AG residual risk is explicit. | Bash/untracked-file guard limitation remains disclosed, not hidden. | S1 |
| S8 | `antigravity-live-certification` | A real AG run supplies full lifecycle evidence, resolves P8/Skill support, upgrades justified cells and closes #451/#469. | None for this Initiative once every other Slice is also settled. | S2, S6, S7 |

S2, S3 and S7 may proceed in parallel after S1. S6 follows S2; S4 follows S3 and S5 follows S4. S8 waits for S2, S6 and S7. Actual parallel groups follow `imm-kernel intent overlap`.

## Acceptance and verification mapping

Every descriptor runs from the task working directory with the existing Bun installation and tracked tests. No acceptance installs a dependency, uses the whole test suite, or treats a skip as success.

| Slice / AC | Source | Focused descriptor and agreed seam | Observable done-looks-like and controls |
| --- | --- | --- | --- |
| S1 AC1 | BR-REQ-1 | `bun test tests/host-capability-contract.test.ts` | Table lists every Host/port exactly once; positive complete render, negative unknown/duplicate/missing cells, bound only four levels; BR-SCN-1 maps here. |
| S1 AC2 | BR-DEC-4 | `bun test tests/runtime-layering-boundary.test.ts tests/host-capability-contract.test.ts` | Explicit composition imports pass; production registry/dispatcher references and cross-adapter imports fail. |
| S1 AC3 | repository evidence `scripts/dist-sync-manifest.ts` | `sh -c "bun scripts/sync-dist-docs.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun run typecheck"` | Source and packaged tables/declarations are current and typed. |
| S2 AC1 | BR-REQ-2 | `bun test tests/dual-host-assurance-conformance.test.ts` | Shared helper accepts owned `0700/0600` state and rejects symlink, foreign/non-regular/wrong-mode inputs without fallback reads. |
| S2 AC2 | BR-REQ-2 | `bun test tests/antigravity-assurance-conformance.test.ts` | Real Hook/MCP admission and native grant succeed once; replay, truncated grant and tampered files refuse; cache key remains conversation/step/operation. |
| S2 AC3 | repository evidence `docs/agents/derived-files.json` | `sh -c "bun scripts/build-claude-plugin.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun run typecheck"` | Both runtime packages contain the same helper behavior. |
| S3 AC1 | BR-REQ-6 | `bun test tests/pi-canary-assurance-progression.test.ts tests/pi-subagent-dispatch-observability-contract.test.ts` | Real Pi Agent dispatch/result seam settles one receipt; unknown/altered/duplicate/conflicting events refuse or stay pending as appropriate. |
| S3 AC2 | BR-REQ-6 | `bun test tests/dual-host-assurance-conformance.test.ts tests/pi-canary-assurance-advance.test.ts` | Shared machine passes Host profiles; packet-handle, missing-terminal and consumed-receipt bounds remain. |
| S3 AC3 | repository evidence `plugins/immune-brain/.pi-extension/package.json` | `bun run typecheck` | Pi composition and tests typecheck. |
| S4 AC1 | BR-REQ-6 | `bun test tests/pi-canary-assurance-progression.test.ts tests/pi-canary-work-extension.test.ts tests/pi-canary-assurance-authority.test.ts` | Pi public tools preserve status/advance/review/verify/authorization results and native dialogs through the real composition root. |
| S4 AC2 | BR-REQ-6 | `bun test tests/pi-batch-authority.test.ts tests/pi-batch-acceptance-integration.test.ts tests/claude-batch-authority.test.ts` | Single-task, Parent, resume, stop and retirement receipts retain identity; failed/cancelled gates do not manufacture batch state. |
| S4 AC3 | BR-REQ-6 | `bun test tests/runtime-layering-boundary.test.ts tests/pi-canary-package-boundary.test.ts tests/layering-rules-contract.test.ts` | Duplicate Pi coordinator/batch source is deleted, adapters remain siblings, current docs name three adapters. |
| S4 AC4 | repository evidence `plugins/immune-brain/.pi-extension/package.json` | `bun run typecheck` | Pi entrypoints and test harnesses typecheck after retirement. |
| S5 AC1 | BR-DEC-5 | `bun test tests/pi-run-continuation.test.ts tests/pi-canary-assurance-continuation.test.ts` | Real Pi input/tool/settle events bind task and Parent, continue automated work, wait on users/no-progress, and revoke on settlement. |
| S5 AC2 | BR-DEC-5 | `bun test tests/pi-run-continuation.test.ts tests/claude-run-continuation.test.ts` | Third native failure and seventh active boundary pause with Host-neutral text; paused gates deny until literal entry; old metadata remains bounded/readable or fails closed. |
| S5 AC3 | repository evidence `host-core/run_continuation_session.ts` | `bun test tests/pi-batch-authority.test.ts tests/runtime-layering-boundary.test.ts && bun run typecheck` | Selected-parent correlation and layering hold with shared Pi continuation ports. |
| S6 AC1 | BR-REQ-3 | `bun test tests/antigravity-assurance-conformance.test.ts` | Real AG Hook payload mapping binds task/Parent and renders continue/pause; BR-SCN-2's seventh Stop pauses with same-Host recovery. |
| S6 AC2 | BR-REQ-3 | `bun test tests/antigravity-assurance-conformance.test.ts tests/claude-run-continuation.test.ts` | Positive shared parity; negative replay/foreign correlation/user wait/missing boundary; bound three failures, one unchanged observation and seven Stops. Old `decideAutomatedStop` is deleted. |
| S6 AC3 | repository evidence `docs/agents/derived-files.json` | `sh -c "bun scripts/build-claude-plugin.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun run typecheck"` | Shared continuation behavior is packaged for both MCP Hosts. |
| S7 AC1 | BR-REQ-4 | `bun test tests/cli-review-dispatch.test.ts` | Pi argv has all three ambient-disable flags, explicit existing skill path and `read,grep,find,ls,bash`; negative ambient config/implicit skill, bound unchanged model/effort/packet and other-Host argv. BR-SCN-3 maps here. |
| S7 AC2 | BR-REQ-5 | `bun test tests/host-capability-contract.test.ts tests/antigravity-host-package.test.ts` | Pi and AG P5 read `guard-only`; README/ADR disclose Bash/untracked/native-role limitations and do not claim prevention. |
| S7 AC3 | repository evidence `assurance/cli_review.ts` | `sh -c "bun scripts/build-claude-plugin.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun run typecheck"` | Review argv changes and skill resolution are packaged and typed. |
| S8 AC1 | BR-REQ-7 | `bun test tests/antigravity-assurance-conformance.test.ts tests/antigravity-host-package.test.ts` | Probe-driven P8/Skill behavior has positive support or explicit unsupported evidence; no fictitious Hook or certification. |
| S8 AC2 | BR-REQ-8 | `bun test tests/antigravity-live-certification.test.ts` | Evidence validator accepts only a current complete successful report; absent `agy`/report, stale plugin digest, skipped phase, failed command or non-`done` projection fails. |
| S8 AC3 | BR-REQ-8 | `sh -c "bun scripts/build-antigravity-plugin.ts --check && bun scripts/sync-dist-docs.ts --check && bun run typecheck"` | Final capability table, README certification and generated package agree with validated evidence. |

## User scenarios

- **BR-SCN-1** (Slice S1, `automated` → S1 AC1). Actor: maintainer. Given: the repository at the delivered revision. When: they open the host capability table. Then: they see each of Pi, Claude Code and Antigravity listed against ports P1–P9 with one level per cell.
- **BR-SCN-2** (Slice S6, `automated` → S6 AC1). Actor: Antigravity user. Given: an active Managed task whose Stop hook keeps returning continue. When: the seventh consecutive Stop occurs. Then: the run pauses and Antigravity shows a message telling them to resume explicitly in the same Host.
- **BR-SCN-3** (Slice S7, `automated` → S7 AC1). Actor: Pi user with `review_host: pi`. Given: a task reaching Review. When: the reviewer process starts. Then: the reviewer command line shown in the review evidence includes `--no-extensions --no-skills --no-mcp` and the narrowed `--tools read,grep,find,ls,bash` list; the residual Bash limitation is disclosed rather than called read-only.
- **BR-SCN-4** (Slice S8, `manual`; no acceptance ID). Actor: Antigravity user. Given: an Antigravity install with this release. When: they run `drive` through Enrollment, QA, Review and completion. Then: the task reaches `done` and the README states the lifecycle as certified. **Manual reason**: this requires a real installed Host, native user confirmation and real model Review; fixtures cannot certify those interactions. S8 AC2 validates the recorded evidence but is not a substitute for performing the scenario.

S2, S3, S4 and S5 have no new user-visible feature: they repair local tamper resistance or replace internal implementations while preserving public Host behavior. Their observable security/refusal and compatibility results are pinned directly to acceptance rather than inventing scenarios.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D1; S1 AC1–AC3 |
| BR-REQ-2 | D3; S2 AC1–AC3 |
| BR-REQ-3 | D7; S6 AC1–AC3 |
| BR-REQ-4 | D8; S7 AC1, AC3 |
| BR-REQ-5 | D9; S7 AC2 |
| BR-REQ-6 | D4, D5, D6; S3 AC1–AC3, S4 AC1–AC4, S5 AC1–AC3 |
| BR-REQ-7 | D10; S8 AC1 |
| BR-REQ-8 | D11; S8 AC2, AC3 and BR-SCN-4 |
| BR-DEC-1 | D12; S1/S4 architecture acceptance |
| BR-DEC-2 | D8; S7 AC1 |
| BR-DEC-3 | D7; S6 AC1, AC2 |
| BR-DEC-4 | D2; S1 AC2 |
| BR-DEC-5 | D6; S5 AC1–AC3, S6 AC1, AC2 |
| BR-DEC-6 | Discovery evidence; stale alleged gate/verifier defects are not reimplemented |
| BR-OUT-1 | D2; no registry/dispatcher |
| BR-OUT-2 | D5; Pi remains in-process Extension API, no MCP transport |
| BR-OUT-3 | D1; P9 Pi remains `unsupported` with Host limitation and no implementation Slice |
| BR-Q-1 | Resolved as an environment fact: no `agy` in the planning environment; S8 AC2 fails without real evidence and only S8 completion is blocked |
| BR-SCN-1 | S1 AC1 |
| BR-SCN-2 | S6 AC1 |
| BR-SCN-3 | S7 AC1 |
| BR-SCN-4 | S8 manual scenario plus AC2 evidence validation |

## Assumptions and recovery

- S1 declarations describe evidence at the Slice that lands them, not aspirational final levels. `certified` requires live evidence; conformance alone cannot promote a cell.
- Existing in-flight Antigravity grant files that fail the new ownership/mode checks are refused; the user retries through the same-Host literal entry. No authority is migrated or synthesized.
- Pi continuation metadata may gain private on-disk state, but no live entry survives process/session loss. Resuming without a live token drops unusable continuation metadata and requires explicit `drive`.
- S8 requires an installed, authenticated Antigravity environment and a real user at its native gates. The planning environment lacks `agy`; this is a concrete blocker to S8 completion, not to authoring the independent Slices.
- Any discovery that real Hook payloads cannot support the agreed correlation/boundary seam stops the affected Slice for Planner revision; the Executor must not invent a new authority protocol.

## Devil's Advocate Audit

- **Rollback resilience.** S1 is additive and revertible. S2 refuses unsafe legacy cache files without deleting Kernel state. S3–S5 are sequential Pi composition changes; reverting the merged Slice restores its previous file set, and no two Slices require a destructive data migration. S6 deletes the simplified decision only after characterization parity exists. S7 can restore the previous argv and ADR note as one unit. S8 changes certification only after evidence passes; a failed live run leaves prior disclosures intact. Generated artifacts are regenerated, never manually patched.
- **Verification vanity.** Tests exercise real composition roots and Hook/CLI seams, not merely type presence. Negative controls include tampered files, replayed grants, altered Agent dispatch, duplicate/conflicting observations, absent boundary identity, paused native gates and missing/failed live evidence. Structural checks prove forked implementations are deleted rather than wrapped forever. The Pi scenario checks actual argv rather than claiming tool-name allowlisting constrains Bash.
- **Spec dilution detection.** Every BR item maps above. Live certification is a required phase with its own Slice and manual scenario; marking it `guard-only`, writing a README, or passing fixtures cannot close S8. Pi's full profile migration includes observation, HostRuntime/Batch and continuation, not just one import. P9 remains explicitly excluded rather than silently dropped.
- **False-compromise check.** No false compromise detected. Keeping native UI in adapters versus moving machinery into host-core is the established ownership boundary, not a trade-off requiring an inventive transform. The unavoidable residual is Host capability: Pi Bash cannot be argument-restricted and Antigravity lacks a CLI restriction flag; D8/D9 disclose and bound it rather than inventing a preventive claim.

## Execution posture

`characterization-first` for S3–S6: run and preserve the existing Pi/Claude/Antigravity observation, Batch and continuation behavior at the named seams before deleting adapter implementations. S2 is security-focused test-first around the enumerated local-file attacks. S7 is argv/contract test-first. S8 records a cleanup condition for every temporary task, Lane, session and report fixture; failed live evidence never closes the source issues or upgrades a capability level.
