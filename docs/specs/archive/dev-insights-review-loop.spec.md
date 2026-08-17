# Spec: Developer insights review loop

**任务 ID**: IMM-DEV-INSIGHTS-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 增加一个本地、手动触发的 dev insights review loop。它从
`~/.immune-brain/insights/workflow-improvement-inbox.md` 读取已 opt-in 收集的
workflow 改进记录，生成人工可审阅的候选改进报告，帮助系统开发者决定下一条
`imm-brainstorm` / `imm-preplan-review` 输入。

首版只解决“可读、可验证、可人工复盘”的分析入口，不实现 scheduler，不自动创建
`.imm/specs/`、`docs/plans/`，也不把 inbox 条目直接提升为 `docs/solutions/`。

## 2. 问题背景

`IMM-DEV-INSIGHTS-001` 已经实现用户级全局 inbox，用于跨项目收集 workflow friction
和 suggested improvement。当前缺口是：这些记录只能人工打开阅读，没有一个稳定的本地
入口把它们整理成可比较的主题、频率、严重度和推荐下一阶段。

已沉淀模式要求后续分析继续从 opt-in inbox 读取，并保持隐私边界：

- [docs/solutions/opt-in-global-developer-insights-inbox.md](docs/solutions/opt-in-global-developer-insights-inbox.md)
- [docs/solutions/workflow-trigger-contracts.md](docs/solutions/workflow-trigger-contracts.md)

## 3. 功能需求

### R1. 手动 review 入口

- 必须提供本地手动触发入口，用于读取 dev insights inbox 并生成 review 报告。
- 默认输入路径沿用 `~/.immune-brain/insights/workflow-improvement-inbox.md`。
- 入口应允许指定替代 inbox 路径，便于测试和本地复盘。
- 当 inbox 不存在或为空时，应输出明确的空状态，而不是失败或创建正式计划。

### R2. 结构化解析与归并

- 首版只解析现有 Markdown 记录格式中的结构化字段：
  - Project
  - Project path
  - Workflow
  - Context
  - Friction
  - Evidence
  - Suggested improvement
  - Severity
  - Status
- 报告必须能按 suggested improvement / friction 的相近文本做轻量归并。
- 报告必须展示候选主题、出现次数、涉及项目、最高 severity、代表性 evidence 和建议下一 skill。
- 不要求首版实现语义嵌入、LLM 聚类或复杂评分模型。

### R3. 隐私与写入边界

- 首版不得默认输出完整 prompt、完整对话、代码 diff 或敏感原文。
- 报告只能使用 inbox 里已经结构化记录的短字段。
- Review loop 不得自动写 `.imm/specs/`、`docs/plans/`、`.imm/memory/current_iteration.json`
  或 `docs/solutions/`。
- 如果需要持久化报告，必须写到人工审阅用路径，而不是把候选 insight 当成 verified solution。

### R4. 下一阶段建议

- 报告应给出推荐下一 skill，而不是直接执行下一阶段。
- 默认路由规则：
  - scope 不清或主题过散：`imm-brainstorm`
  - 主题清楚但需要收窄：`imm-preplan-review`
  - 已有明确 spec/plan 请求：`imm-planner`
- 报告必须声明候选改进仍需人工或 workflow gate 判断，不能自动成为实现授权。

### R5. 可验证首版

- 首版必须有 focused tests 或 fixture 覆盖：
  - inbox 不存在
  - inbox 为空
  - 单条记录
  - 多条重复主题归并
  - severity 汇总
  - 不写正式 plan/spec/state
- 测试必须使用临时路径，不能污染真实 `~/.immune-brain/`。

## 4. 验收标准

- [ ] Spec 明确 review loop 是手动、本地、只读分析入口。
- [ ] 本地入口能从默认路径或指定路径读取 dev insights inbox。
- [ ] 空 inbox 和缺失 inbox 都能得到明确报告。
- [ ] 多条记录能归并成候选改进主题，并展示次数、项目、severity 和代表性 evidence。
- [ ] 报告能给出推荐下一 skill，但不自动执行。
- [ ] 验证证明 review loop 不写 `.imm/specs/`、`docs/plans/` 或 active workflow state。
- [ ] README 或相关 skill 文档说明 review loop 的输入、输出、隐私边界和非目标。
- [ ] 计划经过 `python3 .imm/imm-plan.py <plan-path> --json` 校验通过。

## 5. 非目标

- 不实现 scheduler 或后台周期任务。
- 不自动创建或修改 `.imm/specs/`、`docs/plans/`、`.imm/memory/current_iteration.json`。
- 不把 inbox 条目直接写入 `docs/solutions/`。
- 不引入 LLM 聚类、embedding、远程服务或 telemetry。
- 不改变 `imm-finish.py` 的 dev insights 写入格式，除非后续实现证明当前格式无法解析。

## 6. 依赖项

- 依赖 `IMM-DEV-INSIGHTS-001` 的全局 inbox 格式。
- 依赖 `IMMUNE.md` 的写入边界和小步执行原则。
- 依赖 `docs/solutions/opt-in-global-developer-insights-inbox.md` 的隐私边界。
- 依赖本地测试使用临时 inbox fixture 验证行为。

## 7. 首版验证路径

首选验证入口应是 focused unittest 或等价本地测试，使用临时 inbox 文件作为输入。
实现完成后，至少证明：

- `missing inbox -> empty report`
- `empty inbox -> empty report`
- `single insight -> one candidate`
- `duplicate suggested improvements -> one grouped candidate with count > 1`
- `high severity insight -> candidate severity reflects high`
- `review command/report generation does not create plan/spec/state files`

