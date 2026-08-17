# Spec: compound debt inventory and bounded backfill

**任务 ID**: IMM-COMPOUND-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 增加一个面向历史漏沉淀轮次的 compound debt inventory，并提供
受限的 backfill contract。它先基于仓库内可验证的 durable artifacts 识别
“可能已完成但未沉淀”的候选项，再只对高置信候选开放自动 backfill。

首版不承诺无证据地自动补齐“所有历史轮次”。它只解决三件事：

- 有一个稳定入口识别历史 compound debt 候选；
- 候选项带证据等级和已沉淀去重结果；
- 只有高置信、单一结果、可直接验证的候选才允许自动 backfill。

## 2. 问题背景

当前 `imm-compounder` 和 `imm-finish` 只围绕当前已闭合 iteration 工作：

- `imm-compounder` 只要求对已闭合工作提取 reusable learning；
- `imm-finish` 只做当前 closure 的 dehydrate、reset 和 opt-in dev insights；
- `state.json` 只保留最近一次摘要，不是历史轮次 ledger；
- `current_iteration.json` 已被收敛为当前活跃 runtime state，而不是历史档案。

因此，系统现在既没有“所有历史轮次”的 canonical source，也没有
“哪些轮次已经 compound、哪些轮次漏掉了”的稳定总账。若直接宣称自动补齐全部历史，
就会把推断当成事实。

## 3. 功能需求

### R1. Compound debt inventory 入口

- 必须提供一个本地入口，用于扫描 repo-local durable artifacts 并生成
  compound debt inventory。
- 首版只允许使用当前仓库内可验证来源：
  - `docs/plans/*.md`
  - `.imm/memory/MEMORY.md`
  - `docs/solutions/`
  - 必要时只读 `.imm/memory/state.json` 作为最近一次摘要补充
- 不得把长对话、临时上下文或不可复现的会话记忆当成 inventory 主数据源。
- 输出必须区分：
  - `already_compounded`
  - `candidate_backfill`
  - `ambiguous`
  - `insufficient_evidence`

### R2. 候选识别与证据分级

- inventory 必须把“历史漏沉淀轮次”降级为候选识别问题，而不是先假设都可自动回补。
- 候选识别至少要结合：
  - 已完成/已闭合的任务证据
  - 已有 `docs/solutions/` 与 `MEMORY.md` knowledge index 去重
  - 可定位的来源 plan / task summary / evidence path
- 每个候选必须包含：
  - candidate id
  - summary
  - source evidence
  - evidence confidence: `high|medium|low`
  - dedupe status
  - recommended action
- 首版允许启发式匹配，但必须显式标记置信度，不能把启发式命中伪装成确定事实。

### R3. 受限自动 backfill

- 只有 `high` 置信候选才允许进入自动 backfill。
- 自动 backfill 仅适用于：
  - 可映射到单一可复用结果；
  - 有明确 plan/task/evidence 来源；
  - 与现有 `docs/solutions/` 不冲突；
  - 不需要猜测缺失上下文才能写出结论。
- `medium` / `low` 候选必须停留在 inventory 中，等待人工确认或后续 workflow gate。
- 自动 backfill 必须继续复用 `imm-compounder` 的 evidence-backed、minimal、reusability
  边界，而不是绕过它直接批量写 docs。

### R4. 防重与边界

- inventory / backfill 必须避免为已存在模式再生成平行 solution doc。
- 若发现疑似已沉淀但命名或索引漂移，应优先报告为 refresh / reconcile 候选，
  而不是新建 doc。
- 首版不得引入新的全局历史数据库、后台调度器、embedding 检索或对话日志回放。
- 首版不得把 dev insights inbox 直接视为 verified solution 来源。

### R5. 可验证首版

- 必须补充 focused validation，覆盖：
  - 已沉淀项被识别为 `already_compounded`
  - 已完成但未沉淀项被识别为 `candidate_backfill`
  - 证据不足项被识别为 `insufficient_evidence` 或 `ambiguous`
  - 只有高置信候选会触发自动 backfill
  - backfill 不会为已有 pattern 重复建档
- 测试必须使用临时 fixture，不得依赖真实历史会话目录。

## 4. 验收标准

- [ ] Spec 明确首版是 inventory + bounded backfill，不是“自动补齐所有历史”的历史迁移系统。
- [ ] 本地入口能从 repo-local durable artifacts 生成 compound debt inventory。
- [ ] inventory 输出包含候选状态、证据来源、置信度和推荐动作。
- [ ] 现有 `docs/solutions/` / `MEMORY.md` knowledge index 可参与去重，避免重复沉淀。
- [ ] 只有高置信候选允许自动 backfill；其余候选保持待确认。
- [ ] backfill 继续受 `imm-compounder` 的 evidence-backed 和 minimal 边界约束。
- [ ] focused tests 或等价验证覆盖候选识别、去重和 bounded backfill。
- [ ] 计划经过 `imm-plan <plan-path> --json` 校验通过。

## 5. 非目标

- 不实现新的历史轮次数据库或 registry。
- 不承诺自动重建“所有历史轮次”的完整真实记录。
- 不从长对话、agent session archive 或外部日志系统直接回放生成正式 knowledge。
- 不把 dev insights inbox 直接升级为 `docs/solutions/` 来源。
- 不在首版引入 embedding、LLM clustering、后台 scheduler 或自动全量 refresh。

## 6. 依赖项

- 依赖 `IMMUNE.md` 的文件即记忆、spec-first、small-step 和 compound 边界。
- 依赖 `skills/imm-compounder/SKILL.md` 的 evidence-backed learning capture 规则。
- 依赖 `.imm/specs/current-iteration-closure-contract.spec.md` 对 current iteration
  非历史档案语义的约束。
- 依赖 `docs/solutions/manual-dev-insights-review-loop.md` 对“先做人工/本地分析入口”
  的收敛思路。

## 7. 首版验证路径

首选验证入口应是 focused unittest 或等价 fixture-based validation。实现完成后，
至少证明：

- `completed + already indexed -> already_compounded`
- `completed + no solution doc + strong evidence -> candidate_backfill(high)`
- `summary-only trace -> ambiguous or insufficient_evidence`
- `high-confidence candidate -> bounded auto backfill allowed`
- `existing overlapping solution -> refresh/reconcile instead of duplicate doc`
