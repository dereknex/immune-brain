---
title: "refactor: inline clarification and preplan demotion"
type: refactor
status: planned
date: 2026-05-11
origin: user requested CE-style inline clarification flow; prior brainstorm concluded preplan should become opt-in rather than default route
---

# Iteration Plan

## Task
- Summary: 借鉴 CE 的 Product Pressure Test 和 Planning Bootstrap 模式，将澄清收窄内联到 `imm-brainstorm` 和 `imm-planner` 中，`imm-preplan-review` 降级为可选高压闸门，更新全部路由引用和合约测试
- Origin: 用户在对话中指出「分析收窄澄清部分调整为类似 CE 的方法，在后续对话中澄清即可，不用单独调用 imm-preplan-review」；先前 brainstorm 确认 preplan 不应删除但应降为按需
- Research: 对比 CE 实现发现三个可借鉴模式。(1) `ce-brainstorm` Phase 1.2 Product Pressure Test 在技能内部做 agent-internal gap analysis（evidence gap / specificity gap / counterfactual gap / attachment gap），不依赖独立预审阶段，然后在 Phase 1.3 Collaborative Dialogue 中逐个 probe 未解决的 gap。(2) `ce-plan` Phase 0.4 Planning Bootstrap 在无上游 brainstorm 时自行确认 problem frame / intended behavior / scope boundaries / non-goals / success criteria / blocking questions，只在发现重大产品级问题时建议回 `ce-brainstorm`。(3) CE 没有 preplan 等价物，高风险场景通过 brainstorm 的 Deep scope tier（额外 durability gap probe）和 plan 的 Phase 2 Resolve Planning Questions 覆盖。现有 IMM 已通过 plan-049 和 plan-046 将 preplan 定位为条件闸门，但技能文案和路由引用仍隐含 preplan 为常规步骤
- Decisions: D1 在 `imm-brainstorm` 增加内联收窄挑战规则（borrowing CE Phase 1.2 gap analysis 模式），默认路由到 `imm-planner`；D2 在 `imm-planner` 增加 Planning Bootstrap 规则（borrowing CE Phase 0.4），处理无上游 brainstorm 的场景；D3 收窄 `imm-preplan-review` 为可选高压闸门，仅在 scope 不稳 + 多方分歧 + 审计记录需求时触发；D4 同步更新全部路由引用和合约测试
- Assumptions: 现有合约测试结构可扩展覆盖新断言；技能文本变更不需要 runtime 代码修改；README 入站路由表调整不会破坏现有 substring 测试或可同步更新
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-work/SKILL.md`, `IMMUNE.md`, `README.md`, `tests/test_skill_contracts.py`, `.imm/specs/inline-clarification-preplan-demotion.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: 三个主线 skill 实现内联澄清模型，路由引用一致，合约测试通过
      - method: `python3 -m unittest tests.test_skill_contracts` 和文档交叉检查
  - blockers: none
  - replan_condition: 如果路由变更需要修改 `.imm/imm-work.py` 或 `imm-plan.py` 核心行为则停止

## Steps

### Step 1
- Step ID: U1
- Result: 三个主线 skill 实现内联澄清模型取代 preplan 默认路由
- Verification: `skills/imm-brainstorm/SKILL.md` Workflow Rules 增加内联收窄挑战规则（borrowing CE Phase 1.2 gap analysis）且 description 和 Next Action 默认指向 `imm-planner` 而非 `imm-preplan-review`（仅在高风险信号下建议 preplan）; `skills/imm-planner/SKILL.md` 包含 Planning Bootstrap 规则（borrowing CE Phase 0.4）用于无上游 brainstorm 时自行确认 scope 和 success criteria，阻断问题路由到 `imm-brainstorm` 而非 `imm-preplan-review`; `skills/imm-preplan-review/SKILL.md` description 移除默认路由暗示且 Workflow Rules 触发条件收窄为高风险加多方分歧加审计需求
- Agent Hint: imm-executor
- Test scenarios: Covers brainstorm 内联挑战规则存在; Covers brainstorm 默认路由到 planner; Covers planner bootstrap 规则存在; Covers planner 阻断问题路由到 brainstorm; Covers preplan 声明可选且触发条件收窄
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-preplan-review/SKILL.md`
- Replan condition: 如果内联挑战步骤需要引入新的工具调用或 runtime 依赖则收窄到纯文案变更

### Step 2
- Step ID: U2
- Result: 全部路由引用文档与新的默认 brainstorm-to-planner 路径一致
- Verification: `skills/imm-work/SKILL.md` description 不再将 `imm-preplan-review` 列为常规来源（保留可选提及）; `IMMUNE.md` 第 4 节和第 5 节反映 brainstorm 默认到 planner 的路径且 preplan 仅在高风险场景出现; `README.md` 入站路由表和组合主线描述与新模型一致; 现有合约测试中涉及的 substring 若需变更则同步更新
- Agent Hint: imm-executor
- Test scenarios: Covers imm-work 路由引用更新; Covers IMMUNE.md 工作流描述一致; Covers README.md 工作流描述和入站路由表一致; Covers 现有 substring 测试不因措辞变更而失败
- Depends on: 1
- Scope: `skills/imm-work/SKILL.md`, `IMMUNE.md`, `README.md`, `tests/test_skill_contracts.py`
- Replan condition: 如果 IMMUNE.md 或 README.md 的现有合约测试断言因措辞变更大面积失败则先审计影响范围再调整

### Step 3
- Step ID: U3
- Result: 合约测试覆盖新路由模型的关键规则
- Verification: `tests/test_skill_contracts.py` 包含新断言确认 brainstorm 内联挑战加默认路由到 planner 以及 preplan 可选声明以及 planner bootstrap 规则; `python3 -m unittest tests.test_skill_contracts` 全部通过
- Agent Hint: imm-qa
- Test scenarios: Covers brainstorm 内联挑战和默认路由断言; Covers preplan 可选声明断言; Covers planner bootstrap 断言; Covers 全部测试套件通过
- Depends on: 2
- Scope: `tests/test_skill_contracts.py`
- Replan condition: 如果合约测试需要检查 runtime 行为而非文本断言则保持文本级别并单独规划 runtime 测试

## Notes
- 本计划从 5 步合并为 3 步 outcome：U1 三个 skill 文本（一个 outcome：内联澄清模型在 skill 层就位）; U2 路由文档一致性（一个 outcome：所有引用对齐）; U3 合约测试（一个 outcome：测试通过）
- 每步内部可能涉及多文件和多 commit，但验收只对应该步的单一可验证结果
- CE 参考模式的具体映射：brainstorm 借鉴 Phase 1.2 gap analysis 的 agent-internal 挑战（不是用户侧 checklist）; planner 借鉴 Phase 0.4 Planning Bootstrap 的 scope 确认（不是完整 brainstorm 重做）; preplan 保留为 CE 中不存在但 IMM 认为在高压场景有价值的可选闸门
- 与 plan-046（composable-workflow-contract）和 plan-049（planning-granularity-preplan-routing）方向一致
- `imm-preplan-review` 技能文件保留不删除
