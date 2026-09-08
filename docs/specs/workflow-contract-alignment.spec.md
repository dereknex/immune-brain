# Spec: Workflow Contract Alignment

**Task ID**: `workflow-contract-alignment`
**Owner**: user
**Status**: Candidate
**Design risk**: Medium
**Design risk rationale**: Clarifies cross-role instructions against existing authority behavior. Miswording can cause redundant stops or unauthorized evidence even though no runtime transition changes.
**Diagram decision**: not_required
**Diagram reason**: The discrepancy and ownership table below explains existing operations without introducing a new state machine.

## Outcome And Approval

This is S2 of the user-approved `Proportionate Agent Instructions` Initiative, slug `proportionate-agent-instructions`. Remove contradictory instructions around enrollment requests, carrier checks, evidence, completion and role handoffs while preserving the actual runtime permission boundary. It can be accepted independently of S1; recommended order is S1, S2, S3 to avoid shared-document conflicts. Planning/publication is plan-only and does not enroll this candidate.

The prior audit's consistency changes were approved in full. User requirements for fewer redundant questions and proportionate execution are covered here by A1-A3; autonomy policy and the clean AGENTS belong to S1, six Skill trigger descriptions to S3. Global/third-party Skills and the already delivered reusable audit Skill remain outside this batch. No unresolved user-owned decision remains.

## Discovery Evidence

- `plugins/immune-brain/dist/imm-planner.md` and its loader mix "never enrolls" with direct native Enrollment requests, and active-owner routing with revision preparation.
- `plugins/immune-brain/dist/imm-loop.md` unconditionally requires `tracker_associated` for candidate enrollment, although Planner limits publication to GitHub-carried Initiatives. It also mixes stop wording with direct `awaiting_user` authorization handling.
- `plugins/immune-brain/runtime/prompts/executor.md` requests structured evidence through the read-only Loop action and uses an active Step as its default frame. `runtime/prompts/pr-fix.md` carries a supplied Plan boundary; distinguish legacy context from current TaskIntent ownership rather than removing legacy runtime support.
- `plugins/immune-brain/BASELINE.md` references matching a Plan and an undefined Direct completion contract. `IMMUNE.md` has current role summaries alongside old Step/preplan terminology.
- `docs/reference/subagent-dispatch-protocol.md` and Baseline mix read-only parallel eligibility with Pi's one-foreground-child scheduling limit.
- `plugins/immune-brain/runtime/loop_contract.ts`, `runtime/role_prompt_bridge.ts` and `.pi-extension/imm-canary-work.ts` establish read-only action construction and explicit foreground role envelopes. They are reference evidence, not mutation scope.
- `plugins/immune-brain/runtime/kernel/completion.ts` and `runtime/kernel/projection.ts` remain the completion and available-operation owners; prompt text cannot mint attestations or change obligations.
- `tests/imm-planner-kernel-intent-contract.test.ts`, `tests/carrier-enrollment-gate-contract.test.ts`, `tests/loop-execution-routing.test.ts`, `tests/baseline-packaging-contract.test.ts` and `tests/managed-authority-failure-contract.test.ts` cover the highest existing local contract and envelope seams.
- `scripts/dist-sync-manifest.ts` maps Baseline, role prompts and dispatch protocol copies; `scripts/sync-dist-docs.ts` regenerates these without changing owned Skill contracts.

### Prior Decisions

ADR `docs/adr/0003-internal-role-prompt-routing.md` preserves coordinator authority and bounded advisory evidence. `docs/solutions/rejected-origin-coverage-authority-expansion.md` rejects moving Spec/Plan writing into Brainstorm or scope judgment into QA. The approved audit at `docs/reports/agent-instruction-audit-2026-09-08.md` identifies ambiguity; it does not authorize runtime rewrites. Preserve legacy runtime behavior while fixing current-facing instruction truth.

## Technical Design

**Design views**: Role ownership and existing call sequence are relevant. No new architecture layer, data format, state transition or public API is introduced.

| Surface | Instruction change | Boundary retained |
| --- | --- | --- |
| Planner enrollment | Planner may request the host native Enrollment gate for an execution-bearing request; only the confirmed gate grants execution authority. Plan-only stops at validated candidates and approved carrier publication. | No unconditional enrollment, duplicate chat pre-confirmation, or host fallback on failure. |
| Carrier prerequisite | Require complete publication only for an identified GitHub-carried Initiative. Standalone TaskIntents and Local Initiatives do not require `tracker_associated`. Verify uncertain membership before treating it as exempt. | Full approved batch and failed-publication blocking remain for GitHub Initiatives. |
| Executor evidence | Run permitted diagnostic checks and return commands/outcomes to Parent. The Loop action only constructs an envelope; it does not store evidence. | Executor cannot mint QA/Review attestations or mutate workflow state. |
| Completion | Direct completion requires the requested result and passing required verification. Disclosing a failed or unavailable required check reports incomplete work, not success. Check breadth follows the task and established project requirements, not a universal full-repository rule. Managed completion additionally comes from fresh Kernel terminal projection against the TaskIntent. | No Plan/Step ledger as substitute, no reporting success from diagnostic output alone, and no deleting, skipping or weakening valid checks to manufacture a pass. |
| Missing evidence | Collect missing in-scope evidence and continue. Autonomously diagnose, repair and rerun failed ordinary local checks within the authorized scope; only a demonstrated scope/acceptance mismatch or protected decision needs escalation. | No silent scope expansion or unrelated fixes to make a pre-existing failure disappear. An unavailable required check remains an explicit blocker. |
| Revision preparation | The current Loop may obtain a complete proposed decision delta from Planner reasoning without creating a new owner or overwriting enrolled sidecars. | Kernel applies revisions, including the existing native gate for breaking revisions. |
| Awaiting user | Invoke the available native authorization action directly; end dependent execution only if the decision remains unresolved, is cancelled, or fails. | One native decision; failed authorization stays fail-closed with the existing same-host recovery action. |
| Advisory dispatch | Read-only eligibility is distinct from scheduling. On Pi use one foreground child at a time; optional failures fall back to bounded inline investigation. | Returned envelopes, host capabilities and independent Review obligations are unchanged. |

The user-approved post-publication supplement makes the completion distinction explicit in A2: disclosure is not successful verification, and ordinary in-scope test failures lead to repair and rerun without another approval round. This refines instruction truth within existing acceptance IDs, descriptors and scope; it does not change Kernel completion obligations or authorize implementation during planning.

### Sequence And Recovery

Existing flow remains candidate preparation, native gate when execution was requested, enrolled execution, freeze, deterministic QA, required independent Review and Kernel settlement. Cancellation, timeout, provider failure, dispatch failure, session interruption and stop remain governed by the current Kernel/host operations; this Slice introduces or changes none of their transitions. Current Loop consumes the fresh projection, not a local promise, elapsed time or child acknowledgement, as authority. No new durable owner or receipt is created by rewording a prompt.

A Loop-requested revision is a proposed object until the existing revision operation accepts it. Preserve on-disk enrolled sidecars while preparing it. If the clarified contract cannot be satisfied without changing runtime behavior, report the concrete missing operation for separate planning rather than expanding this TaskIntent.

## Acceptance And Verification

| ID | Required evidence | Focused descriptor |
| --- | --- | --- |
| A1 | Planner distinguishes requesting approval from granting authority; plan-only still stops; Loop carrier requirement covers GitHub Initiatives only and retains full-batch failure blocking. | `bun test tests/imm-planner-kernel-intent-contract.test.ts tests/carrier-enrollment-gate-contract.test.ts` |
| A2 | Executor reports diagnostic evidence without claiming writes through read-only actions; failed in-scope local checks continue through repair and rerun; failed or unavailable required checks cannot be reported as completion; current ownership and real Loop envelopes remain read-only and foreground. | `bun test tests/loop-execution-routing.test.ts tests/baseline-packaging-contract.test.ts` |
| A3 | Revision preparation, awaiting-user handling and advisory scheduling have one unambiguous owner; cancellation, protected native decisions and same-host failure behavior remain; generated copies match. | `bun test tests/managed-authority-failure-contract.test.ts tests/dist-docs-sync-contract.test.ts` |

Extend these tests against canonical and packaged instruction surfaces. Include standalone, Local and GitHub Initiative cases; execution versus plan-only requests; missing diagnostic evidence versus true scope mismatch; autonomous repair and rerun versus an unrelated pre-existing failure; unavailable required verification versus completed verification; active-owner revision preparation; available authorization action versus cancellation/failure; and optional advisory failure versus mandatory Review. Keep the existing runtime envelope assertions. Static tests prove instruction consistency, not that every model follows prose. Descriptors use Bun 1.3.14, 30 seconds and 32 KiB per check. Planning validates their structure only; final implementation also runs root typecheck, regression tests and generated-doc checks.

## Scope And Non-Goals

The TaskIntent lists exact instruction sources, affected tests, generated copies and this Spec's active/archive paths. Shared S1 sources may be edited only for this Slice's consistency outcome. Preserve S1's new autonomy policy if already applied and S3's loader narrowing if already applied. Leave `runtime/loop_contract.ts`, the bridge, extension tools, Kernel reducers/storage/projections, historical validation and archived planning evidence unchanged. No new scheduling, tool, receipt, generic dispatcher, authority gate, compatibility layer or external Skill change.

## Devil's Advocate Audit

- **Rollback resilience**: Source prompt, test and generated-copy changes revert together without data migration. Revert this Slice's diff rather than restoring whole shared files over another Slice's changes. Interrupted implementation remains incomplete until contract checks pass.
- **Verification vanity**: Test both removal of misleading instructions and preservation of concrete native/owner behavior. Do not solve a prompt contradiction by weakening a runtime assertion, fabricating evidence, or adding a new operation.
- **Spec dilution detection**: Do not expand the GitHub exception to uncertain membership; bypass native gates; overwrite active sidecars; make optional advisory failures stop all work; or rename Plan authority instead of removing its current-flow dependency.
