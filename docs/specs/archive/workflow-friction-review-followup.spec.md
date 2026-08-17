# Spec: workflow friction review follow-up

**任务 ID**: IMM-WORKFLOW-004  
**负责人**: Planner  
**状态**: Proposed

## 1. 目标

修复 `workflow friction reduction` 首轮 contract 改动在 code review 中暴露的两个后续问题：

1. `imm-preplan-review` 的触发语义仍有路由冲突；
2. `.imm/memory/MEMORY.md` 顶部 durable summary 落后于已完成的 runtime state。

首版只修正 contract 一致性和 durable summary 文案，不扩展到 runtime engine、
`current_iteration.json` reset/commit 策略或新的 workflow 模式。

## 2. 问题背景

`workflow friction reduction` 计划已经完成 3 个 step，并通过 focused regression。
但后续 `imm-code-review` 发现两处独立问题：

- README 一处仍写着轻量 bugfix / hotfix “应先经过 `imm-preplan-review`”，
  与同轮新增的“`imm-preplan-review` 是条件触发 gate，稳定小任务可直接进入
  `imm-planner`”形成语义冲突。
- `.imm/memory/current_iteration.json` 已显示该计划 `completed_steps = [1,2,3]` 且
  active step 为空，但 `MEMORY.md` 顶部仍停留在 planned / execute wording，
  未切回完成态或 compound next。

## 3. 功能需求

### R1. Preplan routing contract must be internally consistent

- README、`IMMUNE.md`、`skills/imm-preplan-review/SKILL.md` 必须使用同一条路由语义。
- 如果 `imm-preplan-review` 是条件触发 gate，那么轻量 bugfix / hotfix 也必须先经过
  trigger 判断，而不是被写成固定必经阶段。
- 稳定小任务直接进入 `imm-planner` 的条件必须保留，不被另一处旧文案抵消。

### R2. Durable summary must match completed runtime state

- `MEMORY.md` 顶部 `最新摘要` 与 `待办事项` 必须反映：
  - `workflow friction reduction` repair slice 已完成；
  - 当前下一入口应为 `imm-compounder`，而不是继续执行该计划。
- 该修复只允许修改 `MEMORY.md`，不修改 `.imm/memory/current_iteration.json`。

### R3. Scope stays narrow

- 不修改 runtime engine、`imm-work` 状态机、`imm-review` 行为或 `imm-finish`。
- 不修改 `.imm/memory/current_iteration.json` 的提交策略或 reset 策略。
- 不引入新的 workflow mode、autowork 行为或 authority merge。

## 4. 验收标准

- [ ] README / `IMMUNE.md` / `skills/imm-preplan-review/SKILL.md` 不再对 hotfix/small-task 路由给出互相冲突的规则。
- [ ] focused contract tests 能覆盖 trigger-only preplan 语义，而不只是 snippet presence。
- [ ] `MEMORY.md` 顶部摘要不再描述 `workflow friction reduction` 为 planned / execute 中。
- [ ] `MEMORY.md` 顶部待办事项与当前完成态一致，不再指向该计划的执行入口。
- [ ] 本轮不扩展到 `.imm/memory/current_iteration.json`、runtime reset 或 commit policy。

## 5. 非目标

- 不重写 `workflow friction reduction` 主计划。
- 不修改 `.imm/memory/current_iteration.json` 的内容、提交流程或长期状态策略。
- 不把这次 follow-up 扩展成新的 contract framework。

## 6. 依赖项

- 依赖 [2026-05-09-015-refactor-workflow-friction-reduction-plan.md](docs/plans/2026-05-09-015-refactor-workflow-friction-reduction-plan.md)
  作为首轮变更来源。
- 依赖 [closure-side-durable-summary-sync.md](docs/solutions/closure-side-durable-summary-sync.md)
  作为 durable summary 对齐模式参考。
