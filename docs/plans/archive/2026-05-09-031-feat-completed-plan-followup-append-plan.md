---
title: feat: append review fixes to completed plan
type: feat
status: planned
date: 2026-05-09
origin: user wants genuine review fixes to supplement the already completed validated plan and continue via imm-work instead of always opening a separate follow-up plan
---

# Iteration Plan

## Task
- Summary: Add a bounded `append_to_plan` review-followup path so review findings that still fit the current completed plan can be appended in place and then continued through `imm-work`.
- Origin: The completed orchestration plan `029` was followed by review findings that became a separate `030` follow-up plan even though the findings still fit the original plan boundary. The user wants those genuine same-boundary fixes to supplement the existing completed plan so `imm-work` can continue from the next appended step instead of switching to a new plan.
- Research: Reviewed `IMMUNE.md`, `.imm/memory/current_iteration.json`, `.imm/memory/MEMORY.md`, `docs/plans/2026-05-09-030-fix-orchestration-review-followup-plan.md`, `docs/solutions/review-followup-handoff-contract.md`, `docs/solutions/plan-switch-state-isolation.md`, `skills/imm-work/SKILL.md`, `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`, `.imm/imm-work.py`, and `tests/test_imm_work.py`. Conclusion: the current runtime already scans same-plan future steps before returning `done`, and only resets `completed_steps` when switching to a new plan. The missing contract is review/planner routing for “append to current completed plan”, not a missing runtime continuation mechanism.
- Decisions: D1 use Scope Reduction and support only append-to-current-completed-plan, not historical reopen after finish/dehydrate; D2 keep the current `new_slice` route for structural findings and add `append_to_plan` only for same-boundary direct fixes; D3 preserve existing completion history by appending new steps to the current plan file instead of mutating old step closure facts; D4 guard the behavior with focused skill-contract tests plus one runtime regression that proves same-plan append continues through `imm-work`.
- Assumptions: The relevant append scenario happens before compound/finish clears the active runtime plan context; extending the same plan file with new steps is acceptable as long as origin/review traceability is retained; the current `build_next_action()` ordering in `.imm/imm-work.py` is stable enough that a same-plan append test can lock the intended behavior without adding new state fields.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/completed-plan-followup-append.spec.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`, `tests/test_imm_work.py`, and `docs/plans/2026-05-09-031-feat-completed-plan-followup-append-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: reviewer/planner contracts expose `append_to_plan`, same-plan append remains bounded, and `imm-work` continues from the appended step instead of reporting `done`
      - method: `python3 -m unittest tests.test_skill_contracts tests.test_imm_work`
  - blockers: none
  - replan_condition: if append support requires new runtime state fields, reopen-after-finish behavior, old-step closure rewrites, or cross-plan step merging, stop and replan as a broader workflow-state redesign

## Steps

### Step 1
- Step ID: U1
- Result: A source-of-truth spec defines the narrow `append_to_plan` follow-up path for completed current plans.
- Verification: `.imm/specs/completed-plan-followup-append.spec.md` states the `append_to_plan` trigger conditions, the same-boundary restrictions, planner in-place append rules, `imm-work` continuation expectation, and explicit non-goals around finish/dehydrate reopen.
- Test scenarios: Covers same-boundary review fix on the current completed plan; Covers structural follow-up still requiring `new_slice`; Covers no historical reopen after finish
- Depends on: none
- Scope: `.imm/specs/completed-plan-followup-append.spec.md`
- Replan condition: If the contract cannot stay narrow to current completed plans and starts implying broader reopen semantics, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Reviewer contracts expose `append_to_plan` as a distinct route from `new_slice`.
- Verification: `skills/imm-code-review/SKILL.md` and `skills/imm-ui-review/SKILL.md` document `append_to_plan`, its narrow trigger conditions, and the requirement to preserve same-boundary repair hints instead of defaulting to a new slice.
- Test scenarios: Covers reviewer route emitting `append_to_plan`; Covers same-boundary direct fixes staying append-eligible; Covers `new_slice` remaining the route for structural changes
- Depends on: 1
- Scope: `skills/imm-code-review/SKILL.md` and `skills/imm-ui-review/SKILL.md`
- Replan condition: If reviewer/planner alignment requires redesigning the broader follow-up packet or introducing a new planning engine, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Planner contract updates the current completed plan in place when `append_to_plan` is valid.
- Verification: `skills/imm-planner/SKILL.md` states that `append_to_plan` revises the existing current plan file, preserves old completed-step traceability, and refuses the route when the request would widen scope or reopen post-finish history.
- Test scenarios: Covers planner preserving old completed steps while appending new ones; Covers current-plan-only append boundary; Covers no post-finish reopen promise
- Depends on: 2
- Scope: `skills/imm-planner/SKILL.md`
- Replan condition: If documenting the route exposes a runtime truth conflict that cannot be resolved without state-machine changes, stop and return to planner.

### Step 4
- Step ID: U4
- Result: `imm-work` contract describes same-plan append continuation without inventing a new runtime state model.
- Verification: `skills/imm-work/SKILL.md` explains that once a completed current plan is appended in place, `imm-work` continues from the next appended executable step and only routes to `imm-compounder` when no further steps exist.
- Test scenarios: Covers `done` meaning “no further steps in the current plan”; Covers same-plan append resuming normal `imm-work` flow; Covers no promise of reopen after finish/dehydrate
- Depends on: 3
- Scope: `skills/imm-work/SKILL.md`
- Replan condition: If proving the runtime path requires implementation changes outside focused tests and contract docs, stop and replan the runtime surface explicitly.

### Step 5
- Step ID: U5
- Result: README documents the user-facing same-plan append route.
- Verification: `README.md` explains that review-origin fixes may extend the still-current completed plan in place, planner appends the steps, and `imm-work` continues from the new step instead of forcing a new follow-up plan.
- Test scenarios: Covers review-to-planner append wording; Covers same-plan continue path; Covers no promise of post-finish reopen
- Depends on: 4
- Scope: `README.md`
- Replan condition: If the contract cannot be guarded without broader harness changes, stop and replan the test surface explicitly.

### Step 6
- Step ID: U6
- Result: Focused contract tests guard the `append_to_plan` contract.
- Verification: `tests/test_skill_contracts.py` asserts `append_to_plan` presence across reviewer/planner/work docs, plus the narrow same-boundary and no-post-finish wording.
- Test scenarios: Covers contract presence for `append_to_plan`; Covers reviewer/planner boundary wording; Covers `done` versus appendable-current-plan route wording
- Depends on: 5
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If the contract cannot be guarded without broader harness changes, stop and replan the test surface explicitly.

### Step 7
- Step ID: U7
- Result: Focused runtime regression proves that same-plan appended steps continue through `imm-work`.
- Verification: `tests/test_imm_work.py` proves a completed current plan with newly appended same-plan steps continues through `imm-work` without resetting `completed_steps`; `python3 -m unittest tests.test_skill_contracts tests.test_imm_work` passes.
- Test scenarios: Covers same-plan appended step activation after a formerly complete state; Covers no completed-step reset for same-plan append; Covers passing focused verification across contract and runtime tests
- Depends on: 6
- Scope: `tests/test_imm_work.py`
- Replan condition: If proving the runtime path requires implementation changes outside focused tests and contract docs, stop and replan the runtime surface explicitly.

## Notes
- This slice does not try to reopen history after `imm-finish`; it only legitimizes appending review fixes onto the still-current completed plan.
- The intended payoff is smaller review repair friction without weakening planner/work/qa authority boundaries.
