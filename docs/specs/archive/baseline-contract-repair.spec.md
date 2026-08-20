# Spec: BASELINE contract repair

**任务 ID**: IMM-BASELINE-CONTRACT-REPAIR-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `skills/BASELINE.md` 与既有 `tests/test_skill_contracts.py` 契约之间的漂移，使完整 skill contract test suite 恢复通过。

当前阻塞来自 `python3 -m unittest tests.test_skill_contracts` 的 4 个既有断言失败：

- `Success Criteria`
- `Collaboration Posture`
- `Hub skill anatomy`
- `Shallow Discovery`

本 Spec 只修复 shared baseline 文档契约，不修改 gstack P1 guidance 的已完成结果。

## 2. 背景

执行 `docs/plans/2026-05-24-004-feat-gstack-borrow-p1-adoption-plan.md` 的 U3 时，新增的 focused guard 已通过，Plan 校验与 drift grep 也已通过；完整 `tests.test_skill_contracts` 失败在 `skills/BASELINE.md` 缺少已有测试要求的 shared sections。

这些失败属于 baseline contract repair，而不是 gstack P1 adoption 的结果边界。因此本轮使用独立 Plan，不把 baseline 修复追加到 gstack P1 guidance Plan。

## 3. 功能需求

### R1. Success Criteria wording

- `skills/BASELINE.md` 必须包含 `Success Criteria`。
- 文案必须包含 `ready to execute only when`。
- 文案必须包含 `closable only when`。

### R2. Collaboration Posture

- `skills/BASELINE.md` 必须包含 `Collaboration Posture`。
- 文案必须覆盖 `When to ask` 与 `When to proceed`。
- 该段必须保持简短，不替代具体 Skill 的 boundary 或 workflow rules。

### R3. Hub skill anatomy carrier guidance

- `skills/BASELINE.md` 必须包含 `Hub skill anatomy`。
- 文案必须包含 `Rationalizations`、`Red Flags`。
- 文案必须点名 `imm-work`、`imm-executor`、`imm-planner`、`imm-qa`。

### R4. Shallow Discovery guidance

- `skills/BASELINE.md` 必须包含 `Shallow Discovery`。
- 文案必须包含 `shallow discovery before full-file reads`、`symbol/signature scans`、`targeted line ranges`。

## 4. 验收标准

- [ ] `python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] `skills/BASELINE.md` 保留现有核心 guard，并补齐上述 4 类 contract wording。
- [ ] 不修改 `tests/test_skill_contracts.py` 来降低既有断言强度。
- [ ] `imm-plan` 对本轮 Plan 的 JSON 校验通过。

## 5. 非目标

- 不重写全部 Skill contract。
- 不修改 `plugins/immune-brain/dist/*` 编译输出。
- 不修改 gstack P1 guidance 的 scope 或已闭合步骤。
- 不新增 runtime 行为、状态字段或安装流程。

## 6. 依赖项

- `skills/BASELINE.md`
- `tests/test_skill_contracts.py`
- `docs/solutions/outcome-first-rule-framing-and-collaboration-posture.md`
- `docs/solutions/addy-upstream-contrast-and-hub-anatomy-pattern.md`
- `docs/solutions/contracts.md`
