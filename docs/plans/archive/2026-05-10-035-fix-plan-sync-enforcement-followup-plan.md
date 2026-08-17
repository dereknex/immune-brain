---
title: fix: enforce imm-plan runtime sync contract
type: fix
status: planned
date: 2026-05-10
origin: `imm-code-review` 对 `2026-05-10-034-fix-imm-plan-state-sync-plan` 的 follow-up 审查指出，当前实现仍存在 sync failure 被吞掉、same-path plan 变更不失效旧 closure、以及 `imm-work` 仍可写 plan-level runtime state 的三个高风险缺口。
---

# Iteration Plan

## Task
- Summary: 收紧 `imm-plan` 的 runtime sync 合同，让它真正成为唯一的 plan-level state writer，并在 same-path plan 变更时失效旧 closure。
- Origin: 来自 review follow-up 的 `CR-001`、`CR-002`、`CR-003`，均属于当前 plan-state sync 边界内的 direct fix，不扩展到新目标或新状态平台。
- Research:
  - 已读取 `IMMUNE.md`，确认 planner 只能产出 spec / plan / durable memory。
  - 已读取 `.imm/specs/plan-state-sync-via-imm-plan.spec.md` 与 `2026-05-10-034-fix-imm-plan-state-sync-plan.md`，确认上一轮目标与本轮缺口。
  - 已复核 `.imm/imm-plan.py`、`.imm/imm-work.py`、`.imm/current_iteration_state.py` 的现有行为：sync failure 被降级为 warning；same-path signature change 未清空 closure；`imm-work activate` 仍会写 `plan_path` / `plan_summary`。
- Decisions: 采用 Hold Scope，只修 review 已定位的 3 个 contract 缺口；不重写 `034` 已完成切片，不引入新 schema 或兼容迁移系统。
- Assumptions:
  - review follow-up 的 `direct_fix` 仍适合一个新的窄修复计划，而不是改写 `034` 的历史闭环；
  - same-path plan 变更的首版安全策略是“清空旧 closure”，优先正确性而不是局部保留；
  - 如果现有调用方依赖 `imm-work activate` 直接切 plan，需要在本轮内一并收口到“先 `imm-plan`，后 `imm-work`”。
- Scope Mode: Hold Scope
- Replan condition: 若修复 `imm-work` 的写入边界时发现必须同时重构更广泛的 runtime state 协议或多工具兼容层，则回到 `imm-planner` 新开 follow-up slice。

## Steps

### Step 1
- Step ID: U1
- Result: `imm-plan` 只在 runtime sync 成功时才返回成功。
- Verification: 运行针对 sync failure 的 focused 验证，确认 `python3 .imm/imm-plan.py docs/plans/2026-05-10-035-fix-plan-sync-enforcement-followup-plan.md --json` 在 sync 失败时返回非零，而不是 warning 后继续成功。
- Test scenarios:
  - runtime sync 抛错时命令失败；
  - runtime sync 成功时 `--json` 仍返回正常 plan payload。
- Depends on: none
- Scope: `.imm/imm-plan.py`, `tests`
- Replan condition: 如果必须引入新的 CLI 模式来区分“只校验不落 runtime”与“校验并同步”，先回到 planner 明确命令契约再继续。

### Step 2
- Step ID: U2
- Result: same-path plan 内容变更后会失效旧 `completed_steps` / `active_step`。
- Verification: 在同一路径 plan 变更后重新运行 `python3 .imm/imm-plan.py docs/plans/2026-05-10-035-fix-plan-sync-enforcement-followup-plan.md --json`，确认 runtime state 清空旧 closure 并留下可追溯 history。
- Test scenarios:
  - `plan_signature` 变化且 `plan_path` 不变时，`completed_steps` 被清空；
  - 同场景下 `active_step` 被清空，避免 stale step 继续执行。
- Depends on: 1
- Scope: `.imm/imm-plan.py`, `.imm/current_iteration_state.py`, `tests`
- Replan condition: 如果需要保留部分 closure 才能维持现有工作流，则停止并让 planner 先定义显式兼容矩阵。

### Step 3
- Step ID: U3
- Result: `imm-work` activate 不再绕过 `imm-plan` 写 plan-level runtime state。
- Verification: 通过 `python3 .imm/imm-work.py activate ...` 的 focused 验证，确认未先经过 `imm-plan` sync 的 plan 不能被直接切入，同时 `imm-work status --json` 仍能正确展示当前 runtime source of truth。
- Test scenarios:
  - 传入与 runtime 当前计划不一致的 plan path 时，`imm-work activate` 明确拒绝；
  - 已同步的当前计划仍可正常 activate step 并输出 `codex_status` / `codex_plan`。
- Depends on: 1, 2
- Scope: `.imm/imm-work.py`, `skills/imm-work/SKILL.md`, `tests`
- Replan condition: 若收口写入边界会破坏现有 step driver 入口，需要先让 planner 重新切分“路由修复”与“runtime contract 修复”。

## Notes
- 本轮是 `034` 的 review follow-up repair，不重复打开上轮已通过的 U1-U3 文档目标。
- 修复完成后，用户继续入口仍应保持 `imm-work`，但前提是 plan-level sync 已先由 `imm-plan` 成功完成。
