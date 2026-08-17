# Spec: BMAD Party advisory integration

**任务 ID**: IMM-PARTY-001  
**负责人**: Planner  
**状态**: Proposed  

## 1. 目标
把 BMAD Party Mode 的多角色讨论能力接入 Immune-Brain，作为只读会诊层帮助暴露取舍、分歧和风险，不替代 `imm-preplan-review`、`imm-planner`、`imm-executor` 或 `imm-qa` 的职责。

## 2. 功能需求
- **触发边界**：
  - 用户显式请求 party、roundtable、多角色讨论或复杂取舍会诊时可触发。
  - 需求模糊、架构取舍、产品体验冲突、review 是否 replan 等场景可建议触发。
  - 普通小任务不得默认触发，避免增加流程成本。
- **角色选择**：
  - 每轮选择 `2-4` 个与问题最相关的角色。
  - 角色必须覆盖不同关注点，例如 product、architecture、developer、qa、ux。
  - 如果当前环境支持 sub-agent 且用户请求多角色讨论，可使用独立 sub-agent；否则使用 solo 模式并明确说明。
- **输出契约**：
  - 输出必须压缩成 Immune-Brain 可消费的 handoff。
  - handoff 必须包含角色观点、分歧点、共识、风险、建议的 scope posture、下一阶段建议。
  - 不把完整长对话作为计划依据，只保留决策材料。
- **流程接入**：
  - 默认插入 `imm-brainstorm -> imm-party -> imm-preplan-review`。
  - 当 `imm-qa` 判断可能需要 replan 时，可触发 `imm-party` 辅助会诊。
  - `imm-preplan-review` 保留最终 scope posture 决定权。
- **写入边界**：
  - `imm-party` 默认只读。
  - 不写 `.imm/specs/`、实现代码、测试、运行态状态或长期记忆。
  - 如需持久化，只允许经用户明确要求写入 `docs/brainstorms/`。

## 3. 验收标准
- [ ] 仓库治理文档明确说明 party 是 advisory layer，不是 execution layer。
- [ ] 新增或更新的 skill 能指导多角色讨论并产出结构化 handoff。
- [ ] `imm-preplan-review` 或相关入口能消费 party handoff，而不会把角色意见直接变成计划。
- [ ] 安装与文档入口能发现新增能力。
- [ ] 至少一个示例场景证明 party 输出能被后续规划使用。

## 4. 依赖项
- 依赖现有 `imm-brainstorm`、`imm-preplan-review`、`imm-planner` 的边界定义。
- 参考 `upstreams/BMAD-METHOD/src/core-skills/bmad-party-mode/SKILL.md` 的多角色讨论机制。
- 依赖当前平台是否允许 sub-agent；不允许时必须保留 solo fallback。

