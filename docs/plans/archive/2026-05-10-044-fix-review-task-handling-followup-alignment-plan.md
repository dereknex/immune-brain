---
title: fix: align review task handling follow-up
type: fix
status: planned
date: 2026-05-10
origin: imm-code-review findings on `043` identified route-taxonomy overlap and durable-summary drift.
---

# Iteration Plan

## Task
- Summary: 修复 `043` review task handling 规划后的 follow-up 对齐问题：收紧 route taxonomy 层级，并让 durable summary 与当前 runtime 状态重新对齐。
- Origin: `imm-code-review` 对 `043` 给出两条 actionable finding：`append_to_plan` 同时被写成顶层 route 和 same-boundary follow-up 的内部去向；`MEMORY.md` 顶部摘要仍停在 managed-copy install 任务。review 初步建议 `append_to_plan`，但检查 `.imm/imm-plan.py` 后确认 same-path signature change 仍会重置 `completed_steps`，与 completed-plan append contract 冲突，因此本轮不能安全使用 `append_to_plan`，必须新开 narrow follow-up slice。
- Research:
  - 已检查 `.imm/memory/current_iteration.json`、`.imm/memory/MEMORY.md`、`.imm/specs/review-task-handling-workflow.spec.md`、`.imm/specs/review-followup-imm-work-entry.spec.md`、`.imm/specs/completed-plan-followup-append.spec.md`、`.imm/imm-plan.py`、`docs/plans/2026-05-10-043-feat-review-task-handling-workflow-plan.md`、`skills/imm-code-review/SKILL.md` 与 `skills/imm-pr-fix/SKILL.md`。
  - 确认当前 runtime plan 仍指向 `043`，且该计划已完成；问题仍属于同一高层边界，但 append runtime 语义与 contract 不一致。
  - 确认 `MEMORY.md` 顶部摘要已偏离当前 runtime 真相，因此需要一个专门的 durable-summary 对齐结果，而不是只记任务历史。
- Decisions: D1 选择 `Hold Scope`，只修 route taxonomy 层级和 durable summary 对齐；D2 本轮 route 为 `new_slice`，不是 `append_to_plan`，理由是 `.imm/imm-plan.py` 在同路径签名变化时会重置 `completed_steps`； D3 保留现有 route enum，不把本轮扩大成 vocabulary rename； D4 将 follow-up 拆成两个独立结果：taxonomy alignment 与 durable-summary alignment； D5 验证保持在文件真值与 runtime 状态对比，不扩展到新的 focused tests。
- Assumptions:
  - `043` 的总体 planning 方向仍然成立，follow-up 只修层级表达和状态摘要，而不是推翻整套 review handling workflow。
  - 顶部 durable summary 应与新的当前 follow-up slice 对齐，而不是继续描述 `043` 完成态或更旧的 legacy-installer 工作。
  - 当前 review finding 不需要立即修复 `imm-plan` runtime reset 机制；只要明确记录该风险即可。
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/review-task-handling-workflow.spec.md`, `.imm/specs/review-task-handling-followup-alignment.spec.md`, `docs/plans/2026-05-10-043-feat-review-task-handling-workflow-plan.md`, `docs/plans/2026-05-10-044-fix-review-task-handling-followup-alignment-plan.md`, `.imm/memory/MEMORY.md`
  - dependencies_known: true
  - verification_path:
      - target: route taxonomy has one clear layer for `append_to_plan`, and durable summary matches the current runtime follow-up slice
      - method: file inspection plus comparison between `MEMORY.md` top lines and `python3 .imm/imm-work.py status`
  - blockers: none, as long as the slice stays contract-first and avoids runtime append semantics changes
  - replan_condition: if fixing this follow-up requires changing `imm-plan` append behavior, route-enum redesign, or broader README/runtime work, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Route taxonomy alignment exists.
- Verification: `.imm/specs/review-task-handling-workflow.spec.md` and the follow-up spec no longer treat `append_to_plan` as both a top-level route and an internal same-boundary disposition.
- Test scenarios: Covers same-boundary route remaining user-facing; Covers append staying single-layer; Covers `new_slice` and `pr_blocker` staying distinct
- Depends on: none
- Scope: `.imm/specs/review-task-handling-workflow.spec.md`, `.imm/specs/review-task-handling-followup-alignment.spec.md`, `docs/plans/2026-05-10-043-feat-review-task-handling-workflow-plan.md`
- Replan condition: If route taxonomy cannot be made coherent without renaming the whole historical enum set, stop and reduce scope to a vocabulary-prep slice.

### Step 2
- Step ID: U2
- Result: Durable summary aligns with the current follow-up state.
- Verification: the top summary in `.imm/memory/MEMORY.md` reflects the current `044` follow-up slice instead of the old managed-copy install task, and `python3 .imm/imm-work.py status` points to the same current plan boundary.
- Test scenarios: Covers top-summary/runtime alignment; Covers next-boundary wording no longer pointing to old legacy-installer work
- Depends on: 1
- Scope: `.imm/memory/MEMORY.md`
- Replan condition: If summary alignment requires rewriting broader memory history or changing runtime state behavior, stop and narrow the task again.

## Notes
- 这次 follow-up 明确拒绝 `append_to_plan`，不是因为问题超出 `043` 目标边界，而是因为当前 `.imm/imm-plan.py` 的 same-path signature reset 仍会清空 `completed_steps`，与 append contract 冲突。
- 新切片只修 contract alignment 和 durable summary；不处理 `imm-plan` runtime 机制本身。
