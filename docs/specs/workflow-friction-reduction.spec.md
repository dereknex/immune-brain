# Spec: workflow friction reduction

**任务 ID**: IMM-WORKFLOW-003  
**负责人**: Planner  
**状态**: Proposed

## 1. 目标
在保留 `brainstorm -> preplan -> planner -> work -> qa -> compound` 权限边界的前提下，
降低 Immune-Brain 的流程僵化感，让用户默认感知到的入口更少、重门禁触发更准、小任务闭环更轻。

## 2. 功能需求
- **入口收口**：
  - 用户默认看到的继续入口应收敛到少数稳定入口，优先使用 `imm-work` 作为已验证计划后的默认继续入口。
  - `imm-executor`、`imm-qa` 等 authority role 必须继续保留，但不应在默认成功路径中被当作用户必须手动切换的显式入口。
- **Preplan 条件 gate**：
  - `imm-preplan-review` 只应在 scope 不稳、验证路径不清、或存在明显跨角色分歧时作为显式 gate 触发。
  - 对 framing 已稳定、可在 `1-2` 个 step 内验证的小任务，不应把 preplan 长期暴露为必经显式阶段。
- **小任务快线**：
  - 小任务仍必须保留最小 spec / plan / QA 闭环。
  - 当一个任务能被一个独立闭合结果覆盖时，planner 应允许一条 one-step minimal plan，并由 `imm-work` 推进，而不是要求额外阶段切换。
- **边界保护**：
  - 第一版不合并 `imm-work`、`imm-executor`、`imm-qa` 的 authority boundary。
  - 第一版不新增后台调度、长期驻留 agent、双 active step 状态或默认 full-plan autowork。
  - 第一版不把 `imm-party`、`imm-brainstorm` 或 `imm-preplan-review` 升级为直接 scope authority 或执行入口。

## 3. 验收标准 (QA Points)
- [ ] 默认用户文案与 workflow docs 能明确区分“continue entry”和“authority role”。
- [ ] `imm-preplan-review` 的显式触发条件被收敛为有限的风险门禁，而不是所有任务的重阶段暴露。
- [ ] 规划文档与 skill contract 允许小任务使用 one-step minimal plan，同时保留 spec、evidence 和 QA gate。
- [ ] 第一版边界中明确排除了 authority merge、默认 autowork 扩张、后台调度和状态机重写。

## 4. 依赖项
- 依赖于 `IMMUNE.md` 中既有 authority boundary 与 small-step principles。
- 依赖于 `docs/solutions/role-entrypoint-contract-separation.md`、
  `docs/solutions/default-debug-workflow-output-split.md`、
  `docs/solutions/opt-in-bounded-autowork-entry.md` 中已沉淀的约束。
