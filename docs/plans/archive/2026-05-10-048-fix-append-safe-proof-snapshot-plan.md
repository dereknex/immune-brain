---
title: fix: add proof snapshot for append-safe sync
type: fix
status: planned
date: 2026-05-10
origin: `047` stopped at U2 because runtime could not prove append-safe same-path preservation without an old validated plan prefix snapshot
---

# Iteration Plan

## Task
- Summary: Add a minimal validated plan proof snapshot so same-path append-safe sync can preserve completion state only when old closure is actually provable
- Origin: While executing `docs/plans/2026-05-10-047-fix-same-path-append-completion-reset-plan.md`, `imm-autowork` completed `U1` and then stopped before `U2` because `.imm/imm-plan.py` currently persists only `plan_path`, `plan_summary`, and `plan_signature`. After a same-path planner edit, runtime has no old normalized step prefix to compare against the new plan, so append-safe preservation cannot be implemented truthfully under `047`'s current assumptions.
- Research:
  - Checked `.imm/specs/same-path-append-completion-preservation.spec.md`, `.imm/specs/plan-sync-enforcement-followup.spec.md`, `.imm/imm-plan.py`, `.imm/current_iteration_state.py`, `tests/test_imm_plan.py`, `tests/test_imm_work.py`, and current runtime status for `047`.
  - Confirmed `047` remains the current runtime plan and `U1` is legitimately closed, so revising `047` in place would trigger another same-path signature reset and discard the newly closed step.
  - Confirmed no existing runtime field stores the old validated step prefix needed to prove append-safe continuation; current disk state only exposes the new plan file plus scalar metadata.
- Decisions: D1 choose `Hold Scope` and create a new follow-up slice instead of rewriting `047` in place; D2 allow one minimal persisted runtime field for proof-only use; D3 keep reset-by-default semantics and permit preserve only when the stored snapshot proves identical completed prefix plus tail append; D4 leave planner/reviewer contracts, reopen flows, and multi-version history out of scope.
- Assumptions:
  - A minimal `validated_plan_snapshot` in current runtime state is enough to support truthful append-safe comparison.
  - Storing the minimal closure-relevant step fields is materially narrower than introducing a new state store or full plan versioning system.
  - Missing snapshot on older states should safely degrade to reset rather than require backfill migration.
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/append-safe-proof-snapshot.spec.md`, `.imm/imm-plan.py`, `.imm/current_iteration_state.py`, `tests/test_imm_plan.py`, `tests/test_imm_work.py`
  - dependencies_known: true
  - verification_path:
      - target: validated sync writes a proof snapshot, same-path append-safe preserve only fires when the snapshot proves identical completed prefix, and missing proof still resets
      - method: focused unit/runtime regression plus direct inspection of synced current-iteration state
  - blockers: none, as long as the slice stays on a single minimal runtime field rather than expanding into history migration or version archives
  - replan_condition: if truthful append-safe proof requires a second state store, historical backfill, cross-plan version stitching, or reopening previously closed steps, stop and return to `imm-preplan-review`

## Steps

### Step 1
- Step ID: U1
- Result: A source-of-truth spec defines the minimal proof snapshot required for append-safe same-path sync
- Verification: `.imm/specs/append-safe-proof-snapshot.spec.md` defines the snapshot shape, ownership boundary, degrade-to-reset rule when proof is missing, and the exact connection between the snapshot and append-safe preservation
- Test scenarios: Covers snapshot-written-on-validate; Covers missing-snapshot-reset; Covers append-safe proof source remains narrow
- Depends on: none
- Scope: `.imm/specs/append-safe-proof-snapshot.spec.md`
- Replan condition: If the proof source cannot stay minimal and starts implying broader plan version management, stop and return to planner.

### Step 2
- Step ID: U2
- Result: Runtime sync has a minimal validated plan snapshot gate for append-safe decisions
- Verification: `.imm/imm-plan.py` and `.imm/current_iteration_state.py` persist the minimal snapshot during successful sync, use it to compare the completed prefix during same-path signature changes, preserve completion only when the snapshot proves append-safe continuation, and reset when proof is missing or mismatched
- Test scenarios: Covers validated sync writing snapshot; Covers same-path append-safe preserve with snapshot; Covers missing or mismatched snapshot resetting truthfully
- Depends on: 1
- Scope: `.imm/imm-plan.py`, `.imm/current_iteration_state.py`, and only minimal adjacent helpers
- Replan condition: If implementation requires a second persistence surface or broader migration behavior, stop and return to planner.

### Step 3
- Step ID: U3
- Result: Focused regression proves append-safe continuation depends on the stored snapshot
- Verification: `tests/test_imm_plan.py` and `tests/test_imm_work.py` cover the `046`-style same-path append flow with snapshot-backed proof, verify the next action continues to the appended step, and verify missing proof still resets instead of silently preserving
- Test scenarios: Covers safe append continuation after prior validated snapshot; Covers no-snapshot fallback reset; Covers prefix drift reset despite same path
- Depends on: 2
- Scope: `tests/test_imm_plan.py`, `tests/test_imm_work.py`
- Replan condition: If truthful coverage requires broad harness redesign beyond focused runtime tests, keep the slice narrow and return to planner.

## Notes
- `047` is not being amended in place because same-path revalidation would retrigger the very reset bug under repair and erase its newly closed `U1`.
- The purpose of `048` is to supply the missing proof source that `047` implicitly needed, not to reopen planner contract design.
