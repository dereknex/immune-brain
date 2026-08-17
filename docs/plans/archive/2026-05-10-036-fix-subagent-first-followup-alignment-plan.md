---
title: fix: align subagent-first follow-up coverage
type: fix
status: planned
date: 2026-05-10
origin: follow-up plan after code review found residual README summary drift and missing spec-source regression coverage in the completed 033 slice
---

# Iteration Plan

## Task
- Summary: Close the residual follow-up from the subagent-first contract rollout by aligning the README entry summary and adding focused regression coverage for the shared spec sources of truth.
- Origin: After `033` completed, `imm-code-review` found two residual issues that still fit the same high-level product boundary: the README entry template still underspecifies the new default route, and `tests/test_skill_contracts.py` does not directly guard the shared spec sources of truth. Because `.imm/memory/current_iteration.json` no longer keeps `033` as the current runtime plan, this follow-up cannot safely use `append_to_plan`; it needs a new narrow slice.
- Research: Re-checked `IMMUNE.md`, `.imm/memory/current_iteration.json`, `docs/plans/2026-05-10-033-fix-default-subagent-first-activation-plan.md`, `.imm/specs/default-subagent-first-activation.spec.md`, `README.md`, and `tests/test_skill_contracts.py`. Conclusion: the implementation mostly matches `033`, but the top-level README template still routes broad review through `imm-code-review` without surfacing the new entry-level split summary, and the focused test file still lacks direct assertions on the two shared spec files updated in `U1`.
- Decisions: D1 choose `Hold Scope` and keep this as a tiny follow-up slice entirely inside the existing subagent-first contract boundary; D2 route as `new_slice` instead of `append_to_plan` because the current runtime state no longer points to `033`; D3 split the work into one user-visible summary alignment step and one regression-coverage step so each outcome closes independently; D4 keep verification contract-level via `python3 -m unittest tests.test_skill_contracts`.
- Assumptions: The desired outcome is to close the residual contract drift, not to reopen runtime-state ownership or broader workflow orchestration; current README and test changes are sufficient to absorb the findings without touching more surfaces.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `README.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: README entry summary and focused regression both reflect the shared subagent-first truth directly
      - method: targeted file inspection plus `python3 -m unittest tests.test_skill_contracts`
  - blockers: none, as long as the slice stays on summary wording and regression coverage
  - replan_condition: if closing the findings requires runtime-state repair, broader README restructuring, or new spec/runtime automation coverage, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: The README entry template explicitly exposes the shared `subagent-first` default route.
- Verification: `README.md` states, in the direct-trigger template section, that clearly decomposable review/advisory work defaults to bounded subagents before the existing reviewer-specific routing details.
- Test scenarios: Covers README entry-summary alignment; Covers continue-entry preservation
- Depends on: none
- Scope: `README.md`
- Replan condition: If the wording cannot be aligned without rewriting unrelated README sections or changing the workflow chain, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Focused regression directly guards the shared spec sources of truth for the `subagent-first` policy.
- Verification: `tests/test_skill_contracts.py` directly asserts the relevant truth in `.imm/specs/workflow-skill-subagent-orchestration.spec.md` and `.imm/specs/skill-trigger-template-routing.spec.md`, and `python3 -m unittest tests.test_skill_contracts` passes.
- Test scenarios: Covers spec-source truth; Covers explicit solo fallback; Covers focused suite pass
- Depends on: 1
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If truthful coverage requires runtime orchestration tests or a broader harness rewrite, keep this follow-up contract-level and replan broader verification support separately.

## Notes
- This slice is intentionally narrower than `033`: it closes the review-discovered drift without reopening the full shared contract rollout.
- The key planner judgment is that the fix belongs to the same conceptual area as `033`, but current runtime state prevents safe in-place append, so a fresh narrow slice is safer.
