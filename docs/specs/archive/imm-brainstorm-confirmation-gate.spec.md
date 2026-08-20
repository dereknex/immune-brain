# Spec: imm-brainstorm Confirmation Gate

**任务 ID**: IMM-WORKFLOW-UX-004
**负责人**: Planner
**状态**: Proposed

## 1. 目标
让 `imm-brainstorm` 在进入 `imm-planner` 前先完成真实讨论确认。即使 framing 看起来稳定，也不能把“我建议这样做”自动升级成“下一步进入 planner”。

## 2. 需求

### R1. planner handoff 必须等待显式确认
- `imm-brainstorm` 只有在用户明确回复“确认”“可以”“按这个来”或等价表达后，才允许建议 `imm-planner`。
- 仅有 agent 自己判断 framing stable 不足以通过 handoff gate。

### R2. brainstorm 可以先提出推荐方案
- `imm-brainstorm` 可以给出建议方向、推荐 scope 和理由。
- 未确认前，Next Action 应表达为“请确认是否按此方案进入 planner”。

### R3. 未确认时不得命名 planner 作为 next skill
- 如果用户尚未确认推荐方案，Next Action 不应写成“建议 `imm-planner`”。
- 未确认时可以提到“确认后再进入 planner”，但不能把它作为当前 next skill。

### R4. 保留只读和 manifest 边界
- 本变更不让 `imm-brainstorm` 写 Spec、Plan、实现文件、测试或运行态。
- `Brainstorm manifest` 仍只在确认后作为 planner handoff 的 closed-world 输入。

## 3. 验收标准
- [ ] `plugins/immune-brain/dist/imm-brainstorm.md` 的 gate 明确要求用户显式确认 proposed direction / scope。
- [ ] `Default Next Route` 或等价文案不再暗示无条件默认进入 `imm-planner`。
- [ ] Output / Next Action 文案允许“推荐方案，确认后进入 planner”的表达。
- [ ] 未确认时的 fail path 明确不命名下一 skill。
- [ ] `tests/test_skill_contracts.py` 有 focused assertion 锁住显式确认门槛，防止回漂。

## 4. 依赖项
- `CONTEXT.md` 中 `Brainstorm`、`Plan`、`Spec`、`Skill` 的术语边界。
- `docs/specs/imm-brainstorm-natural-output.spec.md` 中“默认输出可只保留最少必要的下一步和确认需求”的自然输出方向。
- `docs/specs/inline-clarification-preplan-demotion.spec.md` 中“brainstorm 内联挑战后进入 planner”的既有路由模型。本 Spec 对它增加确认门槛，而不是恢复 `imm-preplan-review` 默认阶段。
- `tests/test_skill_contracts.py` 中现有 `imm-brainstorm` handoff 和 gated Next Action 回归。

## 5. 非目标
- 不把 `imm-preplan-review` 恢复成默认中间阶段。
- 不改变 `imm-planner` 的 bootstrap 行为。
- 不新增 runtime parser 或结构化确认状态。
- 不修改实现代码或测试之外的业务逻辑。
