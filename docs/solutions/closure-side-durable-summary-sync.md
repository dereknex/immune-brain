# Pattern: Closure-side Durable Summary Sync

**领域**: Agent workflow / durable memory / closure hygiene
**描述**: 当一个计划已经闭合，但 `.imm/memory/MEMORY.md` 的顶部摘要仍停留在“planned / executing”口径时，应使用一个单步 hotfix 把 durable summary 切回完成态或 compound next。若这个 hotfix 自己被激活成新的 active plan，验证时不要再把当前 `imm-work status` 的 next action 当成旧计划的完成证据；应回到上一条已完成计划在 `.imm/memory/current_iteration.json` 中保留的完成历史或最终 pass 证据。

**reusability**: high
**next_reuse_scenarios**: [`某条 rollout 或 runtime slice 已完成，但 MEMORY.md 顶部仍指向过期执行入口`, `修正 summary 漂移时会新建一个 hotfix plan，导致当前 imm-work status 被新 plan 接管`, `需要在不改 runtime reset/finish 逻辑的前提下做最小 durable memory 对齐`]

## 场景

- 当前工作已经通过 `imm-qa` 闭合，真实下一入口应为 `imm-compounder` 或其他完成态后续动作。
- `.imm/memory/MEMORY.md` 顶部摘要仍保留旧的 planned / execute wording，继续把后续入口指向过期执行态。
- 为了修复这个 summary 漂移，会新增一个极小 hotfix plan；一旦激活，`imm-work status` 就会开始跟踪这个 hotfix，而不再直接显示上一条已完成计划的 next action。
- 目标只是修正 durable summary，不是顺手扩展到 `current_iteration.json` reset、finish 流程或 runtime state policy。

## 方案模板

1. **把修复收窄成单步 hotfix**: 只改 `MEMORY.md` 顶部摘要、待办事项和同步时间，不同时触碰 runtime engine 或 commit/reset 策略。
2. **把旧计划的完成证据和新 hotfix plan 分开**: 激活 hotfix 后，当前 `imm-work status` 只负责驱动 hotfix 自己；旧计划是否已完成，要回到 `current_iteration.json` 的完成历史、最终 `pass` 记录，或旧 plan 的已闭合证据。
3. **验证“summary 内容”而不是“当前 active plan 的 next action”**: 核对 `MEMORY.md` 顶部是否不再描述旧计划为执行中，并确认 durable evidence 仍能证明旧计划已经闭合。
4. **明确排除更大的状态修复**: 如果 closure 需要修改 `current_iteration.json`、finish/reset 逻辑或 compound 行为，应回到 planner 单独立项，不要在 summary sync hotfix 里偷做。

## 可复用前提

- 仓库使用 `MEMORY.md` 作为 durable index，且 `current_iteration.json` 保留足够的闭合历史可供核对。
- 系统允许通过单步 hotfix 纠正 closure-side memory drift，而不是要求每次都改 runtime engine。
- 团队接受“当前 active hotfix plan 的状态”和“上一条已完成计划的完成证据”不是同一个验证面。

## 验证依据

- [2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md](docs/plans/2026-05-09-009-fix-post-batch-durable-summary-sync-plan.md) 先证明了：batch 完成后，durable summary 若不切回完成态，后续 workflow 会继续跟着过期 next action 走。
- [2026-05-09-014-fix-docs-verifier-durable-summary-sync-plan.md](docs/plans/2026-05-09-014-fix-docs-verifier-durable-summary-sync-plan.md) 又暴露出第二层现实：当 summary sync 本身被激活成新 hotfix plan 时，`imm-work status` 的 next action 已经属于 hotfix，而不是旧的 `docs-verifier` runtime slice。
- [.imm/memory/current_iteration.json](.imm/memory/current_iteration.json) 在第二次 hotfix 中仍保留了 `docs-verifier` runtime slice 的 `activate_step`、`record_execution_evidence` 和最终 `review_step: pass` 历史，因此可以作为旧计划已闭合的 durable completion evidence。
- [MEMORY.md](.imm/memory/MEMORY.md) 顶部状态最终改成 `completed docs-verifier runtime slice` 与 `enter imm-compounder ...`，说明 summary 已回到完成态，而没有继续误导到 `imm-work` 执行入口。

## 约束与建议

- 不要把“当前 `imm-work status` 显示的 active hotfix plan”误读成“旧计划还没完成”；两者只是不同验证面。
- 不要因为只是修一条 summary 就顺手改 runtime reset 或 finish 逻辑；summary drift 和 runtime policy 是两类问题。
- 如果仓库未来不再保留足够的 `current_iteration` 历史，这个模式会失去证据基础；那时应单独规划 canonical closure ledger，而不是继续依赖 summary hotfix。

---
*沉淀日期: 2026-05-09 | 来源: post-batch durable summary sync hotfix + docs-verifier durable summary sync hotfix 全步骤验收*
