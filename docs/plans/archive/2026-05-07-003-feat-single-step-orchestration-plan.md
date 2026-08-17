---
title: feat: smooth single-step orchestration
type: feat
status: planned
date: 2026-05-07
origin: user brainstorm and preplan handoff on 2026-05-07
---

# Iteration Plan

## Task
- Summary: Make imm-work the smooth single-step orchestration entry after planning
- Origin: User feedback on 2026-05-07: after planning, each step currently requires explicit work, executor, and qa handoffs, which makes the flow correct but fragmented.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/immune-brain-requirements.md`, `.imm/specs/plan-work-review-rewrite.spec.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `.imm/imm-work.py`, `.imm/imm-review.py`, and README workflow docs. Conclusion: role boundaries are already clear; the gap is the missing single-step orchestration contract and next-action state.
- Decisions: D1 keep `imm-work`, `imm-executor`, and `imm-qa` as separate authority boundaries; D2 make `imm-work` the default continue entry after a validated plan; D3 limit automatic orchestration to the current step and report the next step instead of running the full plan; D4 expose machine-readable next action so evidence handoff is less dependent on manual narration.
- Assumptions: Existing `current_iteration.json` shape is enough for a first next-action report; executor evidence can remain in the assistant response for this slice; no migration of historical plans is required.

## Steps

### Step 1
- Step ID: U1
- Result: 单步编排契约统一
- Verification: `skills/imm-work/SKILL.md` and README both describe `imm-work` as the plan-after continue entry for one current step, while preserving executor-only edits, qa-only closure, and no default full-plan autowork.
- Test scenarios: Covers IMM-WORKFLOW-002 AC1; Covers IMM-WORKFLOW-002 AC2; Covers IMM-WORKFLOW-002 AC6
- Depends on: none

### Step 2
- Step ID: U2
- Result: 下一动作状态可查询
- Verification: `.imm/imm-work.py` can report a normalized next action from current iteration state for no active step, active step, needs rework, replan required, and completed plan cases.
- Test scenarios: Covers IMM-WORKFLOW-002 AC3; Covers IMM-WORKFLOW-002 AC4; Covers IMM-WORKFLOW-002 AC5
- Depends on: 1

## Notes
- Do not merge `imm-work`, `imm-executor`, and `imm-qa` into one authority role.
- Do not implement full-plan autowork in this slice.
- If next-action detection needs plan parsing beyond current state, keep the first version conservative and report the missing plan context as a blocker.
