---
title: feat: Plan framing stage terse output
type: feat
status: planned
date: 2026-05-08
origin: User asked to further simplify reply style by reducing explanation and process narration in the Immune-Brain framing stages
---

# Iteration Plan

## Task
- Summary: Tighten the default output contract for `imm-brainstorm` and `imm-preplan-review` so framing-stage replies lead with the conclusion and only expand process detail when needed.
- Origin: User asked for a further simplification pass after the brainstorm and preplan responses still felt too explanatory.
- Research: Reviewed `IMMUNE.md`, existing brainstorm notes, `docs/solutions/default-debug-workflow-output-split.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `README.md`, and `tests/test_skill_contracts.py`.
- Decisions: Apply `Scope Reduction`; keep the slice on framing-stage skill contracts first; treat repeated boundary fields as optional-by-default user-facing output rather than mandatory every turn.
- Assumptions: Current skill docs and contract tests are the right place to lock the terse-default rule before touching any broader workflow roles.

## Steps

### Step 1
- Step ID: U1
- Result: `imm-brainstorm` terse-default handoff contract
- Verification: 手工检查 `skills/imm-brainstorm/SKILL.md`，确认默认输出被定义为短格式，且较完整字段只在阻塞、边界变化、或用户明确要求时展开。
- Scope: `skills/imm-brainstorm/SKILL.md`
- Depends on: none
- Replan_condition: 若 `imm-brainstorm` 需要保留大量默认解释才能完成 handoff，说明 terse slice 仍不稳定，应回到 planner 重新定义边界。

### Step 2
- Step ID: U2
- Result: `imm-preplan-review` terse-default preplan handoff contract
- Verification: 手工检查 `skills/imm-preplan-review/SKILL.md`，确认默认输出被定义为短格式，且过程说明不再默认展开。
- Scope: `skills/imm-preplan-review/SKILL.md`
- Depends on: 1
- Replan_condition: 若 `imm-preplan-review` 的边界检查必须长期依赖长格式默认输出，说明当前收敛目标不成立，应回到 planner 重新审查。

### Step 3
- Step ID: U3
- Result: framing-stage terse-default contract guardrail
- Verification: `python3 -m unittest tests.test_skill_contracts.py` 通过，且守卫明确约束 framing-stage 的默认简短输出。
- Scope: `tests/test_skill_contracts.py`
- Depends on: 1, 2
- Replan_condition: 若现有测试文件无法表达该 contract，回到 planner 决定是否改为文档守卫而不是扩大测试框架。

## Notes
- 本轮不扩展到 `imm-work`、`imm-executor`、`imm-qa` 的再次重写，也不把 README/template 对齐当成必需前置结果。
- 保留 contract 字段，但不再把“每轮都完整外显”当成默认用户输出义务。
