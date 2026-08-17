---
title: fix: route review follow-up through imm-work
type: fix
status: planned
date: 2026-05-10
origin: user decision to change same-boundary review follow-up from `reviewer -> follow_up -> imm-planner` to `reviewer -> follow_up -> imm-work`, while preserving planner authority.
---

# Iteration Plan

## Task
- Summary: 收敛 review 后 same-boundary repair 的默认继续入口到 `imm-work`，并让 `imm-work` 显式承接 review handoff 后再内部转入 planner / append 路径，而不是让用户手动切到 `imm-planner`。
- Origin: 用户明确把“同一目标边界内的小修复”改为 `reviewer -> follow_up -> imm-work`。现有仓库里 reviewer、planner、README 已有 bounded `follow_up` handoff contract，但默认继续入口仍偏向 `imm-planner`，同时 `.imm/imm-work.py` 也还没有明显的 review-followup intake truth。当前 `.imm/memory/current_iteration.json` 没有 active runtime plan，因此这不是 `append_to_plan`，而是一个新的 narrow workflow-contract slice。
- Research:
  - 已检查 `skills/imm-code-review/SKILL.md`、`skills/imm-ui-review/SKILL.md`、`skills/imm-planner/SKILL.md`、`skills/imm-work/SKILL.md`、`skills/imm-pr-fix/SKILL.md`、`README.md`、`.imm/specs/review-followup-handoff.spec.md`、`.imm/specs/completed-plan-followup-append.spec.md`、`.imm/specs/role-entrypoint-contract-repair.spec.md`、`.imm/imm-work.py`、`.imm/imm-plan.py`、`tests/test_skill_contracts.py` 与 `tests/test_imm_work.py`。
  - 确认当前 shared truth 已支持 reviewer 输出 bounded `follow_up` handoff、planner 消费 `origin_review` 和 `append_to_plan`；但对外默认 continue entry 尚未统一成 `imm-work`，且 runtime 代码没有显式 follow-up intake contract。
  - 确认当前 runtime state 为空，不能把这次改动伪装成已有 current completed plan 的 append follow-up。
- Decisions: D1 选择 `Hold Scope`，只改 same-boundary review follow-up 的默认 continue entry 与 internal handoff truth，不顺手重命名 route enum；D2 `imm-planner` 继续保留 spec / plan / append 的唯一 authority，`imm-work` 只负责吸收入口并内部转发； D3 PR review thread / CI / merge conflict 继续保持 `imm-pr-fix` 独立入口，不合流到 `imm-work`； D4 若实现落地需要 runtime 支持，则优先补 `imm-work` 的 intake/status truth 与 focused regression，不扩展到自动建计划或自动执行。
- Assumptions:
  - `direct_fix` 这一术语虽然不理想，但本轮可以先保留，只修入口和 authority 关系。
  - `imm-work` 可以承接新的 follow-up intake / status truth，而不会被迫合并 planner authority。
  - focused tests 可以用 contract + targeted runtime assertions 覆盖本轮变化，不需要新的全链路 harness。
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-pr-fix/SKILL.md`, `README.md`, `.imm/imm-work.py`, `.imm/specs/*.spec.md`, `tests/test_skill_contracts.py`, `tests/test_imm_work.py`
  - dependencies_known: true
  - verification_path:
      - target: same-boundary review follow-up 默认继续入口改为 `imm-work`，但 planning authority 仍归 `imm-planner`
      - method: contract text inspection + targeted unittest coverage for `imm-work` state/next-action truth
  - blockers: none, as long as the slice stays within contract text and targeted `imm-work` runtime behavior
  - replan_condition: if the only workable implementation would require a new follow-up dispatcher, new runtime state store, or route-enum redesign, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Shared contracts align on `imm-work` as the default continue entry for same-boundary review follow-up.
- Verification: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, and the affected review-followup specs all state that same-boundary repair re-enters through `imm-work`, while plan creation and append authority still belong to `imm-planner`.
- Test scenarios: Covers same-boundary review fix defaulting to `imm-work`; Covers planner authority remaining explicit; Covers `append_to_plan` versus `new_slice` wording staying distinct
- Depends on: none
- Scope: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `.imm/specs/review-followup-handoff.spec.md`, `.imm/specs/completed-plan-followup-append.spec.md`, new follow-up spec
- Replan condition: If contract alignment alone cannot explain how `imm-work` absorbs the handoff, stop and widen only enough to define the missing runtime truth.

### Step 2
- Step ID: U2
- Result: `imm-work` runtime/status truth can represent review follow-up re-entry without implying that planning authority moved out of `imm-planner`.
- Verification: targeted `tests/test_imm_work.py` coverage proves the relevant `next_action`, `continue_entry`, or status messaging points same-boundary review follow-up back through `imm-work` while still routing planning decisions to `imm-planner` when plan mutation is required.
- Test scenarios: Covers no-current-plan follow-up routing back into planner through `imm-work`; Covers append-eligible follow-up staying on `imm-work` as the outer continue entry; Covers planner fallback when same-boundary conditions are not met
- Depends on: 1
- Scope: `.imm/imm-work.py`, any adjacent runtime helper needed for status truth, `tests/test_imm_work.py`
- Replan condition: If runtime support requires new persistent workflow state or a general follow-up queue, stop and return to planner.

### Step 3
- Step ID: U3
- Result: README documents the new review-followup entry contract for same-boundary fixes.
- Verification: `README.md` explains that same-boundary review follow-up continues through `imm-work`, while PR blockers still continue through `imm-pr-fix`.
- Test scenarios: Covers README route table truth; Covers same-boundary review follow-up entry via `imm-work`; Covers PR blocker path staying separate
- Depends on: 1, 2
- Scope: `README.md`
- Replan condition: If docs/test closure reveals unresolved route terminology conflicts that materially change behavior, return to planner instead of silently broadening the slice.

### Step 4
- Step ID: U4
- Result: Focused regression suites guard the new review-followup entry contract.
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_imm_work` passes with direct assertions for same-boundary review follow-up entry through `imm-work`, planner authority retention, and the separate PR blocker path.
- Test scenarios: Covers same-boundary review follow-up entry via `imm-work`; Covers planner authority remaining explicit in runtime and contract output; Covers PR blocker path staying separate
- Depends on: 1, 2, 3
- Scope: `tests/test_skill_contracts.py`, `tests/test_imm_work.py`
- Replan condition: If focused tests require a broader route-enum redesign or new runtime persistence to pass, stop and return to planner.

## Notes
- 本次切片故意不处理 `direct_fix` 是否应改名为 `same_boundary_fix`；那是单独的 vocabulary cleanup，不是本轮入口收口的必要条件。
- 关键判断是“对外入口收口”与“内部 authority 保留”必须同时成立；只改文案不补 intake truth，或只改 runtime 不改 contract，都会留下新的歧义。
