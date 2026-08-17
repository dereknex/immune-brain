---
title: Rejected UI Review Fallback Design Generation
rejected: true
rejection_reason: >
  `imm-ui-review` 被明确限定为只读 reviewer。缺失 `DESIGN.md`
  时让它自动生成 fallback 文件，或默认套用 SaaS 风格，会把“提醒契约缺失”的审查动作
  扩成“替项目决定设计语言”的写权限行为，和本轮已确认的 authority boundary 冲突。
reusability: medium
key_files:
  - docs/specs/ui-review-design-contract-alignment.spec.md
  - docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md
  - docs/reference/design-contract-review-checklist.md
  - plugins/immune-brain/dist/imm-ui-review.md
  - tests/test_skill_contracts.py
next_reuse_scenarios:
  - 有人提议 reviewer 在缺失 repo-local contract 时自动补模板文件
  - 有人试图把 generic style guide 当成项目设计契约 fallback
  - 需要区分 quality checklist 与 style authority 的边界
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Rejected: Auto-generating `DESIGN.md` or Default Style Fallback in `imm-ui-review`

## Rejected approach

当项目没有 `DESIGN.md` 时，让 `imm-ui-review` 自动写入一个 fallback `DESIGN.md`，或直接按 “clean / standard SaaS” 默认风格完成 UI design review。

## Rejection reason

这个方案的问题不在实现成本，而在边界错位：

- `imm-ui-review` 的角色是 advisory-only、read-only reviewer，不是项目初始化器，也不是设计系统 author。
- 缺失 `DESIGN.md` 时，系统缺的是项目契约，不是平台默认审美；用默认 SaaS 风格顶上，会把通用偏好伪装成项目要求。
- 一旦 reviewer 负责生成 fallback design file，后续 review 就会混淆“检查项目是否遵守自己的设计约束”和“用 reviewer 自己的约束替代项目决策”。

## Preferred approach

保留三段式边界：

1. 仓库存在 `DESIGN.md` 时，按它审查，视其为 UI contract 的最高优先级来源。
2. 仓库缺失 `DESIGN.md` 时，只报告缺失并建议补齐，不自动生成文件。
3. 仅保留 style-neutral 的 anti-slop quality checklist，用来约束基本表达质量，而不是替代项目设计语言。

## Evidence

- [docs/specs/ui-review-design-contract-alignment.spec.md](docs/specs/ui-review-design-contract-alignment.spec.md)
- [docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md](docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md)
- [docs/reference/design-contract-review-checklist.md](docs/reference/design-contract-review-checklist.md)
- [plugins/immune-brain/dist/imm-ui-review.md](plugins/immune-brain/dist/imm-ui-review.md)
- `tests/test_skill_contracts.py`

*沉淀日期: 2026-05-25 | 来源: imm-ui-review design-contract alignment brainstorm / planner / autowork 闭环*
