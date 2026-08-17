# Spec: completed plan follow-up append

**任务 ID**: IMM-WORKFLOW-010
**负责人**: Planner
**状态**: Proposed

## 1. 目标

让真正属于原计划边界的 review fixes 可以追加到**已完成但仍是当前 runtime plan** 的
validated plan 上，并继续通过 `imm-work` 推进，而不是默认强制新开一份 follow-up plan。

首版只支持窄场景：

1. 原 plan 仍是 `.imm/memory/current_iteration.json` 的当前 `plan_path`；
2. 原 plan 已完成，但尚未因为新 plan 切换而丢失其 runtime completion state；
3. review findings 仍属于原计划目标、验证面和 repair boundary；
4. 追加结果只需扩写原 plan 的后续 step，不要求新的 workflow state 结构。

## 2. 问题背景

当前系统已经具备两块相邻能力，但它们之间还缺一条正式 contract：

- `imm-code-review` / `imm-ui-review` 已能输出 `follow_up` handoff，并区分
  `direct_fix` 与 `new_slice`；
- `.imm/imm-work.py` 的 `build_next_action()` 会先扫描当前 plan 的未完成 step，
  只有在 `completed_steps >= len(plan.steps)` 且确实没有后续 step 时才返回 `done -> imm-compounder`。

这意味着：如果 planner 把 review follow-up 直接追加到**同一份当前 plan**，并保留
现有 `completed_steps`，`imm-work` 其实已经能自然继续到新追加的 step。

现在断裂的地方在于 contract，而不是 runtime 卡死：

- review 只能给出 `direct_fix` / `new_slice`，没有 “append 到当前 completed plan” 的正式路由；
- planner 面对 completed plan review fixes 时，只会自然走成“新 follow-up plan”，
  于是触发 `reset_completed_steps_for_new_plan`，把用户带离原 plan；
- `MEMORY.md`、README 和 focused tests 也没有说明“completed but appendable”这条窄路径。

## 3. 功能需求

### R1. Review handoff must preserve append-eligibility hints

- user-facing route 仍应停留在 same-boundary follow-up candidate；
  `append_to_plan` 只作为 planner-owned internal disposition 存在。

- `imm-code-review` 及同类 reviewer 在 findings 仍属于原计划边界时，必须至少保留：
  - same-boundary repair boundary
  - success target
  - verification hint
  - 当前 follow-up 是否仍指向原 plan goal 的判断
- reviewer 可以为 planner 保留 append candidate 线索，但不应把 `append_to_plan`
  当成用户可直接继续执行的 repair route。
- append 目标若成立，必须仍是当前 runtime plan，而不是新的 follow-up slice。
- `append_to_plan` 只适用于：
  - 原 plan 仍是当前 `plan_path`
  - findings 不要求改原有已完成 step 的验收语义
  - findings 只需要追加 1~N 个新 step 即可闭合
- 如果 findings 触发结构性改写、scope widening、或新验证面，仍必须走 `new_slice`。
- 如果 runtime state、completion history 或 verification surface 不能证明 append 仍合法，
  planner 必须默认退回 `new_slice`。

### R2. Planner must revise the existing completed plan in place

- 当来源是 `append_to_plan` review handoff 时，`imm-planner` 应更新现有 plan 文件，
  直接追加 follow-up steps，而不是默认新建一份 plan。
- 追加后的 plan 必须保留：
  - 原 plan 已完成 steps 的 traceability
  - 新增 review follow-up 的来源信息
  - 追加原因与适用边界
- planner 必须显式约束：
  - 不能重写旧 step 的闭合事实
  - 不能把 append 用成“偷偷重开 scope”
  - 如果已进入 compound / finish 后没有当前 runtime plan 可复用，则不走 append
  - 如果 `imm-plan` 同步后会因 plan signature 变化失去现有 closure proof，则不应乐观 append

### R3. `imm-work` contract must acknowledge appendable completed plans

- `imm-work` / README / tests 必须明确：
  - 对**同一 plan** 追加 step 后，`imm-work` 应继续从新 step 激活，而不是保持 `done`
  - `done -> imm-compounder` 只适用于“当前 plan 真的没有后续 step”
- 首版不要求新增新的 runtime state 字段，只要求守住：
  - 同 plan 扩写 step 时，现有 `completed_steps` 保持原样
  - build-next-action 优先看到新 step，再决定不是 `done`

### R4. Scope stays narrow

- 不新增后台 repair queue、自动 reviewer 触发或新的 workflow state store。
- 不支持对“已经 `imm-finish` 脱水并失去当前 plan context”的历史 plan 做 append。
- 不支持通过 append 重写旧 step 文案、验收标准或 completion history。
- 不扩展到跨 plan merge、plan nesting 或多 plan 聚合执行。

## 4. 验收标准

- [ ] review handoff 能保留 append eligibility 所需线索，同时不把 `append_to_plan` 伪装成用户直接可走的 route。
- [ ] planner contract 能在 review follow-up 命中窄条件时更新现有 completed plan，而不是默认新建 plan。
- [ ] README / `imm-work` contract 说明同 plan append 后可继续 `imm-work`。
- [ ] focused tests 至少覆盖：
  - same-plan append 后 `imm-work` 不再返回 `done`
  - planner gate 对 `append_to_plan` 的存在、边界与 fallback-to-`new_slice`
- [ ] 本轮不引入新的 runtime state 字段或 compound/finish 后的历史 plan reopen 机制。

## 5. 非目标

- 不实现“已 finish / 已脱水任务”的历史 plan reopen。
- 不实现对已完成 step 的验收结果回滚或覆盖。
- 不把 append 扩展成通用的 multi-plan stitching 或 patch queue 系统。
- 不修改 reviewer 为自动建计划器或自动执行器。

## 6. 依赖项

- 依赖 [review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md)
  的现有 `follow_up` handoff contract。
- 依赖 [workflow-skill-subagent-orchestration-plan.md](docs/plans/2026-05-09-029-feat-workflow-skill-subagent-orchestration-plan.md)
  与 [close orchestration review follow-up](docs/plans/2026-05-09-030-fix-orchestration-review-followup-plan.md)
  暴露出的 completed-plan follow-up friction。
- 依赖 `.imm/imm-work.py` 现有 “scan next executable step before `done`” 的 runtime truth。
