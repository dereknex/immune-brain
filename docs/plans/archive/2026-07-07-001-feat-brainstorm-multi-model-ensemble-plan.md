---
title: feat: brainstorm multi-model ensemble
type: feat
status: draft
date: 2026-07-07
origin: user asked how Immune-Brain should fully use multi-model capability during brainstorm; imm-planner converted the discussion into a bounded implementation plan
---

# Iteration Plan

## Task
- Summary: Add a Brainstorm ensemble dispatch contract that reuses Immune-Brain model tier resolution so multi-model Brainstorm can produce advisory framing evidence without taking Planner authority
- Origin: User asked how to implement multi-model use in the Brainstorm stage after a framing discussion; planner ensemble candidates agreed on reusing the existing resolver while preserving Brainstorm boundaries
- Spec: docs/specs/archive/brainstorm-multi-model-ensemble.spec.md
- Research: Existing `imm_core.ts` has `resolveWorkflowStageModels`, `buildPlannerEnsembleRequest`, `normalizePlannerEnsemblePacket`, and presets for `planner_ensemble`; current config already resolves `workflow_models.planner_ensemble` to four advisory candidates; `imm-brainstorm` is framing-only and may not write plans or edit files
- Decisions: D1 use `brainstorm_ensemble` as a distinct workflow stage instead of overloading `brainstorm`; D2 runtime only returns deterministic dispatch JSON and never calls model providers; D3 host owns actual parallel model/subagent execution; D4 Brainstorm children are advisory-only and default to `tool_policy: no tools`; D5 Planner remains final Spec and Plan authority; D6 small-risk Brainstorm does not fan out by default
- Assumptions: Existing `PlannerEnsembleCandidate` shape can be reused or renamed with no behavior change; model presets may add `brainstorm_ensemble` without migration because unknown config currently falls back to inherit; package build or dist sync follows the repo’s existing skill packaging process
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-DEC-1; BR-DEC-2; BR-OUT-1; BR-Q-1
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`, `docs/specs/archive/brainstorm-multi-model-ensemble.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: runtime helper returns deterministic Brainstorm ensemble candidates and prompt docs preserve authority boundaries
      - method: `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts` and `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-07-001-feat-brainstorm-multi-model-ensemble-plan.md --json`
  - blockers: none after the plan pins `brainstorm_ensemble` as shared stage and keeps Brainstorm advisory-only
  - replan_condition: if implementation requires runtime provider calls host orchestration state mutation or Brainstorm-owned Spec/Plan drafting stop and return to imm-planner

## Output Language

Spec and Plan prose language: zh-CN for user-facing explanations; preserve exact English literals for file paths, CLI flags, function names, enum values, stage keys, and model IDs.

## Devil's Advocate Audit

- Rollback resilience: Each step is additive. If helper or CLI behavior fails, remove the new `brainstorm_ensemble` helpers and docs while leaving existing `planner_ensemble` untouched. No state migration is planned.
- Verification vanity: Tests must assert runtime return objects and authority strings, not just that files contain words. CLI validation must exercise the real `imm-activation-plan` and `imm-plan` wrappers.
- Spec dilution detection: The accepted requirement is multi-model Brainstorm framing, not generic model routing. The plan explicitly includes request construction, normalization, CLI exposure, prompt contract, and tests; it excludes provider calls and voting by design, not because they are expensive.

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-1 | accepted | Step 1 | Reuse existing model tier and workflow stage resolver for multi-model dispatch. |
| BR-REQ-2 | accepted | Step 2 | Brainstorm needs its own advisory request and packet normalization. |
| BR-REQ-3 | accepted | Step 3 | Host-facing activation JSON is needed for pi or other hosts to run candidates. |
| BR-DEC-1 | accepted | Step 1 | Distinct `brainstorm_ensemble` avoids conflating ordinary Brainstorm with fanout. |
| BR-DEC-2 | accepted | Step 2 | Children stay advisory-only and Planner keeps final Spec/Plan authority. |
| BR-OUT-1 | accepted | Step 4 | Prompt docs and tests must make the boundary durable. |
| BR-Q-1 | resolved | Step 3 | The minimal surface is a stage flag on `imm-activation-plan`, not a new CLI. |

## Steps

### Step 1
- Step ID: U1
- Result: Brainstorm ensemble model resolution is available through the existing workflow stage resolver
- Verification: `tests/advisory-dispatch-core.test.ts` asserts `resolveWorkflowStageModels("brainstorm_ensemble", { workflow_models: { brainstorm_ensemble: ["fast", "mid", "strong"] }, subagent_models: { fast: "model-fast", mid: "model-mid", strong: "model-strong" } })` returns multi_model with three resolved models; `bun test tests/advisory-dispatch-core.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers explicit workflow_models; Covers preset fallback; Covers duplicate model single_model_fallback
- Depends on: none
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/advisory-dispatch-core.test.ts`
- Replan condition: If `brainstorm_ensemble` cannot use `resolveWorkflowStageModels` without a separate resolver stop and return to planner

### Step 2
- Step ID: U2
- Result: Brainstorm ensemble framing contract preserves advisory-only semantics
- Verification: `tests/planner-ensemble-contract.test.ts` or a sibling contract test asserts `buildBrainstormEnsembleRequest` returns `dispatch: false` for `brainstorm_risk: "small"`, returns advisory-only candidates for configured multi-model stages, and `normalizeBrainstormEnsemblePacket` maps repeated recommendations to framing evidence disagreements to decision criteria and strong-tier blockers to risk verification requirements; `bun test tests/planner-ensemble-contract.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers small-risk solo fallback; Covers candidate roles; Covers agreement evidence; Covers strong blocker risk requirements
- Depends on: 1
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If normalization needs child-owned decisions or final plan drafting remove that behavior and return to planner

### Step 3
- Step ID: U3
- Result: Activation-plan CLI can emit Brainstorm ensemble dispatch JSON without launching models or mutating workflow state
- Verification: `plugins/immune-brain/bin/imm-activation-plan --stage brainstorm_ensemble --task-summary "brainstorm multi-model implementation" --activation-mode auto --json` exits zero and includes `stage: "brainstorm_ensemble"` plus advisory candidates when config has multiple models; existing activation-plan runtime surface tests continue to pass
- Agent Hint: imm-executor
- Test scenarios: Covers stage flag parsing; Covers JSON output; Covers no candidate fallback; Covers existing imm-activation-plan compatibility
- Depends on: 2
- Scope: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/activation-plan-runtime-surface.test.ts`
- Replan condition: If CLI exposure requires provider credentials or background execution stop and keep only runtime helper APIs

### Step 4
- Step ID: U4
- Result: Brainstorm skill contract preserves multi-model advisory authority boundaries
- Verification: `plugins/immune-brain/dist/imm-brainstorm.md` states multi-model Brainstorm is advisory-only no-vote framing, child disagreement becomes decision criteria, strong blockers become risks or verification requirements, and final Spec/Plan authority stays with `imm-planner`; contract tests assert both source skill or dist prompt contain the boundary terms; `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts` exits zero
- Agent Hint: imm-executor
- Test scenarios: Covers dist prompt boundary; Covers no Spec/Plan authority; Covers Planner handoff wording
- Depends on: 3
- Scope: `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`
- Replan condition: If generated dist files are not source-owned update the source skill package path used by repo build instead of hand-editing generated output

### Step 5
- Step ID: U5
- Result: Brainstorm ensemble implementation is validated against Immune-Brain packaging contracts
- Verification: `bun test tests/planner-ensemble-contract.test.ts tests/advisory-dispatch-core.test.ts tests/activation-plan-runtime-surface.test.ts` exits zero; `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-07-001-feat-brainstorm-multi-model-ensemble-plan.md --json` exits zero; `git diff -- plugins/immune-brain/runtime plugins/immune-brain/dist/imm-brainstorm.md plugins/immune-brain/skills/imm-brainstorm/SKILL.md tests docs/specs/archive/brainstorm-multi-model-ensemble.spec.md docs/plans/2026-07-07-001-feat-brainstorm-multi-model-ensemble-plan.md` shows no provider SDK or state mutation changes
- Agent Hint: imm-qa
- Test scenarios: Covers runtime contracts; Covers CLI surface; Covers plan validation; Covers scope guard
- Depends on: 4
- Scope: `plugins/immune-brain/runtime/imm_core.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/dist/imm-brainstorm.md`, `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`, `tests/planner-ensemble-contract.test.ts`, `tests/advisory-dispatch-core.test.ts`, `tests/activation-plan-runtime-surface.test.ts`, `docs/specs/archive/brainstorm-multi-model-ensemble.spec.md`, `docs/plans/2026-07-07-001-feat-brainstorm-multi-model-ensemble-plan.md`
- Replan condition: If validation reveals host-specific requirements beyond dispatch JSON split those into a later host adapter plan

## Notes

- Planner ensemble evidence: divergent candidate recommended parallel Brainstorm ensemble; repo-grounded candidate identified `imm_core.ts`, `immune_brain_runtime.ts`, Brainstorm prompt, and contract tests; risk candidate warned against boundary creep and small-task fanout; strong candidate required one shared ensemble path and authority-preserving output contract.
- Skipped by design: voting, direct provider calls, new orchestration layer, `.imm/` state writes, and imm-party expansion.
