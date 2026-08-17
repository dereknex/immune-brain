# Spec: docs-verifier durable summary sync

**任务 ID**: IMM-MEM-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修正 `docs-verifier` runtime slice 完成后的 durable summary 漂移：让 `.imm/memory/MEMORY.md`
顶部摘要与当前已完成的 workflow 状态保持一致，不再继续指向“planned / execute via imm-work”
这类过期执行态。

首版只修复 `.imm/memory/MEMORY.md` 的顶部状态文案与最小任务历史说明；不修改
`.imm/memory/current_iteration.json`、compound 流程实现或 runtime reset 规则。

## 2. 问题背景

仓库刚完成 `docs-verifier` runtime slice 的 3 个执行步骤，并已通过本地 focused regression。
但 `imm-code-review` 发现 durable memory 没有在闭合后及时切换：

- `.imm/memory/current_iteration.json` 已显示当前 plan 的 `completed_steps` 为 `1, 2, 3`，
  且 `imm-work status` 的下一入口已转向 `imm-compounder`。
- `.imm/memory/MEMORY.md` 顶部却仍写着 `planned docs-verifier runtime slice` 与
  `execute docs-verifier runtime host slice via imm-work`，会把后续入口继续指向过期执行态。

这个问题与此前 `post-batch durable summary sync` 是同类 closure-side memory hygiene：
当一个 rollout/plan 已闭合时，durable summary 必须及时从“执行中”切到“完成/compound next”。

## 3. 功能需求

### R1. Durable summary must match completed runtime state

- `MEMORY.md` 顶部 `最新摘要` 必须反映 `docs-verifier` runtime slice 已完成，而不是仍处于 planned / executing。
- `待办事项` 必须与当前 workflow 真实下一入口一致，至少不能继续指向 `imm-work` 执行这条已完成 plan。

### R2. Scope stays narrow

- 只允许修改 `.imm/memory/MEMORY.md`。
- 不修改 `.imm/memory/current_iteration.json`。
- 不修改任何 runtime tool、finish 行为、compound 逻辑或计划外 docs。

### R3. Verification path

- 通过比对 `sed -n '1,8p' .imm/memory/MEMORY.md` 与 `imm-work status`，证明 durable summary
  已不再与 runtime completion state 冲突。
- 验证必须明确显示：
  - `MEMORY.md` 不再写执行中的 `docs-verifier` runtime slice；
  - `imm-work status` 仍保持当前 plan 已完成，下一入口为 `imm-compounder`。

## 4. 验收标准

- [ ] `.imm/memory/MEMORY.md` 顶部摘要不再描述 `docs-verifier` runtime slice 为 planned / execute via `imm-work`。
- [ ] `待办事项` 与当前 workflow 完成态一致，不再指向过期执行入口。
- [ ] 验证证据同时覆盖 `MEMORY.md` 顶部状态与 `imm-work status` 完成态。
- [ ] 本修复不扩展到 `.imm/memory/current_iteration.json`、compound 实现或 runtime reset 策略。

## 5. 非目标

- 不修改 `.imm/memory/current_iteration.json` 的提交或 reset 策略。
- 不修改 `imm-work`、`imm-finish`、`imm-compounder` 的实现。
- 不把这条修复扩成新的 memory framework 或自动 summary 同步机制。

## 6. 依赖项

- 依赖 [2026-05-09-013-feat-docs-verifier-runtime-slice-plan.md](docs/plans/2026-05-09-013-feat-docs-verifier-runtime-slice-plan.md)
  作为已完成 runtime slice 的来源。
- 依赖 [2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md](docs/plans/2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md)
  与 [first-subagent-batch-rollout.md](docs/solutions/first-subagent-batch-rollout.md)
  作为同类 durable summary 对齐模式参考。
