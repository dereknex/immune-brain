# Pattern: Subagent Activation Audit and Compliance Strategy

**领域**: Agent governance / Workflow compliance / Policy enforcement
**描述**: 通过周期性审计（Audit）确保系统的分层协作策略（Subagent-first vs Solo-fallback）在不断演进的技能契约中得以维持，防止指令压缩或功能迭代导致核心安全与效率守卫的失效。

## 场景

- 在完成大规模技能重构（如基线化、瘦身）后，需要验证核心规则（如 `append_to_plan` 契约）是否依然完整。
- 当系统存在多种协作模式（并行审查、条件触发）时，确保各角色对“何时拆分、何时回退”的认知保持同步。
- 解决由于对话历史过长或指令漂移导致的“绕过计划（Plan Bypass）”或“静默越权（Silent Escalation）”风险。

## 方案核心

1.  **三项不变性审计 (Three Invariants)**:
    - **Split-First**: 可清晰拆分的工作默认优先使用 Subagents，避免主执行链过载。
    - **Solo-Fallback**: 当边界模糊、环境受限或用户要求时，显式回退至单人模式并记录原因。
    - **No implementation without handoff**: 严禁在没有 Validated Plan 和 `imm-work` 显式激活的情况下修改代码。
2.  **触发式风险门禁 (Trigger-only Risk Gates)**:
    - 明确 `imm-preplan-review` 等角色为非默认阶段，仅在 Scope 不稳或存在分歧时触发。
    - 确保专业审计者（Reviewers）保持 `trigger-only` 与 `advisory-only` 边界，不干扰正常推进。
3.  **回归断言 (Focused Regression)**:
    - 将政策真源（Source of Truth）绑定至 `tests/test_skill_contracts.py` 中的具体断言，使其成为机械化守卫。

## 收益

- **契约韧性**: 确保系统在不断优化 Context 效率的同时，工程契约的硬约束不随之流失。
- **透明度**: 审计报告为系统现状提供了 COMPLIANT/NON-COMPLIANT 的清晰结论。

## 约束与建议

- 审计应作为独立的规划切片执行，避免与功能开发混淆。
- 审计结果必须反映在 `MEMORY.md` 的最新摘要中，确保后续 Agent 继承该结论。

---
*沉淀日期: 2026-05-10 | 来源: Subagent activation policy compliance audit 闭环验收*
