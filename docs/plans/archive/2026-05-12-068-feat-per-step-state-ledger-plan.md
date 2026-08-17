---
title: "feat: Per-step state ledger for parallel-ready workflow"
type: feat
status: active
date: 2026-05-12
origin: brainstorm analysis of workflow state management vs parallel subagent execution
---

# Iteration Plan

## Task
- Summary: Introduce a per-step state ledger in current_iteration.json replacing single-slot active_step plus flat completed_steps with explicit state transitions and backward-compatible migration
- Origin: imm-brainstorm identifying conflict between current single-active-step state model and future parallel step execution needs
- Research: current_iteration_state.py owns default schema and load/save/heal; imm-work.py owns activate and record-execution assuming active_step single-slot; imm-review.py appends completed_steps and clears active_step on pass; imm-plan.py resets completed_steps on plan switch; existing learning canonical-runtime-state-paths requires tool-family-wide migration
- Decisions: D1 add schema_version field with value 2; D2 steps keyed by number as string in a steps map; D3 single-active policy as removable gate function; D4 transition table as data structure in current_iteration_state.py; D5 active_step and completed_steps become derived output-only fields
- Assumptions: No external project consumes current_iteration.json programmatically; imm-finish and imm-dehydrate only read completed_steps and active_step for summary
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/current_iteration_state.py`, `.imm/imm-work.py`, `.imm/imm-review.py`, `.imm/imm-plan.py`, `tests/`
  - dependencies_known: true
  - verification_path:
      - target: new schema loads old format via migration; transition enforcement rejects illegal moves; all existing workflow tests pass
      - method: `python3 -m unittest tests.test_state_ledger tests.test_imm_work tests.test_imm_review tests.test_skill_contracts`
  - blockers: none
  - replan_condition: if imm-finish.py or imm-dehydrate.py have deeper coupling to old schema shape than assumed

## Steps

### Step 1
- Step ID: U1
- Result: current_iteration_state.py exposes a per-step state ledger layer (VALID_TRANSITIONS table / migrate_v1_to_v2 / get_active_steps / get_completed_steps) tested by a new test_state_ledger module
- Verification: `python3 -c "import importlib.util as u; s=u.spec_from_file_location('m','.imm/current_iteration_state.py'); m=u.module_from_spec(s); s.loader.exec_module(m); assert hasattr(m,'VALID_TRANSITIONS'); assert hasattr(m,'migrate_v1_to_v2'); assert hasattr(m,'get_active_steps'); assert hasattr(m,'get_completed_steps'); print('OK')"` exits zero; `python3 -m unittest tests.test_state_ledger` exits zero with migration and transition tests passing
- Test scenarios: Load old-format current_iteration.json produces valid v2 state; Attempt illegal transition raises ValueError; Derived get_completed_steps returns correct list from ledger; Derived get_active_steps returns correct list from ledger; Migration preserves active_step evidence and history
- Depends on: none
- Scope: `.imm/current_iteration_state.py`, `tests/test_state_ledger.py`
- Execution note: test-first

### Step 2
- Step ID: U2
- Result: imm-work.py / imm-review.py operate on the per-step ledger API with single-active policy enforced while all existing workflow tests remain green
- Verification: `python3 -m unittest tests.test_imm_work tests.test_imm_review` exits zero; `python3 .imm/imm-work.py status --json` output contains active_step key (derived); `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Activate step updates ledger entry to active state; Record execution transitions step to ready_for_review; QA pass transitions step to closed; QA rework transitions step to rework_needed; Status output backward compatible
- Depends on: 1
- Scope: `.imm/imm-work.py`, `.imm/imm-review.py`, `tests/test_imm_work.py`, `tests/test_imm_review.py`
- Execution note: characterization-first

### Step 3
- Step ID: U3
- Result: Remaining tooling (imm-plan.py / imm-finish / imm-dehydrate) uses ledger API with SKILL.md contract text acknowledging the per-step state ledger
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero; `grep -n "State Ledger" CONTEXT.md` shows hit; `python3 .imm/imm-plan.py docs/plans/2026-05-12-068-feat-per-step-state-ledger-plan.md --json` exits zero; `python3 -m unittest tests.test_imm_work tests.test_imm_review` exits zero
- Test scenarios: Plan sync initializes ledger with pending steps; imm-finish reads derived completed_steps correctly; CONTEXT.md defines State Ledger term; SKILL.md references updated from single-slot to ledger semantics
- Depends on: 2
- Scope: `.imm/imm-plan.py`, `.imm/imm-finish.py`, `.imm/imm-dehydrate.py`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `CONTEXT.md`, `tests/test_skill_contracts.py`
