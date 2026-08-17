# Spec: plan state sync via imm-plan only

**任务 ID**: IMM-PLANSTATE-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

统一计划相关运行态更新来源：任何计划变更（新建、验证通过、变更摘要/步骤后）都应通过
`imm-plan` 完成 `.imm/memory/current_iteration.json` 的同步，禁止在 `imm-work` 里发起计划级状态写入。

首版只做“谁来更新 plan 运行态”的边界修复，不扩展新的 runtime store 或状态 schema：

- 保留 `imm-work` 作为执行流驱动（activate/step lifecycle）与 Codex 展示入口。
- 把 plan-level 关联与校验元信息（如 `plan_path`、`plan_summary`、签名、校验时间）收口到 `imm-plan`。

## 2. 问题背景

最近的执行反馈指出：`imm-work` 在某些场景承担了计划层变更写入，导致“谁负责
`plan_path`/`plan_summary` 同步”不清晰。这样会带来：

- `Codex status` 与 runtime state 的真源边界不稳定；
- 计划改动后仍由不同入口处理，导致可追溯性下降；
- `replan` / continue 边界的来源不一致。

本次只修正来源归属，不改动现有 `imm-work` 的 step-level 驱动闭环。

## 3. 功能需求

### R1. 计划同步单一入口

- 规定：`imm-plan <plan-path> [--json]` 在计划验证通过后，负责把 plan 元信息同步到
  `.imm/memory/current_iteration.json`。
- 同步字段至少包含：
  - 当前计划路径（`plan_path`）
  - 计划摘要（`plan_summary`）
  - 计划签名（`plan_signature`）
  - 最近验证时间（`plan_last_validated_at`）
  - 历史/变更事件（history 记录），用于事后排查。
- 同步入口必须可溯源：只有 `imm-plan <plan-path> [--json]` 在 plan 校验通过后
  才执行该写入，不应由 `imm-work` 或 `imm-review` 直接发起计划级 runtime 写入。

### R2. `imm-work` plan-level 写入禁止边界

- `imm-work` 仅处理 step lifecycle（激活、状态推进、rework/review 路由）与只读
  状态构建，不新增 “替代 `imm-plan` 的 plan-level 同步路径”。
- 对于 plan 内容变更导致 `active_step` 或 `completed_steps` 语义需要重置的场景，
  该逻辑应以 `imm-plan` 的 plan-level sync 结果为准。

### R3. 兼容与回归口径

- 仍保留 `imm-work status` -> `codex_status` / `codex_plan.tasks` 的展示能力；
- 继续用 `.imm/memory/current_iteration.json` + plan 文件作为真实状态源；
- 不把 Codex task 面板当成反写目标。

### R4. 验证路径

- 验证必须覆盖至少两种 plan 变更路径：新建 validated plan 与已存在计划路径/步骤更新。
- 验证应包含 `imm-plan --json` 的命令级成功与同步结果可观测。
- 验证输出必须能说明：
  - plan-level 字段由 `imm-plan` 写入；
  - `imm-work` 并未引入 plan-level 回退写入分支。

## 4. 验收标准

- [ ] `IMMUNE.md` 与 `.imm/specs/current-iteration-closure-contract.spec.md` 的真源原则未被破坏。
- [ ] `imm-plan` 验证通过后能把 plan-level 信息同步到 runtime state。
- [ ] `imm-work` 文档与实现不再把 plan-level runtime 写入作为默认/替代路径说明。
- [ ] `python3 .imm/imm-plan.py <validated-plan> --json` 在成功时产生可观测的 plan state sync。
- [ ] 变更计划后，`imm-work` 的后续驱动逻辑仍可继续按现有 step 流程运行。
- [ ] 无须实现新的 runtime registry，仅收敛职责边界。

## 5. 非目标

- 不重构 `imm-work` 的现有 executor/qa 驱动闭环。
- 不改 `current_iteration_state` 的持久化格式（除非本 slice 内的实现需要兼容字段）。
- 不实现 background scheduler 或 auto-run 全 plan。
- 不扩展所有 skill 的统一状态同步框架。

## 6. 依赖项

- [IMMUNE.md](IMMUNE.md)
- [codex-plan-sync.spec.md](docs/specs/codex-plan-sync.spec.md)
- [current-iteration-closure-contract.spec.md](docs/specs/current-iteration-closure-contract.spec.md)
- [workflow-trigger-repair.spec.md](docs/specs/workflow-trigger-repair.spec.md)
- `skills/imm-planner/SKILL.md`
- `skills/imm-work/SKILL.md`
- `.imm/imm-plan.py`
- `.imm/imm-work.py`
