---
title: feat: reviewer feedback optimization
type: feat
status: planned
date: 2026-05-19
origin: brainstorm session on reducing multi-round code review friction
---

# Iteration Plan

## Task
- Summary: Implement a test-driven verification criteria model for reviewer findings and enforce executor pre-checks to reduce review rounds.
- Origin: Brainstorm session regarding multi-round code review friction.
- Research:
  - Identified that exact patch generation by restricted reviewers causes context attachment gaps and collision risks.
  - A test-driven verification approach allows the Executor to resolve findings with global context while constrained to the specific criteria.
- Decisions:
  - D1: Modify `imm-code-review` and reviewer subagent packets to demand `verification_criteria`.
  - D2: Enforce a local pre-check before state transition to `ready_for_review`.
  - D3: Restrict Executor's behavior in Rework state to strictly satisfying findings.
- Assumptions:
  - Subagents can reliably express findings as verification criteria or failing test scenarios.
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-DEC-1, BR-OUT-1
- Scope Mode: Complete implementation
- Engineering Closure Check:
  - architecture_surface: `skills/imm-code-review/SKILL.md`, `skills/imm-work/SKILL.md`, `.imm/imm_core/code_review_subagents.py`, `tests/test_imm_review.py`, `tests/test_imm_work.py`
  - dependencies_known: true
  - verification_path:
      - target: Reviewer outputs require verification criteria, executor requires pre-checks, rework is bounded.
      - method: contract tests and specific unit tests.
  - blockers: none
  - replan_condition: If enforcing verification criteria requires a new parser for all review findings, stop and reassess.

## Brainstorm Trace
| Item | Status | Target | Reason |
|---|---|---|---|
| BR-REQ-1 | covered_by_step | U1 | - |
| BR-REQ-2 | covered_by_step | U2 | - |
| BR-DEC-1 | covered_by_step | U3 | - |
| BR-OUT-1 | resolved_as_assumption | global | Executor bounded to specific rework loop logic. |

## Steps

### Step 1
- Step ID: U1
- Result: Reviewer delegation packet contracts require `verification_criteria` instead of rigid patches.
- Verification: `.imm/imm_core/code_review_subagents.py` is updated and `python3 -m unittest tests.test_imm_review tests.test_skill_contracts` passes.
- Test scenarios: Contract requires `verification_criteria` in findings payload.
- Depends on: none
- Scope: `skills/imm-code-review/SKILL.md`, `.imm/imm_core/code_review_subagents.py`, `tests/test_imm_review.py`, `tests/test_skill_contracts.py`
- Replan condition: If the finding payload schema change breaks downstream arbitration logic completely.

### Step 2
- Step ID: U2
- Result: Executor transitions to `ready_for_review` enforce local pre-checks.
- Verification: `python3 -m unittest tests.test_imm_work tests.test_state_ledger` passes.
- Test scenarios: `ready_for_review` transition fails if pre-checks fail.
- Depends on: none
- Scope: `.imm/imm-work.py`, `.imm/imm_core/state_machine.py`, `tests/test_imm_work.py`, `tests/test_state_ledger.py`
- Replan condition: If the state machine requires full rewrite to support pre-transition hooks.

### Step 3
- Step ID: U3
- Result: Rework execution behavior is formally restricted to satisfying specific finding verification criteria.
- Verification: `skills/imm-work/SKILL.md` is updated and `python3 -m unittest tests.test_skill_contracts` passes.
- Test scenarios: Rework loop contract specifies scope boundary constraint.
- Depends on: 1, 2
- Scope: `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If restricting executor scope breaks valid rework use-cases for multi-file bugs.
