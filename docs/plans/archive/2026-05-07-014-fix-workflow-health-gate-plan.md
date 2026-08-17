---
title: fix: repair workflow health gate
type: fix
status: planned
date: 2026-05-07
origin: user continued from imm-brainstorm and imm-preplan-review on 2026-05-07 to create the next Immune-Brain plan for the workflow health gate leftovers
---

# Iteration Plan

## Task
- Summary: Repair the workflow health gate leftovers in Immune-Brain
- Origin: User asked to continue the Immune-Brain workflow after `imm-brainstorm` and `imm-preplan-review`. The handoff narrowed scope to two concrete leftovers from the latest runtime summary: stale QA evidence failures in `tests.test_workflow_loop` and `imm-heal` skill inventory drift against the actual `skills/` directory.
- Research: Checked `IMMUNE.md`, `docs/brainstorms/imm-brainstorm-output-2026-05-07.md`, `.imm/memory/state.json`, `.imm/memory/MEMORY.md`, `tests/test_workflow_loop.py`, `.imm/imm-review.py`, `.imm/imm-heal.py`, and the current `skills/*/SKILL.md` set. Conclusion: the remaining work is not a new workflow feature; it is a health-gate alignment slice with a small edit surface and a plausible focused-test path.
- Decisions: D1 choose `Scope Reduction` and keep the slice limited to heal inventory drift plus QA gate regression alignment; D2 treat `imm-review.py` as the source of truth for pass semantics unless focused inspection proves a real contract bug; D3 require explicit regression evidence for both leftovers before claiming closure; D4 defer any unrelated workflow-loop failures rather than expanding this plan into broad test cleanup.
- Assumptions: `test_heal_required_skills_match_repo_skills` is expected to fail because the current `REQUIRED_SKILLS` list is stale; the workflow-loop failure is likely fixture drift against `ready_for_review`, `execution_evidence`, and `artifacts` requirements rather than a new runtime design problem; focused unittest coverage is enough to validate this slice without external dependencies.
- Scope Mode: Scope Reduction
- Engineering Closure Check: Edit surfaces are identifiable in `.imm/imm-heal.py`, `tests/test_workflow_loop.py`, and only secondarily `.imm/imm-review.py` if a real contract bug appears. Verification is plausible through focused unittest runs and the local `imm-plan` validator. Replan if implementation reveals a broader review-state redesign, dynamic plugin discovery requirements, or unrelated failing tests that are required to prove these outcomes.

## Steps

### Step 1
- Step ID: U1
- Result: heal skill inventory reflects repo skills
- Verification: `.imm/imm-heal.py` and focused tests prove the checked skill set matches the current `skills/*/SKILL.md` inventory without omitting installed `imm-*` skills.
- Test scenarios: Covers IMM-WORKFLOW-007 R1; Covers IMM-WORKFLOW-007 acceptance criteria 1
- Depends on: none

### Step 2
- Step ID: U2
- Result: workflow loop pass fixture matches QA gate
- Verification: `tests/test_workflow_loop.py` exercises a pass path that satisfies the current `imm-review.py` contract for `ready_for_review`, `execution_evidence`, and traced-step artifacts where required.
- Test scenarios: Covers IMM-WORKFLOW-007 R2; Covers IMM-WORKFLOW-007 acceptance criteria 2
- Depends on: none

### Step 3
- Step ID: U3
- Result: focused regression coverage proves closure
- Verification: Local regression evidence shows the heal inventory check and the QA-gated workflow loop path both pass without pulling unrelated stale failures into scope.
- Test scenarios: Covers IMM-WORKFLOW-007 R3; Covers IMM-WORKFLOW-007 acceptance criteria 3; Covers IMM-WORKFLOW-007 acceptance criteria 4
- Depends on: 1, 2

## Notes
- Keep the implementation surgical. Do not expand into general test cleanup, workflow redesign, or a new registry for skills.
- If Step 2 reveals that `imm-review.py` itself is wrong, record that as a scoped contract fix inside this plan; if it requires wider state-machine changes, stop and replan.
- Preserve unrelated failures as deferred context instead of hiding them inside this slice.
