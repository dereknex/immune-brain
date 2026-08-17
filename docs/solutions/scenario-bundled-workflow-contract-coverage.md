> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Scenario-bundled Workflow Contract Coverage

**领域**: Agent workflow / contract design / UX governance
**描述**: 当 workflow 改进需求来自多个用户场景而不是单一 bug 时，先按场景族收敛成少量可闭合 contract outcome，再同时落到 skill contract、repo-facing docs 和 focused regression，避免写成一张大而散的愿望清单。

**reusability**: high
**next_reuse_scenarios**: [`同一轮 workflow 改进同时覆盖 onboarding、继续入口、恢复、返工和 QA 守卫`, `用户提出 5+ 个体验场景，但仍希望保持小步闭环和现有角色边界`, `需要把“流程体验问题”收敛成 3-4 个可验证 contract 结果，而不是新增顶层 stage`]

## 场景

- 用户反馈不是一个孤立缺陷，而是多个 workflow 使用场景都存在摩擦。
- 这些摩擦横跨 `preplan`、`planner`、`work`、`qa` 和 README 文案，但还不值得新增新角色或新状态机。
- 如果按场景逐条实现，很容易变成碎片改动；如果一次性全做，又容易失去 step 边界。
- 团队既想改善用户体感，也要保留 `plan -> work -> review` 的权限链和验证纪律。

## 方案模板

1. **先按场景族，不按单点需求拆分**: 把相邻场景合并成少量 outcome，例如默认入口/进度可见性、轻量 bugfix/模糊任务 gate、恢复/返工回路、证据不足/畸形计划守卫。
2. **每个 outcome 都绑定真实 contract 面**: 至少同步到 skill contract、README 或等价 repo-facing 文档，以及 focused regression。
3. **优先补 contract，不先扩 stage**: 如果问题能靠入口提示、状态摘要、guard 文案或 focused tests 解决，就不要先新增 workflow stage 或后台自动化。
4. **把结构性风险和体验问题分层**: 体验问题通过入口/摘要/恢复块收敛；结构性风险通过 `rework` / `replan` / evidence gate 收紧。
5. **允许计划内局部 runtime 改动，但每步只闭一个 contract 结果**: 例如给 `imm-work status` 增加 `recommended_entry`、`progress_summary`、`resume_block`，但不要顺手吞并别的守卫问题。
6. **遇到外部状态噪音时，先记为残余风险，不在当前 outcome 内偷扩修**: 只要当前 step 的 contract 证据还能闭合，就把状态噪音留给下一轮专门治理。

## 可复用前提

- 系统已经有明确的角色边界和可读取的 workflow 状态。
- 多个用户场景共享同一批 edit surfaces，例如 skill docs、README、状态输出和 focused tests。
- 目标是改善 workflow 体验与守卫质量，而不是重写运行时引擎。

## 验证依据

- [workflow-scenario-coverage.spec.md](docs/specs/workflow-scenario-coverage.spec.md) 把 1-9 场景先收敛成 4 类需求，而不是 9 个零散实现点。
- [2026-05-08-009-feat-workflow-scenario-coverage-plan.md](docs/plans/2026-05-08-009-feat-workflow-scenario-coverage-plan.md) 进一步把这些需求拆成 `U1-U4` 四个可闭合结果。
- `imm-work.py` 为默认入口/进度/恢复场景补了 `recommended_entry`、`progress_summary` 和 `resume_block`。
- [imm-work/SKILL.md](skills/imm-work/SKILL.md)、[imm-preplan-review/SKILL.md](skills/imm-preplan-review/SKILL.md)、[imm-planner/SKILL.md](skills/imm-planner/SKILL.md)、[imm-qa/SKILL.md](skills/imm-qa/SKILL.md) 与 [README.md](README.md) 共同锁住了默认入口、hotfix gate、模糊任务 framing、resume/rework 和 evidence-poor / malformed-plan guard。
- Focused regression `python3 -m unittest tests.test_imm_work tests.test_imm_review tests.test_skill_contracts` 通过，证明这些场景不只存在于文档叙述里。

## 约束与建议

- 不要把“覆盖多个场景”误解成“允许扩大单个 step”；正确做法是减少场景数与结果数之间的映射复杂度。
- 如果某个场景必须引入新的状态源、后台流程或新顶层 stage，优先把它拆成下一轮独立计划。
- 文档、状态输出和 focused regression 至少要改两层；只改一层，contract 很快会再次漂移。
- 当计划执行中出现外部 runtime 噪音时，先判断它是否阻断当前 outcome 闭合；未阻断时记录为 residual risk，不要立即偷扩范围。

---
*沉淀日期: 2026-05-08 | 来源: workflow scenario coverage plan (`U1-U4`) 全步骤验收*
