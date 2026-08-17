---
title: "fix: preserve closures for same-plan metadata changes"
type: fix
status: proposed
date: 2026-05-25
---

# Iteration Plan

## Task
- Summary: Preserve completed State Ledger steps when the same plan receives planner-owned metadata-only updates that do not change executable step proof fields.
- Origin: `imm-code-review` found that the adversarial mechanisms plan was completed, then a `Devil's Advocate Audit` metadata addition changed the plan signature and reset U1/U2/U3 to pending.
- Spec: docs/specs/same-plan-metadata-preservation.spec.md
- Research: `.imm/imm_core/plan_runtime.py` already has append-safe preservation, but `resolve_append_safe_preservation` currently rejects same-length plans before checking whether completed step proof fields are unchanged. `tests/test_imm_plan.py` contains reset and append-preservation coverage.
- Decisions:
    - D1: Fix the runtime preservation rule rather than hand-editing `.imm/memory/current_iteration.json`.
    - D2: Preserve closed steps only when the completed prefix is unchanged against `validated_plan_snapshot`; keep reset behavior for true step mutations.
    - D3: Add a regression test for same-plan metadata-only signature changes, using a top-level audit-style field that changes the plan signature without changing Step `Result` or `Verification`.
- Assumptions:
    - The normalized plan signature intentionally includes top-level task metadata, so metadata-only additions can still produce signature changes.
    - Step proof equality remains the correct safety check for preserving closure.
- Scope Mode: One-step runtime contract repair
- Engineering Closure Check:
  - architecture_surface: `.imm/imm_core/plan_runtime.py`, `tests/test_imm_plan.py`
  - dependencies_known: yes
  - verification_path: targeted unit tests plus existing skill contract tests
  - blockers: none
  - replan_condition: If preservation cannot distinguish metadata-only changes from true step mutations without broad parser redesign.
- Devil's Advocate Audit:
  - rollback_resilience: The change is isolated to runtime sync logic and tests; rollback restores the prior reset behavior without touching skill text or historical plan content.
  - verification_vanity: A new regression test must fail on the current behavior by showing same-length metadata-only updates reset closed steps, then pass after the preservation rule changes.
  - spec_dilution_detection: The plan fixes the root runtime behavior instead of narrowing the review finding to a one-off state-file edit.

## Steps

### Step 1
- Step ID: U1
- Result: Same-plan metadata-only resync preserves closed State Ledger steps
- Verification type: automated
- Verification: `python3 -m unittest tests.test_imm_plan tests.test_imm_work tests.test_skill_contracts`
- Test scenarios: Add coverage where a same-path plan gains top-level audit metadata, completed step proof fields stay unchanged, and `sync_plan_to_runtime_state` preserves closed steps instead of recording `sync_plan_reset_completed_steps`; keep existing tests that reset closure on real step mutations passing.
- Discovery cache: .imm/imm_core/plan_runtime.py (runtime sync logic); tests/test_imm_plan.py (plan sync regression tests); tests/test_imm_work.py (status behavior)
- Agent Hint: imm-executor
- failure_behavior: If the safe-preservation proof is ambiguous, keep current reset behavior and return to planner with the ambiguous proof evidence.
- security_considerations: State preservation must not mask real changes to step results, verification paths, or dependency order.
- Depends on: none

## Notes
- Validate this plan before execution, then continue through `imm-work`.
