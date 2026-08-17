> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Telemetry-Derived Signal Hygiene

**领域**: Agent workflow / telemetry / developer insights
**描述**: 当系统通过显式 `record` / `analyze` 入口把 raw telemetry 转成
derived dev insights 时，首版实现不能只满足“能写入、能读出”。要想让这条链路可持续复用，
至少要同时满足 3 个 hygiene 条件：写失败降级不阻塞、project-level baseline 隔离、
以及重复分析幂等。

- `reusability: high`
- `next_reuse_scenarios: [\"新增 derived signal 规则\", \"把 telemetry 接到更多 workflow skill\", \"扩展全局 trace 聚合逻辑\", \"给 analyzer 增加批处理或定时运行能力\"]`

## 场景

- raw trace 已经独立保存在用户级全局目录。
- derived insight 继续写入现有 dev insights inbox，而不是新建 review surface。
- telemetry 入口是显式命令或显式 runtime hook，不是 provider 内置自动采集。
- 系统希望用低噪音 telemetry 帮助改进 workflow，但不能让 telemetry 本身污染或阻塞 workflow。

## 方案模板

1. **写失败必须降级**: `record` 和 `analyze` 的 trace/inbox 写入失败要返回显式 degraded
   结果，而不是抛未捕获异常把当前 workflow 打断。
2. **baseline 必须按项目隔离**: 只要 derived insight 仍然归因到某个项目，就至少按
   `project_fingerprint + skill` 计算 signal baseline，不能把不同项目的历史样本混成一条项目级告警。
3. **重复分析必须幂等**: 对未变化 raw trace 重跑 `analyze` 时，不应把同一 signal 反复追加到 inbox。
   最小可行做法是为 derived entry 建稳定 signature，并在写入前去重。
4. **review loop 保持不变**: 这些 hygiene 修复应发生在 telemetry 边界内，不要顺手改造
   `imm-dev-insights.py` 成 telemetry 仓库或第二分析层。
5. **用 focused regression 证明边界**: 每个 hygiene 条件都要有独立回归测试，并同时确认
   单项目 happy path 和现有 review-loop 兼容性没有回归。

## 可复用前提

- 采集是显式 telemetry 入口，而不是 provider SDK 自带完整容错与去重层。
- derived insight 仍然复用已有 inbox 格式，不计划引入新数据库或新事件总线。
- signal 仍然是 project-facing improvement candidate，而不是纯全局匿名统计。
- 系统可以接受“先做 deterministic hygiene，再扩更复杂 signal”的迭代节奏。

## 验证依据

- [docs/plans/2026-05-09-019-fix-telemetry-review-followups-plan.md](docs/plans/2026-05-09-019-fix-telemetry-review-followups-plan.md)
  将 follow-up 修复收敛为 3 个独立 outcome：写失败降级、项目级 baseline 隔离、重复分析幂等。
- `imm-telemetry.py`
  现已实现 degraded result、按 `project_fingerprint + skill` 分组，以及基于 derived entry signature
  的 inbox 去重。
- `test_telemetry_trace.py`
  覆盖 raw trace 写失败、inbox 写失败、跨项目同 skill baseline 隔离、重复 `analyze` 幂等，
  并保持既有单项目 signal 检测通过。
- `test_dev_insights_review.py`
  与 telemetry focused suite 共同验证：加入去重守卫后，`imm-dev-insights.py` 仍能正常消费
  derived inbox entries。
- `python3 -m unittest tests.test_telemetry_trace tests.test_dev_insights_review`
  在 follow-up 修复闭环后通过，共 `17` 个相关测试。

## 约束与建议

- 不要把 project-facing baseline 隔离误做成“全局完全不聚合”；如果后续需要真正的跨项目统计，
  应单独增加全局视角规则，而不是复用项目级告警规则。
- 不要为了幂等性引入重型 state store；在 inbox 仍是 source of review truth 的前提下，
  先用 stable signature 去重更符合当前边界。
- 如果后续新增 signal 需要 route/progress/outcome 字段，先在 spec 明确扩 schema，
  不要在现有 project-facing hygiene 逻辑上偷塞猜测。
- 当 telemetry 入口将来接到后台批处理或定时任务时，应优先复用这 3 个 hygiene 守卫，
  否则噪音和误报会先于价值出现。

---
*沉淀日期: 2026-05-09 | 来源: telemetry implementation follow-up U1-U3 全步骤验收*
