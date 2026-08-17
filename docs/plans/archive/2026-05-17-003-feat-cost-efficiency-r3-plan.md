---
title: "feat: cost efficiency improvements round 3"
type: feat
status: pending
date: 2026-05-17
origin: "user request to explore remaining cost reduction opportunities based on existing telemetry"
---

# Iteration Plan

## Task
- Summary: Implement round 3 of cost efficiency improvements: Discovery constraints, Dispatch short-circuiting, Prompt pruning, and State Dehydration (GC).
- Origin: User requested additional cost optimization strategies.
- Research: Reviewed recent brainstorms, baseline efforts, and telemetry implementation. Recognized that while payload size per dispatch is down, dispatch frequency, discovery strategy, and state retention are the main token sinks.
- Decisions: D1 Update the dispatch protocol to formally allow short-circuiting on simple tasks; D2 Create a `State Dehydration` step in the iteration closure or compounder; D3 Update `BASELINE.md` and related skills to prefer shallow discovery (signatures over full files); D4 Prune at least one historically un-triggered workflow guard.
- Assumptions: Dehydrating closed step evidence won't break upstream context syncs; existing contract tests can be adapted.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `docs/reference/subagent-dispatch-protocol.md`, `skills/BASELINE.md`, `.imm/imm_core/current_iteration_state.py`, `skills/imm-compounder/SKILL.md`
  - dependencies_known: true
  - verification_path: `imm-plan` validation + run a test task and observe `.imm/memory/current_iteration.json` size reduction.
  - blockers: none.
  - replan_condition: if dehydration breaks the QA/Compounder logic or state integrity tests.

## Steps

### Step 1
- Step ID: U1
- Result: Updated Subagent Dispatch Protocol supporting short-circuiting for low-risk single-domain tasks
- Verification: `cat docs/reference/subagent-dispatch-protocol.md | grep -i "short-circuit"` returns results.
- Status: pending
- Depends on: none
- Scope: `docs/reference/subagent-dispatch-protocol.md`
- Replan condition: none

### Step 2
- Step ID: U2
- Result: BASELINE.md updated with shallow discovery constraints
- Verification: `cat skills/BASELINE.md | grep -i "shallow discovery"` returns results; `python3 -m unittest tests/test_skill_contracts.py` passes.
- Status: pending
- Depends on: 1
- Scope: `skills/BASELINE.md`, `tests/test_skill_contracts.py`
- Replan condition: none

### Step 3
- Step ID: U3
- Result: Implemented State Dehydration logic in `current_iteration_state.py` for closed steps
- Verification: `python3 -m unittest tests/test_current_iteration_state.py` passes after adding a test for dehydration behavior.
- Status: pending
- Depends on: 2
- Scope: `.imm/imm_core/current_iteration_state.py`, `tests/test_current_iteration_state.py`
- Replan condition: none

### Step 4
- Step ID: U4
- Result: Updated `imm-compounder` skill to invoke State Dehydration on successful closure
- Verification: `python3 -m unittest tests/test_skill_contracts.py` passes with updated `imm-compounder` instructions.
- Status: pending
- Depends on: 3
- Scope: `skills/imm-compounder/SKILL.md`
- Replan condition: none
