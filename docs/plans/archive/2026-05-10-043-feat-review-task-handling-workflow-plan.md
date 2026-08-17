---
title: feat: define review task handling workflow
type: feat
status: planned
date: 2026-05-10
origin: user request to completely plan review task handling under imm-planner rather than only planning the same-boundary follow-up entry slice.
---

# Iteration Plan

## Task
- Summary: 完整规划 Immune-Brain 的 review 任务处理 workflow，统一 `rework`、same-boundary follow-up、`new_slice` 与 `pr_blocker` 的顶层 route matrix，并明确 `append_to_plan` 作为 same-boundary follow-up 内部 disposition 的 continue entry、authority role 与验证边界。
- Origin: 用户在 `imm-planner` 语义下明确要求“完整规划 review 任务处理”。当前 runtime 已同步到 `042`，但 `042` 只覆盖 same-boundary review follow-up 的 `imm-work` 入口收口，不能代表完整 review handling。因为当前 runtime 还没有 active step、也没有已完成 step，所以这次不是 `append_to_plan`，而是用一个新的更大 planning slice 替换当前窄计划。
- Research:
  - 已检查 `.imm/memory/current_iteration.json`、`IMMUNE.md`、`README.md`、`skills/imm-qa/SKILL.md`、`skills/imm-code-review/SKILL.md`、`skills/imm-ui-review/SKILL.md`、`skills/imm-planner/SKILL.md`、`skills/imm-work/SKILL.md`、`skills/imm-pr-fix/SKILL.md`、`.imm/specs/review-followup-handoff.spec.md`、`.imm/specs/completed-plan-followup-append.spec.md`、`.imm/specs/review-followup-imm-work-entry.spec.md`、`.imm/specs/pr-fix-remote-context.spec.md`、`.imm/specs/role-entrypoint-contract-repair.spec.md`、`.imm/specs/workflow-scenario-coverage.spec.md`、`.imm/imm-work.py`、`tests/test_skill_contracts.py` 与 `tests/test_imm_work.py`。
  - 确认现有 contract 已经覆盖 review handling 的局部能力：QA `rework/replan`、bounded `follow_up` handoff、planner consumption、completed-plan append、PR remote blocker repair。
  - 确认当前缺口是“完整 route matrix 缺少统一真源”，不是单点实现完全不存在。
- Decisions: D1 选择 `Hold Scope`，本轮只做完整规划，不进入实现；D2 用新的 planning slice 替换当前 `042` 作为 runtime 当前计划，因为 `042` 只是本次总问题里的一个子问题；D3 保持 `imm-planner` 的唯一 plan authority，不把“入口收口到 `imm-work`”误写成 authority merge； D4 把完整 review handling 拆成 route matrix、skill contract、runtime truth、README、focused regression 5 个可独立闭合结果； D5 保留现有 route enum，不在本轮引入 vocabulary rename。
- Assumptions:
  - 仓库现有 reviewer、planner、work、qa、pr-fix contract 已足够支撑一套完整 route matrix，不需要新增顶层 workflow stage。
  - 当前 `042` 产出的 same-boundary entry truth 仍然成立，只是会被吸收入更完整的总规划。
  - focused regression 未来可以同时使用 contract test 与 targeted runtime test 守住这套 matrix，无需新建全链路 harness。
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/*.spec.md`, `docs/plans/*.md`, `README.md`, `skills/imm-qa/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-pr-fix/SKILL.md`, `.imm/imm-work.py`, `tests/test_skill_contracts.py`, `tests/test_imm_work.py`
  - dependencies_known: true
  - verification_path:
      - target: complete review handling is represented as one coherent route matrix with explicit entries and authority boundaries
      - method: spec and plan inspection now; later contract text inspection plus focused runtime and regression coverage
  - blockers: none, as long as the slice remains a planning-only replacement for the narrower `042`
  - replan_condition: if complete review handling would require new workflow stages, route-enum redesign, or a generic background repair platform, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Route matrix definition exists.
- Verification: `.imm/specs/review-task-handling-workflow.spec.md` defines `current_step_rework`, `same_boundary_follow_up`, `new_slice`, and `pr_blocker` as top-level routes, and defines `append_to_plan` as a same-boundary internal disposition with explicit triggers, continue entries, authority roles, and guard boundaries.
- Test scenarios: Covers current-step closure failure; Covers same-boundary follow-up; Covers append disposition inside same-boundary follow-up; Covers broader follow-up slice; Covers PR blocker
- Depends on: none
- Scope: new review-task-handling spec
- Replan condition: If the five-route matrix cannot stay stable without first renaming all historical enums, stop and reduce scope to a vocabulary-prep slice.

### Step 2
- Step ID: U2
- Result: Skill contract alignment work is scoped.
- Verification: the plan explicitly maps which skill families must align to the route matrix: `imm-qa` and `imm-review` for `rework`, reviewer family for follow-up packet output, `imm-work` for default continue entry, `imm-planner` for plan authority, and `imm-pr-fix` for remote blockers.
- Test scenarios: Covers role-entrypoint separation; Covers reviewer-family follow-up wording; Covers PR blocker isolation
- Depends on: 1
- Scope: `skills/imm-qa/SKILL.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-pr-fix/SKILL.md`
- Replan condition: If skill alignment reveals hidden authority overlap that cannot be resolved contract-first, stop and re-open boundary review.

### Step 3
- Step ID: U3
- Result: Runtime intake truth is scoped.
- Verification: the plan explicitly names the runtime truth to validate later: `rework` must stay on the current step, same-boundary follow-up must re-enter through `imm-work`, planner mutation authority must remain explicit, and PR blockers must not silently flow through the same runtime path.
- Test scenarios: Covers current-step re-entry after `rework`; Covers no-current-plan review follow-up through `imm-work`; Covers planner fallback; Covers PR blocker isolation
- Depends on: 1, 2
- Scope: `.imm/imm-work.py`, any adjacent runtime helper needed for status or next-action truth, `tests/test_imm_work.py`
- Replan condition: If runtime truth needs new persistent workflow state or a follow-up queue, stop and return to planner before any implementation.

### Step 4
- Step ID: U4
- Result: README route table is scoped.
- Verification: the plan explicitly requires a user-visible README route table that distinguishes `rework`, same-boundary follow-up, `new_slice`, and `pr_blocker`, and separately explains when same-boundary follow-up can internally fall to `append_to_plan`.
- Test scenarios: Covers route table visibility; Covers default continue entry clarity; Covers PR blocker entry clarity
- Depends on: 1, 2, 3
- Scope: `README.md`
- Replan condition: If README closure would require redesigning the whole workflow chapter instead of adding a bounded route table, stop and split docs scope first.

### Step 5
- Step ID: U5
- Result: Focused regression coverage is scoped.
- Verification: the plan explicitly requires focused regression to guard the four top-level routes plus the `append_to_plan` internal disposition through `tests/test_skill_contracts.py` and targeted `tests/test_imm_work.py` coverage.
- Test scenarios: Covers `rework` loop; Covers same-boundary follow-up entry; Covers append disposition boundary; Covers new-slice planner fallback; Covers PR blocker separation
- Depends on: 1, 2, 3, 4
- Scope: `tests/test_skill_contracts.py`, `tests/test_imm_work.py`
- Replan condition: If regression proof requires a repo-wide harness rewrite, stop and keep the slice at focused contract and runtime assertions.

## Notes
- `042` 仍可视为本轮总规划里 “same-boundary follow-up continue entry” 的已明确子问题，但它不再代表完整 review handling 的 current plan。
- 这份计划是 planning replacement，不是 implementation continuation；真正落地时仍应从 `imm-work` 进入当前 validated plan 的执行闭环。
