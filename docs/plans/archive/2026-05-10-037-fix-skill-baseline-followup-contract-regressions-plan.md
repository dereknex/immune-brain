---
title: fix: repair skill baseline follow-up contract regressions
type: fix
status: planned
date: 2026-05-10
origin: `imm-code-review` on the current skill-baselining worktree found three direct-fix regressions: reviewer artifact route drift, `imm-work` arbitration truth drift, and broken shared baseline links.
---

# Iteration Plan

## Task
- Summary: Repair the review-found contract regressions from the recent skill baseline refactor and add focused regression guards so the shared truth stays mechanically enforced.
- Origin: The latest `imm-code-review` produced three actionable findings that fit a narrow follow-up repair boundary: reviewer artifacts mention `append_to_plan` but their schema omits it, `imm-work` dropped `security` from the reviewer-conflict priority and no longer says to route unresolved conflicts back to planner, and the new shared baseline links point at `../skills/BASELINE.md` instead of the real repo-local path. Because `.imm/memory/current_iteration.json` currently has no active runtime plan, this follow-up should be a new one-step slice rather than an `append_to_plan`.
- Research:
  - Read `IMMUNE.md`, `.imm/memory/current_iteration.json`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/BASELINE.md`, `README.md`, and `tests/test_skill_contracts.py`.
  - Confirmed the current shared truth still lives in README/specs/tests: reviewer follow-up routing includes `append_to_plan`, conflict arbitration should be `security > performance > compatibility > readability`, unresolved conflicts should return to planner, and the real baseline file is `skills/BASELINE.md`.
  - Verified the focused suites currently pass despite the regressions, so this slice must include direct contract-test coverage instead of relying only on wording repair.
- Decisions: D1 choose `Hold Scope` and keep this as a one-step repair slice because the outcome is one coherent contract-alignment closure; D2 treat it as `new_slice`, not `append_to_plan`, because the runtime plan state is empty and no historical completed plan is still current; D3 keep verification focused on `tests/test_skill_contracts.py` plus direct file-path truth, without widening into runtime orchestration tests; D4 include both wording repair and focused guard coverage in the same closure target so the follow-up does not leave the same drift surface unprotected.
- Assumptions:
  - The affected regressions are still inside the same overall skill-contract boundary and do not require new planner-level scope design.
  - The repair can remain doc/contract-test local without touching `.imm` runtime tooling.
  - The batch of broken `BASELINE.md` links should be fixed uniformly rather than via one-off exceptions per skill.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `skills/*/SKILL.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: reviewer artifact schemas, `imm-work` arbitration contract, and baseline references all match shared truth
      - method: targeted file inspection plus `python3 -m unittest tests.test_skill_contracts`
  - blockers: none, as long as the slice stays contract-level
  - replan_condition: if closing the findings requires runtime behavior changes, broader README/spec rewrites, or a new shared reviewer framework, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: Shared skill-contract truth is restored for the baseline follow-up slice.
- Verification: `imm-code-review`, `imm-ui-review`, and `imm-work` all express the same shared routing/arbitration truth; affected skills link to `skills/BASELINE.md`; and `python3 -m unittest tests.test_skill_contracts` passes with direct assertions for these contracts.
- Test scenarios: Covers reviewer artifact `append_to_plan` route; Covers `imm-work` security-first arbitration and planner fallback; Covers repo-local baseline link path; Covers focused suite pass
- Depends on: none
- Scope: `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-work/SKILL.md`, affected baseline-linked `skills/*/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If the fix can no longer stay contract-level and requires runtime orchestration or broader workflow redesign, stop and return to planner with the newly discovered boundary.

## Notes
- This is intentionally a one-step plan: the user-verifiable outcome is a single contract-alignment closure with regression guards, not a sequence of independent product outcomes.
- The key planner judgment is that the repair is direct and narrow, but because there is no current runtime plan to append to, the safe path is a fresh validated slice.
