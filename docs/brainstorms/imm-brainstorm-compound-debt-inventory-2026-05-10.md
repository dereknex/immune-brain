---
date: 2026-05-10
topic: compound-debt-inventory
scope: agent-skills-hygiene
---

# Imm-brainstorm: Compound Debt Inventory

## Conclusion

通过建立 repo-local 的迭代清册（Inventory），识别历史计划（001-036）中未被 `imm-compounder` 处理的“知识债”。首步应实现扫描与分类逻辑，次步为高置信度（单目标、无冲突）项提供自动回灌路径。

## In Scope

- 扫描 `docs/plans/` 下所有状态为 `completed` 或通过 `imm-finish` 归档的计划。
- 建立 `Confidence Model`：通过文件名、Step ID 和 `docs/solutions/` 的关联度判断置信度。
- 分类清册输出：`Already Compounded`, `High-Confidence Candidate`, `Ambiguous Debt`, `Insufficient Evidence`。
- 实现一个简单的 `imm-compound-debt.py` 工具执行扫描与报告。

## Out of Scope

- 重新运行历史任务（Session Replay）。
- 自动为 `low/medium` 置信度项生成 solution 文档（仅做 inventory 标记）。
- 引入外部数据库，保持文件即记忆。

## Key Conclusions

- **清册为先**：在尝试任何自动回灌前，必须先有一份可见的“债务清单”。
- **置信度模型**：如果计划只有一个 Step 且对应的 Solution 已存在，标记为 `Already Compounded`；如果计划已完成但无 Solution 对应且目标单一，标记为 `High-Confidence`。

## Assumptions / Risks

- 假设 `docs/plans/` 的文件名与状态足以支撑基础扫描。
- 风险：如果早期计划格式不统一，扫描脚本的鲁棒性将面临挑战。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 需要锁定“置信度模型”的具体指标和扫描器的输出格式。

## Workflow Guard

后续任何涉及脚本编写、Spec 固化或回灌执行的动作，必须经过 `imm-planner`。
