# Spec: Immune-Brain 多场景工作流覆盖与收敛

**任务 ID**: IMM-WORKFLOW-UX-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标
把 Immune-Brain 当前分散的 workflow 摩擦点，按用户已确认的 1-9 场景收敛成一组可规划、可验证的治理目标，重点覆盖：

- 默认入口清晰化：新用户、普通单步执行、长周期多步任务都能理解该从哪里继续。
- 路由收敛：轻量 bugfix 与模糊需求都通过明确 gate 进入，不绕过 plan / QA。
- 恢复闭环：会话中断与 `rework` 后都能回到当前 step，而不是重新讲整条流程。
- 守卫强化：证据不足任务和畸形计划不能被乐观闭环。

## 2. 需求

### R1. 默认入口与进度可见性
- 新用户 onboarding 必须有明确的默认路径说明，最少包含：当前场景、推荐入口、下一步会发生什么。
- 普通单步执行继续以 `imm-work` 为默认 continue entry，不要求用户在成功路径显式切换 `imm-executor` / `imm-qa`。
- 长周期多步任务必须能暴露轻量进度视图，至少说明 active plan、当前 step、下一边界和阻塞原因。

### R2. 轻量 bugfix 与模糊需求路由
- 轻量 bugfix / hotfix 必须有明确短路径，但仍经过 `imm-preplan-review -> imm-planner -> imm-work -> imm-qa` 的最小闭环。
- 模糊任务必须先收敛成最小 framing，再决定进入 `imm-brainstorm` 还是直接进入 `imm-preplan-review` / `imm-planner`。
- 不允许以“任务很小”为由直接绕过 plan 或 QA。

### R3. 中断恢复与返工回路
- 每个 active step 都应支持固定 resume block，最少包含：目标、当前状态、下一动作、阻塞点。
- `imm-qa rework` 后必须能回到当前 active step 的执行回路，而不是重新走完整 planning 叙事。
- 恢复与返工路径都应保持“只继续当前 step”的 workflow guard。

### R4. 证据不足与畸形计划守卫
- 证据不足型任务不能直接 `pass`，也不能进入 `imm-compounder`。
- 证据不足时，系统至少要输出假设、缺失证据和下一步取证方式。
- 过大或畸形计划必须在 `imm-preplan-review` / `imm-planner` / `imm-qa` 的守卫中被识别并退回，不应把结构性问题留给 executor 临场兜底。

### R5. 文档与回归对齐
- 上述 1-9 场景的默认路径、边界和失败回退必须在 skill contract、README 或等价 repo-facing artifact 中可见。
- 至少要有 focused regression 或 contract evidence 证明这些场景不会因角色名、entrypoint、证据标准或状态恢复逻辑再次漂移。

## 3. 验收标准
- [ ] 用户能从默认文案快速判断：当前该用哪个入口、现在在哪个 step、下一步会发生什么。
- [ ] 轻量 bugfix 场景具备最小闭环说明，但不绕过 `imm-planner` 与 `imm-qa`。
- [ ] 模糊任务场景具备明确 framing gate，不再默认直接进入实现。
- [ ] 中断恢复与 `rework` 场景都能回到当前 step，而不是重走整条 workflow。
- [ ] 证据不足任务不会被错误闭环，畸形计划会被结构性退回。
- [ ] 技能文档、状态输出或 focused tests 能证明 1-9 场景的 contract 已被覆盖。

## 4. 依赖项
- 依赖 `IMMUNE.md` 既有角色边界与 `plan -> work -> review` 小步闭环。
- 依赖现有 `imm-brainstorm`、`imm-preplan-review`、`imm-planner`、`imm-work`、`imm-executor`、`imm-qa`、`imm-compounder` skill 契约。
- 依赖已有沉淀：single-step orchestration、role-entrypoint separation、default-debug output split、workflow health gate alignment、workflow trigger contracts。

## 5. 非目标
- 不覆盖外部项目 bootstrap、跨环境 capability matrix、manifest 中心化、trigger smoke matrix 等 10-14 场景。
- 不新增顶层 workflow stage。
- 不把 `imm-work` 扩大成默认 full-plan autowork。
- 不放宽 QA 证据要求来换取更短的 happy path。
