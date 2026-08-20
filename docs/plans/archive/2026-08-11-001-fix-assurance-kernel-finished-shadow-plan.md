# Iteration Plan

## Task

- Summary: Correct the Assurance Kernel legacy shadow projection so a normally finished v3 Plan maps to `done` while an all-closed Plan awaiting finish remains in `review`.
- Origin: After Foundation Plan `2026-08-10-002` reached `terminal_plan_complete`, the user requested repair of the post-finish smoke finding: the real Ledger is `idle + intentional_reset` with a matching `finish_reset`, but `imm-kernel status --json` projects `review`.
- Spec: `docs/specs/assurance-kernel-v4.spec.md`
- Research: `mapLegacyState()` currently maps every all-closed aggregate with a non-empty `plan_path` and null `plan_terminal` to `legacy-review`. The authoritative v3 predicate in `currentPlanAlreadyFinished()` additionally requires `runtime_status=idle`, `reset_reason=intentional_reset`, no active Step or pending follow-up, all Steps closed, and the latest `finish_reset.details.plan_path` to match the current Plan. The real post-finish Ledger satisfies these facts.
- Decisions: D1 preserve `review` for all-closed active Plans without current finish evidence. D2 map to `done` only from the complete v3 finish evidence set. D3 inspect the latest `finish_reset` only, so a stale older matching entry cannot override a newer mismatched finish marker. D4 keep the mapper pure and shadow-only; do not import v3 runtime internals or change production routing. D5 map explicit `plan_terminal` records conservatively to the existing stopped result.
- Assumptions: v3 remains production authority. `history` is ordered oldest to newest. A missing or malformed history value is unverified and therefore not terminal evidence.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: One legacy projection predicate plus focused unit and CLI regressions. No TaskRecord schema, storage, CLI routing, migration-write, or v3 lifecycle changes.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, and code identifiers

## Devil's Advocate Audit

### 1. Rollback Resilience

- The change is isolated to one pure mapper and focused tests. Rollback restores the previous branch without persistence or migration cleanup.

### 2. Verification Vanity

- The RED fixture must reproduce the exact real post-finish facts and fail because the current mapper returns `review`. Negative controls must prove missing, malformed, or mismatched finish evidence remains `review`.

### 3. Spec Dilution Detection

- The repair does not treat all closed Steps as completion. It preserves the distinction between review-ready closure and record-aware finish, and it leaves shadow/migration commands read-only.

## Steps

### Step 1

- Step ID: U1
- Result: A normally finished legacy Plan deterministically maps to `done`.
- Scope: `plugins/immune-brain/runtime/kernel/legacy.ts`; `tests/kernel-core.test.ts`; `tests/kernel-shadow-cli.test.ts`
- Verification: `bun test tests/kernel-core.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts && plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-001-fix-assurance-kernel-finished-shadow-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first
- Discovery cache: `plugins/immune-brain/runtime/kernel/legacy.ts` (all-closed mapping); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`currentPlanAlreadyFinished` evidence contract); `tests/kernel-core.test.ts` (pure mapping matrix); `tests/kernel-shadow-cli.test.ts` (read-only CLI projection)
- failure_behavior: Any uncertain, missing, malformed, or stale finish evidence remains `review`; do not infer completion from `runtime_status`, closed Steps, or `plan_path` alone.
- security_considerations: Parse history defensively as untrusted legacy data and avoid throwing on malformed entries; no path is opened or resolved by this predicate.

## Test scenarios

- T1: The exact post-finish aggregate (`idle`, `intentional_reset`, no pending follow-up, all Steps closed, latest matching `finish_reset`) maps to `done` with reason `legacy-finished`.
- T2: The same all-closed aggregate without `intentional_reset`, without history, with malformed history, with a mismatched latest finish marker, or with a pending follow-up remains `review`.
- T3: A newer mismatched `finish_reset` defeats an older matching entry.
- T4: `imm-kernel status --json` reports `done` for a finished fixture without changing source Ledger bytes or creating TaskRecord/workspace files.
- T5: Existing active, review, replanning, explicit terminal, migration dry-run, and symlink regressions remain green.
