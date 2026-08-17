# Pattern: Rolling Out Specialized Reviewer Subagents

**领域**: Agent system / Sub-agents / Code Review
**描述**: 采用“Standalone Host + Trigger-only”模式分阶段上线专业化的 Reviewer Subagents，在不引入中心化调度平台的前提下，实现高覆盖率的风险审计。

## 场景

- 当通用代码审查（`imm-code-review`）无法覆盖特定领域（如安全、可靠性、API 契约）的深度合规性时。
- 当需要平衡审计深度与 Token 成本，希望仅在必要时才激活昂贵的专业角色时。
- 解决多 Agent 系统中职责重叠导致的结论冗余。

## 方案核心

1.  **独立宿主 (Standalone Host)**: 每个 Reviewer 拥有独立的 `SKILL.md` 和特定的指令集。
2.  **条件触发 (Trigger-only Routing)**:
    - 编排者通过检测 Diff 内容（如是否包含 `auth`, `api_route` 等关键字）来决定是否调用该 Reviewer。
    - 禁止将专业 Reviewer 设置为全量默认门禁。
3.  **基线降级 (Baseline Fallback)**: 若专业 Reviewer 无法运行，默认由 `imm-code-review` 承担基础审查并记录风险备注。
4.  **分批上线 (Batch Rollout)**: 按照领域优先级（如：Security > Reliability > Docs）逐个闭环，每批次包含 Contract、Runtime Host 和 Regression Truth。

## 收益

- **高精度审计**: 专业角色关注点极度聚焦。
- **成本可控**: 仅按需消耗专业角色的 Context。
- **渐进式演进**: 允许在不破坏主流程的情况下持续添加新的审计维度。

## 约束与建议

- 推荐配合 `Delegation Packet` 分层模式使用，确保 Subagent 接收到的信息是经过脱噪处理的。
- 每个 Reviewer 必须保留人工验证路径，作为自动化失败时的备选。

---
*沉淀日期: 2026-05-10 | 来源: Remaining subagents rollout (023, 024, 025) 闭环验收*
