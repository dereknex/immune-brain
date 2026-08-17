---
title: "feat: TDD execution discipline integration"
type: feat
status: closed
date: 2026-05-11
origin: brainstorm session comparing upstream CE and GSD TDD approaches; user requested concrete landing plan for this project
---

# Iteration Plan

## Task
- Summary: Embed TDD execution posture signals into the imm-planner, imm-executor, and imm-qa skill contracts so test-first discipline is enforceable per-step without changing tooling or JSON schema
- Origin: brainstorm on delivery-vs-plan alignment; upstream CE ce-plan Execution note plus ce-work guardrails identified as the model to adopt
- Research: CE uses optional Execution note field per unit plus guardrails in ce-work; GSD uses task-level tdd attribute plus acceptance_criteria; both explicitly forbid expanding into RED/GREEN/REFACTOR substeps in plans; current Immune-Brain steps already carry Test scenarios and Verification but lack posture signal
- Decisions: D1 adopt CE-style Execution note as optional step field not a plan-level mode; D2 guardrails live in imm-executor skill text not in tooling; D3 QA check is additive only fires on marked steps; D4 no imm-plan.py schema change in this slice; D5 no CI or commit-lint tooling in this slice
- Assumptions: Skill text changes are sufficient to guide executor behavior without tooling enforcement; existing Test scenarios field covers the what; Execution note covers the how
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-planner/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `.imm/specs/tdd-execution-discipline.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: three skill files carry TDD discipline text and existing tests still pass
      - method: `grep -c "Execution note" skills/imm-planner/SKILL.md skills/imm-executor/SKILL.md skills/imm-qa/SKILL.md` returns 1+ per file and `python3 -m unittest tests.test_skill_contracts` exits zero
  - blockers: none
  - replan_condition: if skill text changes require imm-plan.py schema enforcement to be useful stop and plan a tooling slice

## Steps

### Step 1
- Step ID: U1
- Result: TDD execution discipline is contractually embedded in the three-skill pipeline (planner detection plus executor guardrails plus QA evidence gate) as a unified posture convention
- Verification: `skills/imm-planner/SKILL.md` contains section on Execution note signal detection with legal values test-first and characterization-first; `skills/imm-executor/SKILL.md` contains TDD Execution Discipline section with RED GREEN REFACTOR constraints and exceptions; `skills/imm-qa/SKILL.md` contains TDD evidence check clause that fires only on test-first steps; `python3 -m unittest tests.test_skill_contracts` exits zero
- Execution note: test-first
- Test scenarios: Covers planner Execution note field presence; Covers executor TDD guardrails section presence; Covers QA TDD evidence clause presence; Covers no-regression on existing contract tests
- Depends on: none
- Scope: `skills/imm-planner/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`
- Replan condition: If contract tests require schema changes to pass stop and replan with tooling slice

## Notes
- This plan itself uses Execution note: test-first on its single step as dogfooding of the new convention
- Future slices may add imm-plan.py lint for Execution note values and commit-message convention tooling
