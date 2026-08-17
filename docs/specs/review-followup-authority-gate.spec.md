# Spec: review follow-up authority gate

**任务 ID**: IMM-REVIEW-005
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 review follow-up 的 append 判定权和 route-layer 校验收紧到 planner / planning validation，
避免 reviewer 提前猜测 runtime legality，也避免 `append_to_plan` 再次和顶层 user-facing route 混层。

本轮目标只覆盖流程硬化：

1. reviewer family 只输出用户可见的 same-boundary follow-up / new-slice 判断，不直接输出 planner-only append disposition；
2. `imm-planner` / `imm-plan` 统一裁决 same-boundary follow-up 应走 `append_to_plan` 还是 `new_slice`；
3. planning 阶段增加 route-layer validation，阻止 `append_to_plan` 被重新写成顶层 route；
4. README 与 focused regression 以同一套 authority truth 对齐。

## 2. 问题背景

本轮 session 已经把 review task handling workflow 规划成 `043`，并用 `044` 修复了 follow-up 对齐问题，
但过程里暴露出两个仍未被制度化约束的摩擦：

- reviewer 能表达 `append_to_plan`，但真正能否 append 取决于 current runtime plan、completion history、
  验证面是否仍相同，以及 `.imm/imm-plan.py` 的现有 reset 语义；这些都不是 reviewer 的 authority；
- route taxonomy 的混层是在 `043` 完成后才被 `imm-code-review` 抓到，说明 planning 阶段还缺少
  对 “顶层 route vs 内部 disposition” 的显式 guard。

因此，本轮不是继续扩展 review handling 能力，而是把 **append eligibility 的判定时机**
和 **route-layer drift 的阻断位置** 前移。

## 3. 功能需求

### R1. Reviewer output must stop short of planner-only append decisions

- reviewer family 在 `needs_fix` / `block` 场景下，仍必须表达：
  - 是否属于 same-boundary repair
  - 是否需要 `new_slice`
  - repair boundary、success target、verification hint
- reviewer family 不得把 `append_to_plan` 当作 user-facing repair route 直接输出给用户。
- 为兼容现有 contract，本轮允许保留 `direct_fix` 这一历史 handoff enum，
  但必须把它解释为 “same-boundary follow-up candidate”，而不是 append 决议本身。
- reviewer 仍需保留 planner-ready `origin_review`、`recommended_route`、`scope`、
  `change_goal` / `success_target`、`verification_hint` 等 handoff 信息。

### R2. Planner and planning validation own append eligibility

- 当 handoff 落在 same-boundary follow-up 时，`imm-planner` 或其相邻 planning validation helper
  必须统一判断是否满足 `append_to_plan` 窄条件：
  - current runtime plan 仍是目标 plan
  - repair 仍属于同一 goal boundary 与 verification surface
  - plan 没有进入 historical finish / archive 语义
  - append 不要求改写旧 step 的 closure fact
- 若 gate 无法证明 append 合法，默认必须退回 `new_slice`，而不是乐观 append。
- `append_to_plan` 继续只表示 planner-owned internal disposition，不恢复为 reviewer-owned route。

### R3. Planning stage must block route-layer mixing

- planning validation 或 focused regression 必须能拦住以下 drift：
  - `append_to_plan` 被写成和 `same_boundary_follow_up` 并列的顶层 route
  - reviewer contract 一边说 planner-owned append，一边又把 `append_to_plan` 暴露成 reviewer output route
  - README / spec / skill wording 对 route hierarchy 各说各话
- 首版允许通过 focused contract + validation lint 完成，不要求引入新的 schema store 或 parser framework。

### R4. Scope stays narrow

- 不修 `.imm/imm-plan.py` 的 same-path signature reset 机制本身。
- 不统一重命名历史 `direct_fix` / `append_to_plan` / `new_slice` enum。
- 不改 `imm-work`、`imm-pr-fix` 的主职责与运行路径。
- 不新增 review queue、dispatcher、scheduler、自动建计划器或自动执行器。
- 不把 durable summary 自动同步机制并入本轮。

## 4. 验收标准

- [ ] reviewer family 的 follow-up contract 不再把 `append_to_plan` 当作用户路由直接输出。
- [ ] planner / planning validation 明确拥有 append eligibility gate，且 gate 失败时默认走 `new_slice`。
- [ ] planning 阶段有 route-layer validation，能阻止 `append_to_plan` 重新和顶层 route 混层。
- [ ] README、spec、skill contract、focused regression 对 append 的 authority role 表达一致。
- [ ] 本轮不通过修 runtime reset 机制或重命名所有历史 enum 来完成目标。

## 5. 非目标

- 不在本轮实现 append runtime reset 的保留历史优化。
- 不重写 reviewer family 的所有 artifact 字段结构。
- 不把 `direct_fix` 全量改名为 `same_boundary_follow_up`。
- 不扩展到 PR blocker、`imm-work` 入口收口或 durable summary 自动刷新。

## 6. 依赖项

- 依赖 [review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md)
  的现有 review handoff 字段。
- 依赖 [completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md)
  的 append 边界定义。
- 依赖 [review-task-handling-workflow.spec.md](docs/specs/review-task-handling-workflow.spec.md)
  对 top-level route 与 internal disposition 的既有整理。
- 依赖 `skills/imm-code-review/SKILL.md`、`skills/imm-ui-review/SKILL.md`、
  `skills/imm-planner/SKILL.md`、`README.md`、`.imm/imm-plan.py`、
  `tests/test_skill_contracts.py` 与 `tests/test_imm_plan.py` 的当前 contract surface。
