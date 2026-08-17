# Spec: review task handling follow-up alignment

**任务 ID**: IMM-REVIEW-004
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `043` 完成后的两条高信号 review follow-up：

- review task handling route matrix 中 `append_to_plan` 的分类层级冲突
- `.imm/memory/MEMORY.md` 顶部 durable summary 与当前 runtime 状态漂移

本轮只做一个窄 follow-up alignment slice：

1. 让 review route taxonomy 保持互斥、可实现、可继续消费；
2. 让 durable summary 再次与当前 runtime 真相对齐；
3. 不扩展到新的 workflow stage、route enum 重命名、或 append runtime 机制重写。

## 2. 问题背景

`imm-code-review` 对 `043` 的 follow-up 审查识别出两条会影响后续决策的 finding：

- 新增的 [review-task-handling-workflow.spec.md](docs/specs/review-task-handling-workflow.spec.md)
  把 `append_to_plan` 同时当作 route matrix 的并列顶层 route，又在 same-boundary follow-up
  说明里把它当作条件分支，导致 route matrix 不再互斥；
- [MEMORY.md](.imm/memory/MEMORY.md)
  顶部摘要仍停留在 managed-copy install 任务，已经偏离当前 runtime 已切换到 review-handling
  follow-up 的事实。

理论上这两条问题仍在 `043` 同一高层边界内；但当前 `imm-plan` 在同一路径 plan signature 变化时
会重置 `completed_steps`，与 completed-plan append contract 要求的“保留原 completion history”
冲突。因此这次 follow-up 虽然属于 same-boundary repair，也不能安全使用 `append_to_plan`；
必须走新的 narrow follow-up slice。

## 3. 功能需求

### R1. Route taxonomy must stay mutually exclusive

- review task handling 的 route matrix 必须明确区分：
  - 顶层 user-facing route
  - planner / runtime 内部 disposition
- `append_to_plan` 不能同时占据这两层。
- 本轮允许保留现有 `append_to_plan` 名称，但它必须只出现在一个清晰层级里。

### R2. Same-boundary follow-up wording must remain coherent

- `same_boundary_follow_up` 仍应保持为 bounded repair 的用户可见 route。
- 若命中 current completed plan 的窄条件，planner / runtime 可在其内部落到 `append_to_plan` disposition。
- `new_slice` 与 `pr_blocker` 继续保持独立，不被 same-boundary wording 吞掉。

### R3. Durable summary must match current runtime truth

- `MEMORY.md` 顶部 `最新摘要` / `待办事项` 必须与当前 runtime 当前计划和下一边界对齐。
- 当 runtime 已切到 review-handling follow-up slice 时，顶部摘要不应继续指向旧的 managed-copy install 工作。
- 本轮只修顶部 durable summary，不重写整份 `MEMORY.md` 历史。

### R4. Scope stays narrow

- 不在本轮重命名全部历史 route enum。
- 不修 `imm-plan` 的 append runtime reset 机制；只把它记录为本轮拒绝 `append_to_plan` 的原因。
- 不扩展到 README、runtime 实现或 focused tests 的更大 redesign。

## 4. 验收标准

- [ ] route matrix 不再把 `append_to_plan` 同时当作顶层 route 与内部分支。
- [ ] same-boundary follow-up、`append_to_plan`、`new_slice`、`pr_blocker` 的层级关系清晰可读。
- [ ] `MEMORY.md` 顶部摘要与当前 runtime plan / next boundary 对齐。
- [ ] 本轮明确记录为什么这次 follow-up 不能安全使用 `append_to_plan`。

## 5. 非目标

- 不实现 completed-plan append runtime 修复。
- 不把 `043` 整体重写成新的 workflow 设计。
- 不新增 background queue、dispatcher 或新的 workflow state。

## 6. 依赖项

- 依赖 [review-task-handling-workflow.spec.md](docs/specs/review-task-handling-workflow.spec.md)
  作为被 follow-up 修复的主 spec。
- 依赖 [completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md)
  的 append contract 作为拒绝本次 `append_to_plan` 的判断基线。
- 依赖 [current_iteration.json](.imm/memory/current_iteration.json)
  与 `python3 .imm/imm-work.py status` 作为 runtime 真相来源。
