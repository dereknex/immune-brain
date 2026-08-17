---
title: "feat: subagent-integrated planning across 5 phases"
type: feat
status: active
date: 2026-05-11
origin: brainstorm — subagent 整体规划设计，把 subagent 从执行期即兴优化升级为规划期一等公民，覆盖扩展审查、并行调研、执行辅助、对抗视角、度量闭环五个阶段
---

# Iteration Plan

## Task
- Summary: Extend the subagent system across five phases so that review catalog covers more reviewers and planner can define parallel probes in step structure and brainstorm-planner can dispatch readonly research and preplan can dispatch adversarial voice and compounder can record dispatch metrics
- Origin: User brainstorm on subagent holistic design with upstream comparison analysis leading to five-phase implementation path
- Research: Current catalog only covers 2 children under imm-code-review; 7 additional reviewers have SKILL.md but no catalog entry; planner step schema has no parallel sub-task structure; brainstorm and preplan have no dispatch path; no dispatch metrics exist; upstream GSD uses wave-based parallel execution with worktrees and CE uses multi-persona parallel review with structured merge and gstack uses adversarial fresh-context voices
- Decisions: D1 each phase is one independently closable step to allow incremental delivery; D2 probe structure uses plan-level field not runtime invention; D3 all subagent dispatch stays readonly and advisory; D4 planner decides split not executor; D5 no global registry or scheduler in any phase
- Assumptions: Existing dispatch protocol and catalog infrastructure are stable; Cursor Task tool remains the runtime dispatch primitive; contract test framework can accommodate new assertions
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `docs/reference/subagent-trigger-catalog.yaml`, `skills/imm-code-review/SKILL.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-compounder/SKILL.md`, `docs/reference/subagent-dispatch-protocol.md`, `.imm/specs/subagent-integrated-planning.spec.md`, `tests/test_skill_contracts.py`, `tests/test_activation_plan.py`
  - dependencies_known: true
  - verification_path:
      - target: catalog extended plus skill dispatch sections added plus contract tests pass plus plan validator passes
      - method: `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-11-062-feat-subagent-integrated-planning-plan.md --json`
  - blockers: none
  - replan_condition: if any phase requires authority chain changes or global registry stop and return to imm-preplan-review

## Steps

### Step 1
- Step ID: U1
- Result: Trigger catalog includes data-integrity-reviewer plus reliability-reviewer entries with deterministic surfaces while imm-code-review reflects updated parallel children limit
- Verification: `docs/reference/subagent-trigger-catalog.yaml` contains entries for data-integrity-reviewer and reliability-reviewer with keywords and path_globs; `skills/imm-code-review/SKILL.md` lists updated max_parallel_children; `tests/test_activation_plan.py` has golden cases for new triggers; `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts` exits zero
- Test scenarios: Covers data-integrity trigger path; Covers reliability trigger path; Covers triple-child parallel; Covers empty fallback unchanged
- Depends on: none
- Scope: `docs/reference/subagent-trigger-catalog.yaml`, `skills/imm-code-review/SKILL.md`, `.imm/activation_plan.py`, `tests/test_activation_plan.py`, `tests/test_skill_contracts.py`
- Replan condition: If new triggers cannot be expressed without LLM classification narrow to path-only rules

### Step 2
- Step ID: U2
- Result: Brainstorm plus planner skills carry optional parallel research dispatch sections referencing the shared dispatch protocol with readonly constraints
- Verification: `skills/imm-brainstorm/SKILL.md` contains a Research Dispatch section referencing `docs/reference/subagent-dispatch-protocol.md` with trigger condition multi_domain or explicit user request; `skills/imm-planner/SKILL.md` contains equivalent section; both sections state readonly and no state writes; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers brainstorm dispatch section presence; Covers planner dispatch section presence; Covers protocol reference linkage; Covers readonly constraint text
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If dispatch section conflicts with existing brainstorm inline-challenge or planner bootstrap flows rewrite as addendum rather than replacement

### Step 3
- Step ID: U3
- Result: Planner step schema supports parallel_probes as an optional field with imm-work probe-aware dispatch logic feeding readonly evidence into executor
- Verification: `skills/imm-planner/SKILL.md` documents parallel_probes field semantics including scope and output and readonly constraint and trigger condition of 3 plus non-overlapping file areas; `skills/imm-work/SKILL.md` documents probe-aware dispatch logic referencing dispatch protocol with probe failure fallback to sequential inline; `python3 .imm/imm-plan.py docs/plans/2026-05-11-062-feat-subagent-integrated-planning-plan.md --json` exits zero; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers planner probe field documentation; Covers work probe dispatch text; Covers probe fallback text; Covers executor receives probe results text
- Depends on: none
- Scope: `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If probe field breaks imm-plan.py validation or conflicts with existing step fields adjust field naming and revalidate

### Step 4
- Step ID: U4
- Result: imm-preplan-review has an optional adversarial dispatch section that can spawn a fresh-context readonly subagent for independent scope challenge when triggered by major architectural changes or explicit user request
- Verification: `skills/imm-preplan-review/SKILL.md` contains an Adversarial Dispatch section referencing dispatch protocol with trigger conditions and readonly boundary and non-gating failure semantics and source attribution adversarial_voice; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers adversarial dispatch section presence; Covers non-gating failure text; Covers protocol reference; Covers readonly constraint
- Depends on: none
- Scope: `skills/imm-preplan-review/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If adversarial dispatch overlaps with existing imm-party coverage in preplan merge into party delegation rather than adding parallel path

### Step 5
- Step ID: U5
- Result: Dispatch metrics fields exist in compounder plus code-review output artifacts so future iterations can tighten or relax catalog triggers
- Verification: `skills/imm-compounder/SKILL.md` documents optional dispatch_count and solo_fallback_count and fallback_reasons fields in output; `skills/imm-code-review/SKILL.md` documents optional dispatch summary in output artifact section; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers compounder dispatch metrics field text; Covers code-review dispatch summary text; Covers no regression on existing output contracts
- Depends on: 1
- Scope: `skills/imm-compounder/SKILL.md`, `skills/imm-code-review/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If metrics fields conflict with existing compounder output schema adjust naming to avoid collision

## Notes
- Steps 1 through 4 are independent except Step 5 depends on Step 1 for catalog context
- Each step targets skill text and contract tests only; no runtime tooling changes in this slice
- Future slices may add imm-plan.py schema-level validation for parallel_probes fields
- ui-review catalog integration is deferred to a follow-up plan after feasibility assessment in Step 1
