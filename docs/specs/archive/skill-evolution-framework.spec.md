# Spec: Skill Evolution Evidence Packet Foundation

**任务 ID**: IMM-SKILL-EVOLUTION-001
**负责人**: Planner
**状态**: Proposed（引用的 Python 入口已退役）——文中要求的
`.imm/imm-upstream-sync.py`、`imm-dev-insights.py` 已随 Python reference runtime
删除，见 `docs/solutions/python-reference-retirement-exception-inventory.md`。
「必须提供显式本地入口」这类要求不能再按字面执行；证据包的整体意图仍然成立，
落地形态应改为 Bun/TypeScript runtime command。

## 1. 目标

为 Immune-Brain 建立一条面向系统自身演进的最小证据链，把现有的日常反馈、轻量 telemetry
和上游方法论变更收敛成可复盘、可比较、低成本的 `evolution packet` 输入。

首版只解决 3 件事：

- 从全局 raw trace 脱水出可比较的 telemetry summary；
- 从 `upstreams/` 子模块生成确定性的变更摘要；
- 定义一份统一的 `evolution packet` 契约，供后续人工 review 或未来 system-facing 分析角色消费。

首版不实现自动 skill 修改、自动建计划、自动 subagent 选择，也不把分析角色挂到
`imm-brainstorm` 下，因为 `imm-brainstorm` 服务的是目标项目 framing，而不是系统自身演进。

## 2. 问题背景

当前仓库已经有 3 块基础能力，但还没有把它们收敛成可规划的演进输入：

- `dev insights inbox` 与 `imm-dev-insights.py`：能收集并人工归并 workflow friction；
- `imm-telemetry.py`：能 `record/analyze` raw usage trace 与少量 derived insight；
- `upstreams/` 子模块：保存上游方法论来源，但还没有本地摘要入口。

当前缺口有 3 个：

1. telemetry 只有事件记录和单条 signal 规则，还没有低成本的趋势摘要层；
2. 上游变化只能靠人工逐仓库查看，没有稳定的本地 sync 摘要入口；
3. 现有草案把 `Evolution-Analyst` 放进 `imm-brainstorm` 方向不对，因为那会把 system-facing
   演进分析和 target-project framing 混在一起。

因此本切片必须先把“证据脱水层”补齐，再决定未来是否需要独立的 system-facing analyst。

## 3. 功能需求

### R1. Telemetry summary 入口

- 必须为 `.imm/imm-telemetry.py` 增加一个显式 summary 入口，用于读取全局 raw trace 并输出
  脱水后的 JSON 摘要。
- 入口必须保持显式调用，不依赖后台任务或隐藏 hook。
- 输出路径必须由调用者显式指定；首版可以允许写到工作区内的临时或 review 路径。
- feature 关闭、trace 缺失或无事件时，必须返回明确空状态或降级结果，而不是抛未捕获异常。

### R2. Telemetry summary 字段边界

- summary 只能包含当前 raw trace schema 可以稳定支持的聚合指标。
- 首版至少应覆盖按 `project_fingerprint + skill` 聚合的最小趋势字段，例如：
  - `event_count`
  - `total_tokens_median`
  - `total_tokens_p95`
  - `prompt_tokens_median`
  - `prompt_tokens_p95`
  - `latency_ms_p95`
  - `exact_source_rate`
- 首版不得伪实现当前 schema 不支持的字段，例如：
  - `skill_success_rate`
  - `token_efficiency_ratio`
  - 任何依赖 outcome / acceptance / progress 的指标
- 若未来需要这些高层指标，必须先扩 raw trace schema，再单独规划。

### R3. Upstream sync 入口

- 必须提供一个显式本地入口，例如 `.imm/imm-upstream-sync.py`，用于读取 `upstreams/`
  子模块状态并生成本地摘要。
- 首版输出必须是确定性的摘要，不依赖 LLM 或远程 API。
- 摘要至少应覆盖：
  - submodule 名称
  - 当前 commit
  - 比较基线（例如 `--since` 参数）
  - 新 commit 数量或“无变化”状态
  - commit subject 列表或等价短摘要
- 当子模块未初始化、路径缺失、或指定比较基线不可用时，必须返回显式 degraded / empty 结果，
  而不是中断整个流程。

### R4. Evolution packet 契约

- 首版必须定义统一的 `evolution packet` 契约，用于收敛以下输入：
  - `dev_insights_report`
  - `telemetry_summary`
  - `upstream_diff_summary`
- `evolution packet` 可以是一个 JSON manifest、约定好的文件集合，或等价的稳定契约；
  关键是后续消费者能以固定字段读取，而不是临时拼接。
- 契约必须明确：
  - 哪些字段/文件是必需的
  - 哪些是可选的
  - 缺失某一输入时如何表示 degraded state

### R5. System-facing boundary

- 首版必须显式声明：未来分析角色如果存在，也应是 system-facing 的独立入口，而不是
  target-project `imm-brainstorm` 的分支能力。
- 本切片只产出 evidence packet，不产出 `Evolution Proposal`。
- 本切片不得：
  - 自动修改 `SKILL.md`
  - 自动创建 `.imm/specs/` 或 `docs/plans/`
  - 自动触发 `imm-brainstorm`、`imm-preplan-review`、`imm-planner`
  - 自动决定某个 subagent 是否“值得”

### R6. 文档与验证边界

- README 或相关文档必须说明：
  - 这个能力服务于 Immune-Brain 系统自身演进，而不是目标项目交付；
  - telemetry summary / upstream sync / evolution packet 的输入输出；
  - 为什么 `Evolution-Analyst` 不属于 `imm-brainstorm`；
  - 当前 slice 的非目标。
- focused tests 至少要覆盖：
  - `summarize` 在 trace 缺失时给出空状态
  - `summarize` 在样本存在时输出稳定 JSON 聚合
  - `upstream-sync` 在无变化、未初始化、存在变化时都能给出确定性结果
  - evolution packet 契约能表示完整输入与 degraded 输入
  - 文档/契约未把 system-facing analyst 放进 `imm-brainstorm`

## 4. 验收标准

- [ ] 存在一条显式 telemetry summary 入口，而不是只停留在 raw `record/analyze`。
- [ ] summary 输出只包含当前 raw trace schema 可支撑的确定性聚合指标。
- [ ] spec 明确排除 `skill_success_rate`、`token_efficiency_ratio` 这类缺少字段支撑的指标。
- [ ] 存在一条显式 upstream sync 入口，可以从 `upstreams/` 生成本地摘要。
- [ ] upstream sync 在无变化、缺路径、未初始化等情况下有明确 empty/degraded 行为。
- [ ] evolution packet 契约定义了 dev insights、telemetry、upstream 三类输入的收敛方式。
- [ ] 文档明确 system-facing analyst 不属于 `imm-brainstorm`。
- [ ] 首版不自动改 skill、不自动建 plan、不自动触发 workflow skills。
- [ ] focused tests 使用隔离路径验证行为，不污染真实用户级状态。

## 5. 非目标

- 不实现完整 feedback-driven skill evolution platform。
- 不在本切片中实现 `Evolution-Analyst` 或等价自动分析角色。
- 不把 system-facing 能力挂进 target-project `imm-brainstorm`。
- 不自动修改 `SKILL.md`、`README.md`、`BASELINE.md` 或 reviewer roster。
- 不实现 outcome / progress / ROI 级别分析，例如：
  - `subagent_cost_mismatch`
  - `high_cost_low_progress`
  - `skill_success_rate`
- 不引入后台 scheduler、远程服务、LLM 聚类、自动 dispatch 或新的全局 memory。

## 6. 依赖项

- 依赖现有 `.imm/imm-telemetry.py` raw trace schema 与 enablement contract。
- 依赖现有 `dev insights inbox` 与 `imm-dev-insights.py` 作为人工反馈来源。
- 依赖 `git submodule` 提供的 `upstreams/` 来源边界。
- 依赖 repo 现有“system-facing state 不污染 target-project runtime state”的边界约束。

## 7. 首版验证路径

实现完成后，至少应证明：

- `python3 .imm/imm-telemetry.py summarize --out <tmp>` 能在空 trace 下返回稳定空结果；
- 对 fixture trace 运行 `summarize` 会输出可比较的 skill-level 聚合 JSON；
- `python3 .imm/imm-upstream-sync.py --since <ref>` 能在：
  - 有新增 commit
  - 无新增 commit
  - 子模块未初始化
  - 比较基线缺失
  四种情况下给出显式结果；
- evolution packet 契约能表达：
  - `dev insights + telemetry + upstream` 全部齐全
  - 缺少其中一项时的 degraded packet
- README / spec / focused tests 一致表达：
  - 该能力是 system-facing
  - `imm-brainstorm` 不是它的宿主
  - 当前 slice 停在 evidence packet，而不是分析/执行闭环。
