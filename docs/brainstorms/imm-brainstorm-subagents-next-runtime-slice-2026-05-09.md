---
date: 2026-05-09
topic: subagents-next-runtime-slice
scope: immune-brain-subagents
---

# Imm-brainstorm Next Runtime Slice Handoff

## Conclusion

`prompt-contract-reviewer` 的 docs-first contract 已闭环。继续推进 `subagents` 功能时，默认下一刀不该再横向加新的 project-specific reviewer，也不该跳去做 registry；更合适的是把现有 `prompt-contract-reviewer` 收窄成第一个真正可激活的 project-specific reviewer runtime slice。

## In Scope

- 只做 `prompt-contract-reviewer` 的显式 activation / delegation 路径。
- 保持 `advisory`、只读、trigger-only，不升级成默认 gate。
- 明确 reviewer available / unavailable 时的行为，以及回退到 `scope-reviewer + imm-code-review` 的路径。
- focused regression 与 Codex runtime 人工验证路径。

## Out of Scope

- 新增 `ai-eval-planner`、`docs-verifier`、`release-readiness-checker` 或 `debug-investigator` 的新 contract slice。
- 通用 subagent registry、自动 dispatch、多 reviewer 编排。
- 非 advisory 权限、agent-to-agent 通信、长期 reviewer state。

## Key Conclusions

- 当前仓库已经有 `prompt-contract-reviewer` 的 standalone contract、fallback 和文本回归，但还没有真实 activation path。
- 如果现在继续加 `ai-eval-planner`，会继续扩 roster 宽度，却仍然不解决 project-specific reviewer 还停留在文档层的问题。
- `imm-party` 的 bounded advisory delegation packet 模式已经验证过：先把一个只读 advisory 角色做成真实 activation path，比直接扩平台更稳。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 先把范围锁成 `prompt-contract-reviewer` 的 narrow runtime slice，而不是再次扩成新 reviewer 或 registry 工作。
- User confirmation needed: no, unless the real intent is to continue breadth-first with `ai-eval-planner`.

## Workflow guard

任何后续涉及 spec、plan、测试、skill contract 或 runtime 行为修改的 continuation，都必须先经过 `imm-preplan-review` 或 `imm-planner`；不要从这份 brainstorm 直接跳实现。
