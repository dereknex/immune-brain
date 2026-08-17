> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Framing-Stage Terse Handoff

**领域**: Agent workflow / framing-stage output contract
**描述**: 当 workflow 仍处于 `brainstorm` / `preplan` 这类只读 framing 阶段时，默认用户输出应优先给出范围判断和下一动作，而不是完整复述分析过程。结构化边界字段继续保留给 Codex-facing contract 和按需展开场景。

**reusability**: high
**next_reuse_scenarios**: [`imm-brainstorm`, `imm-preplan-review`, 其他只读澄清/审查型 skill 需要降低默认解释密度, 但仍要保留 workflow guard 与结构化 handoff]

## 场景

- workflow 还没有进入实现或验收，只是在做范围澄清、scope posture 判断、或 planning gate 审查。
- skill contract 需要保留 `Allowed` / `Blocked` / `Workflow guard` 等结构字段，供 Codex 或后续阶段消费。
- 但如果这些字段和完整研究过程每轮都默认外显，用户会感受到回复像流程说明书，而不是当前结论。
- 同时，framing 阶段又不能像纯闲聊那样省略边界，因为后续实现路由仍依赖这些 contract。

## 方案模板

1. **默认只给 handoff 核心**: `imm-brainstorm` 优先输出 `Problem -> Scope -> Next Action`；`imm-preplan-review` 优先输出 `Scope Mode -> Key boundary -> Next Action`。
2. **结构字段内外分层**: `Next Action` 保留在默认用户输出；`Allowed` / `Blocked` / `Workflow guard` 作为 Codex-facing 必备字段继续存在，但只在边界风险、阻塞、歧义、路由变化或用户明确要求时展开到用户界面。
3. **少讲分析过程，多给范围结论**: 默认不回放读了哪些文档、怎样一步步推导，除非这些研究细节本身改变了边界判断。
4. **保留可复用 handoff 字段，但允许 terse summary**: `Origin` / `Research` / `Decisions` / `Assumptions` 仍属于可交接 artifact；当 planning route 已清晰时，用户可只看到压缩版摘要。
5. **用 focused regression 锁住风格**: 至少有一层契约测试显式检查 framing-stage skill 的 terse-default 规则，避免文档后续慢慢回漂到 verbose。

## 可复用前提

- 该 skill 仍处于只读 framing 阶段，不承担直接实现或 QA closure。
- workflow contract 已有稳定的结构字段，需要继续保留给后续阶段或调度层。
- 默认用户协作目标是快速进入下一 gate，而不是复核全部分析过程。

## 验证依据

- [skills/imm-brainstorm/SKILL.md](skills/imm-brainstorm/SKILL.md) 现在明确默认用户输出为 `Problem -> Scope -> Next Action`，并限制 `Allowed` / `Blocked` / `Workflow guard` 只在边界风险或显式 full handoff 时展开。
- [skills/imm-preplan-review/SKILL.md](skills/imm-preplan-review/SKILL.md) 现在明确默认用户输出为 `Scope Mode -> Key boundary -> Next Action`，并说明 task-level handoff 字段可以对用户做 terse summary。
- `tests/test_skill_contracts.py` 增加了 `test_brainstorm_defines_terse_default_handoff` 与 `test_preplan_review_defines_terse_default_handoff`，并通过 `python3 -m unittest tests.test_skill_contracts`。
- 本轮 workflow plan [2026-05-08-005-feat-framing-stage-terse-output-plan.md](docs/plans/2026-05-08-005-feat-framing-stage-terse-output-plan.md) 已完成 3 个 step，并通过 `imm-review pass` 闭合。

## 约束与建议

- 不要把 framing-stage terse handoff 误解成“删除 boundary contract”；真正要减少的是默认外显密度，不是内部约束本身。
- 这类模式最适合只读澄清/审查型 skill；进入 execution 或 QA 后，输出结构应重新由对应角色决定。
- 如果某个 framing skill 仍需要默认解释大量研究过程，通常说明 scope 还没收敛，或该 role 已经混入 planner/executor 责任。
- 文档收紧后，最好配一层 focused regression；否则回复风格很容易随零散改动回漂。

---
*沉淀日期: 2026-05-08 | 来源: framing-stage terse output plan 闭环*
