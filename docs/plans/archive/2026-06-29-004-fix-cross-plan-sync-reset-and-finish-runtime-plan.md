---
title: "fix: cross-plan sync resets stale completion state and finish runtime is implemented"
type: fix
status: proposed
date: 2026-06-29
origin: imm-loop diagnosed stale runtime state during the pi code agent support plan (003)
---

# Iteration Plan

## Task

- Summary: Stop cross-plan plan sync from inheriting the previous plan's completed-step state, and implement the `imm-finish` (plus no-op-safe `imm-dehydrate`) runtime so completed plans reset to idle instead of leaking stale state.
- Spec: docs/specs/archive/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime.spec.md
- Origin: During plan 003, `imm-autowork` falsely reported `complete` because plan 002's four closed steps survived into plan 003's sync (Step 1 inherited old `U1` body and `closed` state) while `package.json` was never created. Root cause: cross-plan sync preserves completion prefix unconditionally, and `imm-finish`/`imm-dehydrate` are registered but unimplemented in the TS runtime. Direct planner entry from a diagnosed incident; no brainstorm manifest applies.
- Research: `runPlanCommand` (`immune_brain_runtime.ts:255-289`) computes `completedPrefixNumbers(getCompletedSteps(previous))` and spreads `{...old}` for any prefix number regardless of `same_plan`. `runImmCommand` (`immune_brain_runtime.ts:418-426`) has branches for only 6 commands; `imm-finish` and `imm-dehydrate` fall through to `Command not yet implemented`. Plan 047 covered `same_plan: true` append preservation only. `docs/solutions/canonical-runtime-state-paths.md` defines the intended finish/dehydrate idle+`intentional_reset` semantics. TS tests have no `imm-finish`/`same_plan`/`intentional_reset` coverage.
- Decisions: D1 Cross-plan (`same_plan: false`) sync must zero completion state; same-plan append preservation stays untouched. D2 Implement `imm-finish` as the idle-reset closure; `imm-dehydrate` as a no-op-safe shim for this slice (persist without error), deferring JSONL archive. D3 `imm-autowork` needs no code change — fixing R1+R2 removes its false-positive input. D4 Capture the cross-plan reset contract as a durable Learning.
- Assumptions: `normalizeCurrentIteration` already tolerates a missing `reset_reason`; adding the field on finish is additive and non-breaking. Existing `same_plan` equality is `previous.plan_path === normalized.plan_path`.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the defect is localized to two functions in one runtime file plus tests.

## Output Language

- Human-readable prose: English for new Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Devil's Advocate Audit

1. **Rollback Resilience**: The fix touches one sync branch and adds two command branches. If a step fails midway, reverting `immune_brain_runtime.ts` and deleting the new tests restores prior behavior; no state migration is involved because `reset_reason`/`runtime_status` already exist.
2. **Verification Vanity**: A test that only asserts `"pending"` appears would be vanity. Verification must prove the negative: a cross-plan sync after a fully-closed prior plan yields zero `closed` steps, empty `completed_steps`, and `imm-autowork` not `complete` — while a same-plan sync still preserves the prefix.
3. **Spec Dilution Detection**: R2 finish and R3 dehydrate could be split, but dehydrate is only needed to stop the `not yet implemented` error in the finish/dehydrate pair; implementing it as a no-op-safe shim keeps the closure path intact without diluting the finish contract. R4 needs no code (proof-by-construction) but must be asserted by test to guard the false-positive regression.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`runPlanCommand` sync branch, `runImmCommand` dispatch), `plugins/immune-brain/runtime/imm_core.ts` (no schema change; reuse `reset_reason`/`runtime_status`), `plugins/immune-brain/dist` mirrored runtime copy.
- compatibility: Same-plan append preservation (`same_plan: true`) is unchanged. `imm-finish`/`imm-dehydrate` go from erroring to working; no existing caller breaks.
- interruption recovery: If execution stops, rerunning the focused TS tests plus `imm-plan --json` identifies which branch remains old.
- rollback path: Revert `immune_brain_runtime.ts`, its dist mirror, and the new tests as one slice.
- verification strength: Focused TS unit + CLI regression tests asserting cross-plan reset, same-plan preservation, finish idle+`intentional_reset`, and the false-completion guard.
- Brainstorm traceability: No brainstorm manifest; origin is the imm-loop recorded blocker.

## Steps

### Step 1

- Step ID: U1
- Result: Cross-plan sync zeros stale completion state
- Verification type: automated
- Verification: `bun test tests/cross-plan-sync-reset.test.ts` passes, asserting: (a) after syncing a new plan (`same_plan: false`) over a fully-closed prior plan, every new-plan step is `pending` with the new-plan body (not the old `U1`), `completed_steps` is empty, `active_step` is null; (b) after a same-plan sync (`same_plan: true`) the completed prefix stays `closed` with old body preserved.
- Execution note: test-first
- Test scenarios: Covers cross-plan all-pending reset; Covers cross-plan body not inherited from old U1; Covers same-plan append-safe preservation regression; Covers `completed_steps` emptied on cross-plan.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (runPlanCommand sync branch); plugins/immune-brain/runtime/imm_core.ts (completedPrefixNumbers, getCompletedSteps); tests/runtime-state.test.ts (state machine test style); tests/plugin-package-runtime.test.ts (CLI spawnSync test style)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If preserving same-plan append safety requires new state fields, stop and return to planner because that violates the Non-goals.
- security_considerations: The sync branch must not copy arbitrary old step `execution_evidence` or `notes` into a new plan step, since that could leak prior-run file paths or context into a different plan boundary.

### Step 2

- Step ID: U2
- Result: Finish with dehydrate runtime commands implemented in TS runtime
- Verification type: automated
- Verification: `bun test tests/finish-dehydrate-runtime.test.ts` passes, asserting: (a) `imm-finish` on an all-closed plan sets `runtime_status: idle`, `reset_reason: intentional_reset`, clears `active_step`, preserves step history and `validated_plan_snapshot`, and records a `finish_reset` history entry; (b) `imm-dehydrate` returns success (exit 0) without error and persists `current_iteration.json`; (c) neither command returns `Command not yet implemented`.
- Execution note: test-first
- Test scenarios: Covers finish idle+intentional_reset; Covers finish preserves history and snapshot; Covers dehydrate no-op-safe success; Covers no not-yet-implemented fallthrough.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (runImmCommand dispatch, IMM_COMMANDS set); plugins/immune-brain/runtime/imm_core.ts (normalizeCurrentIteration, reset_reason/runtime_status fields); docs/solutions/canonical-runtime-state-paths.md (intended finish/dehydrate semantics)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If finish requires durable memory (`state.json`/`MEMORY.md`) writes or JSONL archive to be correct, narrow to the idle-reset closure and defer durable memory to a later slice per Non-goals.
- security_considerations: `imm-finish` must not delete or rewrite `validated_plan_snapshot`; it only resets active-runtime markers.

### Step 3

- Step ID: U3
- Result: False-completion guard holds after cross-plan sync
- Verification type: automated
- Verification: `bun test tests/cross-plan-sync-reset.test.ts` and `bun test tests/autowork-false-completion.test.ts` pass, asserting that after a cross-plan sync of an all-pending plan, `imm-autowork` does not report `stop_reason: complete` and `next_recommended_skill` is not `imm-compounder`; it reports `awaiting_execution_input` (or equivalent non-complete boundary).
- Test scenarios: Covers autowork not complete on fresh cross-plan plan; Covers autowork does not hand off to compounder prematurely.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (runAutoworkCommand); tests/plugin-package-runtime.test.ts (autowork CLI test style)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If `imm-autowork` still reports complete with all steps pending, the false-positive source is in `buildStatus` next-step resolution; return to planner rather than patching autowork heuristics.
- security_considerations: None beyond ensuring unexecuted work is not silently reported done.

### Step 4

- Step ID: U4
- Result: Cross-plan reset contract is captured as a durable Learning
- Verification type: manual
- Verification: `docs/solutions/cross-plan-sync-reset-contract.md` exists with reusability tags, states the `same_plan: false` reset rule, the `imm-finish` idle+`intentional_reset` closure, and the false-completion guard, and references the focused tests.
- Test scenarios: Covers Learning describes cross-plan reset; Covers Learning references finish closure; Covers Learning points to regression tests.
- Discovery cache: docs/solutions/canonical-runtime-state-paths.md (existing solution style); docs/plans/2026-05-10-047-fix-same-path-append-completion-reset-plan.md (prior same-plan fix for contrast)
- Agent Hint: imm-executor
- Depends on: 3
- failure_behavior: If the Learning would imply a new mandatory runtime field, keep it to existing `reset_reason`/`runtime_status` per Non-goals.
- security_considerations: None.

## Validation

- Plan validator: `./plugins/immune-brain/bin/imm-plan docs/plans/2026-06-29-004-fix-cross-plan-sync-reset-and-finish-runtime-plan.md --json`
- Runtime sync: MCP `imm_plan_validate(sync=true)`
