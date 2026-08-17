# Spec: second-wave reviewer runtime acceptance

**任务 ID**: IMM-SWEEP-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把第二波 reviewer（`data-integrity-reviewer`、`reliability-reviewer`、`release-readiness-checker`、`debug-investigator`）的 runtime spec 从 Proposed 推进到 Accepted，前提是验收标准已被现有制品满足。

## 2. 问题背景

Plan 058 对齐了首批 subagent spec/plan 元数据。剩余工作文档（`docs/reference/subagent-remaining-work.md`）把这四名 reviewer 列为 P1-P3。

实际审计发现：四名 reviewer 的 `skills/*/SKILL.md` 都已完整落地（delegation packet、trigger-only、advisory-only、fallback、output artifact），`tests/test_skill_contracts.py` 已有对应的 activation-path 断言。runtime spec 的验收标准已全部由现有制品覆盖，但 spec 仍标 Proposed。

## 3. 功能需求

### R1. 验收对齐

逐条验证四份 runtime spec 的验收标准，通过后标 Accepted 并补证据指针。

### R2. 剩余工作文档同步

更新 `docs/reference/subagent-remaining-work.md` §1 状态，反映第二波 reviewer 已 Accepted。

### R3. 测试回归

全过程不得破坏现有测试。

## 4. 验收标准

- [ ] 四份第二波 runtime spec 从 Proposed 更新为 Accepted 附验收证据。
- [ ] `subagent-remaining-work.md` 反映更新后的状态。
- [ ] `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` 通过。

## 5. 非目标

- 不实现新 reviewer runtime、不扩 trigger catalog、不改 activation_plan.py。
- 不修改 SKILL.md 功能文案或 dispatch protocol 行为。
