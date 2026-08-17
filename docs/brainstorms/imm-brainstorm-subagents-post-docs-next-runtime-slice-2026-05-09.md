---
date: 2026-05-09
topic: subagents-post-docs-next-runtime-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Post docs Runtime Next Slice Handoff

## Conclusion

`prompt-contract-reviewer`、`ai-eval-planner` 和 `docs-verifier` 的 runtime activation-host 都已经进入仓库。继续推进 `subagents` 功能时，默认下一刀不该回头重做 project-specific reviewer，也不该提前扩成 shared orchestration / registry；更合理的窄目标是把 `security-reviewer` 推进成第一条真正可激活的 conditional-risk runtime slice。

## Scope

只收窄到 `security-reviewer` 的 dedicated activation-host / runtime slice，保持 `advisory`、read-only、trigger-only、non-default，并明确 reviewer available / unavailable 的 fallback 与验证路径。`api-contract-reviewer` 仍排在其后；shared dispatch、capability detection、multi-reviewer composition 仍然不在这一步里。

## Key Conclusions

- 当前仓库已存在 3 条 project-specific runtime host：`skills/prompt-contract-reviewer/SKILL.md`、`skills/ai-eval-planner/SKILL.md`、`skills/docs-verifier/SKILL.md`。
- `security-reviewer` 与 `api-contract-reviewer` 目前仍停留在 docs-first contract 层；还没有对应的 skill host。
- 按既有 batch activation roadmap，先做 `security-reviewer` 比先做 `api-contract-reviewer` 更稳，因为它触发面更清楚，但平台化漂移风险仍需被严格压住。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把范围锁成 `security-reviewer` 的单 slice runtime host，避免漂移到 conditional-risk 批量推进或 shared runtime 平台。
- User confirmation needed: no, unless你想改成优先推进 `api-contract-reviewer`，或真实目标其实是 orchestration / registry。

## Workflow guard

任何后续涉及 spec、plan、测试、skill host 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳到实现。
