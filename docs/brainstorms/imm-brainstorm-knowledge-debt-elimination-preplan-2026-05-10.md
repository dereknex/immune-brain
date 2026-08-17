---
date: 2026-05-10
topic: knowledge-debt-elimination-preplan
scope: agent-skills-hygiene
---

# Imm-preplan-review: Knowledge Debt Elimination

## Scope Mode: Selective Expansion

## Conclusion

除了执行已识别的 7 个高置信度回灌外，额外增加“扫描器逻辑调优”步骤，确保 Batch 1-2 (001-003) 计划能被正确识别为 Candidate。这将显著提升本轮优化的知识沉淀质量。

## Key Boundary

- **In Scope**:
  - 修改 `imm-compound-debt.py` 优化“完成”状态的正则权重。
  - 自动回灌 7+ 候选计划（包含调优后新增的 001-003）。
  - 人工评审 10 个 Ambiguous 项并记录结果。
- **Out Scope**: 强制回灌 `insufficient_evidence` 项。

## Engineering Closure Check

- **architecture_surface**: `.imm/imm-compound-debt.py`, `docs/solutions/`, `.imm/memory/MEMORY.md`.
- **dependencies_known**: true.
- **verification_path**: 
  - target: 001-003 被识别为 Candidate，且 7+ 高置信度项成功生成 Solution。
  - method: `python3 .imm/imm-compound-debt.py --backfill-ready` & 检查 `docs/solutions/` 文件增量。
- **blockers**: none.
- **replan_condition**: 如果自动回灌导致大规模 Solution 冲突或 MEMORY.md 格式损坏。

## Recommended Next Skill

- Recommended next skill: `imm-planner`
- Reason: 已确定需要对扫描器进行细微调整及分批处理债务。

## Workflow Guard

后续 implementation 必须经过 `imm-planner`。
