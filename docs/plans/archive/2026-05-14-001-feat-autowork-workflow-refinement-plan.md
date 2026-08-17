---
title: "feat: autowork workflow refinement"
date: 2026-05-14
---

# Iteration Plan

- Summary: Refine the boundary between imm-work and imm-autowork by introducing can_auto_advance and standardizing snapshots.

## Task
- Summary: Implement a clear contract between `imm-work` and `imm-autowork` using a machine-readable safety flag and standardized reporting.
- Origin: Researching logical differences and relationship between imm-autowork and imm-work.
- Research: U4 full verification failed because `mise run test` exposed five pre-existing Skill contract assertion gaps in `tests/test_skill_contracts.py`; targeted `tests/test_workflow_loop.py` still passes.
- Decisions: D1 Add `can_auto_advance` to `imm-work` status output; D2 Use `HANDOFF.md` for human-readable persistence; D3 Standardize `run_snapshot` keys.
- Assumptions: Existing `.imm` state is sufficient to derive the safety flag. Blocking Skill contract text can be repaired without changing the closed U1-U3 outcomes.

## Steps

### Step 1
- Step ID: U1
- Result: Workflow refinement artifacts
- Verification: Files exist and the plan passes `imm-plan --json`.
- Scope: `.imm/specs/`, `docs/plans/`

### Step 2
- Step ID: U2
- Result: imm-work status logic update
- Verification: `imm-work status --json | grep can_auto_advance` shows the flag.
- Scope: `.imm/imm-work.py`

### Step 3
- Step ID: U3
- Result: imm-autowork skill prompt refinement
- Verification: Skill content references `can_auto_advance` and `run_snapshot`.
- Scope: `skills/imm-autowork/SKILL.md`

### Step 4
- Step ID: U4
- Result: Blocking Skill contract alignment
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_execution_entrypoints_define_plan_and_step_guards tests.test_skill_contracts.SkillContractTests.test_code_review_defines_repairability_routing tests.test_skill_contracts.SkillContractTests.test_review_followup_handoff_contract_is_shared tests.test_skill_contracts.ReviewFollowUpAppendContractTests.test_append_to_plan_contract_is_documented_across_skills tests.test_skill_contracts.ReviewFollowUpAppendContractTests.test_append_to_plan_route_layer_stays_planner_owned` passes.
- Scope: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-planner/SKILL.md`, `README.md`

### Step 5
- Step ID: U5
- Result: Workflow loop verification tests
- Verification: `mise run test` passes.
- Scope: `tests/test_workflow_loop.py`
