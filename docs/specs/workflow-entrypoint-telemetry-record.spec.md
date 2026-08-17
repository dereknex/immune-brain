# Spec: Workflow entrypoint telemetry record integration

**任务 ID**: IMM-DEV-INSIGHTS-004
**负责人**: Planner
**状态**: Accepted（`imm-work` / `imm-review` / `imm-finish` hooks + 回归测试已落地）

## 1. 目标

把 `imm-telemetry.py record` 从“纯手动命令”推进到 repo-local 的实际 workflow entrypoints，
让 `usage_events.jsonl` 能随着真实的 `imm-*` 生命周期逐步沉淀，而不是长期为空。

首版只解决 3 件事：

- 明确哪些“skills”在本仓库里有真实可执行挂点；
- 为这些 workflow entrypoints 增加统一的 telemetry record hook；
- 在没有 runtime usage metadata 时，定义低风险的 estimated / no-op 降级边界。

首版不实现完整 observability platform，不改 Codex 外层 runtime，也不把 telemetry
伪装成直接来自 `SKILL.md` 文本执行。

## 2. 问题背景（已由本 spec 闭合）

当前仓库已有 `.imm/imm-telemetry.py record`、`analyze` 与 `summarize`。历史上 `usage_events.jsonl`
常为空，是因为仅有手动 `record`、而无 workflow entrypoint 挂钩。**现已**在
`.imm/imm-work.py`、`.imm/imm-review.py`、`.imm/imm-finish.py` 中对关键 transition 尽力写入
`estimated` 或（环境变量齐全时）`exact` 事件；trace 仍稀疏时需确认 dev insights 已启用且 CLI 被调用。

仓库边界仍能说明：

- `SKILL.md` 是 prompt/contract 文本，不是本地自动执行面；
- 真正可编排的 repo-local 入口是 `imm-work`、`imm-review`、`imm-finish` 以及相关 CLI wrapper；
- 现有 telemetry spec 也明确承认：仓库本身不直接发起模型请求，所以不能假设它天然知道
  prompt token、completion token 或 latency。

因此本切片需要把“接到实际 skills 中”解释为：

- 接到 repo-local workflow entrypoints；
- 明确 exact metadata 从哪里来；
- 在拿不到 exact metadata 时，只允许可解释的 estimated / no-op 行为，不能伪装成真实计费数据。

## 3. 功能需求

### R1. 真实挂点边界

- 首版只把 telemetry record 接到 repo-local 的实际 workflow entrypoints，不接到 `SKILL.md`
  文本本身。
- 最小挂点范围：
  - `.imm/imm-work.py`
  - `.imm/imm-review.py`
  - `.imm/imm-finish.py`
- 允许根据实现便利性补充共享 helper，但不扩到后台任务、外部插件或 Codex 全局 runtime。

### R2. 事件触发时机

- `imm-work` 至少要覆盖一个真实 workflow transition，例如：
  - `activate`
  - `record-execution`
  - `continue` 导致的状态推进
- `imm-review` 至少要覆盖 QA closure 事件：
  - `pass`
  - `rework`
  - `replan`
- `imm-finish` 至少要覆盖 compound / closure 事件。
- 每次 hook 只记录一条与该 transition 对应的 telemetry event，不做 fan-out。

### R3. exact metadata contract

- 首版必须定义一套外部 runtime 可选提供的 usage metadata contract，供 workflow entrypoints
  在可用时写入 `source=exact` 事件。
- 至少要支持：
- `model`
- `prompt_tokens`
- `completion_tokens`
- `reasoning_tokens`
- `cached_tokens`
- `latency_ms`
- 首版固定采用环境变量 contract，不再留作“等价入口待定”：
  - `IMM_TELEMETRY_MODEL`
  - `IMM_TELEMETRY_PROMPT_TOKENS`
  - `IMM_TELEMETRY_COMPLETION_TOKENS`
  - `IMM_TELEMETRY_REASONING_TOKENS`
  - `IMM_TELEMETRY_CACHED_TOKENS`
  - `IMM_TELEMETRY_LATENCY_MS`
- workflow entrypoint 只有在以上字段全部存在、可解析且非负时，才允许写入 `source=exact`。
- 当 exact metadata 齐全时，workflow hook 必须直接复用现有 `record` 路径，而不是另造 schema。

### R4. estimated / no-op fallback

- 当 workflow entrypoint 被调用，但 exact metadata 不可得时，首版必须显式选择一种受控行为：
  - 写 `source=estimated` 的低保真事件；或
  - 明确 no-op，并保留不会写入 trace 的可解释原因。
- 不允许静默伪造“看起来像真实计费”的 exact 数据。
- 首版固定选择 `estimated`，不采用默认 no-op。原因是本切片目标就是把 telemetry 接到真实
  workflow entrypoints 上，若默认 no-op，`usage_events.jsonl` 仍会长期空置。
- `estimated` 事件的最小 contract：
  - `model = "unknown-runtime"`
  - `prompt_tokens` 基于 repo-local 可解释文本估算，首版使用字符数的粗估映射
    `ceil(chars / 4)`，输入来源仅限当前 step/result/verification/evidence 等 workflow 文本
  - `completion_tokens = 0`
  - `reasoning_tokens = 0`
  - `cached_tokens = 0`
  - `latency_ms` 优先使用本次 entrypoint 调用内可测得的 wall-clock duration；不可得时允许 `0`
- README / spec 必须明确说明：`estimated` 只用于说明 workflow 活动与粗粒度趋势，不能被当成
  真实计费、真实 provider usage 或 ROI 结论。

### R5. 事件字段与 phase 映射

- workflow hook 写出的事件仍必须沿用现有 raw schema，不新增第二套 trace 结构。
- `skill` / `phase` 至少要能映射 repo-local workflow 语义，例如：
  - `imm-work` + `execution`
  - `imm-review` + `review`
  - `imm-finish` + `compound`
- 推荐补充现有可选字段：
  - `step_id`
  - `plan_path_hint`
- 不记录 prompt/raw conversation/code/diff/absolute external path。

### R6. 失败与隐私边界

- telemetry record 失败不得阻塞 workflow 主路径。
- workflow entrypoints 调用 record 失败时，必须保持 degraded / best-effort，而不是中断 step、
  QA 或 finish。
- 首版不得把 raw trace 写进目标项目 `.imm/memory/`。
- 首版不得把 telemetry hook 变成默认输出噪音源；正常成功路径不应频繁向用户播报 trace 细节。

### R7. 验证路径

- focused tests 至少要覆盖：
  - workflow entrypoint 在 dev insights disabled 时不写 trace
  - workflow entrypoint 在 exact metadata 存在时写出 `source=exact`
  - workflow entrypoint 在 exact metadata 缺失时符合选定的 estimated / no-op 契约
  - record failure does not block `imm-work` / `imm-review` / `imm-finish`
  - trace 仍写到用户级全局路径，而不是项目 `.imm/memory/`
- 文档必须说明：
  - “实际 skills”在本仓库中指 workflow entrypoints
  - 为什么不能把 telemetry 直接挂到 `SKILL.md`
  - 文件为空时的预期解释

## 4. 验收标准

- [x] spec 明确区分 `SKILL.md` 文本与 repo-local workflow entrypoints 的可执行边界。
- [x] `imm-work`、`imm-review`、`imm-finish` 被定义为首版 telemetry hook 挂点。
- [x] spec 明确 exact metadata contract 与缺失时的 estimated 行为。
- [x] workflow hook 继续复用现有 raw trace schema，不引入第二套格式。
- [x] telemetry record 失败不会阻塞 `imm-work` / `imm-review` / `imm-finish` 主路径。
- [x] README 说明启用 dev insights + CLI 后的 trace 预期（含仍可能稀疏的情形）。
- [x] focused tests 证明 workflow hooks 行为与失败隔离（见实现切片回归）。

## 5. 非目标

- 不实现 Codex 外层或 provider 级自动 usage capture。
- 不要求首版拿到完美真实的 token/accounting 数据。
- 不把 telemetry hook 接到每个 `SKILL.md` 文本或每次普通对话响应上。
- 不实现 dashboard、scheduler、remote sink、alerting 或 cost governance platform。
- 不在本切片里扩展 ROI / success metrics；那些仍依赖未来 schema 扩展。

## 6. 依赖项

- 依赖现有 `.imm/imm-telemetry.py` 的 raw trace schema 与 degraded behavior。
- 依赖 `.imm/imm-work.py`、`.imm/imm-review.py`、`.imm/imm-finish.py` 作为真实 workflow entrypoints。
- 依赖现有 dev insights enablement contract 与用户级全局路径。

## 7. 首版验证路径

实现完成后，至少应证明：

- 通过 workflow entrypoint 而不是手动 `record` 命令，也能在启用时生成 `usage_events.jsonl`；
- exact metadata 存在时，事件以 `source=exact` 写入；
- exact metadata 缺失时，行为与 spec 选择的 estimated / no-op 契约一致；
- telemetry hook 失败不会阻塞 `imm-work`、`imm-review`、`imm-finish` 的主功能；
- README / spec / tests 一致解释“为什么过去文件为空，以及现在哪些入口会写它”。
