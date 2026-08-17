---
title: "fix: Pocock review boundary fixes round 2"
type: fix
status: active
date: 2026-05-12
origin: second code review finding three remaining authority/boundary wording issues
---

# Iteration Plan

## Task
- Summary: Fix three remaining authority wording issues in executor/QA advisory annotation language plus planner CONTEXT.md boundary plus fast-track QA authority phrasing
- Origin: imm-code-review round 2 identifying P1 advisory annotation carries-vs-raw-text wording plus P1 planner CONTEXT.md boundary gap plus P2 fast-track QA authority blur
- Research: executor says "when the active step carries Prototype: true" but runtime state does not carry it since imm-plan.py does not parse it; planner CONTEXT.md Vocabulary rule says "add it" but Boundary Allowed only lists specs/plans/memory; fast-track says imm-work "drives QA judgment" but QA is an authority role
- Decisions: D1 change carries to raw-plan-text inspection language; D2 add CONTEXT.md to planner Allowed; D3 reword fast-track to route-through not drive
- Assumptions: All text-only changes; contract tests remain stable
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: executor and QA use raw-plan-text language; planner Allowed includes CONTEXT.md; fast-track says routes through QA not drives QA; contract tests pass
      - method: `python3 -m unittest tests.test_skill_contracts`
  - blockers: none
  - replan_condition: none expected

## Steps

### Step 1
- Step ID: U1
- Result: Executor plus QA plus planner plus imm-work skill text resolves three remaining authority wording issues from the second code review
- Verification: `skills/imm-executor/SKILL.md` Prototype Steps rule contains "raw plan text" instead of just "carries"; `skills/imm-qa/SKILL.md` Verification Quality Check contains "raw plan text" instead of just "carries"; `skills/imm-planner/SKILL.md` Boundary Allowed includes CONTEXT.md; `skills/imm-work/SKILL.md` Fast-Track rule does not contain "drives" followed by "QA judgment"; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers executor raw-plan-text language; Covers QA raw-plan-text language; Covers planner boundary includes CONTEXT.md; Covers fast-track QA authority wording; Covers no regression on 92 existing contract tests
- Depends on: none
- Scope: `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`
