---
date: 2026-05-09
topic: first-subagent-batch-activation-roadmap
scope: immune-brain-subagents
---

# Imm-brainstorm First Subagent Batch Activation Roadmap

## Conclusion

`first-subagent-batch` 的下一阶段应收敛为“把这 4 个 slice 逐个推进到可激活使用”，而不是停留在 docs-first contract，也不是一次性做 shared reviewer runtime。

默认推荐的推进方式是：保留 batch 目标，但执行上按单 slice 闭环。首刀先做 `ai-eval-planner` runtime activation-host，其后再推进 `docs-verifier`，最后再进入 `security-reviewer` / `api-contract-reviewer` 这两个 conditional-risk reviewers。

## In Scope

- 把第一批 4 个 slice 从 standalone contract 继续推进到 dedicated activation-host / runtime slice。
- 明确这是 batch activation roadmap，不是第二批规划。
- 每次只推进一个 slice，保持 `advisory`、read-only、trigger-only、non-default。
- 复用 `prompt-contract-reviewer` runtime slice 和 `dedicated-reviewer-activation-hosts` 模式。

## Out of Scope

- 第二批 subagents 名单。
- 通用 registry、shared dispatch、availability detection、multi-reviewer composition。
- 一次性让 4 个 slice 同时进入实现或统一共享宿主。
- 非只读权限、agent-to-agent 通信、长期 subagent state。

## Key Conclusions

- `first-subagent-batch` 规格已经要求这 4 个 slice 都有最小 activation-host 目标，所以当前缺口不是“要不要激活”，而是“按什么顺序激活、如何避免平台化”。
- 已闭环的 `prompt-contract-reviewer` runtime slice 已经证明：最小可激活真相是独立 skill host + trigger-only repo routing + focused regression + manual runtime validation，而不是 registry。
- 若现在直接把 4 个 slice 一起推进，会很容易把 host、fallback、routing、validation 抽成共享框架，重新膨胀成平台任务。

## Recommended Rollout Order

- `ai-eval-planner`
  原因：最贴合当前 AI/agent 仓库，且已有最清楚的 project-specific fallback，可直接复用 `prompt-contract-reviewer` activation-host 模板。
- `docs-verifier`
  原因：同属 project-specific，边界简单，能在不引入风险平台语义的前提下验证第二个 host 是否仍保持窄边界。
- `security-reviewer`
  原因：跨项目复用高，但更容易把讨论拉向 security gate 或 policy；放在 project-specific host 模式稳定之后更安全。
- `api-contract-reviewer`
  原因：同属 conditional-risk，但与 contract policy、compat tooling 的平台膨胀风险更近，适合排在最后。

## Assumptions / Risks

- 假设你说的“推进到可激活使用”是指这四个都进入 roadmap，而不是要求这轮同时实现四个 runtime hosts。
- 若你更重视跨项目复用而不是当前仓库贴合度，可以把 `security-reviewer` 提前到第一刀，但那会提高 scope 漂移到 risk-platform 的概率。
- 如果第二个 activation slice 开始要求 shared host、统一 reviewer selection 或 capability detection，应立即停下并回到 `imm-preplan-review`，不要继续假装还是单 slice 工作。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把“第一批 activation roadmap = batch 目标 + 单 slice 顺序闭环”锁住，并默认把当前执行目标收窄到 `ai-eval-planner` runtime slice。
- User confirmation needed: no, unless你想把第一刀从 `ai-eval-planner` 改成 `security-reviewer`。

## Allowed

- 继续细化第一批 activation 的顺序与边界。
- 比较 project-specific first 与 conditional-risk first 的取舍。
- 复用现有 activation-host 与 manual validation 模式。

## Blocked

- 直接把四个 slice 一起进入实现。
- 跳过 `imm-preplan-review` 直接写 spec、plan、tests、skills。
- 借 batch activation 名义顺手引入 shared reviewer runtime。

## Workflow guard

任何后续涉及 spec、plan、测试、skill host 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳到实现。
