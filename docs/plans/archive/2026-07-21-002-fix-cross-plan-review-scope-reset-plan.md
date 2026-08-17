---
title: "fix: scope review evidence to the current Plan"
type: fix
status: proposed
date: 2026-07-21
origin: imm-code-review findings P2 and P3 after maintenance-surface simplification
spec: docs/specs/2026-07-21-cross-plan-review-scope-reset.spec.md
---

# Iteration Plan

## Task

- Summary: Prevent prior Plan follow-up evidence and reviewer passes from contaminating a new Plan, then repair the canonical L2S Spec reference.
- Spec: `docs/specs/2026-07-21-cross-plan-review-scope-reset.spec.md`
- Origin: `imm-code-review` found 12 prior-Plan paths inside the completed maintenance Plan's 17-file review signature and found one nonexistent canonical L2S evidence path.
- Scope Mode: New two-Step repair slice. Runtime review-state compatibility is isolated from the one-line documentation repair.
- Planner research dispatch: planner ensemble used because the repair spans persisted State Ledger behavior and durable documentation. Fast, mid, strong, and preplan reviewers agreed on a marker-based boundary, cross-Plan review-state reset, same-Plan preservation, full history retention, and an independent docs Step.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- Preserved literals: `Plan`, `Step`, `State Ledger`, `follow_up_history`, `review_state`, `review_follow_up_start_index`, paths, commands, and code identifiers.

## Review Finding Trace

| Finding | Severity | Status | Target | Evidence |
|---|---|---|---|---|
| CR-P2 | P2 | covered_by_step | U1 | Current Plan Steps produced 5 files, but the persisted review pass covered 17; 12 paths came from prior closed follow-ups. Cross-Plan sync also preserved the old signature pass. |
| CR-P3 | P3 | covered_by_step | U2 | `docs/solutions/workflow.md` references missing `.imm/specs/l2s-workflow-pattern.spec.md`; the tracked Spec is under `docs/specs/`. |

## Research

- `plugins/immune-brain/runtime/state_ledger.ts::collectReviewChangedFiles` includes every closed Step and every closed follow-up in the full history.
- `plugins/immune-brain/runtime/immune_brain_runtime.ts::runPlanCommand` uses normalized Plan path equality for `same_plan`, resets Step completion on a different path, but spreads previous follow-up and review state.
- Existing `tests/cross-plan-sync-reset.test.ts` proves prior Step completion does not leak across Plans but does not cover `follow_up_history` or `review_state`.
- Existing `tests/imm-follow-up-runtime.test.ts` proves current same-Plan closed follow-up files extend the review signature and invalidate stale passes.
- Existing State Ledger normalization preserves unknown optional fields, so one optional integer marker does not require a schema-version migration.
- The current completed Ledger directly proves the defect: 17 reviewed files versus 5 current Step files, with no git diff for the other 12.
- The canonical L2S solution contains the required workflow guidance and compatibility pointer, but one evidence path targets a missing `.imm/specs/` file.

## Advisory Synthesis

- Agreement: preserve complete audit history; do not attach Plan IDs to every historical follow-up or add a migration framework.
- Agreement: cross-Plan sync must update the marker and clear all review gates in the same State Ledger commit; same-Plan sync must preserve both.
- Agreement: the documentation path fix is an independent Step.
- Disagreement: one candidate preferred clamping invalid markers while the strong reviewer required fail-closed behavior.
- Planner decision: explicit invalid markers fail closed because clamping an oversized value could exclude current follow-up evidence and permit review bypass. Missing legacy fields alone default to `0`.
- Strong-model blocker promoted to verification: a new Plan that changes the same paths as a previous Plan must still require a fresh review pass.

## Decisions

- D1: Add optional `review_follow_up_start_index` rather than modifying every FollowUp record or deleting history.
- D2: Use the existing normalized Plan path comparison as the cross-Plan identity boundary.
- D3: Set the marker to the pre-sync history length and reset `review_state` only on `same_plan: false`.
- D4: Preserve the marker and review passes on `same_plan: true`.
- D5: Reject invalid explicit marker values instead of silently clamping them.
- D6: Accept one legacy over-inclusive review for this repair Plan; no in-place State Ledger migration is added. The next cross-Plan sync establishes the marker.
- D7: Fix only the confirmed canonical L2S reference and leave historical evidence untouched.

## Assumptions

- `follow_up_history` array order is append-only under current runtime behavior.
- The existing optimistic `commitStateMutation` path makes marker and review-state reset atomic with Plan sync.
- Older readers preserve unknown State Ledger fields because normalization copies unrecognized keys.
- Changing `tests/cross-plan-sync-reset.test.ts` guarantees this repair Plan's final changed-file signature differs from the currently persisted pass, preventing the rollout exception from skipping review.

## Devil's Advocate Audit

1. **Rollback Resilience**: Runtime rollback may leave the optional marker in the State Ledger, but existing normalization preserves and ignores unknown keys. A rollback restores legacy over-inclusive review behavior without losing follow-up history. The cross-Plan review-state reset intentionally discards obsolete passes; requiring review again is safe and needs no data restoration. U2 rolls back with one documentation line.
2. **Verification Vanity**: Helper-only tests could pass while `imm-autowork` still emits polluted checkpoints or reuses an old pass. U1 requires black-box cross-Plan sync and completion-boundary assertions, identical-signature pass invalidation, same-Plan continuity, invalid marker rejection, full-history preservation, and focused package/runtime regression tests.
3. **Spec Dilution Detection**: CR-P2 includes two coupled failures: stale follow-up files and stale reviewer passes. Both map to U1; fixing only one fails acceptance. CR-P3 maps separately to U2. History migration, Plan identity redesign, and broad docs cleanup are explicit non-goals rather than silently omitted requirements.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, State Ledger schema-v2 compatibility, review checkpoint signatures, `tests/cross-plan-sync-reset.test.ts`, `tests/imm-follow-up-runtime.test.ts`, focused review/package tests, `docs/solutions/workflow.md`, this Spec, and this Plan.
- compatibility: Existing Ledgers without the marker load with index `0`; valid optional fields survive round-trip; full history remains available; same-Plan append and follow-up behavior remains unchanged.
- interruption recovery: Cross-Plan marker and review-state reset use the existing single optimistic commit, so a failed commit leaves the previous Ledger byte-identical. Step execution can rerun focused tests without manual state repair.
- rollback path: Revert the two runtime files and focused tests together. The optional persisted marker is ignored by the old runtime. Revert the U2 documentation line independently.
- verification strength: isolated runtime fixtures, black-box `imm-plan --sync` and `imm-autowork` checkpoints, same-signature bypass regression, same-Plan preservation, invalid-state failure tests, Plan validation, and `git diff --check`.
- design-depth classification: High because the change controls persisted review authority and cross-Plan compatibility.
- Design Conformance: QA must prove the marker affects review collection only, full history is byte-preserved, cross-Plan review gates reset, and same-Plan review continuity survives. Any history migration or Plan identity redesign returns to Planner.
- review traceability: CR-P2 maps to U1 and CR-P3 maps to U2; no finding is deferred or excluded.

## Steps

### Step 1

- Step ID: U1
- Result: Current-Plan review evidence isolation across sync boundaries
- Verification type: automated
- Verification: `bun test tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/imm-loop-completion-gate.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-002-fix-cross-plan-review-scope-reset-plan.md --json && git diff --check`
- Execution note: test-first
- Test scenarios: Covers missing marker defaulting to zero; Covers valid marker round-trip; Covers invalid negative, fractional, non-numeric, and oversized markers failing closed; Covers cross-Plan marker equaling the pre-sync history length; Covers cross-Plan full follow-up history preservation; Covers cross-Plan review_state reset; Covers old identical-signature passes not satisfying a new Plan; Covers new checkpoints excluding marker-preceding follow-up files; Covers current closed Step files remaining included; Covers same-Plan marker and review pass preservation; Covers current-Plan follow-up files extending signatures and invalidating passes; Covers failed optimistic sync leaving marker, review state, and history unchanged.
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (follow-up records, normalization, changed-file collection, signatures); plugins/immune-brain/runtime/immune_brain_runtime.ts (cross-Plan and same-Plan sync); tests/cross-plan-sync-reset.test.ts (different-path reset fixture); tests/imm-follow-up-runtime.test.ts (same-Plan follow-up and review signature behavior); docs/specs/2026-07-21-cross-plan-review-scope-reset.spec.md (state invariants and rollout behavior)
- Scope: `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `tests/cross-plan-sync-reset.test.ts`, `tests/imm-follow-up-runtime.test.ts`, and only a focused existing review/package test if implementation reveals a directly affected assertion.
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If current Plan identity cannot be scoped without modifying FollowUp records or migrating existing histories, stop and return to Planner instead of adding a second history store or silently dropping evidence.
- security_considerations: Review evidence is an authority boundary. Invalid marker state must fail closed, old passes must not authorize a new Plan, and tests must not expose raw reviewer transcripts or user-local secrets.

### Step 2

- Step ID: U2
- Result: Canonical L2S evidence resolves to the tracked Spec
- Verification type: automated
- Verification: `test -e docs/specs/l2s-workflow-pattern.spec.md && ! rg -n '\.imm/specs/l2s-workflow-pattern\.spec\.md' docs/solutions/workflow.md && rg -n 'docs/specs/l2s-workflow-pattern\.spec\.md' docs/solutions/workflow.md && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-002-fix-cross-plan-review-scope-reset-plan.md --json && git diff --check`
- Test scenarios: Covers the canonical solution referencing the existing tracked Spec; Covers the missing `.imm/specs/` path disappearing from current canonical guidance; Covers historical Plan and Spec evidence remaining unchanged.
- Discovery cache: docs/solutions/workflow.md (canonical L2S evidence basis); docs/specs/l2s-workflow-pattern.spec.md (existing target); docs/specs/2026-07-21-cross-plan-review-scope-reset.spec.md (R5 boundary)
- Scope: `docs/solutions/workflow.md` only.
- Agent Hint: imm-executor
- Depends on: U1
- failure_behavior: If another current canonical L2S source requires the missing `.imm/specs/` path for runtime behavior, stop and return to Planner instead of rewriting historical documents.
- security_considerations: Documentation-only repair; preserve project-relative paths and do not add user-local absolute paths.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-002-fix-cross-plan-review-scope-reset-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-002-fix-cross-plan-review-scope-reset-plan.md --sync`

## Notes

- This Plan supersedes the completed maintenance Plan only for the two review findings; it does not reopen that Plan's accepted architecture decisions.
- No new dependency, schema version, migration command, history store, Plan identity, or generic abstraction is planned.
- Execution begins through `imm-loop`; Planner does not edit implementation files or issue QA closure.
