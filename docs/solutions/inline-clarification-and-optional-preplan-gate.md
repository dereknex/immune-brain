# Pattern: Inline Clarification + Planning Bootstrap with Optional Preplan Gate

**领域**: Agent workflow / framing-stage routing / planner authority
**描述**: 将「澄清与收窄」从独立的默认 `imm-preplan-review` 跳转，收敛为在 `imm-brainstorm` 内联完成 gap-style 挑战（借鉴 CE Phase 1.2 思路），并在无上游 brainstorm 时由 `imm-planner` 承担 Planning Bootstrap（借鉴 CE Phase 0.4）自行锁定 scope 与 success criteria；`imm-preplan-review` 仅保留为 **可选高压闸门**（高风险信号、多方分歧、需要审计记录时）。

**reusability**: high
**next_reuse_scenarios**: [`降低 framing→planning 的必经 hop 数`, `README 与 skill 路由同时声明 brainstorm→planner 默认路径`, `需要把 preplan 从“默认阶段”降级为 trigger-only 时`, `合约测试同时锁住 skill 与 repo-facing 文案`]

## 场景

- 团队希望减少「先 preplan 再 planner」的摩擦，但不愿丢掉高压场景下的结构化审计能力。
- `imm-preplan-review` 曾被表述得像默认前置 gate，导致入口文案与 trigger-only 意图冲突。
- `imm-planner` 在无 brainstorm handoff 时需要自问一组最小 scope/success 问题，而不是把用户踢回 `imm-brainstorm` 形成 loop。

## 方案模板

1. **Brainstorm 内联收窄**: 在 `imm-brainstorm` Workflow Rules 中增加显式挑战步骤（缺口分析 / 假设清单），默认 Next Action 指向 `imm-planner`；仅在列出高风险信号时建议 `imm-preplan-review`。
2. **Planner bootstrap**: 在 `imm-planner` 增加「无上游 brainstorm」时的自检规则：自行确认 scope、success criteria、阻断条件；路由问题回到 `imm-brainstorm` 而非默认 `imm-preplan-review`。
3. **Preplan 降级**: 收窄 `imm-preplan-review` description 与触发条件：高风险 + 多方分歧 + 审计需求；移除「默认应先 preplan」的路由暗示。
4. **Repo-facing parity**: 同步 `README.md`、`IMMUNE.md`、`docs/reference/workflow-and-subagents.md`、`imm-work` description，使入口叙述与 skill contract 一致。
5. **Contract regression**: 用 `tests/test_skill_contracts.py` 断言上述路由短语与 bootstrap 规则存在，防止文书回漂。

## 可复用前提

- 上游已有 outcome-based planning 与 role boundaries；变更集中在 **framing 路由语义**，不扩展 autowork 或 runtime dispatcher。
- 愿意接受 preplan 调用频次下降，换取更短的默认路径。

## 验证依据

- 计划 `docs/plans/2026-05-11-057-refactor-inline-clarification-preplan-demotion-plan.md` 三步均已 `imm-qa pass`；`last_review` 证据：`tests/test_skill_contracts.py` 中 `test_inline_clarification_and_preplan_demotion`（11 条断言）；全量 `python3 -m unittest tests.test_skill_contracts` 通过（闭环时 63 tests）。
- `skills/imm-brainstorm/SKILL.md`、`skills/imm-planner/SKILL.md`、`skills/imm-preplan-review/SKILL.md` 与 README/IMMUNE/workflow 参考文档语义对齐。

## 约束与建议

- 不要把「内联澄清」误解成删除 preplan skill；高压闸门仍可用，只是不再是默认 hop。
- bootstrap 规则应保持短小可执行，否则 planner 又变成第二份 preplan 文档。
- 任何未来的路由收紧都应同时更新 README 与 focused tests（参见 `repo-facing-trigger-contract-parity`）。

---
*沉淀日期: 2026-05-11 | 来源: refactor-inline-clarification-preplan-demotion plan U1–U3 闭环*
