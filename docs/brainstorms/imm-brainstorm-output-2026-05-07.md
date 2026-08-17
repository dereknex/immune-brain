---
date: 2026-05-07
topic: imm-brainstorm-output-recording
scope: imm-workflow-local
---

# Imm-brainstorm Output Record

## Summary

`imm-brainstorm` 的产出需要被文件化，且内容聚焦于讨论结果与澄清结论，不直接生成执行计划。

## Problem

在当前任务中，`imm-brainstorm` 的输出口径需要明确：既要保留关键讨论结论，又要能直接支持下一阶段 `imm-preplan-review`。

## Discussion Outcome

- `imm-brainstorm` 的核心产出是讨论结果与关键澄清结论。
- 该输出应避免实现细节和代码级决策。
- 输出应明确列出在/不在范围、假设、风险、以及推进边界。

## Key Conclusions

1. `imm-brainstorm` 输出应包含至少以下字段：
   - Problem statement
   - In scope / Out of scope
   - Assumptions
   - Risks / unknowns
   - Recommended next skill
   - Next Action / Allowed / Blocked
   - Workflow guard
2. 本次任务范围收窄到 `imm-*` 本体工作流；不再分析上游项目产物。
3. `imm-brainstorm` 的文件化记录需要落在 `docs/brainstorms/`。
4. 产物优先级：`imm-brainstorm` 只记录决策边界，不替代 `imm-planner` 的计划文件。

## Assumptions

- “环境产物”指 `imm-*` 指令链条内的可追溯产出。
- 文件记录应使用 Markdown，并放在 `docs/brainstorms/`。
- 后续仍需经过 `imm-preplan-review` 才能进入 `imm-planner`。

## Risks

- 若定义口径不统一，仍可能混淆 `imm-brainstorm` 与 `imm-planner` 的职责。
- 若遗漏 `Allowed/Blocked/Workflow guard`，可能导致后续阶段越权执行。

## Next Action (workflow handoff)

- Allowed: 继续进行范围确认与边界核对。
- Blocked: 执行修改、测试、状态文件/环境持久化写入。
- Next skill: `imm-preplan-review`（确认 scope posture 后进入 `imm-planner`）。
- Workflow guard: 任何实现和验收变更必须经过 `imm-preplan-review -> imm-planner -> imm-work/executor/qa`。
