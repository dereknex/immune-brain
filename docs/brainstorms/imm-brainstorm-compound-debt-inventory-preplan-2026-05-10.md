---
date: 2026-05-10
topic: compound-debt-inventory-preplan
scope: agent-skills-hygiene
---

# Imm-preplan-review: Compound Debt Inventory

## Scope Mode: Hold Scope

## Conclusion

当前任务框架稳定，风险可控。核心挑战在于对历史 Markdown 计划的解析精度，初期应保持 Read-only 扫描优先，确保债务可见。

## Key Boundary

- **In Scope**: 脚本化扫描 `docs/plans/*.md`，置信度判定逻辑，清册报告输出，以及针对单 Step 计划的高置信度自动回灌。
- **Out Scope**: 复杂历史状态恢复，跨仓库债务追踪。

## Engineering Closure Check

- **architecture_surface**: `.imm/imm-compound-debt.py`, `.imm/specs/compound-debt-inventory.spec.md`, `tests/test_compound_debt_inventory.py`.
- **dependencies_known**: true (Python 3).
- **verification_path**: 
  - target: 脚本能正确识别并分类已完成但未 Compound 的计划。
  - method: `python3 -m unittest tests/test_compound_debt_inventory.py`.
- **blockers**: none.
- **replan_condition**: 如果历史计划格式极其混乱，导致解析器无法提取有效 ID。

## Recommended Next Skill

- Recommended next skill: `imm-planner`
- Reason: 已锁定执行边界，可以开始拆分具体实现步骤。

## Workflow Guard

后续 implementation 必须经过 `imm-planner` 产出 validated plan。
