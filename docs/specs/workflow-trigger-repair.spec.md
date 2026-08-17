# Spec: workflow trigger repair

**任务 ID**: IMM-WORKFLOW-006
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 Immune-Brain 当前三个已观测到的 skill 触发缺口：`imm-autowork`
运行后 Codex 原生状态未同步、`dev_insights` 开启后 compound 闭环未写入
全局 inbox、显式 sub-agent 场景没有可验证激活路径。

首版只修复这些可观察触发点，不实现完整 runtime registry、后台调度、
自动选择所有 subagents、或把 autowork 扩展成默认 full-plan runner。

## 2. 问题背景

`imm-work` 已经输出 `codex_plan.tasks` 并要求 Codex 调用 `update_plan`，
但 `imm-autowork` 的契约没有同等 Codex-facing 状态同步要求。因此自动推进
过程中本地 workflow 状态可能变化，Codex 原生 plan/status 面板却保持旧状态。

`dev_insights` 的写入逻辑目前在 `.imm/imm-finish.py`，而
`imm-compounder` 只要求运行 `.imm/imm-dehydrate.py`。当开发者实际多次执行
compound 阶段时，即使 `~/.immune-brain/config.toml` 已启用 dev insights，
全局 `workflow-improvement-inbox.md` 也可能保持为空。

系统 subagents 已有设计规格与 `imm-party` advisory 规则，但现有规格明确首版
不实现 runtime registry。用户看到的 “subagents 从未激活过” 应被收窄为：
当用户显式请求 party / multi-agent / independent agent perspectives，系统
应有一个最小可验证激活路径或明确的 fallback，而不是静默模拟或完全不触发。

## 3. 功能需求

### R1. Autorun Codex 状态同步

- `imm-autowork` 必须说明在 Codex 中运行时应消费 `imm-work status` 的
  `codex_plan.tasks`。
- autowork 每次激活 step、完成 step、停止于 blocker、预算耗尽或计划完成后，
  Codex 原生 task display 应能被更新为当前本地状态快照。
- 状态同步只能是 `.imm` -> Codex 的只读展示同步，不允许 Codex task display
  反写本地 workflow state。

### R2. Compound dev insights 写入

- 当 dev insights 开启时，compound/finish 闭环必须能追加一条结构化
  workflow improvement 记录到全局 inbox。
- 写入内容必须沿用现有 dev insights 记录格式，包含 workflow、context、
  friction、evidence、suggested improvement、severity 和 status。
- dev insights 关闭时不得追加记录。
- 写入失败不得阻塞 compound 闭环，但必须给出可见提示。

### R3. 显式 sub-agent 激活路径

- 当用户显式请求 party mode、multi-agent discussion、independent agents
  或 parallel agent perspectives，且当前环境支持 sub-agents 时，系统应尝试
  激活 bounded read-only sub-agent advisory。
- 每个 sub-agent prompt 必须限定角色、问题、压缩上下文、只读边界、禁止工具或
  禁止状态修改的要求。
- 当环境不可用、成本不合适或用户没有显式请求 sub-agent 时，系统必须明确使用
  solo fallback。
- 首版不得实现长期 sub-agent memory、自动 registry 或 agent-to-agent 通信。

### R4. 回归验证

- 必须补充 focused tests 或可复现验证路径，证明三个触发点不会只停留在文档。
- 验证必须覆盖：
  - autowork 后可得到 Codex task sync 指令或状态快照；
  - dev insights 开启时 compound/finish 追加 inbox，关闭时不追加；
  - 显式 multi-agent 请求触发 sub-agent 路由或明确 fallback。
- 如果某个触发点只能在 Codex runtime 中人工验证，计划必须记录人工验证步骤。

## 4. 验收标准

- [ ] `imm-autowork` 的 Codex-facing 输出契约包含 `codex_plan.tasks` 同步要求。
- [ ] autowork 状态同步仍保持只读展示，不引入 Codex -> `.imm` 反向写入。
- [ ] dev insights 开启时 compound/finish 闭环能向全局 inbox 追加结构化记录。
- [ ] dev insights 关闭时 compound/finish 不追加记录。
- [ ] 显式 sub-agent 请求有可验证激活路径或明确 fallback 输出。
- [ ] sub-agent 激活不绕过 `imm-preplan-review`、`imm-planner`、`imm-work`、
  `imm-executor` 或 `imm-qa` 的权限边界。
- [ ] 本地 focused tests 或命令验证覆盖上述触发点。

## 5. 非目标

- 不实现完整 subagent runtime registry。
- 不实现后台自动任务、定时器或 heartbeat。
- 不让 `imm-autowork` 成为默认 continuation。
- 不把 dev insights inbox 变成正式 `docs/solutions/` 知识库。
- 不自动分析、去重或归并 workflow insights。
- 不引入 agent-to-agent 通信。

## 6. 依赖项

- 依赖 `.imm/specs/codex-plan-sync.spec.md` 的只读 Codex task snapshot 契约。
- 依赖 `.imm/specs/bounded-autowork-skill.spec.md` 的 bounded autowork 边界。
- 依赖 `.imm/specs/dev-insights-global-inbox.spec.md` 的 opt-in 全局 inbox 契约。
- 依赖 `.imm/specs/system-subagents-design.spec.md` 的 subagent 非目标和权限边界。
- 依赖 `skills/imm-party/SKILL.md` 的 solo fallback 与 read-only advisory 语义。
