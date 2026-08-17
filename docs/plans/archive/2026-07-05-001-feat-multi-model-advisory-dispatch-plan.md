---
title: "feat: multi-model advisory dispatch and planner ensemble"
type: feat
status: planned
date: 2026-07-05
origin:
  - user confirmed mainline model tiering
  - user requested multi-model planning synthesis
  - user allowed reassessing shared dispatcher boundaries
  - user requested Pi support
  - docs/specs/2026-07-05-multi-model-advisory-dispatch.spec.md
---

# Iteration Plan

## Task

- Summary: Add Pi-aware dispatch documentation, define stage model selection, define a shared read-only advisory dispatch substrate, and make planner ensemble synthesis a planner-owned workflow.
- Spec: `docs/specs/2026-07-05-multi-model-advisory-dispatch.spec.md`
- Origin: Conversation framing concluded that Immune-Brain should extend model tiering into mainline planning, use multiple models to produce candidate plans before planner synthesis, reassess the old generic dispatcher rejection as a narrower read-only advisory substrate, and include Pi `Agent` support.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-REQ-4; BR-REQ-5; BR-REQ-6; BR-DEC-1; BR-DEC-2; BR-DEC-3; BR-OUT-1; BR-DEFER-1; BR-DEFER-2
- Scope Mode: New executable slice. The current State Ledger Plan is closed, and the existing working tree contains candidate Pi dispatch protocol edits that this Plan treats as Step U1 scope.
- Planner research dispatch: solo. Local docs, runtime seams, current working tree, and prior solution records were sufficient to decompose the slice.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`, `State Ledger`, `Activation Plan`, `Delegation Packet`, and `Model tier`.

## Brainstorm Trace

| Item | Status | Target | Reason |
|---|---|---|---|
| BR-REQ-1 | covered_by_step | U3 | Mainline model tiering is introduced through planner ensemble and role guidance. |
| BR-REQ-2 | covered_by_step | U3 | Planner receives multiple model candidates and keeps the final synthesis authority. |
| BR-REQ-3 | covered_by_step | U2 | Shared dispatch is narrowed to read-only advisory substrate mechanics. |
| BR-REQ-4 | covered_by_step | U1 | Pi `Agent` dispatch support is documented and guarded. |
| BR-REQ-5 | covered_by_step | U3 | Strong-tier use is made explicit for high-risk planning and review decisions. |
| BR-REQ-6 | covered_by_step | U2 U3 | Workflow stages can name single-model or multi-model tier lists before dispatch. |
| BR-DEC-1 | captured_as_decision | D1 | The slice uses shared substrate mechanics instead of a generic authority dispatcher. |
| BR-DEC-2 | captured_as_decision | D2 | Planner owns the final Spec and Plan after ensemble input. |
| BR-DEC-3 | captured_as_decision | D3 | Pi dispatch is capability-present and falls back when `Agent` is unavailable. |
| BR-OUT-1 | out_of_scope | Non-goals | Generic authority dispatch is excluded to preserve role boundaries. |
| BR-DEFER-1 | deferred | Deferred work | Local tier rollout and telemetry-driven tuning need evidence after the first substrate slice. |
| BR-DEFER-2 | deferred | Deferred work | Executor and QA automatic model routing should wait until planner advisory routing is proven. |

## Research

- `CONTEXT.md` defines `Activation Plan`, `Delegation Packet`, `State Ledger`, `Domain Mapper`, and `Model tier` vocabulary relevant to this Plan.
- `docs/reference/subagent-dispatch-protocol.md` already defines Phase 4 model resolution and now includes Pi `Agent` as a dispatch primitive when exposed by the current harness.
- `docs/reference/immune-brain-config.md` maps semantic tiers from `[subagent_models]` to concrete model identifiers. The mapping now names Cursor `Task`, Codex `spawn_agent`, and Pi `Agent` as model-aware dispatch surfaces.
- Stage-level model selection should be progressive for users: zero config inherits the host model, `[workflow].model_preset` enables common behavior, `[subagent_models]` fills reusable model slots, and `[workflow_models]` remains the advanced per-stage override layer. This avoids forcing users to write a full stage matrix.
- `docs/reference/automatic-subagent-activation-policy.md` keeps eligibility and host authorization separate. Pi `Agent` must follow that gate.
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejected a shared registry because the earlier slice lacked three or more host reuse needs and telemetry. The new requirement creates reuse pressure, but only for read-only advisory mechanics.
- `docs/solutions/bounded-advisory-delegation-packets.md` warns against turning delegation packets into a generic manifest registry and requires fixed fallback reasons.
- `docs/solutions/advisory-roundtable-layer.md` proves advisory synthesis can merge perspectives while keeping authority in the parent host.
- `plugins/immune-brain/runtime/imm_core.ts` currently exposes activation helper types and remains the compatibility barrel after recent runtime seam hardening.
- `plugins/immune-brain/runtime/plan_core.ts` already preserves `Parallel probes` metadata and validates readonly probe annotations.
- `tests/host-runtime-cutover.test.ts` now contains a focused Pi `Agent` dispatch contract test for the current protocol edits.
- The current working tree already has candidate changes for Pi dispatch protocol docs, synced mirror docs, the adapted policy copy, and the focused Pi test. U1 should verify and record them rather than reimplement them.

## Decisions

- D1: Replace the old rejected generic dispatcher direction with a narrower shared read-only advisory dispatch substrate.
- D2: Keep host Skills responsible for trigger decisions, real tool calls, result synthesis, Plan writes, and workflow-state changes.
- D3: Treat Pi support as capability-present. If the current Pi harness exposes `Agent`, the protocol may use it; otherwise record `unavailable_environment`.
- D4: Introduce planner ensemble as advisory input only. Multiple model candidates do not vote and do not write Plans.
- D5: Keep Executor ensemble out of this slice to avoid code churn and unclear write authority.
- D6: Defer local-tier rollout until dispatch telemetry can show a cost or quality need.
- D7: Configure stage model selection through a simple `[workflow].model_preset` first, with `[workflow_models]` only as the advanced override for per-stage lists.

## Assumptions

- The current Pi harness supports `Agent`, `model`, `run_in_background`, and `get_subagent_result`, but baseline Pi installations may not.
- Repository tests cannot invoke real host-native agent tools, so envelope builders and contract tests are the correct verification surface.
- A shared substrate is valuable only if it centralizes mechanics without gaining authority.
- Existing review lens activation behavior must remain backward-compatible.
- Planner ensemble should be opt-in or triggered by elevated planning risk, not automatic for every small task.
- Stage model presets expand to built-in stage maps before advanced overrides are applied. Stage model entries can reuse semantic tiers (`fast`, `mid`, `strong`, `local`, `inherit`) or concrete host model ids.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: mixing Pi documentation, shared dispatch substrate work, and planner ensemble changes could leave contracts half-updated.
- Mitigation: U1 is only Pi dispatch contract completion. U2 introduces the shared substrate mechanics behind tests. U3 layers planner ensemble contract on top of U2. Each Step can be reverted by its discovery-cache file group without changing State Ledger schema.

### 2. Verification Vanity

- Risk: checks could only assert that words such as `Pi` or `ensemble` exist.
- Mitigation: U1 runs focused protocol and dist-sync tests. U2 requires envelope and model-resolution tests that must fail when authority fields appear or model inheritance breaks. U3 requires planner ensemble contract tests that prove child outputs remain advisory and final Plan ownership stays with `imm-planner`.

### 3. Spec Dilution Detection

- Risk: the Plan could silently shrink the user's request into only Pi documentation or only review-lens model tuning.
- Mitigation: BR-REQ-1 through BR-REQ-6 map to U1 through U3. Mainline model tiering, multi-model planning synthesis, shared substrate reassessment, Pi support, strong-tier usage, and stage-specific model lists are all represented. Deferred items are explicit.

## Planning Quality Gate

- **contract surface**: `docs/reference/subagent-dispatch-protocol.md`, `docs/reference/immune-brain-config.md`, `docs/reference/automatic-subagent-activation-policy.md`, `docs/reference/workflow-and-subagents.md`, `plugins/immune-brain/skills/imm-planner/SKILL.md`, `plugins/immune-brain/dist/imm-planner.md`, runtime helper modules under `plugins/immune-brain/runtime/`, local `[workflow].model_preset` and `[workflow_models]` config documentation, packaged mirror docs, and focused Bun tests.
- **compatibility**: Existing Cursor and Codex dispatch guidance remains valid. Existing `model_tiers` and `lens_model_tiers` remain compatible. Hosts without `model` or `Agent` support inherit the host model or fall back.
- **interruption recovery**: If U1 fails, keep the existing host docs unchanged and retry sync. If U2 fails, do not route hosts to the new substrate. If U3 fails, keep planner ensemble guidance out of the execution path.
- **rollback path**: Revert each Step's touched files from its Discovery cache. No Step writes runtime State Ledger data except optional later Plan sync.
- **verification strength**: Focused tests and `imm-plan --json` are required. Grep-only checks may supplement but not replace test coverage for U2 and U3.
- **Brainstorm traceability**: The conversation-derived Brainstorm manifest is mapped above with no open `BR-Q-*` items.

## Steps

### Step 1

- Step ID: U1
- Result: Pi Agent dispatch is documented in the subagent protocol.
- Verification type: automated
- Verification: `bun test tests/host-runtime-cutover.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && git diff --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --json`
- Test scenarios: Pi appears as a capability-present runtime in Phase 1; Pi `Agent` has a Phase 4 envelope; Pi model passing uses the same resolved model id rule; Pi fallback stays `unavailable_environment` when `Agent` is not exposed; packaged mirror docs stay synchronized.
- Discovery cache: docs/reference/subagent-dispatch-protocol.md (Pi envelope source); docs/reference/immune-brain-config.md (model mapping doc); docs/reference/automatic-subagent-activation-policy.md (authorization gate); plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md (packaged protocol); plugins/immune-brain/dist/docs/reference/immune-brain-config.md (packaged config); plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md (adapted packaged policy); tests/host-runtime-cutover.test.ts (Pi protocol guard)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If base Pi installations lack `Agent`, keep the capability-present wording and require the `unavailable_environment` fallback instead of removing Pi support.

### Step 2

- Step ID: U2
- Result: Shared advisory dispatch core emits provider envelopes.
- Verification type: automated
- Verification: `bun test tests/advisory-dispatch-core.test.ts tests/host-runtime-cutover.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --json`
- Execution note: test-first
- Test scenarios: Tier resolution honors lens override before tier mapping; `inherit` omits model; `[workflow].model_preset` expands to stage defaults; `[workflow_models]` overrides one stage without replacing the entire preset; duplicate resolved models collapse or trigger single-model fallback; Cursor envelope uses `Task`; Codex envelope uses `spawn_agent`; Pi envelope uses `Agent`; generated envelopes contain no plan-write or QA-closure authority; unsupported hosts return stable fallback reasons.
- Discovery cache: plugins/immune-brain/runtime/imm_core.ts (compatibility barrel); plugins/immune-brain/runtime/immune_brain_runtime.ts (runtime command surface); docs/reference/subagent-dispatch-protocol.md (dispatch contract); docs/reference/immune-brain-config.md (model tier mapping); docs/solutions/rejected-shared-registry-generic-dispatcher.md (rejected platformization boundary); docs/solutions/bounded-advisory-delegation-packets.md (packet boundary); tests/heal-activation.test.ts (activation helper regression)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If a shared runtime helper grows authority logic, split that logic back into host-owned code and keep only envelope construction plus model resolution in the shared core.
- security_considerations: Delegation packets must preserve `tool_policy: no tools` and must not include secrets or full diffs unrelated to the focused advisory scope.

### Step 3

- Step ID: U3
- Result: Planner ensemble advisory is a planner-owned workflow.
- Verification type: automated
- Verification: `bun test tests/planner-ensemble-contract.test.ts tests/code-review-activation-contract.test.ts tests/host-runtime-cutover.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --json`
- Execution note: test-first
- Test scenarios: `imm-planner` can request candidates from `workflow_models.planner_ensemble`; child outputs normalize into one ensemble packet; agreement becomes evidence; disagreement becomes decision criteria; strong-model blockers become risk or verification requirements; final Spec and Plan remain planner-owned; small plans do not fan out by default.
- Discovery cache: plugins/immune-brain/skills/imm-planner/SKILL.md (planner source contract); plugins/immune-brain/dist/imm-planner.md (packaged planner contract); docs/reference/planning-quality-gate.md (elevated planning gate); docs/reference/workflow-and-subagents.md (mainline subagent guidance); docs/specs/2026-07-05-multi-model-advisory-dispatch.spec.md (accepted behavior); docs/solutions/advisory-roundtable-layer.md (synthesis pattern)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: If planner ensemble creates too much ceremony, keep it explicit-only for high-impact planning and defer automatic complexity triggers.
- security_considerations: Planner ensemble children must not receive credentials or mutate workflow state. They return advisory deltas only.

## Test Scenarios

- Pi is documented as a supported dispatch host only when `Agent` is exposed.
- Shared advisory dispatch centralizes model resolution, stage model selection, and provider envelopes without gaining authority.
- Planner ensemble uses multiple model candidates to improve plan quality while preserving planner ownership.
- Existing Cursor and Codex review dispatch contracts remain valid.
- Dist docs remain synchronized or intentionally adapted.
- The old generic dispatcher rejection is not violated because this slice excludes scope decisions, Plan writes, State Ledger mutation, and QA closure from the shared layer.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --json`
- Runtime sync after user confirmation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --sync`

## Next Action

- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-05-001-feat-multi-model-advisory-dispatch-plan.md --json`.
- If validation passes and the user confirms execution, sync the Plan and enter `imm-work` to activate Step `U1`.
