---
date: 2026-05-09
topic: subagents-post-batch-next-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Post-batch Next Slice Handoff

## Conclusion

`first-subagent-batch` 已完成，当前更合理的路线图不是继续扩第二批 reviewer 名单，也不是回头做 registry / dispatcher，而是先把 batch 里的一个 slice 推进成真正可激活的 runtime activation-host。

默认推荐收窄为 `ai-eval-planner` 的 post-batch runtime slice：它最贴合当前 AI/agent workflow 仓库，且能直接复用已闭环的 `prompt-contract-reviewer` activation-host 模式。

## In Scope

- 只讨论 `first-subagent-batch` 之后的下一条窄路线。
- 在已完成的 4 个 docs-first slices 中，选择一个进入 dedicated activation-host / runtime slice。
- 保持 `advisory`、read-only、trigger-only、non-default。
- 明确 fallback、focused regression 和 Codex runtime manual validation 仍是首版边界。

## Out of Scope

- 第二批 reviewer / specialist 名单规划。
- 通用 subagent registry、shared dispatch、availability detection、multi-reviewer composition。
- 一次性把 `security-reviewer`、`api-contract-reviewer`、`ai-eval-planner`、`docs-verifier` 全部推进到 runtime。
- 非只读权限、agent-to-agent 通信、长期 subagent state。

## Key Conclusions

- `MEMORY.md` 与 `first-subagent-batch-rollout` 已表明首批四个 slice 的 planning boundary 已闭环，当前缺口不在“还要不要这四个”，而在“先让哪一个真正可激活”。
- 现有仓库已经有两个可复用 runtime 模板：`imm-party` 的 delegation slice，以及 `prompt-contract-reviewer` 的 dedicated activation-host slice。
- 如果现在直接规划第二批，会继续扩 roster 宽度，但不会证明 batch 后的 rollout 如何从 docs-first contract 进入真实 activation path。

## Candidate Interpretations

- 默认推荐：`ai-eval-planner` runtime slice。
  优点是最贴合当前 AI/agent 仓库，且已有 standalone contract、最小 activation-host 目标和清晰 fallback；缺点是跨项目复用性不如条件风险 reviewer。
- 备选：`security-reviewer` runtime slice。
  优点是跨项目复用最高、触发面清楚；缺点是更容易把下一步拉向 security policy / gate，而不是延续当前 project-specific host 模式。
- 次优备选：`docs-verifier` runtime slice。
  优点是用户可见价值直接、fallback 简单；缺点是对当前 subagents 主线的代表性弱于 `ai-eval-planner`。
- 当前不推荐：规划第二批或做 registry。
  优点是可以更快扩覆盖面；缺点是会再次跳过“post-batch first activation”这个真正未闭环的问题。

## Assumptions / Risks

- 假设当前目标仍是“用最小 runtime slice 证明 rollout 能从 contract 进入 activation”，而不是继续 breadth-first 扩名单。
- 若你更在意跨项目复用，而不是当前仓库贴合度，下一步可能应改选 `security-reviewer`。
- 如果后续实现开始要求共享派发、统一 capability detection 或多 reviewer 协同，应立即回到 `imm-preplan-review`，不要在 runtime slice 内偷扩平台。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先锁定 post-batch 默认范围为单个 runtime activation-host slice，避免再次扩成 batch 2 或平台工作。
- User confirmation needed: no, unless你想把默认推荐从 `ai-eval-planner` 改成 `security-reviewer`。

## Allowed

- 继续比较四个 batch 成员中谁最适合成为 post-batch first runtime slice。
- 复用 `prompt-contract-reviewer` runtime slice 与 `dedicated-reviewer-activation-hosts` 模式。
- 澄清 project-specific 与 conditional-risk 的推进顺序。

## Blocked

- 直接改 spec、plan、tests、skills 去实现 runtime host。
- 跳过 `imm-preplan-review` 直接开做第二批 roster 或 shared runtime platform。

## Workflow guard

任何后续涉及 spec、plan、测试、skill host 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳到实现。
