---
date: 2026-05-09
topic: subagents-runtime-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Runtime Slice Handoff

## Conclusion

`system subagents` 的治理层与“显式触发缺口修复”已经基本闭环；下一步不该继续扩写文档，而应进入一个更窄的 runtime 实现切片。默认建议把“继续推进 subagents 实现”收窄为：先打通 `imm-party` 在显式 independent-agent / multi-agent 请求下的真实 delegation 路径，而不是直接做通用 subagent registry 或全局 dispatcher。

## In Scope

- 显式 `party mode` / `multi-agent discussion` / `independent agents` 请求的真实 delegation path。
- `2-4` 个只读 advisory sub-agent 的最小角色选择、prompt 边界和 fallback 文案。
- 让运行路径与现有 `imm-party` 契约、`workflow-trigger-repair` 计划、以及 system-subagents authority boundary 对齐。
- focused validation：证明“支持 sub-agents 时会尝试真实 delegation；不支持时会明确 solo fallback”。

## Out of Scope

- 通用 system subagent runtime registry。
- 自动挑选所有 subagents 或按 diff 自动路由。
- agent-to-agent 通信、长期 subagent memory、后台调度。
- 把 `security-reviewer`、`api-contract-reviewer`、`executor` 一类 system subagents 一次性都接入 runtime。

## Key Conclusions

- 现有 repo 已完成两层前置工作：一层是 `system-subagents-design` 的治理契约，另一层是 `workflow-trigger-repair` 对“显式 sub-agent 请求必须有可验证激活路径”的收口。
- 因此下一步最自然的实现边界，不是再定义 roster，而是把 `imm-party` 的显式 delegation 从“规则要求”推进到“可运行、可验证”的最小路径。
- 如果直接做通用 runtime router，范围会同时碰到 manifest source、trigger engine、availability detection、fallback policy 和验证矩阵，明显超出当前最小闭环。

## Candidate Interpretations

- 默认推荐：`imm-party` first runtime slice。优点是边界最清楚，直接承接现有 spec/plan；缺点是还不能覆盖非 advisory 类 system subagents。
- 备选：manifest source / registry slice。优点是为后续 runtime 做准备；缺点是用户仍然看不到真实 activation，体感价值较弱。
- 不推荐当前直接做：generic system subagent router。优点是一步到位；缺点是会立刻扩成平台层工作，容易撞上当前 non-goals。

## Assumptions / Risks

- 假设当前环境允许通过 Codex 的 sub-agent delegation 机制触发真实 advisory agents；否则只能验证 fallback 路径。
- 若用户要推进的其实不是 `imm-party`，而是条件风险层或项目专用层的 runtime 接入，需要先重新锁 scope。
- 若验证必须依赖 Codex runtime，计划里需要明确人工验证步骤，不能假装能完全本地自动化。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把默认范围锁成 `imm-party` 的 runtime delegation slice，并明确这不是 registry / dispatcher 扩张。
- User confirmation needed: no, unless the user intended a broader system-wide subagent runtime.

## Allowed

- 澄清 runtime slice 边界。
- 读取现有 spec / README / tests / skill contracts。
- 比较 `imm-party` 与 system-subagents 文档之间的实现缺口。

## Blocked

- 直接改实现文件、测试、plan、spec，去“顺手”做通用 registry 或自动路由。
- 跳过 `imm-preplan-review` 直接进入代码实现。

## Workflow guard

任何后续涉及代码、测试、plan 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review`，再进入 `imm-planner` 或 `imm-work`；不要从这份 brainstorm 直接跳到实现。
