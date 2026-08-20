# Spec: autowork workflow refinement

**任务 ID**: IMM-WORKFLOW-005
**负责人**: Planner
**状态**: Proposed

## 1. 目标
优化 `imm-autowork` 与 `imm-work` 的协作关系，将 `imm-work` 作为唯一的权限和状态驱动器，而将 `imm-autowork` 转化为轻量级、基于契约的调度包装器。

## 2. 功能需求

### R1. 显式自动推进标志 (Explicit Auto-Advance Flag)
- `imm-work status` 及其 JSON 输出必须包含 `can_auto_advance` 布尔标志。
- 逻辑如下：
    - `True`: 如果下一步行动是 `activate` (激活), `executor` (执行) 或 `qa` (质检)。
    - `False`: 如果下一步是 `done` (完成), `planner` (规划), `replan_required` (重排) 或当前 step 状态为 `rework_needed` (返工)。
- 目的：使 `imm-autowork` 能够依靠机器可读的信号进行决策，而非解析自然语言。

### R2. Skill 职责精简与标准化
- `imm-autowork/SKILL.md` 必须重构，移除重复的状态转换细节，改为引用核心基线。
- 强调 `imm-autowork` 仅作为调度器的定位。
- 强制要求输出标准化的 `run_snapshot` 结构。

### R3. 状态持久化与快照
- 在 `autowork` 运行结束或中断时，应通过 `HANDOFF.md` 保持进度快照的同步，以便于跨回合查阅。

### R4. 阻塞性 Skill Contract 对齐
- 如果完整测试发现既有 Skill contract 文案阻塞 `autowork` workflow 验证，应先补齐这些 contract 文案。
- 对齐范围仅限测试明确指出的 Skill contract surface，不能借机扩大 `autowork` 行为范围。
- 目的：让完整测试重新成为可信的最终验收信号。

## 3. 验收标准
- [ ] `imm-work status --json` 包含 `can_auto_advance` 字段。
- [ ] 不同工作流状态下（正常、返工、重排），`can_auto_advance` 的值符合预期。
- [ ] `imm-autowork` Skill 描述中明确使用了该标志。
- [ ] 测试用例覆盖新的状态标志逻辑。
- [ ] `tests/test_skill_contracts.py` 中阻塞完整测试的 contract 断言通过。
- [ ] `mise run test` 通过。
