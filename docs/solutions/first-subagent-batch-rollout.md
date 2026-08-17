# Pattern: First Subagent Batch Rollout

**领域**: Agent workflow / subagent rollout planning
**描述**: 当用户明确要求“第一批”同时覆盖多个 subagent 时，首版应把它们规划成同一批次里的独立 standalone slices，而不是顺势扩成 shared reviewer platform。每个 slice 都必须独立闭合自己的 contract、activation-host 目标、fallback 和验证路径；批次层只负责统一边界，不负责引入 registry、dispatch 或多 reviewer 编排。

**reusability**: high
**next_reuse_scenarios**: [`第一轮 rollout` 需要同时引入多个 subagents, 需求同时覆盖 `conditional-risk` 与 `project-specific` 两层但不想做平台化, 团队已经有单 slice 模板，下一步要把它扩成有限 batch 而不是 shared framework`]

## 场景

- 用户或 roadmap 明确要求第一轮不是单个 slice，而是少量高优先级 subagents 一起进入规划。
- 这些 subagents 可能跨越不同层级，例如 `conditional-risk` reviewers 和 `project-specific` specialists。
- 仓库已经有单个 standalone slice 的成功模板，但还没有验证过“小批次 rollout”如何收口。
- 当前目标是把多个 subagents 从 roster/spec 名称层推进到可独立执行的 planning boundary，而不是搭 reviewer 平台。

## 方案模板

1. **先把 batch 固定成显式名单**: 只列出这一轮必须进入的 subagents，避免把“第一批”变成开放式 backlog 清单。
2. **批次共享规则，slice 独立闭合**: 批次层统一要求每个 slice 都有 standalone contract、activation-host 目标、fallback 和验证路径，但每个 slice 仍单独规划、单独验收。
3. **保留层级差异，不做扁平化**: `conditional-risk` 和 `project-specific` 要分别保持各自 trigger 来源与输出焦点，不能因为同批推进就合并成同一种 reviewer。
4. **共享 posture 必须足够窄**: 首版统一保持 `advisory`、read-only、trigger-only、non-default，避免 batch rollout 顺势升级成默认 gate。
5. **显式排除平台工作**: 在批次 spec 和计划里直接写明不做 registry、shared dispatch、multi-reviewer composition、availability detection 或 agent-to-agent 通信。
6. **批次完成后补 durable memory 对齐**: 如果 batch 执行完成，记忆摘要必须及时从“继续执行”切到“进入 compound/finish”，避免后续入口继续跟着过期 next action 走。

## 可复用前提

- 仓库已经有至少一个已验证的 standalone slice 模板可参考。
- 当前要推进的是少量高优先级 subagents，而不是完整 reviewer framework。
- 团队接受“同批次规划”与“独立 slice 执行/验收”并存，而不是要求所有子项共享实现骨架。
- 本地 workflow 能分别验证 batch 级边界与 slice 级闭合状态。

## 验证依据

- [.imm/specs/first-subagent-batch.spec.md](docs/specs/first-subagent-batch.spec.md) 把首批范围固定为 `security-reviewer`、`api-contract-reviewer`、`ai-eval-planner`、`docs-verifier`，并统一要求 contract、host、fallback 和验证路径。
- [2026-05-09-005-feat-first-subagent-batch-plan.md](docs/plans/2026-05-09-005-feat-first-subagent-batch-plan.md) 把 batch 拆成 4 个可独立闭合结果，同时明确排除 shared platform work。
- [2026-05-09-006-feat-security-reviewer-slice-plan.md](docs/plans/2026-05-09-006-feat-security-reviewer-slice-plan.md) 与 [2026-05-09-007-feat-api-contract-reviewer-slice-plan.md](docs/plans/2026-05-09-007-feat-api-contract-reviewer-slice-plan.md) 证明 conditional-risk 层可以同批推进而不变成默认 gate。
- [2026-05-09-004-feat-ai-eval-planner-slice-plan.md](docs/plans/2026-05-09-004-feat-ai-eval-planner-slice-plan.md) 与 [2026-05-09-008-feat-docs-verifier-slice-plan.md](docs/plans/2026-05-09-008-feat-docs-verifier-slice-plan.md) 证明 project-specific 层可以同批纳入，而不需要共享 reviewer framework。
- [2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md](docs/plans/2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md) 的 hotfix 说明：batch 完成后如果 durable summary 不同步，后续 workflow 会继续指向过期执行态，因此 batch rollout 还需要 closure-side memory hygiene。

## 约束与建议

- 不要因为 batch 里有多个 reviewer 就提前抽 shared abstraction；只有当重复已经阻塞闭合时才值得回到 planner。
- 不要把“同一批次”误解成“同一实现单元”；批次是 scope 管理手段，不是平台实现理由。
- 不要把 batch 验证写成 runtime orchestration 已完成；本轮证明的是 planning boundary 和独立闭合能力。
- 如果后续要求新增第五个以上 slice、统一派发或跨 slice 协同，先回到 `imm-preplan-review` / `imm-planner` 重锁边界。

---
*沉淀日期: 2026-05-09 | 来源: first-subagent-batch U1-U4 全步骤验收 + post-batch durable summary sync hotfix*
