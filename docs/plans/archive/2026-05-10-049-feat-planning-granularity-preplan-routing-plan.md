---
title: feat: planning granularity and conditional preplan routing
type: feat
status: planned
date: 2026-05-10
origin: user thread on reducing ceremonial imm-preplan-review and larger outcome-based plan steps
---

# Iteration Plan

## Task
- Summary: Align planner/preplan/docs/contracts so planning uses fewer outcome steps for larger features while keeping verification explicit, and preplan stays a conditional gate—not a default shrink-to-minimal-slice ritual.
- Origin: User reported repeated routing to `imm-preplan-review` with scope narrowed to the smallest slice, inflating workflow rounds; wants **coarser planning grain** with **controlled acceptance grain** per step.
- Research: Reviewed `skills/imm-planner/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `IMMUNE.md`, `README.md`, `tests/test_skill_contracts.py`, and `.imm/specs/outcome-step-planning.spec.md`. Conclusion: skills already forbid action-micro steps and label preplan as trigger-only, but lack explicit **two-layer granularity** (outcome step vs implementation batches) and **post-gate default handoff** language; README small-task wording can be read as universal minimal slicing.
- Decisions: D1 encode two-layer granularity in planner skill text without reintroducing fixed step counts; D2 tighten preplan skill so pass-through defaults to `imm-planner` and Scope Reduction is not the default posture; D3 adjust IMMUNE/README for consistency while preserving existing contract substrings required by tests (including small-task one-step path); D4 extend contract tests for new canonical phrases only—no broad rewrite of test suite.
- Assumptions: No validator changes; historical plans unchanged; users may still request explicit preplan when scope or verification is unstable.

## Steps

### Step 1
- Step ID: U1
- Result: Planner skill documents two-layer outcome granularity versus step-internal implementation batches.
- Verification: `skills/imm-planner/SKILL.md` states outcome steps may bundle larger deliverables when verification stays one closure per step; same edit forbids treating scope-narrowing as permission for action-micro steps; outcome-step rules stay consistent with existing planner skill.
- Agent Hint: imm-executor
- Test scenarios: Covers PG1
- Depends on: none

### Step 2
- Step ID: U2
- Result: Preplan skill documents default gate pass-through toward imm-planner plus anti-ceremony posture for Scope Reduction.
- Verification: `skills/imm-preplan-review/SKILL.md` names `imm-planner` as the default next skill after a clean gate; Hold plus Selective Expansion are presented as peers to reflexive Scope Reduction toward a single minimal slice.
- Agent Hint: imm-executor
- Test scenarios: Covers PG2
- Depends on: 1

### Step 3
- Step ID: U3
- Result: IMMUNE.md plus README workflow sections match the planning-granularity spec while preserving small-task paths.
- Verification: Both files carry coarse outcome planning plus conditional preplan alignment from `.imm/specs/planning-granularity-preplan-routing.spec.md`; `README.md` still contains `` `imm-planner` 收敛成最小的一步计划 `` for existing contract tests; spot-check §5 plus 组合主线 for internal contradiction.
- Agent Hint: imm-executor
- Test scenarios: Covers PG3
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Contract tests assert canonical phrases from the U1 through U3 skill plus README edits.
- Verification: `python3 -m unittest tests.test_skill_contracts` passes with new stable substring assertions tied to those edits.
- Agent Hint: imm-executor
- Test scenarios: Covers PG4
- Depends on: 3

## Notes
- Do not delete or split existing README sentences that `tests/test_skill_contracts.py` substring-matches unless the same commit updates those tests.
- Step count here is intentionally small (four outcome steps); each step may include multiple files/commits internally.
