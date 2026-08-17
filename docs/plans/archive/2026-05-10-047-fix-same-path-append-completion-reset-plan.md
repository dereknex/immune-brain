---
title: fix: preserve completion on append-safe same-path sync
type: fix
status: planned
date: 2026-05-10
origin: autowork on the appended `046` plan exposed that same-path append resets completed steps and sends imm-work back to Step 1 instead of the newly appended repair step
---

# Iteration Plan

## Task
- Summary: Repair runtime sync so append-safe same-path plan updates preserve existing completed-step history and let `imm-work` continue from the first newly appended step
- Origin: After `imm-code-review` findings were appended onto the still-current completed plan `docs/plans/2026-05-10-046-refactor-composable-workflow-contract-plan.md`, `imm-autowork` stopped because runtime sync recorded `sync_plan_reset_completed_steps` with reason `Plan signature changed; reset completion state.` and `imm-work status` routed back to `U1` instead of `U7`. This disproves append legality for the current runtime and requires a new narrow runtime slice rather than another append to `046`.
- Research:
  - Read `.imm/specs/completed-plan-followup-append.spec.md`, `docs/plans/2026-05-09-031-feat-completed-plan-followup-append-plan.md`, `README.md`, `.imm/imm-plan.py`, `.imm/imm-work.py`, and `.imm/memory/current_iteration.json`.
  - Confirmed the repo-facing contract already promises same-plan append continuation, but `.imm/imm-plan.py` currently clears `completed_steps` whenever `same_plan` and `signature_changed` are both true.
  - Confirmed the actual runtime history on May 10, 2026 includes `sync_plan_reset_completed_steps` for the appended `046` plan and then advertises `U1` as the next action, which is the concrete blocker to continuing `U7/U8`.
- Decisions: D1 choose `Hold Scope` and treat this as a new runtime repair slice, not another append to `046`, because the current runtime has already invalidated the old completion proof; D2 fix only append-safe same-path preservation, not broader reopen/history recovery; D3 preserve `completed_steps` only when the old completed step prefix is still semantically identical in the new plan, while continuing to clear `active_step`; D4 guard the fix with focused runtime regression plus any minimal contract assertions needed for traceability, without widening into planner or reviewer redesign.
- Assumptions:
  - Append-safe legality can be proven from normalized old/new plan prefix comparison without adding new persistent fields.
  - Clearing `active_step` on same-path signature change remains the safe default even when completed-step preservation is allowed.
  - The immediate user value is restoring correct continuation from appended repair steps, not solving every future history-reconciliation scenario.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/same-path-append-completion-preservation.spec.md`, `.imm/imm-plan.py`, `.imm/imm-work.py`, `tests/test_imm_work.py`, and only minimal adjacent assertions if needed
  - dependencies_known: true
  - verification_path:
      - target: append-safe same-path sync preserves completion history and routes `imm-work` to the first appended step, while unsafe same-path changes still reset closure
      - method: focused runtime regression plus direct inspection of current-iteration history/output
  - blockers: none, as long as the slice stays on runtime sync semantics rather than reopening planner/reviewer contract design
  - replan_condition: if safe preservation cannot be proven without new runtime state fields, historical closure migration, or broader append redesign, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: A source-of-truth spec defines append-safe same-path completion preservation
- Verification: `.imm/specs/same-path-append-completion-preservation.spec.md` defines when same-path signature changes may preserve `completed_steps`, when they must still reset, and how `imm-work` should resume from appended steps
- Test scenarios: Covers append-safe same-path sync; Covers unsafe same-path change reset; Covers no historical reopen
- Depends on: none
- Scope: `.imm/specs/same-path-append-completion-preservation.spec.md`
- Replan condition: If the preservation rule cannot stay narrow to append-safe same-path sync and starts implying broader closure migration, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Runtime sync preserves completion history only for append-safe same-path updates
- Verification: `.imm/imm-plan.py` distinguishes append-safe same-path signature changes from unsafe same-path changes, preserves `completed_steps` only for the safe case, keeps `active_step` reset behavior explicit, and records the preservation/reset reason in history
- Test scenarios: Covers append-safe signature change preserving completed steps; Covers non-append-safe signature change resetting completed steps; Covers history reason staying explicit
- Depends on: 1
- Scope: `.imm/imm-plan.py` and any adjacent helper needed for plan-prefix comparison
- Replan condition: If implementing the preservation rule requires new persisted state or content migration for old closures, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Focused runtime regression proves `imm-work` resumes from appended steps after append-safe sync
- Verification: `tests/test_imm_work.py` reproduces a completed current plan extended with appended follow-up steps, proves completion history is preserved, and proves the next action points to the appended step rather than Step 1; the focused runtime suite passes
- Test scenarios: Covers `046`-style append-safe continuation; Covers `done` no longer appearing after safe append; Covers unsafe same-path reset still remaining possible
- Depends on: 2
- Scope: `tests/test_imm_work.py` and only minimal verification helpers
- Replan condition: If truthful regression requires broader harness work or contract rewrites outside focused runtime tests, keep the slice narrow and return to planner.

## Notes
- This slice exists because the current runtime already disproved same-plan append legality for `046`; the safe move is a new validated slice, not another append on top of broken completion state.
- The intended payoff is to make the previously promised completed-plan append path actually executable in runtime, so future appended repair steps can continue through `imm-work` without re-running old completed steps.
