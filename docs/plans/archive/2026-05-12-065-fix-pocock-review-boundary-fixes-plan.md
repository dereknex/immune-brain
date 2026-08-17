---
title: "fix: Pocock review boundary alignment fixes"
type: fix
status: active
date: 2026-05-12
origin: code review of pocock-inspired-improvements identifying three authority/boundary misalignments in skill text
---

# Iteration Plan

## Task
- Summary: Fix three authority boundary misalignments found during code review of the Pocock-inspired improvements — brainstorm CONTEXT.md lazy-creation vs read-only boundary plus imm-work HANDOFF.md write vs coordinator boundary plus planner advisory annotation clarification
- Origin: imm-code-review of pocock-inspired-improvements iteration identifying P1 brainstorm write violation plus P2 imm-work boundary gap plus P1 annotation parse awareness
- Research: brainstorm Boundary says read-only but CONTEXT.md Awareness rule says create lazily; imm-work Boundary allows only validation/activation/inspection but HANDOFF.md Update rule adds repo-file mutation; planner Verification Type Annotation and Prototype Step describe plan fields not in imm-plan.py FIELD_RE
- Decisions: D1 remove lazy-creation from brainstorm and delegate CONTEXT.md writes to planner; D2 add HANDOFF.md to imm-work Allowed boundary; D3 add advisory-only clarification to planner annotation text rather than modifying Python tooling
- Assumptions: All changes are skill text only; no Python tooling modifications; contract tests remain stable
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: brainstorm CONTEXT.md rule no longer contains lazy-creation language; imm-work Boundary Allowed includes HANDOFF.md; planner annotation rules clarify advisory-only reading from raw plan text; contract tests pass
      - method: `python3 -m unittest tests.test_skill_contracts`
  - blockers: none
  - replan_condition: none expected for text-only boundary fixes

## Steps

### Step 1
- Step ID: U1
- Result: Three authority boundary misalignments are resolved in brainstorm plus imm-work plus planner skill text so that each skill's workflow rules stay consistent with its declared boundary
- Verification: `skills/imm-brainstorm/SKILL.md` CONTEXT.md Awareness rule does not contain "create it lazily"; `skills/imm-work/SKILL.md` Boundary Allowed section includes HANDOFF.md; `skills/imm-planner/SKILL.md` Verification Type Annotation or Prototype Step text contains "advisory" or "raw plan text"; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers brainstorm no lazy-creation text; Covers imm-work boundary includes HANDOFF.md; Covers planner advisory annotation text; Covers no regression on existing 89 contract tests
- Depends on: none
- Scope: `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`

## Notes
- Single-step fix plan; all three are text-only boundary alignment changes
- Fast-track eligible (one step with automated verification)
