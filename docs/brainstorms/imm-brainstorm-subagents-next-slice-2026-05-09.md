---
date: 2026-05-09
topic: subagents-next-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Next Slice Handoff

## Conclusion

`imm-party` 的显式 delegation slice 已闭环。继续规划 `subagents` 时，默认不应跳去做 generic registry，也不应一次性铺开条件风险层；对当前这个 AI/agent workflow 仓库，下一刀更适合收窄为 `prompt-contract-reviewer` 的 project-specific reviewer slice。

## In Scope

- 一个只读、project-specific 的 `prompt-contract-reviewer` 契约切片。
- 触发边界：system prompt、tool contract、agent instruction、structured output、safety boundary 变化。
- reviewer 输出契约、fallback、以及与现有 `imm-code-review` / `scope-reviewer` 的关系。
- focused regression 或人工验证路径，用来证明这条 reviewer 路由不是纯文档承诺。

## Out of Scope

- 通用 system subagent runtime registry。
- 自动选择全部 reviewers 或按 diff 自动派发完整 roster。
- 一次性把 `security-reviewer`、`api-contract-reviewer`、`reliability-reviewer` 全部接入 runtime。
- 非只读 reviewer 的执行权限升级、agent-to-agent 通信、长期 memory。

## Key Conclusions

- 当前仓库本身是 AI/agent 项目，README 已把 `prompt-contract-reviewer` 明确放在 project-specific 层，而不是条件风险层。
- 刚完成的 `imm-party` slice 已沉淀出 `bounded advisory delegation packet` 模式，正好可复用到另一个只读 reviewer，而不必先做 registry。
- 如果下一步改做 `security-reviewer` 或 `api-contract-reviewer`，虽然也合理，但它们更偏“跨项目通用风险层”；对当前仓库的贴合度不如 `prompt-contract-reviewer` 高。

## Candidate Interpretations

- 默认推荐：`prompt-contract-reviewer` slice。优点是最贴合当前 AI/agent 仓库，并能直接复用刚完成的 delegation packet 模式；缺点是它属于 project-specific 层，短期内不能代表所有 reviewer runtime。
- 备选：`security-reviewer` first。优点是跨项目复用更强；缺点是会把下一步重心转去条件风险层，而不是继续闭环当前仓库最突出的 prompt/tool contract 风险。
- 不推荐当前直接做：generic registry / dispatcher。优点是后续 reviewer 都能共用；缺点是范围会再次膨胀回平台层工作。

## Assumptions / Risks

- 假设下一步仍想保持“只读 reviewer + 明确 fallback + 可验证路径”的窄切片节奏。
- 若用户真实想优先补的是跨项目通用风险 reviewer，而不是 AI/agent 专用 reviewer，需要在 preplan 阶段重新锁 scope。
- `prompt-contract-reviewer` 的高价值触发面需要在计划里具体化，否则容易重新落回泛化文档描述。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把默认范围锁成 `prompt-contract-reviewer` 的 narrow reviewer slice，并明确这不是 registry / 多 reviewer 扩张。
- User confirmation needed: no, unless the user intended to prioritize a conditional-risk reviewer instead.

## Allowed

- 继续澄清下一条 reviewer slice 的边界。
- 比较 project-specific 与 conditional-risk 两种推进顺序。
- 复用现有 `subagent` 治理文档和 `bounded advisory delegation packet` 模式。

## Blocked

- 直接进入实现或顺手扩成多 reviewer / registry 计划。
- 跳过 `imm-preplan-review` 直接把下一条 reviewer 当成 execution-ready work。

## Workflow guard

任何后续涉及 spec、plan、测试或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳到实现。
