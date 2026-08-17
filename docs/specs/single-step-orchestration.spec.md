# Spec: single-step orchestration

**任务 ID**: IMM-WORKFLOW-002
**负责人**: Planner
**状态**: Draft

## 1. 目标
让 `imm-work` 成为计划完成后的单步编排入口。用户不需要在每个 step
之间手动切换 `imm-work`、`imm-executor` 和 `imm-qa`，但系统仍保留三者的职责边界和
`pass / rework / replan` 门禁。

## 2. 功能需求
- **入口约束**：
  - `imm-work` 是计划后的默认继续入口。
  - `imm-work` 只编排当前 step，不默认连续执行完整 plan。
  - 没有 validated plan 或可执行 step 时，必须返回 `imm-planner`。
- **边界约束**：
  - `imm-work` 不直接修改实现文件、测试或计划结构。
  - 代码改动仍由 `imm-executor` 执行。
  - 验收结论仍由 `imm-qa` 记录。
- **状态约束**：
  - 当前没有 active step 时，系统应能指出下一个可激活 step 或说明阻塞原因。
  - 当前 step 为 `active` 或 `needs_rework` 时，下一动作应指向 `imm-executor`。
  - 当前 step 为 `replan_required` 或 `requires_replan` 时，下一动作应指向 `imm-planner`。
  - 最近 review 为 `pass` 且没有 active step 时，系统应报告已完成 step 和可继续的下一个 step。
- **体验约束**：
  - 用户的一次“继续”应得到当前 step 的下一动作、验证要求和停止条件。
  - `pass` 后不得静默自动跑完整 plan；最多报告下一步可继续。

## 3. 验收标准
- [ ] `imm-work` 的 skill 文档明确它是单步编排入口，而不是执行者或 QA。
- [ ] README 的推荐工作流说明用户可以从 `imm-work` 继续当前 step。
- [ ] `imm-work` 的本地状态输出能表达下一动作：activate、executor、qa、planner 或 done。
- [ ] `rework` 只返回当前 step 的 executor，不扩大 scope。
- [ ] `replan` 明确停止并返回 planner。
- [ ] 文档或测试材料明确排除默认自动执行完整 plan。

## 4. 依赖项
- 依赖 `.imm/specs/plan-work-review-rewrite.spec.md` 的小步闭环定义。
- 依赖 `docs/brainstorms/immune-brain-requirements.md` 中关于保留主链路和缩小人工收口成本的目标。
- 依赖当前 `.imm/imm-work.py` 与 `.imm/imm-review.py` 已有 active step、completed steps 和 review state 基础。
