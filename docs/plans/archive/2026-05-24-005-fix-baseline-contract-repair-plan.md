---
title: "fix(baseline): restore contract sections"
type: fix
status: proposed
date: 2026-05-24
origin: imm-autowork stopped because gstack P1 U3 full skill contract verification exposed existing BASELINE.md contract failures
---

# Iteration Plan

## Task
- Summary: Restore the shared `skills/BASELINE.md` sections required by existing contract tests.
- Origin: `docs/plans/2026-05-24-004-feat-gstack-borrow-p1-adoption-plan.md` U3 added and passed focused gstack drift guards, but `python3 -m unittest tests.test_skill_contracts` failed on existing `skills/BASELINE.md` expectations for Success Criteria, Collaboration Posture, Hub skill anatomy, and Shallow Discovery.
- Spec: docs/specs/archive/baseline-contract-repair.spec.md
- Research: `tests/test_skill_contracts.py` already requires exact section phrases in `skills/BASELINE.md`. `docs/solutions/outcome-first-rule-framing-and-collaboration-posture.md` records the intended Success Criteria and Collaboration Posture pattern. `docs/solutions/addy-upstream-contrast-and-hub-anatomy-pattern.md` records the hub Skill anatomy contract. `docs/solutions/contracts.md` records the Shallow Discovery pattern. Current `skills/BASELINE.md` is a short bullet list and does not satisfy those existing guards.
- Decisions:
    - D1: Use a new one-step repair slice rather than appending to the gstack P1 Plan, because the failing surface is shared baseline contract drift.
    - D2: Repair `skills/BASELINE.md` wording only; do not weaken `tests/test_skill_contracts.py`.
    - D3: Keep the baseline concise and additive so existing short guards remain intact.
    - D4: Do not update generated/plugin dist skill outputs in this slice.
- Assumptions:
    - The existing contract tests are the accepted source of truth for this repair.
    - `skills/BASELINE.md` is the only implementation file needed for the failing contract surface.
    - After this Plan closes, the previous gstack P1 Plan can be resumed to close its U3 verification.
- Scope Mode: one-step repair
- Engineering Closure Check:
  - architecture_surface: skills/BASELINE.md, tests/test_skill_contracts.py
  - dependencies_known: yes; existing unittest assertions define the behavior
  - verification_path: `python3 -m unittest tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-24-005-fix-baseline-contract-repair-plan.md --json`
  - blockers: If full tests fail outside `skills/BASELINE.md`, stop and route that separate failure explicitly.
  - replan_condition: If satisfying the tests requires changing hub Skill files, generated dist outputs, install tooling, or weakening existing tests.

## Steps

### Step 1
- Step ID: U1
- Result: BASELINE.md satisfies existing contract guards
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-05-24-005-fix-baseline-contract-repair-plan.md --json`
- Test scenarios: Confirm BASELINE contains Success Criteria with ready/closable wording, Collaboration Posture with When to ask / When to proceed, Hub skill anatomy naming the four hub Skills and Rationalizations / Red Flags, and Shallow Discovery with symbol/signature scans plus targeted line ranges.
- Discovery cache: skills/BASELINE.md (repair target); tests/test_skill_contracts.py (contract source); docs/solutions/outcome-first-rule-framing-and-collaboration-posture.md (success criteria and collaboration posture pattern); docs/solutions/addy-upstream-contrast-and-hub-anatomy-pattern.md (hub anatomy pattern); docs/solutions/contracts.md (shallow discovery pattern)
- Execution note: test-first
- failure_behavior: If tests still fail on unrelated contracts, record the unrelated failures and stop rather than expanding this slice.
- security_considerations: Baseline wording must not grant implementation, advisory, or QA authority beyond existing role boundaries.
- Depends on: none

## Notes
- This Plan intentionally does not edit `docs/reference/gstack-borrow-p1-guidance.md`.
- The gstack P1 Plan remains the upstream blocked context; return to its U3 after this repair passes.
