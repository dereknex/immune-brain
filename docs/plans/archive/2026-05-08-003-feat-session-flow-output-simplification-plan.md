---
title: feat: Plan session flow and output simplification
type: feat
status: planned
date: 2026-05-08
origin: User retrospective on this session: workflow felt repetitive, output too verbose, and unnecessary process detail was exposed
---

# Iteration Plan

## Task
- Summary: Smooth the default Immune-Brain session flow by reducing visible workflow hops, simplifying success-path output, and auto-healing recoverable state mismatches.
- Origin: User asked for an improvement plan after this session review, with emphasis on less repetition, less verbosity, and less internal process exposure.
- Research: Reviewed `IMMUNE.md`, `skills/imm-planner/SKILL.md`, current `MEMORY.md`, and the just-completed midterm-planning session behavior summarized in conversation.
- Decisions: Keep scope on workflow ergonomics only; defer broader architecture cleanup; treat success-path brevity and state-source repair as first-class outcomes.
- Assumptions: Existing workflow tests and skill-contract checks can be extended to cover output and preflight behavior; no new role or skill is needed.

## Steps

### Step 1
- Step ID: U1
- Result: 收敛 `imm-work` 的默认继续入口与成功路径输出契约
- Verification: 手工验证 `imm-work` skill 说明与相关实现/夹具明确默认只暴露“结论 / 产物 / 下一步”，且同轮继续不再要求用户显式切换 skill。
- Scope: `skills/imm-work/SKILL.md`，必要时 `.imm/imm-work.py` 与相关 workflow tests / fixtures
- Depends on: none
- Replan_condition: 若需要改动多个角色边界才能达成该结果，说明当前切片过大，应回到 planner 重新拆分。

### Step 2
- Step ID: U2
- Result: 建立 `imm-work` 进入前的单一状态源与静默自愈路径
- Verification: 复现一个可恢复的脏状态场景时，系统会优先修正 `plan_path` / active step / source-of-truth 问题并继续，而不是先向用户暴露内部异常。
- Scope: `.imm/imm-work.py`，必要时 `.imm/imm-heal.py`、workflow state helpers、相关 regression tests
- Depends on: 1
- Replan_condition: 若单一状态源修复涉及仓库级迁移或跨多工具联动，回到 planner 改为单独修复计划。

### Step 3
- Step ID: U3
- Result: 收紧 `imm-qa` 与全局默认输出的 verbose/debug 分流契约
- Verification: `pass` 场景只输出一句结论加一句证据；失败场景保留详细原因；相关 skill docs 和测试能区分 default 与 debug 信息密度。
- Scope: `skills/imm-qa/SKILL.md`，必要时相关 skill docs、tests、fixtures、README 说明
- Depends on: 1,2
- Replan_condition: 若 default/debug 模式边界无法在现有契约内表达，回到 planner 重新定义输出模式边界。

## Notes
- 优先修成功路径体验，不把本轮范围扩大到 UI 层或新工作流编排能力。
- 每步都要保持独立闭环；如果某一步只能依赖多项混合修改才能验证，就应在执行前重新拆分。
