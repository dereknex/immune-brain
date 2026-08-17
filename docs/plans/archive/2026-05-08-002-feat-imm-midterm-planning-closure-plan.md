---
title: feat: Plan Immune-Brain midterm planning closure framework
type: feat
status: planned
date: 2026-05-08
origin: User-selected 1+1 scope in imm-brainstorm/preplan flow (governance + one value template)
---

# Iteration Plan

## Task
- Summary: Establish a midterm planning framework with governance closure and one high-value template line.
- Origin: User selected 方案 C with A（治理交付闭环）+ B（目标追踪模板） in `imm-brainstorm`/`imm-preplan-review`.
- Research: Reviewed `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-output-2026-05-07.md`, prior party advisory/spec/plans (`.imm/specs/party-mode-advisory.spec.md`, `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md`), and current planning patterns in existing `docs/plans/` and `.imm/specs/`.
- Decisions: Keep scope to 1+1 lines only, no runtime feature expansion, and make outcomes independently closable for verification before execution.
- Assumptions: Midterm horizon is 3–6 months; both lines share one evidence format; execution in future iterations remains under `imm-work` + `imm-executor`.

## Steps

### Step 1
- Step ID: U1
- Result: 发布中期规划规格文件
- Verification: 手工核对规格包含目标、R1/R2/R3、验收标准、非目标、依赖项，且字段可支持 handoff 复用。
- Scope: `.imm/specs/midterm-planning-imm-workflow.spec.md`
- Depends on: none
- Replan_condition: 若规格字段中出现超出 1+1 目标或新增外部依赖，需回到 preplan 重新收窄。

### Step 2
- Step ID: U2
- Result: 建立中期规划闭环模板草案
- Verification: 确认新增/更新文档包含：问题陈述、目标范围、里程碑、KPI、回退条件、复盘周期，并能在 1+1 约束下复用。
- Scope: `docs/brainstorms/`（拟新增/更新 `imm-midterm-planning-template.md`）
- Depends on: 1
- Replan_condition: 若模板难以容纳 1+1 结构且影响 handoff 复用，退回 preplan 重新界定字段集合。

### Step 3
- Step ID: U3
- Result: 更新 `.imm/memory/MEMORY.md` 持久化任务状态
- Verification: `当前状态` 和 `任务历史` 反映本次“中期规划框架”已进入 planned 状态，且与当前计划链路一致。
- Scope: `.imm/memory/MEMORY.md`
- Depends on: 1,2
- Replan_condition: 若 memory 记录出现跨任务冲突（如当前摘要不一致），需与当前迭代状态对齐后再推进。

## Notes
- 维持最小范围，不把中期规划扩展为代码级功能；本计划的可交付仅用于流程闭环和复用模板。
- 每步均要求可验证；如 U1 或 U2 验收未通过，必须先补齐文档边界后再进入下一步。
