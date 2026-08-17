---
title: fix: harden review follow-up authority gate
type: fix
status: planned
date: 2026-05-10
origin: user request under imm-planner to turn this session's review -> follow-up -> resolution friction into a narrow workflow-hardening slice.
---

# Iteration Plan

## Task
- Summary: 收紧 review follow-up 的 authority chain，把 `append_to_plan` 的判定从 reviewer 输出移回 planner / planning validation，并在 planning 阶段增加 route-layer drift guard。
- Origin: 本轮 session 先完成 `043` 的完整 review task handling workflow 规划，再用 `044` 修复 follow-up alignment。后续 retrospective 发现当前主要摩擦不再是能力缺口，而是 reviewer 过早触碰 append 判定，以及 planning 阶段缺少 route-layer lint。当前 runtime 上一个 plan `044` 已完成，因此这次不是 `append_to_plan`，而是新的 workflow-hardening slice。
- Research:
  - 已检查 `docs/plans/2026-05-10-043-feat-review-task-handling-workflow-plan.md`、`docs/plans/2026-05-10-044-fix-review-task-handling-followup-alignment-plan.md`、`.imm/specs/review-followup-handoff.spec.md`、`.imm/specs/completed-plan-followup-append.spec.md`、`.imm/specs/review-task-handling-workflow.spec.md`、`skills/imm-code-review/SKILL.md`、`skills/imm-ui-review/SKILL.md`、`skills/imm-planner/SKILL.md`、`README.md`、`.imm/imm-plan.py`、`tests/test_skill_contracts.py` 与 `tests/test_imm_plan.py`。
  - 确认当前 reviewer contract 仍把 `append_to_plan` 暴露为 output route，而 append legality 实际依赖 planner / runtime truth。
  - 确认 `.imm/imm-plan.py` 当前 same-path signature change 仍会 reset `completed_steps`；本轮只把它视为 append gate 的约束，不修机制本身。
  - 确认 route-layer 混层是在 `043` 完成后才被 review 抓到，说明 planning 阶段需要更早的 guard。
- Decisions: D1 选择 `Hold Scope`，只修 authority gate 与 route-layer validation；D2 保留历史 `direct_fix` enum，不扩大成全量 vocabulary rename；D3 明确 `append_to_plan` 只属于 planner-owned internal disposition，不再作为 reviewer-facing route 输出；D4 append eligibility 若无法被统一 gate 证明，默认落回 `new_slice`；D5 focused regression 以 skill contract 与 planning validation 为主，不改 `imm-work` / `imm-pr-fix` runtime path。
- Assumptions:
  - reviewer 当前已有的 same-boundary handoff 信息足够支撑 planner 侧 append eligibility gate，无需新建 findings registry。
  - planning 阶段的 route-layer guard 可以通过 contract lint、focused tests 或 `imm-plan` 相邻验证完成，无需引入新的 parser platform。
  - `043/044` 的 review handling 总体方向成立，本轮只硬化 authority timing，不推翻整体 workflow。
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/review-followup-handoff.spec.md`, `.imm/specs/completed-plan-followup-append.spec.md`, `.imm/specs/review-task-handling-workflow.spec.md`, `.imm/specs/review-followup-authority-gate.spec.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `README.md`, `.imm/imm-plan.py`, `tests/test_skill_contracts.py`, `tests/test_imm_plan.py`
  - dependencies_known: true
  - verification_path:
      - target: reviewer no longer makes planner-only append decisions, append eligibility is planner/validation-owned, and route-layer drift is blocked before execution
      - method: spec/skill/README contract inspection plus focused regression and planning validation coverage
  - blockers: none, as long as the slice avoids runtime reset redesign and enum-wide renaming
  - replan_condition: if authority hardening requires changing `imm-work` runtime flow, redesigning all historical review enums, or implementing append-state persistence, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Authority split contract exists.
- Verification: `.imm/specs/review-followup-authority-gate.spec.md` and the updated review workflow spec state that reviewer outputs same-boundary follow-up guidance without directly deciding `append_to_plan`, while planner / planning validation own the append eligibility decision.
- Test scenarios: Covers same-boundary follow-up remaining reviewer-visible; Covers reviewer not exposing planner-only append; Covers no historical enum rename requirement
- Depends on: none
- Scope: `.imm/specs/review-followup-authority-gate.spec.md`, `.imm/specs/review-followup-handoff.spec.md`, `.imm/specs/review-task-handling-workflow.spec.md`
- Replan condition: If the authority split cannot be expressed without renaming `direct_fix` everywhere, stop and reduce scope to a vocabulary-prep slice.

### Step 2
- Step ID: U2
- Result: Planner-owned append eligibility gate is scoped.
- Verification: the plan explicitly maps append eligibility judgment to `skills/imm-planner/SKILL.md`, `.imm/imm-plan.py`, and adjacent docs/tests, including the rule that any unprovable append must fall back to `new_slice`.
- Test scenarios: Covers current runtime plan eligibility; Covers completed-but-current append candidate; Covers append defaulting to new_slice when runtime proof is missing
- Depends on: 1
- Scope: `skills/imm-planner/SKILL.md`, `.imm/imm-plan.py`, `tests/test_imm_plan.py`, `.imm/specs/completed-plan-followup-append.spec.md`
- Replan condition: If gating append safely requires redesigning runtime completion persistence, stop and split runtime redesign from contract hardening.

### Step 3
- Step ID: U3
- Result: Route-layer validation coverage is scoped.
- Verification: the plan explicitly requires planning-stage lint or focused regression that catches `append_to_plan` being presented as a top-level route, or reviewer/planner/README wording disagreeing on the route hierarchy.
- Test scenarios: Covers mixed top-level route vs internal disposition drift; Covers reviewer contract exposing planner-only append; Covers README/spec/skill hierarchy alignment
- Depends on: 1, 2
- Scope: `tests/test_skill_contracts.py`, `README.md`, `.imm/specs/review-task-handling-workflow.spec.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`
- Replan condition: If route-layer validation needs a repo-wide documentation linter platform, stop and keep this slice at focused contract regression.

### Step 4
- Step ID: U4
- Result: Documentation alignment work is scoped.
- Verification: the plan explicitly requires README and adjacent review-follow-up docs to explain that same-boundary follow-up remains the user-facing route, while `append_to_plan` is a planner-only internal disposition decided after eligibility checks.
- Test scenarios: Covers README user routing clarity; Covers append ownership clarity; Covers new-slice fallback clarity
- Depends on: 1, 2, 3
- Scope: `README.md`, `.imm/specs/review-followup-handoff.spec.md`, `.imm/specs/completed-plan-followup-append.spec.md`
- Replan condition: If docs alignment expands into a full README workflow rewrite, stop and split the docs slice first.

## Notes
- 本轮不修 `.imm/imm-plan.py` 的 same-path signature reset；它只作为 “为什么 reviewer 不该先拍 append 决定” 的约束事实存在。
- 这份计划的目标是把 append legality 从 review judgement 里剥离出来，不是否定 completed-plan append 这条窄能力本身。
