---
title: feat: plan workflow scenario coverage
type: feat
status: planned
date: 2026-05-08
origin: user selected scenarios 1-9 after imm-party and imm-preplan-review workflow analysis on 2026-05-08
---

# Iteration Plan

## Task
- Summary: Plan one workflow ergonomics slice that covers user-confirmed scenarios 1-9 without adding new top-level stages or weakening plan/QA boundaries.
- Origin: User first requested a multi-role analysis of the current workflow, then asked for a preplan boundary review, then explicitly requested that planning should cover scenarios 1-9: onboarding, normal single-step execution, interrupted sessions, long-running multi-step progress, light bugfixes, ambiguous tasks, review/rework loops, evidence-poor tasks, and malformed plans.
- Research: Checked `IMMUNE.md`, `README.md`, `skills/imm-work/SKILL.md`, `skills/imm-preplan-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-autowork/SKILL.md`, `skills/imm-compounder/SKILL.md`, `.imm/specs/session-flow-output-simplification.spec.md`, `.imm/specs/current-step-driver.spec.md`, `.imm/specs/role-entrypoint-contract-repair.spec.md`, and solution docs for single-step orchestration, role-entrypoint separation, output split, workflow trigger contracts, and workflow health gate alignment. Conclusion: the main gap is scenario coverage and contract cohesion, not missing stages.
- Decisions: D1 keep `imm-work` as the default continue entry; D2 preserve `imm-executor` and `imm-qa` as authority boundaries, not default shell commands; D3 accept the user-selected expansion from the narrower preplan slice to scenarios 1-9, but keep maintainers-only scenarios 10-14 out of scope; D4 group the nine scenarios into four independently closable outcome steps instead of nine micro-steps; D5 preserve strong QA and planning gates even for fast paths.
- Assumptions: Existing skill contracts, `README.md`, `.imm/imm-work.py`, and focused tests are the main edit surfaces; the current state model can expose a resume block and progress summary without requiring a new runtime state source; any hotfix path can remain a scoped contract within existing stages rather than a new workflow stage.
- Scope Mode: Selective Expansion

## Steps

### Step 1
- Step ID: U1
- Result: 默认入口与进度可见性覆盖 1/2/4 场景
- Verification: `README.md`、`skills/imm-work/SKILL.md` 与必要的状态输出/测试说明共同证明新用户 onboarding、普通单步执行、长周期多步任务都能看到统一默认入口、当前 step/plan 摘要、下一边界与阻塞原因。
- Test scenarios: Covers IMM-WORKFLOW-UX-003 R1; Covers IMM-WORKFLOW-UX-003 acceptance criteria 1; Covers IMM-WORKFLOW-UX-003 acceptance criteria 6
- Scope: `README.md`，`skills/imm-work/SKILL.md`，必要时 `.imm/imm-work.py` 与 focused tests / fixtures
- Depends on: none
- Replan_condition: 若该结果要求新增顶层 stage、额外 CLI 默认入口或新的状态源，回到 planner 重新收窄。

### Step 2
- Step ID: U2
- Result: 轻量 bugfix 与模糊需求路由覆盖 5/6 场景
- Verification: `imm-preplan-review`、`imm-planner`、`imm-work` 相关契约与文档明确：hotfix 走最小闭环而不绕过 plan/QA；模糊任务先经过最小 framing gate，再决定进入 brainstorm 或 planning。
- Test scenarios: Covers IMM-WORKFLOW-UX-003 R2; Covers IMM-WORKFLOW-UX-003 acceptance criteria 2; Covers IMM-WORKFLOW-UX-003 acceptance criteria 3
- Scope: `skills/imm-preplan-review/SKILL.md`，`skills/imm-planner/SKILL.md`，`skills/imm-work/SKILL.md`，必要时 `README.md` 与 contract tests
- Depends on: none
- Replan_condition: 若 hotfix 路径必须引入新的 role、后台自动化或直接跳过 validated plan，说明该切片边界错误，应退回重拆。

### Step 3
- Step ID: U3
- Result: 中断恢复与返工回路覆盖 3/7 场景
- Verification: 当前 active step 的 resume block 与 `rework` 回路在 skill contract、状态输出或 focused tests 中有明确证据，且都只回到当前 step，不重讲整条 planning 流程。
- Test scenarios: Covers IMM-WORKFLOW-UX-003 R3; Covers IMM-WORKFLOW-UX-003 acceptance criteria 4; Covers IMM-WORKFLOW-UX-003 acceptance criteria 6
- Scope: `skills/imm-work/SKILL.md`，`skills/imm-qa/SKILL.md`，必要时 `.imm/imm-work.py`、workflow loop tests、README 对应说明
- Depends on: 1
- Replan_condition: 若恢复或返工必须依赖跨 step 自动推进、历史 plan 重写或新的 runtime file，回到 planner 拆为独立恢复治理切片。

### Step 4
- Step ID: U4
- Result: 证据不足与畸形计划守卫覆盖 8/9 场景
- Verification: `imm-preplan-review`、`imm-planner`、`imm-qa` 和相关 tests / fixtures 证明证据不足任务不会被闭环，畸形计划会被结构性退回，并输出缺失证据或 replan 路由而不是乐观继续。
- Test scenarios: Covers IMM-WORKFLOW-UX-003 R4; Covers IMM-WORKFLOW-UX-003 R5; Covers IMM-WORKFLOW-UX-003 acceptance criteria 5; Covers IMM-WORKFLOW-UX-003 acceptance criteria 6
- Scope: `skills/imm-preplan-review/SKILL.md`，`skills/imm-planner/SKILL.md`，`skills/imm-qa/SKILL.md`，必要时 `.imm/imm-review.py`、focused contract tests、README 相关边界说明
- Depends on: 2, 3
- Replan_condition: 若该结果需要放松 QA 证据标准、把 planner 变成运行时修复器、或引入跨场景 telemetry / registry，说明范围扩张过度，应回到 planner。

## Notes
- 该计划只覆盖用户确认的 1-9 场景，不把 10-14 场景偷偷并入。
- 每个 step 必须以“一个可观察 contract 结果”闭环，而不是以“补几段文档/代码”闭环。
- 若执行阶段发现 1/2/4 与 3/7 必须共享同一实现才能验证，可在执行前回到 planner 合并步骤；不要在 executor 中临时吞并范围。
