---
title: feat: review follow-up handoff
type: feat
status: planned
date: 2026-05-09
origin: user asked to design the implementation slice that turns review-stage need-fix output into a planner-ready follow-up handoff instead of forcing manual translation after review
---

# Iteration Plan

## Task
- Summary: Add a bounded review follow-up handoff contract so `imm-code-review` and `imm-ui-review` can emit plan-ready repair packets, and `imm-planner` can consume them to create the smallest valid follow-up plan without reopening scope from scratch.
- Origin: The current review flow already distinguishes `fix` versus `replan`, but after a review the user still has to manually translate findings into a new planning ask. The requested change is to make review output itself carry the minimum follow-up framing needed for a fast one-step or small multi-step plan while preserving the existing plan/work/qa authority chain.
- Research: Reviewed `IMMUNE.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`, `.imm/specs/workflow-friction-retrospective-followup.spec.md`, `.imm/specs/workflow-friction-review-followup.spec.md`, and existing review-followup plans under `docs/plans/`. Conclusion: the repo already guards repair-vs-replan routing, but it does not yet define a reusable follow-up packet that captures route, minimal scope, success target, and verification hints for planner consumption.
- Decisions: D1 create a dedicated review-followup spec instead of folding more ad hoc wording into the existing friction specs; D2 keep follow-up handoff advisory and planner-consumable, not auto-executable; D3 cover `imm-code-review` first and align `imm-ui-review` in the same slice so reviewer-family routing stays consistent; D4 preserve the small-fix fast path as a validated one-step plan rather than bypassing plan creation.
- Assumptions: existing skill-contract tests are the right guardrail for this slice; the planner can consume review-origin handoffs through documented `Origin` / `Research` / `Decisions` / `Assumptions` mapping without needing new workflow state; README wording can stay concise while still making the route obvious.
- Scope Mode: Selective Expansion
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/review-followup-handoff.spec.md`, `skills/imm-code-review/SKILL.md`, `skills/imm-ui-review/SKILL.md`, `skills/imm-planner/SKILL.md`, `README.md`, `tests/test_skill_contracts.py`, and `docs/plans/2026-05-09-027-feat-review-followup-handoff-plan.md`
  - dependencies_known: true
  - verification_path:
      - target: review skills expose a consistent follow-up packet contract, planner docs say how to consume it, and focused tests plus README guard the new route
      - method: `python3 -m unittest tests.test_skill_contracts`
  - blockers: none
  - replan_condition: if landing the handoff requires automatic plan-file generation inside review, new runtime state, a shared reviewer orchestration framework, or bypassing the validated-plan requirement for small fixes, stop and return to `imm-preplan-review` / `imm-planner` as a broader workflow redesign

## Steps

### Step 1
- Step ID: U1
- Result: A source-of-truth spec defines the bounded review follow-up handoff contract.
- Verification: `.imm/specs/review-followup-handoff.spec.md` states `direct_fix` vs `new_slice` routing, required follow-up packet fields, planner consumption rules, reviewer-family alignment expectations, and no auto-plan / auto-fix expansion.
- Test scenarios: Covers single-boundary fix staying eligible for one-step planning; Covers structural findings requiring a new slice; Covers planner ingestion preserving the validated-plan requirement
- Depends on: none
- Scope: `.imm/specs/review-followup-handoff.spec.md`
- Replan condition: If the contract cannot stay review/advisory-only and starts requiring runtime mutations or auto-generated plan artifacts, stop and return to planner.

### Step 2
- Step ID: U2
- Result: `imm-code-review` exposes a plan-ready `follow_up` packet for repair versus replan routing.
- Verification: `skills/imm-code-review/SKILL.md` documents the `follow_up` packet, direct-fix versus new-slice route, minimum scope fields, and the user-facing distinction between “fix in current boundary” and “new follow-up slice”.
- Test scenarios: Covers review result surfacing plan-ready handoff metadata; Covers direct-fix versus new-slice wording; Covers one-step plan fast path staying explicit for small fixes
- Depends on: 1
- Scope: `skills/imm-code-review/SKILL.md`
- Replan condition: If the handoff wording reveals a deeper mismatch between review ownership and planner authority that cannot be fixed without changing workflow roles, stop and return to planner.

### Step 3
- Step ID: U3
- Result: `imm-planner` explicitly documents how review-origin follow-up handoffs map into plan fields.
- Verification: `skills/imm-planner/SKILL.md` states how `origin_review`, route judgment, scope hints, and verification hints are carried into `Origin` / `Research` / `Decisions` / `Assumptions` while preserving the validated-plan requirement.
- Test scenarios: Covers planner-origin traceability from review; Covers one-step plan creation from a small direct-fix handoff; Covers no bypass of validated plan creation
- Depends on: 2
- Scope: `skills/imm-planner/SKILL.md`
- Replan condition: If planner consumption requires new workflow state or hidden plan generation inside review, stop and return to planner.

### Step 4
- Step ID: U4
- Result: `imm-ui-review` aligns to the same bounded follow-up handoff semantics as `imm-code-review`.
- Verification: `skills/imm-ui-review/SKILL.md` exposes the same review-followup route language for `needs_fix` / `replan`, including the minimum handoff fields and the distinction between direct repair and a new slice.
- Test scenarios: Covers `imm-ui-review` follow-up routing parity; Covers reviewer-family wording consistency; Covers no expansion into a shared reviewer platform
- Depends on: 3
- Scope: `skills/imm-ui-review/SKILL.md`
- Replan condition: If reviewer-family consistency starts requiring a generalized reviewer framework or broad runtime host refactor, stop and return to planner.

### Step 5
- Step ID: U5
- Result: README documents the user-facing review-to-follow-up route.
- Verification: `README.md` explains that review emits a bounded follow-up handoff, planner turns that handoff into a validated plan, and execution still continues through `imm-work` / `imm-executor` rather than directly from review.
- Test scenarios: Covers review-to-planner wording; Covers small-fix one-step-plan route; Covers no direct execution from review
- Depends on: 4
- Scope: `README.md`
- Replan condition: If the route cannot be explained concisely without changing workflow authority or adding new entrypoints, stop and return to planner.

### Step 6
- Step ID: U6
- Result: Focused contract tests guard the new review-followup handoff.
- Verification: `python3 -m unittest tests.test_skill_contracts` passes with assertions covering `imm-code-review`, `imm-ui-review`, `imm-planner`, and README wording for the new follow-up packet contract.
- Test scenarios: Covers `imm-code-review` contract regressions; Covers `imm-ui-review` parity; Covers planner-consumption wording; Covers README route wording
- Depends on: 5
- Scope: `tests/test_skill_contracts.py`
- Replan condition: If guarding the route requires broader runtime integration tests or a repo-wide contract harness redesign, stop and return to planner.

## Notes
- This slice intentionally improves follow-up handoff quality, not workflow automation depth.
- The implementation should stop after contract/docs/tests closure; actual post-review code changes still belong to `imm-work` / `imm-executor` with `imm-qa` closure.
