# Pattern: Standardized Reviewer Delegation via Layered Packets

**领域**: Agent workflow / Sub-agent delegation / Communication protocols
**描述**: 为 Reviewer 类技能建立统一的分层通讯契约（Layered Delegation Packet），将全局背景与局部任务分离，显著提升跨 Agent 协作的精确度与效率。

## 场景

- 当一个编排者（如 `imm-code-review`）需要调用多个专业审计 Agent（Sub-reviewers）时。
- 当直接透传全量对话历史导致 Sub-reviewer 接收到过多噪音或超出 Context 限制时。
- 当不同 Reviewer 对输入格式的预期不一致，导致编排逻辑碎片化时。

## 方案核心

1.  **分层数据包 (Layered Packet)**:
    - **`shared_context_summary`**: 包含高层次的项目状态、全局目标和全量变更摘要。该部分在多子任务间共享。
    - **`focus_delta`**: 仅包含当前子任务特定的、角色相关的细节（如特定的代码片段、特定的 UI 路由、特定的权限模型）。
2.  **契约锚点 (Contract Anchors)**:
    - 在编排者（Orchestrators）中显式要求产出 `shared_context_summary + focus_delta`。
    - 在 Reviewer 技能中建立 `Required inputs` 段落，明确声明对该分层结构的输入预期。
    - 统一 `fallback_path` 描述，确保子任务失败后能稳定回退至 `imm-code-review` 或人工验收。

## 收益

- **通讯效率**: Sub-reviewer 仅关注 Delta，减少了重复解析冗余背景的开销。
- **职责清晰**: `focus_delta` 强化了任务的原子性，避免 Sub-reviewer 越权处理非相关领域。
- **可测试性**: 结构化的 Packet 使得单元测试（Mocking）编排逻辑变得更加容易。

## 约束与建议

- 推荐在 `BASELINE.md` 中固化 Packet 的 JSON 结构模板。
- 确保 Sub-reviewer 在回复时依然返回标准的 `ui_review` 或 `code_review` 结构，实现闭环。

---
*沉淀日期: 2026-05-10 | 来源: Reviewer delegation standardization 闭环验收*
