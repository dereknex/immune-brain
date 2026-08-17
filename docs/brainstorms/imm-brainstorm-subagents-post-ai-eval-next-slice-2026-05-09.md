---
date: 2026-05-09
topic: subagents-post-ai-eval-next-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Post ai-eval Next Slice Handoff

## Conclusion

`prompt-contract-reviewer` 与 `ai-eval-planner` 的 runtime activation-host 已经在仓库中落地。继续推进 sub-agent 实现时，默认下一刀应收窄为 `docs-verifier` 的 dedicated activation-host / runtime slice，而不是回头重做已完成 slice，也不是提前扩成通用 orchestration / registry。

## In Scope

- 只推进 `docs-verifier` 从 docs-first contract 进入独立本地 skill host。
- 保持 `advisory`、read-only、trigger-only、non-default。
- 明确 docs-sensitive trigger、fallback、focused regression 与 Codex runtime manual validation。

## Out of Scope

- 通用 subagent registry、shared dispatch、availability detection、multi-reviewer composition。
- 直接推进 `security-reviewer` / `api-contract-reviewer` 的 runtime host。
- 非只读权限、agent-to-agent 通信、长期 subagent state。

## Key Conclusions

- `skills/ai-eval-planner/SKILL.md` 与 `.imm/specs/ai-eval-planner-runtime.spec.md` 已说明上一条默认 runtime slice 不是待做项，而是已进入可激活宿主层。
- `docs-verifier` 目前仍停留在 docs-first contract：已有 `.imm/specs/docs-verifier.spec.md` 与 plan，但还没有 `skills/docs-verifier/SKILL.md`。
- 按既有 batch activation roadmap，`docs-verifier` 是最自然的下一条 project-specific runtime slice；继续这个顺序能验证第二个 host 仍可保持窄边界，而不被抽象成平台。

## Assumptions / Risks

- 默认假设你说的“继续推进实现”仍然是沿用现有 `activation-host` 路线，而不是改做真实 sub-agent orchestration。
- 如果真实意图是做 provider-level spawn / dispatch / capability detection，这已经不是当前 roadmap 的自然下一步，必须先回到 `imm-preplan-review` 重新锁 scope。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把范围锁成 `docs-verifier` 的单 slice runtime host，避免继续漂移到 conditional-risk reviewers 或 shared runtime platform。
- User confirmation needed: no, unless你真正想优先推进的是 orchestration/runtime 平台而不是下一个 dedicated host。

## Allowed

- 继续澄清 `docs-verifier` trigger、fallback 与 runtime-host 边界。
- 比较 `docs-verifier` 与 orchestration/platform 路线的 scope 差异。

## Blocked

- 直接改 spec、tests、skills 去实现 `docs-verifier` host。
- 跳过 `imm-preplan-review` 直接做 shared runtime / registry。

## Workflow guard

任何后续涉及 spec、plan、测试、skill host 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳到实现。
