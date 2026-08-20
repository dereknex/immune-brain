# Spec: current iteration closure contract

**任务 ID**: IMM-WORKFLOW-STATE-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `current_iteration.json` 在 Immune-Brain workflow 中的状态语义漂移，
让 `imm-work`、`imm-review`、`imm-finish`、`imm-dehydrate` 对“当前活跃迭代”
和“任务已结束”的判断保持一致。

首版只收敛两类可观测问题：

- `imm-work status` 经过自愈后认为计划已完成，但 `imm-finish` 仍被旧
  `active_step` 阻塞。
- finish 成功后运行态未收口，旧 iteration 持续污染下一次任务判断。

本轮不扩展成完整 workflow 重构、历史迁移系统或新的状态存储层。

## 2. 问题背景

当前仓库里，`current_iteration.json` 同时承担了“当前运行态”和“最近一次任务痕迹”
的双重角色，但不同工具对它的读取方式并不一致：

- `imm-work` 具备 source selection 与自愈能力，能根据 plan/history 恢复
  出一个有效状态；
- `imm-review`、`imm-finish`、`imm-dehydrate` 没有统一复用同一套恢复逻辑；
- `imm-finish` 在成功闭环后只执行 dehydrate，不会把 `current_iteration`
  收口成一个安全的 closed/empty runtime state。

结果就是：一个入口看到“流程已完成”，另一个入口仍看到旧 `active_step`，
而 finish 之后旧运行态还会继续影响后续任务。

## 3. 功能需求

### R1. `current_iteration` 单一运行态语义

- `.imm/memory/current_iteration.json` 必须只表示“当前活跃 workflow iteration”。
- `current_iteration`、`state.json` 与同类 runtime artifact 的默认路径必须锚定到当前项目根目录，而不是安装 skill / CLI wrapper 的源码仓库目录。
- `imm-work`、`imm-review`、`imm-finish`、`imm-dehydrate` 对 iteration 的读取
  必须共享同一套 canonical load / normalization 语义，不能再出现某个入口
  读取自愈后状态、另一个入口只读取磁盘旧值的分叉。
- 如仍需兼容 legacy path 或旧字段，只允许作为读取期兼容；不得恢复长期并存的
  双状态源。
- relative `plan_path` 必须相对于当前项目根解析；self-heal 只允许恢复当前项目范围内的历史 plan，不能从别的 worktree / 项目抢回运行态。

### R2. finish 后的 closed/reset contract

- `imm-finish` 只能在 iteration 已闭合时成功执行，不能绕过未解决的
  `active_step` 或 `requires_replan`。
- 当 finish 成功后，`current_iteration` 必须转为不会阻塞下一个任务的
  closed/empty runtime state。
- 历史摘要、复盘上下文或最近一次 iteration 痕迹如需保留，应落到
  `state.json`、`MEMORY.md` 或其他明确的非运行态位置，而不是继续占用
  `current_iteration` 的活跃语义。

### R3. 回归验证

- 必须补充 focused regression，覆盖：
  - `imm-work status` 能恢复有效状态时，`imm-finish` 不再因为旧磁盘值产生
    分叉判断；
  - finish 成功后，`current_iteration` 已收口为安全状态；
  - `dehydrate` / `rehydrate` 不会因为新的 closed/reset contract 而丢失
    必要摘要或错误回显活跃 step。
- 若实现需要引入共享 helper，测试必须覆盖至少一个跨工具链闭环：
  `work -> review -> finish -> dehydrate`。
- focused regression 必须只验证本轮 `current_iteration` closure contract；
  不得把无关的 workflow health gate leftovers 当成本轮 closure 前置条件，
  除非 scope 明确扩展到那些 leftover。

## 4. 验收标准

- [ ] `imm-work`、`imm-review`、`imm-finish`、`imm-dehydrate` 对
  `current_iteration` 采用一致的 canonical load / healing 语义。
- [ ] 当前项目的 runtime state 不再被安装仓库或其他项目的 plan/history 污染。
- [ ] `imm-work status` 与 `imm-finish` 不再对同一 iteration 得出相反结论。
- [ ] finish 成功后，旧 `active_step` 不再残留为下一任务的运行态阻塞。
- [ ] `state.json` / `MEMORY.md` 仍保留任务闭环所需的摘要信息。
- [ ] focused regression 能证明 healed-status / finish mismatch 与
  finish-after-reset 行为都已闭合。
- [ ] 本轮回归命令不依赖 `imm-heal` inventory 对齐之类的无关旧失败先被修复。

## 5. 非目标

- 不引入新的 workflow state 数据库或 registry。
- 不重写 `imm-work` 的整体状态机。
- 不顺带重构 unrelated skill contracts、CLI installer 或 dev insights 功能。
- 不批量迁移历史 `state.json` / `MEMORY.md` 记录。

## 6. 依赖项

- 依赖 [IMMUNE.md](IMMUNE.md)
  中 `.imm/memory/` 的运行态定位与 finish 闭环职责。
- 依赖 [Pattern: Canonical Runtime State Paths](docs/solutions/canonical-runtime-state-paths.md)
  对 canonical path 与兼容读取边界的约束。
- 依赖 [Pattern: Plan Switch State Isolation](docs/solutions/plan-switch-state-isolation.md)
  对 reset history 与新旧 plan 状态隔离的约束。
