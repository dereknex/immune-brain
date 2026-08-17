---
title: "feat: gated handoff discipline"
type: feat
status: active
date: 2026-05-11
origin: brainstorm — enforce that Next Action suggestions only appear when all gate conditions are satisfied
---

# Iteration Plan

## Task
- Summary: Replace the generic Next Action instruction in all 5 workflow skills with explicit readiness gates so the agent only suggests the next skill when conditions are met, and reports missing conditions otherwise
- Origin: user principle — only prompt next step when all conditions are clarified and satisfied
- Research: Current skills all end with identical template text `Next Action: specify next skill, reason, and user confirmation needs`; imm-work Decision Tree already encodes gate logic but the output instruction does not enforce conditional emission; brainstorm identified 5 skills needing the change
- Decisions: D1 keep changes to skill text only, no tooling; D2 each skill gets gate/pass/fail triad in its Next Action section; D3 contract test verifies presence of gated pattern
- Assumptions: Skill text changes are sufficient to guide agent behavior; no tooling enforcement needed in this slice
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: all 5 workflow skills carry gated Next Action sections and contract tests pass
      - method: each skill file contains "Gate:" and "If gates are not met" text; `python3 -m unittest tests.test_skill_contracts` exits zero
  - blockers: none
  - replan_condition: if the text pattern cannot coexist with existing contract fields stop and replan

## Steps

### Step 1
- Step ID: U1
- Result: Gated handoff discipline is contractually embedded in the 5 workflow skills so that Next Action output only appears when readiness gates are satisfied
- Verification: each of `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md` contains "Gate:" and "If gates are not met"; `python3 -m unittest tests.test_skill_contracts` exits zero
- Execution note: test-first
- Test scenarios: Covers gated handoff text presence in all 5 skills; Covers no regression on existing contract tests
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If gated text conflicts with existing contract field checks stop and adjust

## Notes
- This plan uses Execution note: test-first as dogfooding of the TDD discipline convention
- Future slices may add runtime tooling that validates gate state before emitting handoff suggestions
