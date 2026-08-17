> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Manual Dev Insights Review Loop

**领域**: Agent workflow / developer tooling / review loops
**描述**: 当系统已经能跨项目收集 opt-in workflow improvement 记录时，下一层应先做
手动、本地、只读的 review report，而不是直接实现 scheduler、自动建计划或 runtime
dispatcher。

## 场景

- `~/.immune-brain/insights/workflow-improvement-inbox.md` 已经能持续追加结构化
  workflow 改进记录。
- 系统开发者需要从多条 friction / suggested improvement 中看出候选主题、频率和
  严重度。
- inbox 条目还不是 verified solution，不能直接进入 `docs/solutions/` 或自动生成
  `.imm/specs/` / `docs/plans/`。
- 需要保持隐私边界，只处理结构化短字段，不扩大成 telemetry 或原始对话分析。

## 方案模板

1. **保持输入单一**: 读取 opt-in 全局 inbox；允许 `--inbox` 覆盖路径，方便测试和
   人工复盘。
2. **只做报告，不做决策**: 输出候选主题、出现次数、涉及项目、最高 severity、
   代表性 evidence 和推荐下一 skill，但不自动调用 workflow。
3. **用轻量确定性归并起步**: 首版按 `suggested improvement` / `friction` 的规范化文本
   分组；不要先引入 embedding、LLM 聚类或复杂评分。
4. **保护写入边界**: report generation 不写 `.imm/specs/`、`docs/plans/`、
   `.imm/memory/current_iteration.json` 或 `docs/solutions/`。
5. **把候选路由回 workflow gate**: scope 不清回 `imm-brainstorm`，主题清楚但需要收窄
   回 `imm-preplan-review`，已有明确计划请求才进入 `imm-planner`。

## 可复用前提

- insight 记录已经是 opt-in、结构化、短字段格式。
- 目标是帮助人工复盘和规划下一条改进切片，而不是无人值守执行。
- 候选主题仍需要 Immune-Brain 的 brainstorm/preplan/planner gate 判断。
- 本地测试可以用临时 inbox fixture 验证行为，不依赖真实用户目录。

## 验证依据

- `.imm/imm-dev-insights.py`
  提供手动 review report 入口，支持默认 inbox 和 `--inbox` 覆盖，并可输出 JSON。
- `tests/test_dev_insights_review.py`
  覆盖缺失 inbox、空 inbox、单条记录、重复主题归并、severity 聚合，以及不写正式
  workflow artifacts。
- [README.md](README.md) 说明手动运行方式、输入、
  输出、隐私边界和后续 skill 路由。
- `python3 .imm/imm-work.py status` 显示
  `docs/plans/2026-05-08-001-feat-dev-insights-review-loop-plan.md` 的 U1-U4 全部
  通过 QA。

## 约束与建议

- 不要把 review report 当作自动 planning authority；它只提供候选材料。
- 如果未来需要 scheduler，应单独规划，并继续复用这个 report 入口作为底层分析能力。
- 如果未来需要更强归并，先用真实 review 样本证明确定性文本归并不够，再考虑 LLM
  或 embedding。
- 宽测试里的无关旧失败不能阻塞本模式沉淀，但必须在交付说明中标出边界。

---
*沉淀日期: 2026-05-08 | 来源: Dev Insights Review Loop 全步骤验收*
