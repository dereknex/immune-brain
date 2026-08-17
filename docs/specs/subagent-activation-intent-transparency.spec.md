# Spec: Subagent Activation Intent Refinement and Transparency

**状态**: Proposed
**相关**: docs/reference/automatic-subagent-activation-policy.md, docs/reference/subagent-dispatch-protocol.md, skills/imm-code-review/SKILL.md, skills/imm-ui-review/SKILL.md

## 背景

在当前的自动子代理激活方案中，宿主 Skill（如 `imm-code-review`）有时会将用户的简洁指令误判为“显式请求单人模式” (`user_requested`)。此外，当发生此类降级时，用户在最终输出中往往看不到明确的解释，导致透明度不足。

## 目标

1.  **细化意图识别**：确保只有在用户明确否定使用子代理（如 "don't use subagents"）时才触发 `explicit_solo`。
2.  **增强透明度**：在评审输出中显式包含降级原因的解释，让用户理解为什么没有调用子代理。

## 方案设计

### 1. 宿主 Skill 指令更新

更新 `imm-code-review` 和 `imm-ui-review` 的 SKILL.md，在 `Dispatch Protocol` 或 `Workflow Rules` 中增加以下约束：

*   **意图判定约束**：仅当用户明确要求“单人作战”、“不使用子代理”或“不分发任务”时，才在调用 `imm-activation-plan` 时设置 `explicit_solo: true`。对于追求简洁、速度或未提及分发的指令，应默认通过代码内容自动匹配。
*   **解释输出要求**：当 `solo_fallback_reason` 不为 `none` 时，必须在输出的 `Optional dispatch summary` 或 `Result` 附近包含 `solo_fallback_meaning` 的人类可读解释。

### 2. 契约强制

*   `imm-code-review` 的 `Optional dispatch summary` 必须包含 `solo_fallback_meaning`。
*   `imm-ui-review` 也应引入类似的 `Optional dispatch summary` 结构，以保持一致性。

## 验收标准

1.  `imm-code-review` 和 `imm-ui-review` 的 SKILL.md 已更新。
2.  `tests/test_skill_contracts.py` 中新增对 `solo_fallback_meaning` 存在性的断言。
3.  演示在模拟“简单评审”指令下，系统不再默认回退到 `user_requested`。
