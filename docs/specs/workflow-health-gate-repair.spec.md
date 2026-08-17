> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: workflow health gate repair

**任务 ID**: IMM-WORKFLOW-007
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 Immune-Brain 当前 workflow health gate 的两个已知漂移点：`imm-heal`
的 skill inventory 与仓库实际 `skills/` 集合不一致，以及
`tests.test_workflow_loop` 中仍残留的 QA evidence enforcement 旧失败。

首版只收敛这两个可观察缺口，并补上 focused regression 证明；不扩展为
整轮测试清理、workflow 重构或新的健康检查体系。

## 2. 问题背景

`workflow-trigger-repair` 已完成 autowork、dev insights、显式 sub-agent
触发路径的修复，但运行态摘要仍保留两个后续问题：

- `imm-heal` 继续使用手工维护的 `REQUIRED_SKILLS` 列表，而当前仓库
  `skills/` 目录已经包含 `imm-autowork`、`imm-party` 等新增 skill。
- `imm-review.py` 已要求 `pass` 决策必须满足
  `ready_for_review + execution_evidence`，且 traced step 需要 `artifacts`；
  但 `tests.test_workflow_loop` 仍保留旧 fixture/旧预期，导致该健康门禁缺少
  一致的回归覆盖。

对当前仓库来说，最小且高杠杆的后续工作，不是继续加新功能，而是把已有
workflow gate 修到“文档、运行时、测试”三者一致。

## 3. 功能需求

### R1. heal skill inventory 对齐

- `imm-heal` 必须把需要检查的 skill 集合与当前仓库已安装
  `skills/*/SKILL.md` 保持一致。
- 实现可以继续使用显式清单，也可以改为从 `skills/` 目录推导；但结果必须避免
  手工白名单继续漏掉现有 skill。
- 健康检查输出仍需保持当前“缺失项 + 修复建议”的行为，不引入新的 registry
  或外部配置源。

### R2. workflow loop QA gate 对齐

- `tests.test_workflow_loop` 必须反映当前 `imm-review.py` 的 `pass` 契约。
- 相关 fixture 或断言必须覆盖：
  - active step 未 ready 时不能直接 `pass`
  - pass 前必须存在 execution evidence
  - traced step 提供 `Test scenarios` 时必须附带 `artifacts`
- 不要求在本轮重写 review 语义；首版优先修复测试与现有契约不一致的问题。

### R3. focused regression 证明

- 必须补充 focused regression，证明 heal inventory 与 QA gate 两个缺口都已闭合。
- 验证至少覆盖：
  - `test_heal_required_skills_match_repo_skills`
  - 与 `pass` gate 对齐的 workflow loop 测试路径
- 若发现其他无关旧失败，不得顺手扩做；应保留为后续待办或明确 blocker。

## 4. 验收标准

- [ ] `imm-heal` 不再遗漏当前仓库已存在的 `imm-*` skill。
- [ ] `tests.test_workflow_loop` 对 `pass` gate 的预期与 `imm-review.py` 当前契约一致。
- [ ] focused regression 能证明 heal inventory 与 QA evidence gate 同时通过。
- [ ] 本轮范围未扩展成整库测试清理或 workflow redesign。
- [ ] 计划经过 `python3 .imm/imm-plan.py <plan-path> --json` 校验通过。

## 5. 非目标

- 不新增 workflow registry。
- 不重构 `imm-review.py` 的核心状态机。
- 不清理 `tests.test_workflow_loop` 中所有历史问题。
- 不新增新的 `.imm/memory/` 运行态结构。
- 不把 heal 扩展成跨项目 plugin/skill 发现系统。

## 6. 依赖项

- 依赖 `IMMUNE.md` 中既有的 planner / work / QA 权限边界。
- 依赖 `.imm/imm-heal.py`
  当前的健康检查入口。
- 依赖 `.imm/imm-review.py`
  当前的 `pass` gate 契约。
- 依赖 `tests/test_workflow_loop.py`
  作为 focused regression 入口。
