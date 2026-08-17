---
title: refactor: make planning outcome based
type: refactor
status: planned
date: 2026-05-07
origin: user decision and .imm/specs/outcome-step-planning.spec.md
---

# Iteration Plan

## Task
- Summary: Replace fixed step counts with outcome-based planning in Immune-Brain
- Origin: User corrected the brainstorm framing on 2026-05-07: do not set concrete step counts; plan according to independently closable results.
- Research: Checked `IMMUNE.md`, `skills/imm-planner/SKILL.md`, `.imm/templates/iteration-plan-template.md`, `.imm/imm-plan.py`, `.imm/specs/plan-work-review-rewrite.spec.md`, and `docs/brainstorms/immune-brain-requirements.md`. Conclusion: the system already values independently verifiable steps, but planner docs and validator still encode `3-5` as a hard rule.
- Decisions: D1 remove fixed step count as a planning quality rule; D2 keep at least one step as the validator floor; D3 treat step as an outcome unit rather than an execution action; D4 update validator behavior together with docs so workflow guidance and enforcement stay aligned.
- Assumptions: No runtime state migration is needed because plan files are markdown artifacts; existing completed plans can remain historical records.

## Steps

### Step 1
- Step ID: U1
- Result: 固定数量约束从治理文档移除
- Verification: `IMMUNE.md`, `.imm/specs/plan-work-review-rewrite.spec.md`, and `docs/brainstorms/immune-brain-requirements.md` describe planning by independently closable outcomes without requiring `3-5` steps.
- Test scenarios: Covers AC1; Covers AC6
- Depends on: none

### Step 2
- Step ID: U2
- Result: 规划角色契约改为闭合结果驱动
- Verification: `skills/imm-planner/SKILL.md` and `.imm/templates/iteration-plan-template.md` both say step count is determined by independently closable outcomes and explicitly reject execution-action micro steps.
- Test scenarios: Covers AC1; Covers AC2
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 计划校验器支持自然步数
- Verification: `.imm/imm-plan.py` accepts a valid one-step plan, rejects a zero-step plan, preserves dependency and placeholder checks, and reports wording that no longer references `3-5`.
- Test scenarios: Covers AC3; Covers AC4
- Depends on: 2

### Step 4
- Step ID: U4
- Result: 动作型小步被校验材料拦截
- Verification: Validator tests or documented fixtures include an execution-action step such as reading a file or running a command and show it is rejected while a result-state step passes.
- Test scenarios: Covers AC5
- Depends on: 3

## Notes
- Do not rewrite unrelated workflow roles.
- Do not migrate historical plans unless they are used as active fixtures.
- If validator action detection becomes too subjective, prefer a small explicit denylist of action-shaped phrasing over a broad classifier.
