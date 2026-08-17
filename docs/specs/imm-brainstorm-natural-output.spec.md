# Spec: imm-brainstorm Natural Output Contract

**任务 ID**: IMM-WORKFLOW-UX-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标
让 `imm-brainstorm` 的默认回复更像直接结论，而不是固定表单。保留 handoff 所需的边界信息，但减少字段感、重复提示和僵硬结构。

## 2. 需求

### R1. 默认输出以自然结论为主
- 默认成功输出应先给收窄后的判断，再给范围和下一步。
- 不要求每次都按完整字段逐项展开。
- 用户读完默认输出后，应能立即知道“要解决什么、这次只做什么、接下来去哪一步”。

### R2. 结构字段改为按需显式
- `Allowed`、`Blocked`、`Workflow guard` 仍保留在 contract 中。
- 这些字段只在容易误解边界、需要强提醒路由、任务阻塞或用户要求完整 handoff 时显式展开。
- 默认输出可只保留最少必要的下一步和确认需求。

### R3. 简版模板与 skill 文案一致
- `skills/imm-brainstorm/SKILL.md` 与 `docs/brainstorms/imm-brainstorm-template-short.md` 应共享同一默认风格。
- 模板不应继续强化“每次都像 checklist 一样逐项填写”的感觉。

### R4. 保留 planning/workflow 守卫
- 简化输出不能削弱 `imm-brainstorm` 的只读边界。
- 任何基于该 handoff 的实现继续请求，仍必须先进入 `imm-preplan-review`、`imm-planner` 或 `imm-work`。

## 3. 验收标准
- [ ] `imm-brainstorm` 默认 handoff 不再要求完整结构化清单式输出。
- [ ] 默认输出明确结论、范围、下一步，且长度控制在短回复层级。
- [ ] `Allowed`、`Blocked`、`Workflow guard` 在 contract 中仍存在，但文案明确为按需展开。
- [ ] 简版模板与 skill 文案对齐“默认自然、必要时展开”的口径。
- [ ] 相关 contract guard 至少有一处可防止文案回漂到 rigid template 风格。

## 4. 依赖项
- 依赖 [IMMUNE.md](IMMUNE.md) 的规划边界与 workflow guard。
- 参考 [.imm/specs/framing-stage-terse-output.spec.md](docs/specs/framing-stage-terse-output.spec.md) 的 framing-stage 简洁化方向，但本轮进一步收窄到 `imm-brainstorm` 单点。
- 依赖 `skills/imm-brainstorm/SKILL.md`、`docs/brainstorms/imm-brainstorm-template-short.md` 与 `tests/test_skill_contracts.py` 的现有 contract 结构。

## 5. 非目标
- 不在本轮同时修改 `imm-preplan-review`。
- 不扩展到 `imm-work`、`imm-qa` 或全局输出风格重写。
- 不改变 `imm-brainstorm` 的职责边界、落盘边界或 workflow routing。
