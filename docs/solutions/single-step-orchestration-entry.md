# Pattern: Single-step Orchestration Entry

**领域**: Agent workflow / Step orchestration
**描述**: 当一个计划 step 需要 `work -> executor -> qa` 多段协作时，让协调入口在同一轮进入下一段语义，同时仍保留执行与验收权限边界。

## 场景

- 计划已经按可独立闭合结果拆好，但每个 step 都需要用户手动切换协调、执行和验收角色。
- 角色边界本身有价值：executor 只能改当前 step，qa 只能记录 `pass / rework / replan`。
- 用户需要更顺滑的入口，但不希望系统默认自动跑完整 plan。
- 只输出 `Next Action` 会让模型停在“等待用户确认”的中间态，导致用户必须反复说“继续”。

## 方案模板

1. **保留权限边界**: `imm-work` 只协调状态，`imm-executor` 执行改动，`imm-qa` 记录闭合判断。
2. **把入口放在协调层**: 用户触发 `imm-work` 后，由 `imm-work` 判断当前 step 的状态和下一段语义。
3. **同轮进入下一段语义**: 如果当前 step 需要执行或 QA，`imm-work` 应在同一轮按 `imm-executor` 或 `imm-qa` 规则继续，不要求用户再次确认或再次说“继续”。
4. **输出规范化 next action**: `status` 仍返回 `next_action.action` 和 `next_action.skill`，但它们是当前轮的语义路由，不是让用户手动切换的阻塞提示。
5. **只推进当前 step**: 可以激活并执行当前可执行 step；`pass` 后可以报告下一个可激活 step，但不要默认自动执行下一个 plan step。
6. **对不可执行状态保守返回 planner**: 缺少有效 plan、需要 replan 或依赖不可满足时，不猜测执行路径。

## 可复用前提

- 工作流有明确的 `active_step`、`completed_steps` 和 `requires_replan` 状态。
- 计划文件可以被本地 validator 解析，step 有 `Result`、`Verification` 和依赖信息。
- 后续角色是显式 skill 或工具入口，且其规则能被协调入口在同一轮采用。
- 用户体验问题来自手动切换过多，而不是角色边界错误。

## 验证依据

- `skills/imm-work/SKILL.md` 和 `README.md` 已声明 `imm-work` 是计划后的 current-step driver，不替代 executor 或 qa，但可以在同一轮进入对应语义。
- `.imm/imm-work.py status` 已返回 `next_action`，`.imm/imm-work.py continue` 的 stop condition 明确 executor / QA 应在 same turn 继续。
- 临时 fixture 验证覆盖：
  - no active step -> `activate`
  - active step -> `executor`
  - needs rework -> `executor`
  - ready for review -> `qa`
  - replan required -> `planner`
  - completed plan -> `done`
- `python3 -m py_compile .imm/imm-work.py`、`python3 .imm/imm-plan.py docs/plans/2026-05-07-003-feat-single-step-orchestration-plan.md` 和 `python3 .imm/imm-heal.py` 均通过。
- `python3 .imm/imm-work.py status` 在计划完成后返回 `next_action.action = done`。
- 追加验证：`python3 -m unittest tests.test_imm_work tests.test_skill_contracts` 通过，覆盖 active step、刚激活 step、ready for review 都应在 same turn 继续。

## 约束与建议

- 不要把 `Next Action` 写成二次用户确认门槛；它是同轮语义路由，不是权限提升。
- 同轮执行只覆盖当前 active step。不能因为 same turn executor 成立，就自动激活并执行下一个未完成 step。
- 不要用自然语言总结替代结构化字段；至少保留 `action`、`skill` 和 `reason`。
- executor evidence 必须显式记录；QA pass 仍必须走 QA 语义，不能由协调入口乐观闭合。
- 如果状态机复杂到需要多轮策略，应先回到 planner 拆分，而不是让 `imm-work` 吞掉整条 workflow。

---
*沉淀日期: 2026-05-07 | 来源: single-step orchestration 全步骤验收；2026-05-07 根据 current-step same-turn driver 修正*
