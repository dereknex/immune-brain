---
title: feat: pi brainstorm ensemble host adapter
type: feat
status: draft
date: 2026-07-07
origin: user asked to continue after brainstorm_ensemble runtime closure; next slice is Pi host adapter mapping candidates to Agent envelopes
---

# Iteration Plan

## Task
- Summary: Add a Pi host adapter contract that maps Brainstorm ensemble dispatch candidates into advisory-only Pi Agent envelopes without launching models from the runtime
- Origin: Previous Brainstorm ensemble plan closed with host-facing dispatch JSON; user said continue and selected imm-planner for the next slice
- Spec: docs/specs/pi-brainstorm-ensemble-host-adapter.spec.md
- Research: `buildAdvisoryDispatchEnvelope("pi")` already emits `primitive: "Agent"` with `subagent_type: "general-purpose"`, optional `model`, `inherit_context: false`, and `run_in_background`; `docs/reference/subagent-dispatch-protocol.md` documents Pi Agent dispatch and no readonly parameter; `docs/specs/brainstorm-multi-model-ensemble.spec.md` says host owns parallel execution while runtime does not call providers; current `brainstorm_ensemble` work is complete but uncommitted
- Decisions: D1 add a Brainstorm-specific envelope helper instead of a generic dispatcher; D2 helper consumes an already gated request and never re-runs activation policy; D3 Pi only for this slice; D4 tests assert envelope shape rather than invoking Agent; D5 parent Brainstorm remains synthesis authority through `normalizeBrainstormEnsemblePacket`
- Assumptions: The previous `brainstorm_ensemble` changes remain in the working tree or are committed before this plan executes; Pi harness continues to expose `Agent` with `model` and `run_in_background`; repository tests cannot call real host tools
- Scope Mode: New Slice
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `docs/specs/pi-brainstorm-ensemble-host-adapter.spec.md`, `docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: Pi adapter helper returns Agent envelopes for Brainstorm candidates and refuses dispatch-false requests
      - method: `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts` and `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md --json`
  - blockers: implementation should not start if the prior `brainstorm_ensemble` baseline is reverted or absent
  - replan_condition: if real Pi Agent invocation or result polling is required for correctness stop and create a host-integration plan

## Output Language

Spec and Plan prose language: zh-CN for user-facing explanations; preserve exact English literals for file paths, CLI flags, function names, enum values, stage keys, tool names, and model IDs.

## Devil's Advocate Audit

- Rollback resilience: This slice should be additive. If the helper shape is wrong, remove the helper and tests without touching `imm-activation-plan` or `brainstorm_ensemble` request generation.
- Verification vanity: Tests must inspect actual envelope call objects and prompt text, not only assert that a helper exists. A separate fallback test must prove `dispatch: false` returns no Agent envelopes.
- Spec dilution detection: The accepted next step is Pi host adapter mapping, not real Agent execution. The plan includes envelope construction and prompt contract; it intentionally excludes `Agent` tool calls, polling, UI, and non-Pi adapters.

## Steps

### Step 1
- Step ID: U1
- Result: Brainstorm ensemble candidates are representable as Pi Agent envelopes
- Verification: `tests/planner-ensemble-contract.test.ts` asserts a helper maps a `buildBrainstormEnsembleRequest` result into Pi envelopes with `primitive: "Agent"`, `subagent_type: "general-purpose"`, candidate `model`, `inherit_context: false`, `run_in_background: true`, and no `readonly` argument; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers Pi Agent shape; Covers model propagation; Covers background execution; Covers no runtime Agent invocation
- Depends on: none
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If the adapter cannot reuse existing envelope semantics without a generic dispatcher stop and return to planner

### Step 2
- Step ID: U2
- Result: Brainstorm adapter prompt contract preserves advisory-only child output semantics
- Verification: Contract tests assert each child prompt contains `tool_policy: no tools`, the advisory boundary, role-specific instructions, and output fields `recommendations`, `disagreements`, `open_questions`, `blockers`; dispatch-false requests return no envelopes with a stable fallback; `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers role prompt; Covers output schema; Covers dispatch false fallback; Covers existing advisory dispatch envelope compatibility
- Depends on: 1
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`
- Replan condition: If prompt construction needs repo reads or user interaction split those into a later host execution plan

### Step 3
- Step ID: U3
- Result: Brainstorm skill docs describe Pi adapter consumption without changing authority boundaries
- Verification: `plugins/immune-brain/dist/imm-brainstorm.md` and `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` state Pi host adapters may consume `brainstorm_ensemble` dispatch JSON to launch advisory Agent envelopes while final framing remains with `imm-brainstorm` and final Spec/Plan authority remains with `imm-planner`; contract tests assert the boundary text; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers Pi adapter wording; Covers no Plan authority transfer; Covers source plus dist prompt parity
- Depends on: 2
- Scope: `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If generated dist files require a build step update the source package path instead of hand-editing only dist

### Step 4
- Step ID: U4
- Result: Pi Brainstorm adapter slice is validated against runtime contract boundaries
- Verification: `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts tests/activation-plan-runtime-surface.test.ts` exits zero; `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md --json` exits zero; `git diff -- plugins/immune-brain/runtime plugins/immune-brain/dist/imm-brainstorm.md plugins/immune-brain/skills/imm-brainstorm/SKILL.md tests docs/specs/pi-brainstorm-ensemble-host-adapter.spec.md docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md` shows no provider SDK calls, no `Agent` tool invocation, no polling loop, and no workflow-state mutation
- Agent Hint: imm-qa
- Test scenarios: Covers full focused runtime suite; Covers plan validation; Covers scope guard; Covers no real host invocation
- Depends on: 3
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`, `tests/activation-plan-runtime-surface.test.ts`, `docs/specs/pi-brainstorm-ensemble-host-adapter.spec.md`, `docs/plans/2026-07-07-002-feat-pi-brainstorm-ensemble-host-adapter-plan.md`
- Replan condition: If validation needs live Pi `Agent` access stop and route to a manual host-integration plan

## Notes

- This plan intentionally does not call real subagents. The host adapter produces envelopes the parent Pi agent can choose to execute.
- The prior Brainstorm ensemble plan remains the dependency baseline. Avoid rebasing or reverting it mid-slice.
