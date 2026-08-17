---
title: "feat: implement skill baselining and standardized delegation packets"
type: feat
status: completed
date: 2026-05-10
origin: "docs/brainstorms/imm-brainstorm-skills-cost-analysis-2026-05-10.md"
---

# Iteration Plan

## Task
- Summary: Implement skill baselining and standardized delegation packets to reduce context overhead (currently ~146KB total).
- Origin: Identified significant context overhead in research. Brainstorm recommended a `BASELINE.md` and "Role Delta" pattern.
- Research: Checked skill sizes (imm-work ~14KB, imm-planner ~10KB). Found existing `Runtime Payload vs Outer Contract Split` pattern in `imm-party` which can be generalized.
- Decisions: D1 Create `skills/BASELINE.md` as the source of truth for shared guards and styles; D2 Refactor core skills to point to the baseline; D3 Standardize delegation packets to `shared_context_summary + focus_delta`.
- Assumptions: Baseline reference is sufficient for agent adherence; existing contract tests can be adapted.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `skills/BASELINE.md`, `skills/imm-work/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-party/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path: token size reduction check + contract regression tests.
  - blockers: none identified.
  - replan_condition: if baselining leads to significant degradation in agent behavior/compliance.

## Steps

### Step 1
- Step ID: U1
- Result: `skills/BASELINE.md` workflow logic centralization
- Verification: File exists and contains `Output Style`, `Shared Guards`, and `Boundary Baseline`.
- Status: completed
- Depends on: none
- Scope: `skills/BASELINE.md`
- Replan condition: none

### Step 2
- Step ID: U2
- Result: `imm-work` skill prompt compression
- Verification: `wc -c skills/imm-work/SKILL.md` shows significant reduction; contract tests pass.
- Status: completed
- Depends on: 1
- Scope: `skills/imm-work/SKILL.md`
- Replan condition: none

### Step 3
- Step ID: U3
- Result: `imm-planner` skill prompt compression
- Verification: `wc -c skills/imm-planner/SKILL.md` shows significant reduction; contract tests pass.
- Status: completed
- Depends on: 2
- Scope: `skills/imm-planner/SKILL.md`
- Replan condition: none

### Step 4
- Step ID: U4
- Result: `imm-executor` skill prompt compression
- Verification: Skills point to `BASELINE.md`; contract tests pass.
- Status: completed
- Depends on: 3
- Scope: `skills/imm-executor/SKILL.md`
- Replan condition: none

### Step 5
- Step ID: U5
- Result: `imm-qa` skill prompt compression
- Verification: Skills point to `BASELINE.md`; contract tests pass.
- Status: completed
- Depends on: 4
- Scope: `skills/imm-qa/SKILL.md`
- Replan condition: none

### Step 6
- Step ID: U6
- Result: `imm-brainstorm` skill prompt compression
- Verification: Skills point to `BASELINE.md`; contract tests pass.
- Status: completed
- Depends on: 5
- Scope: `skills/imm-brainstorm/SKILL.md`
- Replan condition: none

### Step 7
- Step ID: U7
- Result: `imm-party` layered delegation packet standardization
- Verification: Skill uses `shared_context_summary + focus_delta` pattern.
- Status: completed
- Depends on: 6
- Scope: `skills/imm-party/SKILL.md`
- Replan condition: none

### Step 8
- Step ID: U8
- Result: `imm-preplan-review` layered delegation packet standardization
- Verification: Skill uses `shared_context_summary + focus_delta` pattern.
- Status: completed
- Depends on: 7
- Scope: `skills/imm-preplan-review/SKILL.md`
- Replan condition: none

### Step 9
- Step ID: U9
- Result: `tests/test_skill_contracts.py` contract regression pass
- Verification: `python3 -m unittest tests/test_skill_contracts.py`
- Status: completed
- Depends on: 8
- Scope: `tests/test_skill_contracts.py`
- Replan condition: none
