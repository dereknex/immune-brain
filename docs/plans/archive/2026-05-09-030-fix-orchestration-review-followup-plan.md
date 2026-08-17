---
title: fix: close orchestration review follow-up
type: fix
status: planned
date: 2026-05-09
origin: imm-code-review follow-up for the completed workflow skill orchestration slice
---

# Iteration Plan

## Task
- Summary: Close the direct-fix review follow-up for the completed workflow skill orchestration slice by syncing durable memory and tightening the planner-focused contract assertion
- Origin: `imm-code-review` reviewed the completed orchestration slice and reported two actionable findings. `CR-001` said `MEMORY.md` still points to continuing U1 even though the 029 plan is already complete. `CR-002` said the new planner orchestration regression in `tests/test_skill_contracts.py` relies on overly broad substrings and may miss future contract drift.
- Research: Used the review packet plus the current workflow state from `.imm/memory/current_iteration.json`, the current `MEMORY.md` top summary, and the new orchestration-focused test block in `tests/test_skill_contracts.py`. Conclusion: both findings fit the existing repair boundary and do not require a new orchestration slice or plan-shape rewrite.
- Decisions: D1 keep `Hold Scope` and treat both findings as a bounded direct-fix follow-up; D2 update only durable planning memory and the focused planner assertion, not the broader orchestration docs or runtime state model; D3 preserve contract-level verification by reusing `python -m unittest tests.test_skill_contracts` instead of adding a new harness.
- Assumptions: The current workflow completion state in `.imm/memory/current_iteration.json` is the correct source of truth for the finished 029 slice; the planner contract wording is already good enough and only the test needs to become more specific.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/memory/MEMORY.md`, `tests/test_skill_contracts.py`, `.imm/specs/workflow-skill-orchestration-review-followup.spec.md`, `docs/plans/2026-05-09-030-fix-orchestration-review-followup-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: durable summary matches completed workflow state, and the planner orchestration assertion is specific enough to guard the intended rule while the focused contract suite still passes
      - method: manual comparison against `.imm/memory/current_iteration.json` plus `python -m unittest tests.test_skill_contracts`
  - blockers: none, as long as verification does not expose a broader truth conflict across README or skill contracts
  - replan_condition: if fixing either issue requires changing orchestration rules, altering workflow state structure, or widening beyond `MEMORY.md` plus the focused test file, stop and return to `imm-planner` for a broader follow-up slice

## Steps

### Step 1
- Step ID: U1
- Result: Durable planning memory reflects that the 029 orchestration plan is complete
- Verification: `.imm/memory/MEMORY.md` no longer tells the next session to continue from U1 and instead reflects the completed 029 plan plus the correct next boundary.
- Test scenarios: Covers CR-001 durable summary sync; Covers no stale "continue from U1" instruction
- Depends on: none
- Scope: `.imm/memory/MEMORY.md`
- Replan condition: If the right durable summary depends on changing workflow state structure rather than summary text, stop and replan.

### Step 2
- Step ID: U2
- Result: The planner-focused orchestration regression is tightened to meaningful rule-level assertions
- Verification: `tests/test_skill_contracts.py` checks more specific planner orchestration wording than generic substrings while staying aligned with the current planner contract.
- Test scenarios: Covers CR-002 stronger planner regression; Covers planner solo fallback when conditional reviewer triggers are absent
- Depends on: 1
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If the planner rule cannot be asserted specifically without changing the planner contract or introducing a new harness, stop and return to planning.

### Step 3
- Step ID: U3
- Result: Focused contract verification proves both review follow-up fixes without widening the slice
- Verification: `python -m unittest tests.test_skill_contracts` passes after the direct fixes.
- Test scenarios: Covers CR-001 verification by durable summary consistency check; Covers CR-002 verification by passing focused contract suite
- Depends on: 2
- Scope: `tests/test_skill_contracts.py` and the minimal command evidence needed for traceability
- Replan condition: If the focused contract suite now fails because of a broader orchestration truth conflict, stop and replan that wider issue separately.

## Notes
- This is a direct-fix review follow-up, not a new orchestration design pass.
- Keep the repair surgical: `MEMORY.md` for durable summary truth, `tests/test_skill_contracts.py` for stronger planner guard, and the existing focused suite for proof.
