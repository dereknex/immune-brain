# Drain Legacy Runtime Test Callers (R2)

**Status**: Completed on 2026-08-15 (Kernel QA and Review passed; successor to
stopped Task 020, implementation shipped in `1110a05` + `ba8a2b0`)
**Task**: `2026-08-15-021-drain-legacy-runtime-test-callers`
**Roadmap**: `docs/specs/host-native-lightweight-workflow-roadmap.spec.md`, Phase 5 R4
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Material - restates the deletion and migration goal of stopped Task 020 with corrected acceptance assertions; the implementation already landed on main, so this task verifies the shipped state and records fresh evidence.
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded test-surface drain with per-file decisions already enumerated; the successor only corrects acceptance assertion text and re-verifies the shipped implementation.

## 1. Problem

Task `2026-08-15-020-drain-legacy-runtime-test-callers` implemented the
correct drain (30 test files deleted, 3 trimmed to live unit blocks, 4
subprocess tests migrated to `v4_runtime.ts`, manifest assertions updated)
and landed on main in `1110a05` (plus a spec-count fix in `ba8a2b0`). Its
enrolled TaskIntent acceptance assertions, however, did not match the
bundled change:

- `acc-migrated-subprocesses` listed 3 migration targets, but the
  implementation (correctly, per the 020 spec §3.3) also migrated
  `tests/python-reference-boundary.test.ts` — 4 files total.
- `acc-remaining-references` enumerated only named test files, omitting the
  benchmark fixture paths that the spec §4 acknowledges.
- `acc-deleted-files` referenced a 29-file count while the implementation
  deletes 30.

Native Review returned `rework` with 3 blocking findings on these assertion
mismatches. The TUI `approve-breaking-intent-revision` path cannot supply a
next-intent payload (recorded limitation since Task 015; completing that
payload path is an explicit non-goal). Per the established stop-and-successor
pattern (Task 015 → 016), Task 020 was stopped with its implementation
preserved on main. This successor restates the same goal with assertions that
match the shipped implementation.

## 2. Goal

- Verify the shipped implementation state on main satisfies the corrected
  assertions: 30 deleted test files, 3 trimmed files, 4 migrated subprocess
  targets, v4 manifest assertions, zero imports/subprocesses of
  `immune_brain_runtime.ts` outside the enumerated out-of-scope and
  absence/string-assert files.
- Record fresh acceptance evidence for all corrected assertions.
- Do not change production code; do not re-delete or re-migrate anything.

## 3. Scope

### 3.1 Verified state (already shipped)

Deleted (30): `tests/autowork-false-completion.test.ts`,
`tests/finish-dehydrate-runtime.test.ts`,
`tests/imm-loop-completion-gate.test.ts`,
`tests/imm-loop-review-orchestration-contract.test.ts`,
`tests/plan-execution-boundary-runtime.test.ts`,
`tests/roadmap-plan-transition-runtime.test.ts`,
`tests/roadmap-plan-progression-runtime.test.ts`,
`tests/work-probes-runtime.test.ts`,
`tests/kernel-shadow-observation.test.ts`,
`tests/replan-recovery-runtime.test.ts`,
`tests/workspace-snapshot-persistence.test.ts`,
`plugins/immune-brain/tests/follow-up-archive.test.ts`,
`tests/cross-plan-sync-reset.test.ts`,
`tests/imm-follow-up-runtime.test.ts`,
`tests/imm-autowork-continuation-runtime.test.ts`,
`tests/project-migration-cli.test.ts`,
`tests/handoff-review-integration.test.ts`,
`tests/execution-history-logging.test.ts`,
`tests/review-decision-notes.test.ts`,
`tests/step-dependency-enforcement.test.ts`,
`tests/undeclared-scope-visibility.test.ts`,
`tests/evidence-test-path-validation.test.ts`,
`tests/roadmap-plan-terminal-runtime.test.ts`,
`tests/auto-advisory-route-contract.test.ts`,
`tests/v3-plan-creation-retirement.test.ts`,
`tests/v3-retirement-live-boundary.test.ts`,
`tests/kernel-canary-v3-routing.test.ts`,
`tests/legacy-v3-projection.test.ts`,
`plugins/immune-brain/tests/plan-transition-termination.test.ts`,
`tests/imm-plan-routing-status-contract.test.ts`.

Trimmed (3): `tests/loop-child-output-contract.test.ts`,
`tests/execution-evidence-runtime.test.ts`,
`tests/fast-track-detection.test.ts`.

Migrated to `runtime/v4_runtime.ts` (4): `tests/kernel-intent-authoring.test.ts`,
`tests/plan-validation.test.ts`, `tests/kernel-r2a-boundary.test.ts`,
`tests/python-reference-boundary.test.ts`.

### 3.2 In scope (this task)

- Fresh verification of the shipped state: full suite, focused suites,
  `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` inventory.
- This task's Spec (`drain-legacy-runtime-test-callers-r2.spec.md`) and the
  successor TaskIntent sidecar.
- Roadmap note: mark Task 020 stopped with implementation preserved; Task
  021 as the successor.

### 3.3 Out of scope

- Any source, test, package, skill, or dist change (production untouched).
- The unfinished TUI breaking-revision payload path.
- Dispatcher deletion and public Skill alias retirement (later slices).
- Benchmark fixture workspace content (fixture data; literals remain).

## 4. Contract

After this task:

- `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` returns
  exactly the absence/string-assert files
  (`v4-plan-control-plane`, `wrapper-retirement`,
  `pi-packaged-legacy-fallbacks`, `host-runtime-cutover`,
  `code-review-activation-contract`, `active-runtime-docs-contract`,
  `python-reference-boundary` existence asserts), the 5 out-of-scope
  existence/absence files (`roadmap-plan-host-acceptance`,
  `kernel-r2c1-boundary`, `v4-storage-retirement-v3-writers`,
  `v4-runtime-launchers`, `pi-only-current-contracts`), and the benchmark
  fixture workspace files. Zero import or subprocess of the legacy
  dispatcher remains.
- Every other test file routes CLI subprocesses through
  `runtime/v4_runtime.ts`.
- Full repository suite passes on the shipped state.

## 5. Tests

- `bun test tests/kernel-intent-authoring.test.ts tests/plan-validation.test.ts tests/kernel-r2a-boundary.test.ts tests/python-reference-boundary.test.ts`
  — migrated subprocess targets.
- `bun test tests/loop-child-output-contract.test.ts tests/execution-evidence-runtime.test.ts tests/fast-track-detection.test.ts`
  — trimmed live unit blocks.
- `bun test tests/authority-commit-receipts.test.ts tests/kernel-r2a-boundary.test.ts tests/kernel-shadow-cli.test.ts tests/plugin-package-runtime.test.ts tests/v4-storage-retirement-v3-writers.test.ts tests/host-runtime-cutover.test.ts tests/wrapper-retirement.test.ts tests/v4-plan-control-plane.test.ts`
  — v4-owned suites.
- `bun test` — full regression.

## 6. Verification descriptors (TaskIntent)

1. Deleted files: all 30 files absent from source; no remaining test file imports them.
2. Migrated subprocesses: the 4 files execute `runtime/v4_runtime.ts`, never `immune_brain_runtime.ts`.
3. Trimmed files: the 3 files keep live unit blocks and no longer import `runImmCommand` or `immune_brain_runtime`.
4. Remaining references: `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` returns exactly the enumerated absence/string-assert and out-of-scope files plus benchmark fixtures, with zero import or subprocess of the legacy dispatcher.
5. Contract retention: migrated/trimmed focused suites plus v4-owned suites pass.
6. Zero production changes: `git diff` shows only this task's Spec and sidecar.
7. Full repository suite passes.
