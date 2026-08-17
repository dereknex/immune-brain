---
title: fix: scope runtime state to current project
type: fix
status: planned
date: 2026-05-08
origin: user request after diagnosing cross-project self-heal drift in imm-work
---

# Iteration Plan

## Task
- Summary: Repair project-scoped runtime state loading so imm-work self-heal cannot steal another project's plan
- Origin: During `imm-autowork` on the system-subagents plan, `imm-work status` self-healed from the current repo plan to an external `nextty.dev` worktree plan and cleared the active step. The diagnosis traced this to project-agnostic runtime state paths plus history recovery that is not bounded to the current project.
- Research: Checked `.imm/imm-work.py`, `.imm/current_iteration_state.py`, `.imm/imm-dehydrate.py`, `.imm/imm-finish.py`, `scripts/legacy-cli-launcher`, `scripts/legacy-installer.sh`, existing `current_iteration` spec/plan, and `tests/test_imm_work.py` / `tests/test_workflow_loop.py`. Conclusion: installed CLI wrappers execute scripts from the `agent-skills` repo, so `SCRIPT_DIR`-anchored state paths become global across projects; once that shared state contains cross-project history, `recover_plan_from_history()` can legally restore an unrelated absolute plan path.
- Decisions: D1 fix the runtime path anchor first, so `current_iteration` and related artifacts live under the active project root; D2 bound self-heal to the current project root, so relative plans resolve predictably and external worktree history is ignored; D3 keep the slice focused on runtime state and self-heal behavior, not a broader CLI/skill routing redesign.
- Assumptions: target projects contain or can create `.imm/memory/`; the CLI is normally invoked from the target project root or a descendant; tests can patch explicit temp paths and still validate the new helper behavior without requiring full legacy-installer end-to-end setup.

## Steps

### Step 1
- Step ID: U1
- Result: Runtime state paths resolve from the current project root instead of the engine source repo
- Verification: `imm-work`, `imm-review`, `imm-dehydrate`, and `imm-finish` derive canonical runtime paths from the active project root, and a focused regression proves the helper returns project-local `.imm/memory` paths.
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R1; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 1
- Depends on: none
- Scope: `.imm/current_iteration_state.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-dehydrate.py`, `.imm/imm-finish.py`, focused unit tests
- Replan condition: If project-root discovery requires broader installer or shell-launch redesign beyond runtime path calculation

### Step 2
- Step ID: U2
- Result: self-heal only recovers plan/history within the current project boundary
- Verification: A regression proves an invalid current plan can recover a same-project historical plan, while cross-project historical plans are ignored and cannot clear or replace the current project's active step.
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R1; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 2
- Depends on: 1
- Scope: `.imm/current_iteration_state.py`, `tests/test_imm_work.py`
- Replan condition: If the runtime contract requires cross-project plan recovery as an intentional feature

### Step 3
- Step ID: U3
- Result: Focused regression closes the project-scoped runtime-state contract
- Verification: `python3 -m unittest tests.test_imm_work tests.test_imm_review tests.test_workflow_loop.WorkflowLoopTests.test_finish_uses_healed_iteration_state_before_blocking tests.test_workflow_loop.WorkflowLoopTests.test_finish_closure_resets_runtime_state_after_dehydrate` passes.
- Test scenarios: Covers IMM-WORKFLOW-STATE-001 R3; Covers IMM-WORKFLOW-STATE-001 acceptance criteria 5
- Depends on: 1, 2
- Scope: focused runtime-state tests only
- Replan condition: If the focused regressions cannot express the repaired semantics without unrelated workflow-loop or legacy-installer failures

## Notes
- Keep the fix project-scoped and state-contract-scoped; do not expand into a general multi-project session manager.
- This slice may touch `run_dehydrate` path resolution only if needed to keep finish/dehydrate consistent with the new project-root state paths.
