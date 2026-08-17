> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Repo-local Compound Debt Inventory

**领域**: Agent workflow / durable knowledge / historical backfill
**描述**: 当系统想补齐历史漏沉淀轮次，但没有 canonical 历史 iteration ledger 时，
先从 repo-local durable artifacts 生成 compound debt inventory，再只对高置信、
单一结果、非重复候选开放 bounded backfill。

**reusability**: high
**next_reuse_scenarios**: [`workflow 已有 MEMORY.md、plans、solutions 等持久工件，但没有完整历史总账，仍需要找出哪些已完成工作漏了 compound`, `想增加历史 backfill 能力，但必须避免把 summary 级痕迹或对话记忆直接当成正式 knowledge 来源`]

## 场景

- 当前 `imm-compounder` 只能处理刚闭合的工作，不能自动追补历史遗漏。
- 系统没有新的历史数据库或 registry，只有 repo-local durable artifacts。
- `MEMORY.md` 的任务历史、`docs/plans/` 的计划、`docs/solutions/` 的已沉淀模式
  足以提供一部分 backfill 线索，但证据强弱不一。
- 目标是补齐真正可证明的漏沉淀项，而不是无依据地“自动回放全部历史”。

## 方案模板

1. **先做 inventory，不先做全量 backfill**: 把问题收敛成候选识别，而不是先承诺自动补齐所有历史。
2. **只用 repo-local durable artifacts**: 首版输入限定为 `MEMORY.md`、`docs/plans/`、
   `docs/solutions/`，必要时只读最近一次 `state.json`；不要依赖长对话或外部 session archive。
3. **显式分级候选状态**: 至少区分 `already_compounded`、
   `candidate_backfill`、`ambiguous`、`insufficient_evidence`。
4. **把去重和证据等级前置**: 每个候选都要给出 evidence source、confidence、
   dedupe status 和 recommended action，避免把启发式命中伪装成确定事实。
5. **只放行 bounded backfill queue**: 只有高置信、单一结果、非重复候选才进入
   `imm-compounder` 兼容的自动 backfill 队列；其余候选停留在 inventory 供人工确认。

## 可复用前提

- 历史痕迹主要落在仓库内可复查文件，而不是外部事件流。
- 首版接受“保守漏报”，不接受“乐观误报”。
- 已有 `imm-compounder` 的 evidence-backed、minimal、reusability 边界，后续只需要为它准备更安全的候选输入。
- 需要用 focused tests 证明候选识别和 queue 过滤，而不是只看一次人工样本。

## 验证依据

- `.imm/imm-compound-debt.py`
  提供 repo-local inventory 与 `--backfill-ready` bounded queue 两个入口。
- `tests/test_compound_debt_inventory.py`
  覆盖高置信候选、planning-only `insufficient_evidence`、已有 solution doc 去重、
  以及 bounded backfill queue 只输出高置信候选。
- `python3 .imm/imm-compound-debt.py --json` 能输出当前仓库的历史候选状态、证据来源、
  confidence 和 recommended action。
- `python3 .imm/imm-compound-debt.py --backfill-ready --json` 当前能识别出 4 条高置信
  bounded backfill 候选，并把其余历史项保守留在 `already_compounded`、
  `ambiguous` 或 `insufficient_evidence`。
- `python3 -m unittest tests.test_compound_debt_inventory` 通过，证明该模式不依赖真实 session history。

## 约束与建议

- 不要把 `MEMORY.md` 单行摘要直接当成正式知识结论；它只是一条候选线索。
- 当系统缺少 canonical 历史总账时，inventory 的职责是安全筛选，不是历史真相重建。
- 如果后续发现 repo-local artifacts 无法稳定提供 candidate id 或 dedupe 信号，应单独规划 durable compound ledger，而不是继续堆启发式。
- `ambiguous` 和 `insufficient_evidence` 不是失败；它们是显式保留不确定性的安全边界。
- 当已有 solution doc 只是命名漂移，不要新建平行文档；应优先走 refresh / reconcile。

---
*沉淀日期: 2026-05-09 | 来源: compound debt inventory and bounded backfill plan 全步骤验收*
