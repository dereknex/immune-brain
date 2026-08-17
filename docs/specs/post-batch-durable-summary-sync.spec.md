# Spec: post-batch durable summary sync

**任务 ID**: IMM-MEM-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 first-subagent-batch 完成后 `.imm/memory/MEMORY.md` 顶部摘要与实际 workflow 完成态不一致的问题。

首版只收敛 durable summary sync：让 `MEMORY.md` 的 `最新摘要`、`待办事项`、`最后同步`
与当前 batch 已完成、下一步应进入 `imm-compounder` 的事实保持一致。

## 2. 问题背景

当前 repo 已完成 first-subagent-batch 的 4 个 step，`.imm/memory/current_iteration.json`
显示：

- `completed_steps: [1,2,3,4]`
- `active_step: null`
- `next_action.skill: imm-compounder`

但 `MEMORY.md` 顶部状态仍停留在“Validate and execute the first subagent batch”的执行前口径，
会误导后续 rehydrate、compound 或人工接手。

## 3. 功能需求

### R1. Durable summary alignment

- `MEMORY.md` 顶部摘要必须反映 first-subagent-batch 已完成。
- `待办事项` 必须从“继续执行 batch”切换为“进入 imm-compounder / 沉淀可复用模式”。
- `最后同步` 必须更新到本次 summary sync 时间。

### R2. Scope boundary

- 本切片只处理 `MEMORY.md` 顶部 durable summary 的一致性。
- 不修改 `.imm/memory/current_iteration.json`。
- 不在本轮处理 runtime state 是否纳入提交的策略。
- 不扩成 finish、compound 或 runtime-state reset 流程修复。

### R3. Verification path

- 必须存在一条简单、可复现的检查路径，证明：
  - `MEMORY.md` 顶部状态不再保留 stale 的 “Validate and execute ...” 文案；
  - 顶部状态与 `imm-work status` 所示 “plan complete / next skill imm-compounder” 一致。

## 4. 验收标准

- [ ] `MEMORY.md` 顶部摘要明确表示 first-subagent-batch 已完成。
- [ ] `待办事项` 不再指向继续执行 batch，而是指向 `imm-compounder`。
- [ ] 本切片不修改 `.imm/memory/current_iteration.json`。
- [ ] 验证路径能说明 durable summary 与当前 workflow 完成态一致。

## 5. 非目标

- 不处理 `.imm/memory/current_iteration.json` 的提交策略。
- 不重置 runtime state。
- 不创建 compound solution doc。
- 不扩展到 finish / compound 自动化行为修复。

## 6. 依赖项

- 依赖 [2026-05-09-005-feat-first-subagent-batch-plan.md](docs/plans/2026-05-09-005-feat-first-subagent-batch-plan.md)
  已全部完成。
- 依赖 `.imm/memory/current_iteration.json` 作为当前 workflow 完成态的 source of truth。
