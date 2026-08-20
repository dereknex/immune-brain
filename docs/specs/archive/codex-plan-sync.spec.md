# Spec: Codex native plan sync

**任务 ID**: IMM-CODEX-002
**负责人**: Planner
**状态**: Draft

## 1. 目标

让 Immune-Brain 的本地 iteration plan 能在 Codex 原生 plan 面板中呈现为同步任务列表。首版只做状态快照与同步契约：`.imm/imm-work.py status` 输出 Codex 可消费的 task 列表，由 `imm-work` 在 Codex 中调用 `update_plan` 展示和更新，不把 Codex plan 变成新的状态源。

## 2. 背景

CE 的 Codex 集成把持久 Markdown plan 中的 Implementation Units 映射到 Codex 原生 `update_plan` 任务，并用稳定 U-ID 做状态锚点。Immune-Brain 当前已有 `codex_status`，但只暴露 active plan、active step、completed steps 和 next skill；Codex 可以读状态，却没有一组可直接展示到原生 plan 面板的任务条目。

## 3. 功能需求

- **任务快照**：
  - `imm-work status` 必须输出 `codex_plan.tasks`。
  - 每个 task 必须包含 `step_number`、`step_id`、`step`、`status` 和 `verification`。
  - task 状态必须只从本地 plan 与 `.imm/memory/current_iteration.json` 派生。
- **状态映射**：
  - completed steps 映射为 `completed`。
  - active step 映射为 `in_progress`。
  - 其它未完成 step 映射为 `pending`。
  - 若当前状态需要 replan，active task 仍保持 `in_progress`，并通过 `codex_status.next_skill` 指向 `imm-planner`。
- **Codex 同步契约**：
  - `imm-work` 在 Codex 中应使用 `codex_plan.tasks` 调用原生 `update_plan`。
  - 同步只展示当前 workflow 状态，不授权 `imm-work` 执行实现或记录 QA。
  - 真实状态仍以 `.imm/memory/current_iteration.json` 与 plan 文件为准。

## 4. 验收标准

- [ ] `python3 .imm/imm-work.py status` 输出 `codex_plan.tasks`。
- [ ] active/completed/pending 三种状态能从现有 plan 状态中正确派生。
- [ ] `skills/imm-work/SKILL.md` 说明 Codex 中应把 `codex_plan.tasks` 同步到 `update_plan`。
- [ ] README 说明 Codex 原生 plan 面板只是展示层，不是新的状态源。
- [ ] `python3 .imm/imm-plan.py docs/plans/2026-05-07-006-feat-codex-plan-sync-plan.md --json` 和 `python3 .imm/imm-work.py status` 通过。

## 5. 非目标

- 不让 Codex 原生 plan 反向写入 `.imm` 状态。
- 不新增 centralized router。
- 不让 `imm-work` 自动跑完整 plan。
- 不改变 `imm-executor` 或 `imm-qa` 的权限边界。
- 不重写历史 plan 格式。

## 6. 依赖项

- 依赖 `.imm/specs/codex-native-interaction.spec.md` 的 `codex_status` 输出契约。
- 依赖 `.imm/imm-plan.py` 的 plan parsing 与 validation。
- 依赖 `.imm/imm-work.py` 的 current iteration 状态。
