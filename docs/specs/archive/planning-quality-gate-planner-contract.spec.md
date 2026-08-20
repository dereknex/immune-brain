# Spec: Planning Quality Gate Planner Contract

## Goal

Wire the Planning Quality Gate into `imm-planner` so elevated-risk plans consistently check design readiness before execution.

This is the first implementation slice after the documentation-only quality gate. It keeps the gate advisory and planner-owned: the planner should apply it when risk signals are present, while small low-risk tasks continue through the normal concise planning flow.

## Accepted Behavior

- A reusable `docs/reference/planning-quality-gate.md` checklist exists for planner-facing guidance.
- `imm-planner` references that checklist when a task includes elevated-risk signals:
  - runtime state or State Ledger behavior
  - migration or compatibility behavior
  - cross-host or compiled skill contract changes
  - reviewer or subagent contract changes
  - rollback-sensitive workflow changes
- The planner contract requires elevated-risk plans to address:
  - contract surface
  - compatibility
  - interruption recovery
  - rollback path
  - verification strength
  - Brainstorm traceability
- The planner contract states that the gate is not global ceremony and does not replace `IMMUNE.md`, `imm-plan.py`, or `imm-preplan-review`.
- Contract tests prevent future drift where the planner forgets the quality gate or turns it into a mandatory workflow for all plans.

## Non-Goals

- Do not add automatic validator enforcement in this slice.
- Do not edit `.imm/imm_core/plan_runtime.py`.
- Do not make `imm-preplan-review` mandatory.
- Do not require every plan to cite the quality gate.

## Verification

- `python3 -m unittest tests.test_skill_contracts` passes.
- `python3 .imm/imm-plan.py docs/plans/2026-05-26-010-feat-planning-quality-gate-planner-contract-plan.md --json` passes.
