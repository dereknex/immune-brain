---
date: 2026-05-10
topic: knowledge-debt-elimination
scope: agent-skills-hygiene
---

# Imm-brainstorm: Knowledge Debt Elimination

## Conclusion

通过执行 `imm-compound-debt.py` 识别出的回灌计划，消除历史任务中的“知识债”。优先通过 `auto_backfill` 处理 7 个高置信度项，随后对 `ambiguous` 项进行人工评审。

## In Scope

- 执行 7 个高置信度候选计划的 Compound。
- 评审并处理 10 个模糊（Ambiguous）项。
- 优化扫描器逻辑，使其能识别今日完成的 001-003 计划（目前被归类为 insufficient）。
- 确保所有新生成的 Solution 符合最新的 `Role Delta` 与 `BASELINE.md` 规范。

## Out of Scope

- 对 `insufficient_evidence` 项进行强行回灌。

## Key Conclusions

- **分批执行**：高置信度项应作为一个 Batch 快速闭环。
- **扫描器调优**：扫描器对“规划并启动”类前缀过于敏感，需增加对“完成”关键字的权重。

## Assumptions / Risks

- 风险：批量回灌可能产生 Solution 冗余，需在每步后进行轻量级去重检查。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 决定是按单个候选人拆分步骤，还是按置信度等级打包执行。

## Workflow Guard

后续 implementation 必须经过 `imm-planner`。
