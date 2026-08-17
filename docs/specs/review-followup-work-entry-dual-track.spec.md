# Spec: Review Follow-up Dual-Track Work Entry

**任务 ID**: IMM-WORK-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

在 Immune-Brain 的工作流中引入“双轨执行（Dual-Track Execution）”模型，将执行输入的数据源从单一的“计划（Plan）”解耦为“计划（Plan）”和“后续（Follow-up）”。
实现：当 Review 环节产出属于当前边界内的小修复时，直接生成 `follow_up` artifact，`imm-work` 可直接消费该 artifact 并执行，从而省去用户必须重走 `imm-planner`（甚至后台重走 planner）的摩擦。

同时，确保 `imm-planner` 依然保持作为宏观/复杂规划（如 `new_slice`）的唯一生成权威。

## 2. 问题背景

当前规范（如 `review-followup-imm-work-entry.spec.md` 和 `review-task-handling-workflow.spec.md`）严格规定了 Planner 对 plan 的绝对修改权。这导致了一个体验上的摩擦：
当 reviewer 发现了简单的、当前边界内的错误时（`direct_fix`），即使下一步提示用户运行 `imm-work`，由于 `imm-work` 只能基于 plan 执行，系统在后台或前台都不得不去操作 `append_to_plan` 或创建一个单步计划。这不仅逻辑繁琐，也有突破 Planner 权限的风险。

通过将 Review 产出的结果明确定义为独立的 `follow_up` 概念，并扩展 `imm-work` 兼容处理这两种执行依据，我们可以完美解决这个冲突：
- `imm-planner` 负责长线、跨边界的 Plan。
- `imm-code-review` / `imm-ui-review` 负责当前边界内、闭环验证失败的 Follow-up。
- `imm-work` 是统一的执行驱动器。

## 3. 功能需求

### R1. Conceptual Separation: Plan vs. Follow-up
- **Plan**: 由 `imm-planner` 产出，存放在 `docs/plans/`，具有完整的 Step 分解、验证策略等。
- **Follow-up**: 由 Review 角色（`imm-code-review`, `imm-ui-review`）产出。它不是 Plan，而是一个独立的内存/会话态对象（`follow_up handoff`）。

### R2. Reviewer outputs explicit Follow-up objects
- Reviewer 在判定为 `direct_fix`（当前边界内修复）时，不建议或试图修改 Plan，而是生成标准的 `follow_up` handoff。
- `follow_up` handoff 必须包含：
  - `scope`: 需要修改的文件或逻辑范围。
  - `change_goal`: 修复目标。
  - `verification_hint`: 如何验证修复成功。
- Next Action 明确指向 `imm-work`。

### R3. `imm-work` supports dual execution tracks
- `imm-work` 的核心逻辑必须升级：
  1. 检查是否存在未完成的 Plan step。
  2. 检查上下文中是否存在 pending 的 `follow_up` handoff。
  3. 如果存在 `follow_up`，`imm-work` 直接将其作为执行目标（等同于进入执行态），并基于其 `verification_hint` 收集证据。
  4. 如果 `follow_up` 和 Plan step 都不存在，才回退到 `imm-planner`。
- `imm-work` 不再需要（也不允许）尝试去调用 `append_to_plan` 或后台唤起 planner 处理小修复。

### R4. QA Loop Integration
- 修复完成后，`imm-work` 收集证据并指向 `imm-qa`。
- `imm-qa` 必须能够验证基于 `follow_up` 的修复证据，而不仅仅是验证基于 Plan step 的证据。

### R5. Scope and Authority
- `imm-planner` 不再需要处理简单的 `direct_fix` handoff。它专心处理 `new_slice`。
- `imm-work` 仍然不具备修改 `docs/plans/*.md` 的权限。

## 4. 验收标准

- [ ] `skills/imm-work/SKILL.md` 更新，明确说明其支持基于 Plan 和 Follow-up 双轨执行。
- [ ] `skills/imm-code-review/SKILL.md` 和 `skills/imm-ui-review/SKILL.md` 更新，明确其产出 `follow_up` 对象并直接指向 `imm-work`。
- [ ] `skills/imm-planner/SKILL.md` 更新，剥离其处理微小修复的冗余职责。
- [ ] README.md 更新，说明双轨执行的流程（Review -> Follow-up -> Work）。

## 5. 非目标

- 不改变 PR review feedback、CI failure 等远端 blocker 的处理流程（仍由 `imm-pr-fix` 处理）。
- 不实现将 Follow-up 持久化到 `.imm/specs/` 中（Follow-up 保持轻量会话态）。

## 6. 依赖项

- 依赖现有的 Review handoff 结构定义。
