# Drain Legacy Runtime Test Callers

**Status**: Stopped on 2026-08-15 (implementation preserved on main in
`1110a05` + `ba8a2b0`; enrolled acceptance assertions under-listed migration
targets and the reference inventory, and the TUI breaking-revision payload
path cannot correct them). Successor:
`2026-08-15-021-drain-legacy-runtime-test-callers` (see
`drain-legacy-runtime-test-callers-r2.spec.md`).
**Task**: `2026-08-15-020-drain-legacy-runtime-test-callers`
**Roadmap**: `docs/specs/host-native-lightweight-workflow-roadmap.spec.md`, Phase 5 R4
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Material - deletes 18 test files and migrates 3 subprocess-based tests to the shipped v4 router; no production runtime, package, or authority change.
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded test-surface drain with per-file deletion or migration decisions enumerated in Scope; no flow relationships require a diagram.

## 1. Problem

`plugins/immune-brain/runtime/immune_brain_runtime.ts` (the retired v3
dispatcher) is still imported or executed by current-facing tests. A later
slice deletes the dispatcher; before that, every test that imports it or
subprocesses it must be drained so deletion breaks nothing. A read-only audit
classified all references:

- 12 test files exercise GENUINE retired v3 mutation flows through
  `runImmCommand` (imm-work execution, imm-finish reset, imm-autowork,
  roadmap successor transitions, v3 workspace snapshots, v3 probes,
  v3 observations). Every still-live invariant they touch is already covered
  by v4-owned test files (authority-commit-receipts, kernel-r2a-boundary,
  kernel-shadow-cli, plugin-package-runtime, v4-storage-retirement-v3-writers,
  pi-only-runtime-host-contract, review-gates).
- 4 test files assert RETIRED WALL behavior that is already duplicated by
  v4-owned suites (v4-plan-control-plane, wrapper-retirement,
  plugin-package-runtime, v4-storage-retirement-v3-writers,
  kernel-canary-claim-writer-boundary).
- 1 test file imports two helper functions
  (`hasMatchingUserPlanTermination`, `isApprovedTransitionPhase`) used only
  inside the retired dispatcher for v3 approved-successor transitions; both
  disappear with the dispatcher.
- 1 test file (`tests/imm-plan-routing-status-contract.test.ts`) imports
  `runImmCommand`/`COMMAND_MANIFEST`; every assertion it makes is redundant
  with `tests/v4-plan-control-plane.test.ts` (all 9 policy states),
  `tests/host-runtime-cutover.test.ts` (manifest), and
  `tests/wrapper-retirement.test.ts` (help rejection).
- 3 test files subprocess the legacy dispatcher to test LIVE commands that
  now route through `v4_runtime.ts` (`imm-kernel intent`,
  `imm-plan --json`, `list-commands`); they must point at the v4 router.
- 6 test files only assert the dispatcher file's existence/absence in
  source or packed artifacts; they are handled by the later deletion slice,
  not here.

## 2. Goal

- Delete 30 test files whose only subject is retired v3 behavior or whose
  assertions are fully covered by v4-owned suites.
- Trim 3 test files to their live pure-unit blocks (loop-child-output
  contract, execution-evidence validation, fast-track detection), removing
  their CLI integration blocks and `runImmCommand` imports.
- Migrate 3 subprocess-based tests to the shipped `v4_runtime.ts` router.
- Update `tests/kernel-r2a-boundary.test.ts` manifest assertions from the
  legacy dispatcher's `list-commands` to the v4 router's.
- Leave zero current-facing test files importing or executing
  `immune_brain_runtime.ts`.
- Do not change production code, package contents, skills, or the 6
  existence/absence-assert files (their flip belongs to the deletion slice).

## 3. Scope

### 3.1 Delete (30 files)

Retired v3 behavior tests (24):

1. `tests/autowork-false-completion.test.ts`
2. `tests/finish-dehydrate-runtime.test.ts`
3. `tests/imm-loop-completion-gate.test.ts`
4. `tests/imm-loop-review-orchestration-contract.test.ts`
5. `tests/plan-execution-boundary-runtime.test.ts`
6. `tests/roadmap-plan-transition-runtime.test.ts`
7. `tests/roadmap-plan-progression-runtime.test.ts`
8. `tests/work-probes-runtime.test.ts`
9. `tests/kernel-shadow-observation.test.ts`
10. `tests/replan-recovery-runtime.test.ts`
11. `tests/workspace-snapshot-persistence.test.ts`
12. `plugins/immune-brain/tests/follow-up-archive.test.ts`
13. `tests/cross-plan-sync-reset.test.ts`
14. `tests/imm-follow-up-runtime.test.ts`
15. `tests/imm-autowork-continuation-runtime.test.ts`
16. `tests/project-migration-cli.test.ts`
17. `tests/handoff-review-integration.test.ts`
18. `tests/execution-history-logging.test.ts`
19. `tests/review-decision-notes.test.ts`
20. `tests/step-dependency-enforcement.test.ts`
21. `tests/undeclared-scope-visibility.test.ts`
22. `tests/evidence-test-path-validation.test.ts`
23. `tests/roadmap-plan-terminal-runtime.test.ts`
24. `tests/auto-advisory-route-contract.test.ts` (subprocesses the retired
    `imm-activation-plan` route classifier; the v4 router rejects that
    command, and `tests/activation-plan-runtime-surface.test.ts` plus
    `tests/code-review-activation-contract.test.ts` already assert the
    retirement)

Retired-wall tests with duplicated coverage (4):

24. `tests/v3-plan-creation-retirement.test.ts`
25. `tests/v3-retirement-live-boundary.test.ts`
26. `tests/kernel-canary-v3-routing.test.ts`
27. `tests/legacy-v3-projection.test.ts`

Dispatcher-only helper import (1):

28. `plugins/immune-brain/tests/plan-transition-termination.test.ts`

Fully redundant routing-status contract (1):

29. `tests/imm-plan-routing-status-contract.test.ts`

### 3.2 Trim to live unit blocks (3 files)

- `tests/loop-child-output-contract.test.ts`: keep the pure
  `validateQaChildOutput`/`validateReviewChildOutput` unit blocks (lines
  ~81-406, covering `runtime/loop_contract.ts`); delete the
  `runImmCommand` integration block (lines ~408-456) and the legacy import.
- `tests/execution-evidence-runtime.test.ts`: keep the structured-evidence
  and `failure_exit` enum unit blocks (lines ~46-222, covering
  `runtime/state_ledger.ts` validation); delete the `runImmCommand`
  integration block (lines ~224-269) and the legacy import.
- `tests/fast-track-detection.test.ts`: keep the `planSupportsFastTrack`
  unit tests (lines ~48-80, covering `runtime/plan_core.ts`); delete the
  `runImmCommand` checkpoint blocks (lines ~82-104) and the legacy import.

### 3.3 Migrate subprocess targets (3 files)

- `tests/kernel-intent-authoring.test.ts`: change `TS_RUNTIME` from
  `runtime/immune_brain_runtime.ts` to `runtime/v4_runtime.ts` (CLI shape
  `v4_runtime.ts cli imm-kernel intent ...` is already used by 018-era
  tests).
- `tests/plan-validation.test.ts`: change `TS_RUNTIME` from
  `runtime/immune_brain_runtime.ts` to `runtime/v4_runtime.ts`.
- `tests/python-reference-boundary.test.ts`: change `TS_RUNTIME` from
  `runtime/immune_brain_runtime.ts` to `runtime/v4_runtime.ts`; the
  `canonical Bun checks` block now asserts retired fail-closed walls for
  `imm-work status`/`imm-activation-plan`/`imm-heal` through the v4 router;
  the `canonical command manifest` block asserts the v4 manifest
  (`imm-kernel`/`imm-plan` plus the retired list). The file's
  existence assertions on `immune_brain_runtime.ts` remain (they flip in
  the deletion slice).
- `tests/kernel-r2a-boundary.test.ts`: change the `list-commands`
  subprocess target to `runtime/v4_runtime.ts`; update the `imm-kernel`
  manifest assertions to the v4 manifest (commands
  `imm-kernel`/`imm-plan`, examples intent/status/audit; no
  `readiness`/`journal`/`migrate` subcommand values, no
  `imm-kernel readiness --json` example). Remove the
  `'if (args[0] === "status" || args[0] === "readiness") return "read"'`
  runtimeSource assertion (v4 router does not classify project access that
  way).

### 3.4 Out of scope

- `immune_brain_runtime.ts` and `runtime/commands/*` deletion (later slice).
- The 5 remaining existence/absence-assert files
  (`roadmap-plan-host-acceptance`, `kernel-r2c1-boundary`,
  `v4-storage-retirement-v3-writers`,
  `v4-runtime-launchers`, `pi-only-current-contracts`) — they still assert
  the file exists in source and flip in the deletion slice. The benchmark
  fixture workspace files and the benchmark scenario JSON keep their legacy
  runtime literals as fixture data.
- Production code, packaged `dist/` docs, skills, or docs referencing
  deleted test files: any such reference found during implementation is
  reported, not silently edited beyond the three migrated files.
- `commands/kernel.ts` and `v4_runtime.ts` behavior.

## 4. Contract

After this task:

- No remaining test file imports `runImmCommand` or any other symbol from
  `immune_brain_runtime.ts`, and no remaining test file subprocesses the
  legacy dispatcher.
- `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` returns
  only files that reference the literal in absence/string assertions
  (v4-plan-control-plane, wrapper-retirement, pi-packaged-legacy-fallbacks,
  host-runtime-cutover, code-review-activation-contract,
  active-runtime-docs-contract, python-reference-boundary existence
  asserts) plus the 5 out-of-scope
  existence/absence-assert files (roadmap-plan-host-acceptance,
  kernel-r2c1-boundary, v4-storage-retirement-v3-writers,
  v4-runtime-launchers, pi-only-current-contracts) plus the benchmark
  fixture workspace files. Zero import or subprocess remains.
- Every other test file routes CLI subprocesses through
  `runtime/v4_runtime.ts`.
- Full repository suite passes with the reduced test set.

## 5. Tests

- `bun test tests/kernel-intent-authoring.test.ts tests/plan-validation.test.ts tests/kernel-r2a-boundary.test.ts tests/python-reference-boundary.test.ts`
  — migrated subprocess targets.
- `bun test tests/loop-child-output-contract.test.ts tests/execution-evidence-runtime.test.ts tests/fast-track-detection.test.ts`
  — trimmed live unit blocks.
- `bun test` — full regression.

## 6. Verification descriptors (TaskIntent)

1. Deleted files: all 30 files absent from source; no remaining test file
   imports them.
2. Migrated subprocesses: the 4 files execute `runtime/v4_runtime.ts`, never
   `immune_brain_runtime.ts`.
3. Trimmed files: the 3 trimmed files keep their live unit blocks and no
   longer import `runImmCommand` or `immune_brain_runtime`.
4. Remaining references: `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` returns only the enumerated absence/string-assert and out-of-scope files, with zero import or subprocess of the legacy dispatcher.
5. Contract retention: `kernel-intent-authoring`, `plan-validation`,
   `kernel-r2a-boundary`, `loop-child-output-contract`,
   `execution-evidence-runtime`, `fast-track-detection` focused suites pass;
   live invariants covered by v4-owned suites still pass
   (authority-commit-receipts, kernel-r2a-boundary, kernel-shadow-cli,
   plugin-package-runtime, v4-storage-retirement-v3-writers,
   host-runtime-cutover, wrapper-retirement, v4-plan-control-plane).
6. Zero production changes: `git diff` touches only deleted/trimmed/migrated
   test files.
7. Full repository suite passes.
