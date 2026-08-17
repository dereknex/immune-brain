---
title: fix: align current iteration closure contract
type: fix
status: planned
date: 2026-05-08
origin: user brainstorm, preplan handoff, and planner continuation on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Repair the `current_iteration` runtime contract so all workflow tools share one effective state and successful finish resets the active iteration safely
- Origin: User asked to trace `current_iteration.json` handling, explain the state mismatch, and evaluate whether workflow state should be reset after finish. The preplan review narrowed the work to single-source state loading plus the finish/reset closure contract.
- Research: Checked `IMMUNE.md`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `.imm/memory/current_iteration.json`, `tests/test_imm_work.py`, `tests/test_imm_review.py`, `tests/test_workflow_loop.py`, `.imm/specs/session-flow-output-simplification.spec.md`, `.imm/specs/compound-finish-entry-contract.spec.md`, and solution docs for canonical runtime paths and plan-switch isolation. Autorun then proved U1/U2 are implementable, but the original U3 verification command was blocked by an unrelated existing `imm-heal` inventory failure in `tests/test_workflow_loop.py`. Conclusion: the repair itself is on track; the remaining planning issue is over-broad verification scope, not a missing runtime fix.
- Decisions: D1 keep the slice limited to `current_iteration` runtime semantics and finish closure, not broad workflow redesign; D2 treat `.imm/memory/current_iteration.json` as active runtime state only, while `state.json`/`MEMORY.md` remain the durable historical sinks; D3 require shared canonical load/healing behavior across `imm-work`, `imm-review`, `imm-finish`, and `imm-dehydrate`; D4 require finish success to leave a safe closed/empty runtime state; D5 prove the repair with cross-tool regression, but narrow that regression to behaviors actually touched in this slice instead of inheriting unrelated `imm-heal` leftovers.
- Assumptions: Existing `state.json` and `MEMORY.md` are sufficient to preserve post-finish summary context; no hidden feature depends on `current_iteration.json` remaining as the last completed iteration snapshot; a small shared helper or equivalent normalization path can be introduced without forcing a larger state-framework refactor; the separate workflow health gate plan remains the right place to fix `imm-heal` inventory drift.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: [`.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `tests/test_imm_work.py`, `tests/test_workflow_loop.py`]
  - dependencies_known: true
  - verification_path:
      - target: status, finish, and dehydrate agree on active iteration semantics before and after finish
      - method: `python3 -m unittest tests.test_imm_work tests.test_imm_review tests.test_workflow_loop.WorkflowLoopTests.test_finish_blocks_unclosed_iteration tests.test_workflow_loop.WorkflowLoopTests.test_finish_uses_healed_iteration_state_before_blocking tests.test_workflow_loop.WorkflowLoopTests.test_end_to_end_step_flow_and_dehydrate tests.test_workflow_loop.WorkflowLoopTests.test_finish_closure_resets_runtime_state_after_dehydrate`
  - blockers: [`The original broad regression command currently includes an unrelated imm-heal inventory failure that belongs to the workflow health gate slice, not this contract repair.`]
  - replan_condition: If implementation reveals that other workflows depend on `current_iteration.json` persisting the last completed iteration as active-facing state, or if the narrowed regression still cannot isolate this slice without pulling in unrelated health-gate repairs

## Steps

### Step 1
- Step ID: U1
- Result: All workflow entrypoints read the same effective `current_iteration` state
- Verification: `imm-work`, `imm-review`, `imm-finish`, and `imm-dehydrate` share a single canonical load/healing path or equivalent behavior, and a regression proves `imm-work status` and `imm-finish` no longer disagree when stale disk state is recoverable.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R1; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 1; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 2
- Depends on: none
- Scope: `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, focused workflow tests
- Replan condition: If unifying load/healing requires a broader runtime-state abstraction beyond these four tools

### Step 2
- Step ID: U2
- Result: Successful finish leaves `current_iteration` in a safe closed/reset runtime state
- Verification: After a closed iteration finishes, `current_iteration.json` no longer contains an active step or stale blocking state, while `state.json` still captures the completion summary needed for rehydrate and review.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R2; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 3; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 4
- Depends on: 1
- Scope: `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, shared runtime-state helper if introduced, workflow loop tests
- Replan condition: If preserving summary/history requires a dedicated archive artifact rather than `state.json` reuse

### Step 3
- Step ID: U3
- Result: Cross-tool regression guards the repaired closure contract
- Verification: `python3 -m unittest tests.test_imm_work tests.test_imm_review tests.test_workflow_loop.WorkflowLoopTests.test_finish_blocks_unclosed_iteration tests.test_workflow_loop.WorkflowLoopTests.test_finish_uses_healed_iteration_state_before_blocking tests.test_workflow_loop.WorkflowLoopTests.test_end_to_end_step_flow_and_dehydrate tests.test_workflow_loop.WorkflowLoopTests.test_finish_closure_resets_runtime_state_after_dehydrate` passes, proving healed-status-vs-finish alignment and post-finish runtime reset behavior without depending on unrelated `imm-heal` inventory leftovers.
- Agent Hint: imm-executor
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R3; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 5
- Depends on: 1, 2
- Scope: `tests/test_imm_work.py`, `tests/test_imm_review.py`, targeted `tests/test_workflow_loop.py` closures
- Replan condition: If existing fixtures cannot express the repaired semantics without first restructuring unrelated historical test scaffolding, or if full-file workflow-loop assertions are still required for closure

## Notes
- Keep the repair state-contract-first: if a narrower helper extraction is enough, do not expand into a general workflow state framework.
- This plan intentionally excludes README edits, skill-output cleanup, dev insights redesign, and any migration of historical task records.
