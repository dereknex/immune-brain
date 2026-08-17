---
date: 2026-05-10
topic: reviewer-delegation-standardization
scope: agent-skills-efficiency
---

# Imm-brainstorm: Reviewer Delegation Standardization

## Conclusion

为了进一步提升 subagent 协作效率，需要将 `imm-party` 验证过的 `shared_context_summary + focus_delta` 分层 delegation packet 模式推广到所有 Reviewers 及其编排者（`imm-code-review`）。

## In Scope

- 更新 `imm-code-review` 及其它潜在编排者，明确其在调用 sub-reviewers 时必须产出分层 packet。
- 更新 9 个 Reviewer 技能，明确其作为 subagent 被激活时对 `shared_context_summary + focus_delta` 的输入预期。
- 在 `BASELINE.md` 中强化 Delegation Packet 的通用契约说明（如果尚未足够明确）。
- 更新 contract tests 增加对 Reviewer delegation 契约的检查。

## Out of Scope

- 改变 Reviewer 的核心审计逻辑。
- 修改底层 `invoke_agent` 逻辑。

## Key Conclusions

- **Orchestrator 责任**：`imm-code-review` 是目前最大的 Reviewer 编排者，必须强制其输出 `delegation_packet` 结构。
- **Reviewer 预期**：Reviewers 应明确自己只接收 `focus_delta` 作为核心任务，并参考 `shared_context_summary` 作为背景。

## Recommended Next Skill

- Recommended next skill: `imm-planner`
- Reason: 目标清晰，需要分解为具体的 refactor 步骤。

## Workflow Guard

任何涉及 `SKILL.md` 的 delegation 契约修改必须经过 `imm-planner`。
