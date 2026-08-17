---
title: "fix: cross-plan sync resets stale completion state and finish runtime is implemented"
type: fix
status: proposed
date: 2026-06-29
origin: imm-loop diagnosed stale runtime state during the pi code agent support plan (003)
---

# Spec: Cross-Plan Sync Reset and Finish Runtime

## Goal

Guarantee that switching to a different plan (`same_plan: false`) never inherits the
previous plan's completed-step state, and that the `imm-finish` closure command is
actually implemented in the TypeScript runtime so completed plans reset to idle
instead of leaking stale state into the next plan.

## Problem

Two defects surfaced together when the pi code agent support plan (003) was synced
right after the Python reference retirement plan (002) had passed all four steps:

1. **Cross-plan sync inherits stale completion state.** `runPlanCommand` computes
   `completedPrefixNumbers(getCompletedSteps(previous))` and marks any new-plan step
   whose number falls in that prefix as `closed`, spreading the old plan's step
   body into the new step via `{ ...old }`. Because `imm-finish` never ran, plan 002
   kept all four steps `closed` in `current_iteration.json`. Syncing plan 003 (a
   single-step, `same_plan: false` plan) then marked its Step 1 as `closed` with the
   old `U1` result and evidence. `imm-autowork` read that as `complete` and reported
   the work done — a false positive — while `package.json` and `.pi/settings.json`
   had never been created.

2. **`imm-finish` is unimplemented.** `imm-finish` (and `imm-dehydrate`) are
   registered in `IMM_COMMANDS`, but `runImmCommand` has no branch for either, so
   they fall through to `Command not yet implemented in TypeScript runtime`. With
   no finish path, completed plans never reset to `runtime_status: idle` with
   `reset_reason: intentional_reset`, so stale closed steps accumulate across plans.

The previous same-path append fix (plan 047) only governs `same_plan: true`
append continuation; it does not cover the `same_plan: false` cross-plan case, so
this regression is unguarded.

## Accepted Behavior

### R1. Cross-plan sync must reset completion state

When `imm-plan --sync` switches to a plan whose path differs from the previous
plan (`same_plan: false`), no step in the new plan may inherit the previous plan's
`closed` state, `completed_steps` membership, or old step body. Every new-plan
step starts as `pending`; `completed_steps` is cleared; `active_step` is cleared;
`runtime_status` becomes `idle`.

Existing same-plan (`same_plan: true`) append-safe preservation behavior is
unchanged: a step whose number matches a previously completed prefix stays
`closed` with its old body preserved.

### R2. `imm-finish` resets completed plans to idle

`imm-finish` (invoked after all plan steps are closed and reviews pass) sets
`runtime_status` to `idle` and `reset_reason` to `intentional_reset`, clears
`active_step`, and preserves the completed step history for audit. It must not
mutate step results or erase `validated_plan_snapshot`. It records a
`finish_reset` history entry. The `intentional_reset` marker prevents accidental
replay of the completed iteration.

### R3. `imm-dehydrate` is a no-op-safe compaction shim

`imm-dehydrate` must at minimum not error. It may compact `history` to a bounded
tail and archive overflow to `current_iteration_history.jsonl`. For this slice the
minimal acceptable behavior is: persist the current `current_iteration.json`
without error and report success, so the finish/dehydrate pair stops producing
`Command not yet implemented`.

### R4. `imm-autowork` does not report false completion

After R1 and R2, `imm-autowork` must never report `stop_reason: complete` for a
plan whose steps have not actually been executed. A freshly synced cross-plan
plan with all steps `pending` must not surface as `complete`.

### R5. Distilled contract is durable

The `same_plan: false` reset rule and the `imm-finish` reset semantics are
captured in a `docs/solutions/` Learning so future plans do not re-litigate the
cross-plan boundary.

## Acceptance Criteria

- [ ] `imm-plan --sync` with `same_plan: false` produces new-plan steps all in `pending` state with new-plan bodies; `completed_steps` is empty; `active_step` is null.
- [ ] `imm-plan --sync` with `same_plan: true` still preserves the completed prefix (regression guard).
- [ ] `imm-finish` sets `runtime_status: idle`, `reset_reason: intentional_reset`, clears `active_step`, preserves step history, and records a `finish_reset` history entry.
- [ ] `imm-finish` and `imm-dehydrate` no longer return `Command not yet implemented`.
- [ ] `imm-autowork` after a cross-plan sync of an all-pending plan does not report `complete`.
- [ ] Focused TS regression tests cover cross-plan reset, same-plan preservation, finish reset, and the false-completion guard.
- [ ] A `docs/solutions/` Learning records the cross-plan reset contract.

## Non-goals

- No new mandatory runtime state fields beyond existing `reset_reason`/`runtime_status`.
- No durable memory (`state.json`/`MEMORY.md`) write or JSONL archive implementation in `imm-finish`; `imm-dehydrate` compaction may stay a no-op-safe shim for this slice.
- No planner or reviewer contract redesign.
- No reopening of historical closure records.
- No migration of already-completed plans' state.
