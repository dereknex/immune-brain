# Spec: 对话内澄清与 preplan 降级

**任务 ID**: IMM-INLINE-CLARIFY-001  
**负责人**: Planner  
**状态**: Proposed  

## 1. 目标

将「分析收窄澄清」的默认路径从「单独调用 `imm-preplan-review`」改为「在后续对话中由 `imm-brainstorm` 或 `imm-planner` 自行完成」，使 `imm-preplan-review` 降级为 **按需可选闸门**（高风险、大分歧、需要审计记录时才调用），而非工作流中的默认中间步骤。

参考 CE 的做法：`ce-brainstorm` 的 Phase 1.2 Product Pressure Test 和 Phase 1.3 Collaborative Dialogue 在同一技能内完成所有澄清和收窄，不依赖单独的 preplan 阶段；`ce-plan` 的 Phase 0.4 Planning Bootstrap 在计划技能内部处理缺失的产品澄清。

## 2. 上游依据与边界

- [composable-workflow-contract.spec.md](composable-workflow-contract.spec.md)：已确立触发式组合模型，preplan 不是默认 ceremony。
- [planning-granularity-preplan-routing.spec.md](planning-granularity-preplan-routing.spec.md)：已将 preplan 定位为条件性闸门，但路由文案和 brainstorm 的 handoff 仍隐含 preplan 为常规路径。
- [outcome-step-planning.spec.md](outcome-step-planning.spec.md)：outcome step 粒度原则不受此变更影响。

## 3. 功能需求

### R1. `imm-brainstorm` 内联澄清能力

- `imm-brainstorm` 的 Workflow Rules 和 Output artifact 更新：
  - 增加 **收窄与挑战**步骤：在输出结论之前，对假设、范围、验证路径执行一轮内部挑战（类比 CE Phase 1.2）。
  - 默认 Next Action 直接路由到 `imm-planner`，不再将 `imm-preplan-review` 列为常规中间路由。
  - 仅在检测到高风险信号（安全、数据迁移、跨边界合约、大分歧）时建议 `imm-preplan-review`。

### R2. `imm-planner` 内联 bootstrap

- `imm-planner` 增加 **Planning Bootstrap** 规则（参考 CE Phase 0.4）：
  - 当没有上游 brainstorm 文档且输入不清晰时，planner 自行执行简短的问题框架确认。
  - 确认范围边界、非目标、关键假设后继续规划，不路由回 brainstorm 或 preplan。
  - 若 bootstrap 发现真正的产品级阻断问题，建议 `imm-brainstorm`（而非 `imm-preplan-review`）。

### R3. `imm-preplan-review` 定位调整

- `imm-preplan-review` 的 description 和 Workflow Rules 更新：
  - 明确声明：此技能是 **可选高压闸门**，不是默认路由目标。
  - 触发条件收窄为：scope 不稳定 + 存在未解决的多方分歧 + 需要结构化审计记录。
  - 移除 description 中 "Also use it when a conversation is continuing after `imm-brainstorm`" 的默认路由暗示。

### R4. 路由引用一致性

- `imm-brainstorm` 的 description 移除 `imm-preplan-review` 作为默认 framing 目标的措辞。
- `imm-work` 的 description 移除 `imm-preplan-review` 作为常规来源的措辞（保留其作为可选来源的说法）。
- `IMMUNE.md` 和 `README.md` 中的工作流描述更新为新路由模型。

### R5. 合约测试

- `tests/test_skill_contracts.py` 新增断言：
  - `imm-brainstorm` 默认 Next Action 路由到 `imm-planner`。
  - `imm-preplan-review` 声明自身为可选而非默认。
  - `imm-planner` 包含 bootstrap 规则。

## 4. 验收标准

- [ ] `imm-brainstorm` 包含内联收窄挑战步骤，默认路由到 `imm-planner`。
- [ ] `imm-planner` 包含 Planning Bootstrap 规则。
- [ ] `imm-preplan-review` description 和 Workflow Rules 声明为可选高压闸门。
- [ ] 路由引用在 brainstorm、planner、work、IMMUNE.md、README.md 间一致。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] 未改变 `imm-work`、`imm-qa`、`imm-executor` 的 authority 边界。

## 5. 非目标

- 删除 `imm-preplan-review` 技能文件。
- 改变 `imm-work` / `imm-qa` / `imm-executor` 的 authority 边界。
- 引入新的运行时状态字段或 dispatcher。
- 修改 `.imm/imm-work.py` 或 `imm-plan.py` 核心行为。

## 6. 依赖项

- [composable-workflow-contract.spec.md](composable-workflow-contract.spec.md)
- [planning-granularity-preplan-routing.spec.md](planning-granularity-preplan-routing.spec.md)
