---
title: refactor: reduce workflow friction
type: refactor
status: planned
date: 2026-05-09
origin: user requested an upstream-informed analysis of whether the current Immune-Brain workflow is too rigid, then asked for an `imm-preplan-review` and `imm-planner` handoff to define the smallest safe improvement slice
---

# Iteration Plan

## Task
- Summary: Reduce the visible rigidity of the Immune-Brain workflow without weakening role boundaries, by tightening user-facing entrypoints, turning preplan into a condition-triggered gate, and defining a lighter small-task loop.
- Origin: User asked whether the current workflow is overly rigid, requested upstream comparison analysis, and then explicitly routed the result through `imm-preplan-review` into `imm-planner`.
- Research: Reviewed `IMMUNE.md`, `README.md`, `skills/imm-work/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-qa/SKILL.md`, prior workflow ergonomics plans, and upstream references from GSD, BMAD, and Compound Engineering. Conclusion: the main friction is over-exposed phase/role switching and over-eager gate visibility, not flawed authority separation.
- Decisions: D1 keep `imm-work` / `imm-executor` / `imm-qa` authority boundaries intact; D2 reduce scope to three outcomes only: entrypoint contraction, condition-triggered preplan gating, and a one-step minimal loop for small tasks; D3 keep runtime/platform rewrites, autowork expansion, and authority merges out of scope; D4 require each outcome to stay independently closable through docs/contracts/tests rather than a bundled workflow rewrite.
- Assumptions: Existing workflow contract tests can absorb this first slice; user-visible improvement can be proven through skill/doc contract alignment before any deeper runtime refactor; a one-step plan path is sufficient for the first small-task fast path and does not require a second workflow mode.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/workflow-friction-reduction.spec.md`, `IMMUNE.md`, `README.md`, `skills/imm-work/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-qa/SKILL.md`, and related workflow contract tests
  - dependencies_known: true
  - verification_path:
      - target: default entrypoint language is narrower, preplan is described as a risk-triggered gate, and small tasks can close through a one-step minimal plan without bypassing QA
      - method: focused doc/skill contract review plus relevant workflow contract tests and plan validation
  - blockers: none
  - replan_condition: if any step starts requiring runtime state-model redesign, new persistent workflow state, default full-plan autowork semantics, or merged role authority, stop and replan as a broader workflow architecture change

## Steps

### Step 1
- Step ID: U1
- Result: Default user-facing workflow entry is explicitly contracted to a small set of stable continue paths.
- Verification: `IMMUNE.md`, `README.md`, and the affected skill contracts all align on the same entrypoint story: users continue through the contracted default path, while `imm-executor` and `imm-qa` remain authority roles rather than mandatory visible handoff commands.
- Test scenarios: Covers IMM-WORKFLOW-003 acceptance criteria 1; Covers role-entrypoint consistency for default continue language; Covers success-path user output staying lighter than role/state internals
- Depends on: none
- Scope: `IMMUNE.md`, `README.md`, `skills/imm-work/SKILL.md`, `skills/imm-qa/SKILL.md`, and any focused contract tests that lock entrypoint language
- Replan condition: If entrypoint contraction cannot be expressed without changing CLI/runtime behavior first, stop and return to `imm-preplan-review` or a broader planner pass.

### Step 2
- Step ID: U2
- Result: `imm-preplan-review` is reframed as a condition-triggered gate with explicit trigger conditions instead of a default always-visible stage for every task.
- Verification: `IMMUNE.md`, `README.md`, and `skills/imm-preplan-review/SKILL.md` all describe the same limited trigger set: unstable scope, unclear verification path, or meaningful cross-role disagreement; stable small tasks are allowed to pass directly into planning.
- Test scenarios: Covers IMM-WORKFLOW-003 acceptance criteria 2; Covers preplan gate trigger clarity; Covers no silent bypass of preplan when risk conditions are present
- Depends on: 1
- Scope: `IMMUNE.md`, `README.md`, `skills/imm-preplan-review/SKILL.md`, and focused contract tests for preplan routing language
- Replan condition: If trigger-based preplan wording exposes contradictions with current planner/work routing that cannot be closed via contract changes, stop and replan the boundary before implementation.

### Step 3
- Step ID: U3
- Result: Small tasks gain a clearly defined one-step minimal loop.
- Verification: `.imm/specs/workflow-friction-reduction.spec.md`, `README.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, and any focused contract tests jointly show that a one-step minimal plan is valid for small tasks and still requires explicit verification and QA closure.
- Test scenarios: Covers IMM-WORKFLOW-003 acceptance criteria 3; Covers one-step plan validity for small tasks; Covers explicit exclusion of authority merge and default autowork expansion
- Depends on: 1, 2
- Scope: `.imm/specs/workflow-friction-reduction.spec.md`, `README.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, and focused contract tests for minimal-loop wording
- Replan condition: If a one-step minimal loop cannot be expressed without introducing a second workflow mode, bypassing QA, or rewriting the runtime state machine, stop and return to planning with a narrower alternative.

## Notes
- This slice intentionally changes workflow contracts first, not the full runtime architecture.
- The goal is to make the workflow feel lighter without weakening evidence or review discipline.
