# Spec: Dev insights telemetry trace

**任务 ID**: IMM-DEV-INSIGHTS-003
**负责人**: Planner
**状态**: Proposed（引用的 Python 入口已退役）——文中的
`imm-dev-insights.py`、`imm-telemetry.py` 随 Python reference runtime 一并删除，
见 `docs/solutions/python-reference-retirement-exception-inventory.md`。凡以这些
脚本为主语的要求均已失效；若恢复 telemetry trace，应作为 Bun/TypeScript runtime
command 重新立项。

## 1. 目标

为 Immune-Brain 增加一条本机全局、默认关闭、可真正落地的 telemetry trace 实现路径，
用于记录轻量 token / latency 使用信号，并把其中少量可行动的聚合结论转写成 dev
insights inbox 条目，服务于 Immune-Brain 自身的改进迭代。

首版只解决 3 件事：

- 全局 raw trace 的最小 schema、启用契约与写入入口；
- 从 raw trace 派生 dev insights 的最小聚合规则与 inbox 兼容格式；
- 隐私、保留与写入边界。

首版以显式本地命令/模块为实现入口，不假设仓库内部拥有 LLM 调用权，也不要求隐藏钩子或
后台采集。首版不实现完整 observability 平台、远程上报、目标项目内持久化、
prompt/raw 对话存档、自动建计划，或 production telemetry pipeline。

## 2. 问题背景

现有 dev insights 已经明确是本机全局、跨项目、默认关闭的 workflow 改进素材入口：

- `.imm/specs/dev-insights-global-inbox.spec.md`
- `.imm/specs/dev-insights-review-loop.spec.md`
- `docs/solutions/opt-in-global-developer-insights-inbox.md`
- `docs/solutions/manual-dev-insights-review-loop.md`

当前缺口是：系统可以跨项目记录 workflow friction，但还不能低噪音地观察 token 成本和
上下文膨胀是否持续恶化，而且仓库内也没有任何真正写入 usage trace 的实现。
直接把高频 usage 明细写进 inbox 会破坏现有“insight 而非 telemetry”的定位；把 trace
写进目标项目 `.imm/memory/` 又会污染项目运行态边界。

因此首版需要把 raw telemetry 与 dev insights 派生结论分层：

- raw trace：独立保存在用户级全局目录；
- derived insights：只有命中阈值或趋势规则时，才追加到现有 dev insights inbox。

同时，首版需要承认一个实现事实：本仓库当前不直接发起模型请求，所以 telemetry 必须通过
显式提交 usage metadata 的方式进入系统，而不是假设 `imm-work` / `imm-finish` 能自动
知道 prompt token、completion token 或 latency。

## 3. 功能需求

### R1. 全局 raw trace 边界

- raw trace 必须写入用户级全局路径，而不是目标项目 `.imm/memory/`。
- 首版默认路径：
  - trace file: `~/.immune-brain/telemetry/usage_events.jsonl`
  - existing inbox: `~/.immune-brain/insights/workflow-improvement-inbox.md`
- telemetry 与 dev insights 共用“本机全局、默认关闭”的产品定位，但 raw trace 不是 inbox
  记录格式的一部分。
- 首版 telemetry 复用现有 dev insights 开关，而不是再发明第二套默认开关：
  - `IMM_DEV_INSIGHTS=1` 强制开启 raw trace 与 derived insight 能力；
  - `IMM_DEV_INSIGHTS=0` 强制关闭 raw trace 与 derived insight 能力；
  - `~/.immune-brain/config.toml` 的 `[dev_insights] enabled = true` 作为配置开关；
  - 默认关闭。
- `[dev_insights]` 可新增可选键：
  - `telemetry_trace_path = "~/.immune-brain/telemetry/usage_events.jsonl"`
  - 若缺省则使用默认路径。
- feature 关闭时不得创建 trace 文件或 telemetry 目录。

### R2. 首版实现入口

- 首版必须提供一个显式本地实现入口，用于提交 raw usage event 并在需要时运行聚合：
  - 建议脚本路径：`.imm/imm-telemetry.py`
- 该入口至少支持两个子命令：
  - `record`: 追加一条 raw trace event
  - `analyze`: 读取 raw trace，并按规则把 derived insight 追加到 inbox
- 首版不要求把此入口接进后台任务、`imm-work` 默认流程、或任何隐藏自动采集钩子。
- 该入口可以由外部 runtime、测试夹具或手动命令显式提供 usage metadata；当 metadata
  本身不可得时，允许提交 `source=estimated` 的事件。

### R3. 原始事件 schema

- 每条 raw trace 必须保持轻量、结构化、append-only。
- 首版最小字段：
  - `at`
  - `trace_id`
  - `project_name`
  - `project_fingerprint`
  - `skill`
  - `phase`
  - `model`
  - `prompt_tokens`
  - `completion_tokens`
  - `reasoning_tokens`
  - `cached_tokens`
  - `total_tokens`
  - `latency_ms`
  - `source`
- `source` 枚举：
  - `exact`
  - `estimated`
- 允许可选字段：
  - `step_id`
  - `plan_path_hint`
- raw trace 不默认记录完整 prompt、完整对话、代码内容、diff、工具参数或绝对项目路径。

推荐事件形状：

```json
{
  "at": "2026-05-09T16:30:00Z",
  "trace_id": "trace_...",
  "project_name": "agent-skills",
  "project_fingerprint": "proj_...",
  "skill": "imm-party",
  "phase": "advisory",
  "model": "gpt-5.5",
  "prompt_tokens": 4200,
  "completion_tokens": 620,
  "reasoning_tokens": 310,
  "cached_tokens": 0,
  "total_tokens": 5130,
  "latency_ms": 18200,
  "source": "exact"
}
```

### R4. Derived insight 规则

- 不是每次 raw trace 都要生成 dev insight。
- 只有命中规则或趋势阈值时，才向现有 inbox 追加一条结构化 insight。
- 首版只支持当前 schema 可以稳定支撑的 2 类信号：
  - `token_spike_by_skill`
  - `context_bloat_regression`
- `subagent_cost_mismatch` 与 `high_cost_low_progress` 明确延期到后续切片；
  首版不应在没有 route/progress 数据的情况下伪实现。
- `token_spike_by_skill` 的最小判定应可由确定性窗口规则实现，例如同一 `skill`
  最近样本的 `total_tokens` 相对既有中位线发生显著跃升。
- `context_bloat_regression` 的最小判定应可由确定性窗口规则实现，例如同一 `skill`
  最近样本的 `prompt_tokens` 持续增大并超过早期窗口基线。
- 首版 signal baseline 至少必须按 `project_fingerprint + skill` 做窗口隔离，不能把不同项目的
  raw event 混入同一条项目级 derived insight 基线。
- 每条 derived insight 必须沿用现有 inbox 基础字段：
  - `Project`
  - `Project path`
  - `Workflow`
  - `Context`
  - `Friction`
  - `Evidence`
  - `Suggested improvement`
  - `Severity`
  - `Status`
- 并额外允许这些 telemetry 扩展字段：
  - `Source: telemetry-derived`
  - `Signal type: <rule id>`
- `Evidence` 允许使用聚合统计摘要，但不能只写 telemetry 扩展字段而漏掉现有基础字段。
- derived insight 仍是候选 workflow improvement，不自动变成正式 solution、spec 或计划。
- 对同一批未变化的 raw trace 重复运行 `analyze` 时，derived insight 输出必须保持幂等，
  不能把同一 signal 反复追加到 inbox。

### R5. 与 dev insights review loop 的关系

- `imm-dev-insights.py` 继续以 inbox 为唯一 review 输入，不直接承担 raw telemetry 仓库职责。
- 如需从 raw trace 生成 derived insight，应通过单独聚合步骤完成，再把结果写入 inbox。
- review loop 可以展示 `Source` / `Signal type`，但不要求第一版同时做更复杂的 telemetry
  浏览器。

### R6. 隐私与保留策略

- 首版不得默认记录：
  - 完整 prompt
  - 完整对话
  - 代码内容
  - diff
  - 工具调用原文
  - 绝对项目路径
- `project_fingerprint` 应能支持跨运行聚合，但不要求可逆恢复真实路径。
- raw trace 应有清晰 retention posture：
  - 首版至少要定义“可删除、可轮转、可忽略”的策略说明；
  - 若暂不实现自动 rotation，也必须把它明确写成后续能力，而不是隐含长期增长。
- raw trace 写入失败不得阻塞当前 workflow；最多产出明确告警或降级说明。
- `record` 或 `analyze` 的 telemetry 写入/追加失败必须返回显式降级结果，而不是抛异常中断
  当前 workflow。

### R7. 首版验证路径

- focused tests 或 fixture 至少覆盖：
  - feature disabled -> no trace file
  - append one exact event
  - append one estimated event
  - telemetry-derived threshold hit -> one inbox entry
  - threshold miss -> no inbox append
  - telemetry-derived inbox entry retains required base dev-insights fields
  - no target-project `.imm/memory/` writes
  - no raw prompt/path leakage in stored records
  - `imm-dev-insights.py` can still read the derived inbox entry
  - cross-project events with the same `skill` do not share one project-level signal baseline
  - repeated `analyze` on unchanged raw trace does not duplicate the same derived inbox entry
  - trace/inbox write failures degrade without uncaught exceptions
- 测试必须使用临时 `HOME` 或等价隔离路径，不污染真实用户目录。

## 4. 验收标准

- [ ] Spec 明确 raw trace 属于用户级全局状态，而不是目标项目 `.imm/memory/`。
- [ ] Spec 明确 telemetry 复用现有 dev insights enablement contract，而不是新增模糊开关。
- [ ] 首版实现入口明确为显式 `record` / `analyze` 路径，而不是假设隐藏 runtime 钩子。
- [ ] raw trace schema 覆盖 token / latency 最小字段，并区分 `exact` 与 `estimated`。
- [ ] derived insight 只在命中规则时进入现有 inbox，而不是逐事件写入。
- [ ] 首版只承诺实现当前 schema 可以稳定支撑的 rule 集，不伪实现缺字段信号。
- [ ] project-level derived insight 不会跨 `project_fingerprint` 混用 baseline。
- [ ] 对未变化 trace 重复执行 `analyze` 不会重复追加同一 derived insight。
- [ ] `imm-dev-insights.py` 继续以 inbox 为 review 输入，不被扩成 telemetry 仓库。
- [ ] 隐私边界禁止默认记录 prompt/raw conversation/code/diff/absolute project path。
- [ ] telemetry 写入失败时返回降级结果，不抛未捕获异常阻塞 workflow。
- [ ] 验证路径说明全程使用临时全局目录，不污染真实 `~/.immune-brain/`。
- [ ] 首版非目标明确排除完整 observability、远程服务、目标项目内状态写入和自动计划生成。

## 5. 非目标

- 不实现 production telemetry platform。
- 不实现远程上报、后台调度、仪表盘或监控告警系统。
- 不把 raw trace 直接写入 `.imm/memory/current_iteration.json`、`.imm/memory/state.json`
  或目标项目下任意 runtime state。
- 不记录完整 prompt、完整对话、代码内容、diff 或工具原文。
- 不把 telemetry-derived insight 自动升级为 `.imm/specs/`、`docs/plans/` 或
  `docs/solutions/`。
- 不在首版实现 `subagent_cost_mismatch`、`high_cost_low_progress` 这类需要额外
  route/progress 维度的数据规则。
- 不要求第一版实现自动 retention rotation；只要求先明确 contract。

## 6. 依赖项

- 依赖 `.imm/specs/dev-insights-global-inbox.spec.md` 的全局路径、opt-in 和 inbox 边界。
- 依赖 `.imm/specs/dev-insights-review-loop.spec.md` 的“review loop 只消费 inbox”定位。
- 依赖 `docs/solutions/opt-in-global-developer-insights-inbox.md` 的全局用户级状态模式。
- 依赖 `docs/solutions/manual-dev-insights-review-loop.md` 的手动 review / no auto-plan 边界。

## 7. 首版设计约束

- 任何实现都必须先保持“raw trace 独立、derived insight 入 inbox”的两层结构。
- 当 runtime 无法提供精确 usage metadata 时，可以记录 `estimated`，但不得伪装成 `exact`。
- 任何实现都不得把“仓库里没有 LLM 调用入口”伪装成自动采集能力；首版必须通过显式
  `record` / `analyze` 入口闭合。
- 如果规则设计开始要求 embedding、LLM 聚类、跨项目业务语义理解或完整 cost accounting，
  说明 scope 已过宽，应回到 `imm-preplan-review` 或 planner replan。
