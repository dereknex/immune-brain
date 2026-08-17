# Spec: subagent status closure sweep

**任务 ID**: IMM-SWEEP-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

消除仓库内 subagent 相关 spec/plan 元数据与真实实现状态之间的滞后：
已实现的 spec 应标为 Accepted 并指向验收证据，已完成的 plan 应标为 closed；
同时产出一份结构化的剩余工作参考文档，明确第二波 reviewer 与延期项的优先级。

## 2. 问题背景

brainstorm 审计发现：

- 全部 9 名 reviewer 都已有独立 `skills/*/SKILL.md`。
- `activation_plan.py` + `subagent-trigger-catalog.yaml` + dispatch protocol 已实现，68 条测试通过。
- `imm-code-review`、`imm-party`、`imm-ui-review` 三个 host 都已嵌入 Dispatch Protocol 段落。
- 但多个 subagent 治理/首批/runtime spec 仍标 `Proposed`；plan 055、056 仍标 `planned`。
- 第二波 reviewer（`data-integrity`、`reliability`、`release-readiness`、`debug-investigator`）
  的 runtime spec 仍为 Proposed，但都已有 SKILL.md。

元数据滞后导致：后续 workflow 入口无法可靠判断哪些工作真正已完成，
`imm-work` / `imm-planner` 可能重复规划已闭环的切片。

## 3. 功能需求

### R1. Spec 状态对齐

对以下 subagent 相关 spec，逐条验证验收标准（检查制品存在性 + 合约测试覆盖），
验证通过后标 Accepted 并补证据指针：

- `automatic-subagent-activation.spec.md`
- `system-subagents-design.spec.md`
- `workflow-skill-subagent-orchestration.spec.md`
- `imm-party-subagent-delegation.spec.md`
- `first-subagent-batch.spec.md`
- `remaining-first-batch-runtime-activation.spec.md`
- 首批 reviewer runtime spec：`security-reviewer-runtime`、`api-contract-reviewer-runtime`、
  `prompt-contract-reviewer-runtime`、`ai-eval-planner-runtime`、`docs-verifier-runtime`

仅当验收标准未满足时保留 Proposed 并记录缺口。

### R2. Plan 状态对齐

验证 plan 055（first-wave dispatch）和 plan 056（automatic activation）的全部 step
制品是否存在并通过测试，若已完成则将 frontmatter `status` 更新为 `closed`。

### R3. 剩余工作参考文档

产出 `docs/reference/subagent-remaining-work.md`，结构化列出：

- 第二波 reviewer runtime（`data-integrity`、`reliability`、`release-readiness`、
  `debug-investigator`）的当前状态与建议优先级
- Dispatch host catalog 扩展（第二波 child 接入 `imm-code-review` 或其他 host）
- 显式延期项（LLM 路由、跨会话调度、共享 registry、`imm-party`/`imm-ui-review` catalog 接线）
- 每项标注：当前状态、前置依赖、建议下一步

### R4. 测试回归

全过程不得破坏现有测试：`python3 -m unittest tests.test_skill_contracts tests.test_activation_plan`。

## 4. 验收标准

- [ ] 至少 10 个已实现的 subagent spec 从 Proposed 更新为 Accepted，附验收证据。
- [ ] plan 055 和 056 的 status 反映真实完成状态。
- [ ] `docs/reference/subagent-remaining-work.md` 存在且覆盖 R3 四类剩余项。
- [ ] `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` 通过。

## 5. 非目标

- 不实现新 reviewer runtime、不扩 trigger catalog、不改 activation_plan.py 逻辑。
- 不修改 SKILL.md 功能文案或 dispatch protocol 行为。
- 不变更 `.imm/imm-work.py` / `imm-plan.py` 核心行为。
- 不对非 subagent 相关 spec 做状态对齐。

## 6. 依赖项

- 依赖全部已有 subagent spec 与 plan（见 R1、R2 列表）。
- 依赖 `tests/test_skill_contracts.py` 和 `tests/test_activation_plan.py` 作为验收判据。
