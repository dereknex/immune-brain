---
title: Rejected Autowork Driver and Runtime Default Pass
rejected: true
rejection_reason: >
  这些方案都把边界切到了 runtime/工具里：新增 `imm-autowork-driver` 会把已有
  单入口能力硬拆为新的交付面；把 `execution` 的通过状态当作 `imm-qa` 结论会
  破坏 authority 分离。都没有必要，也会让 `imm-autowork` 的职责变成“模型决策者”。
reusability: medium
key_files:
  - docs/specs/autowork-skill-driver-simplification.spec.md
  - docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md
  - plugins/immune-brain/dist/imm-autowork.md
  - .imm/imm-autowork.py
  - tests/test_imm_autowork.py
  - tests/test_skill_contracts.py
next_reuse_scenarios:
  - 有人提议新增 driver skill 来替代 existing autowork entry 的 host loop。
  - 有人提议 runtime 在看到执行通过就自动 `pass` QA。
  - 需要解释为何 default pass 会导致 QA authority 被稀释。
---

# Rejected: `imm-autowork-driver` and Runtime Default QA Pass

## Rejected approaches

- 新增 `imm-autowork-driver` 作为独立 MCP/tool 入口。
- 在 `imm-autowork.py` 根据 `verification_result: passed` 自动执行 QA pass 迁移。

## Why rejected

1. `imm-autowork.py` 当前和未来都应是 deterministic checkpoint runtime，而不是执行/QA authority。
2. `imm-qa` 的检查项不等于 executor 返回的 `verification_result`，二者职责不同，不能替代。
3. 现有 `imm-autowork` 已有明确入口，新增 driver 会带来更多边界、测试、以及文档维护成本。

## Preferred approach

- 保留现有 `imm-autowork` 入口不变。
- 把 host-loop 约定写进 `skills/imm-autowork/SKILL.md` 与 packaged contract：`awaiting_execution_input` 与
  `awaiting_qa_decision` 分别触发 executor/qa 角色。
- QA 决策只从 `imm-qa` + `imm-review` 路径产出，runtime 只透传边界与证据。

## Evidence

- `docs/specs/autowork-skill-driver-simplification.spec.md`
- `docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md`
- `plugins/immune-brain/dist/imm-autowork.md`
- `tests/test_imm_autowork.py`
- `tests/test_skill_contracts.py`

*沉淀日期: 2026-05-27 | 来源: autowork simplification spec / plan / Step U1*
