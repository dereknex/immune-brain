# Retire Legacy v3 Dispatcher Closure

**Status**: Completed on 2026-08-15 (Kernel QA and Review passed)
**Task**: `2026-08-15-022-retire-legacy-v3-dispatcher`
**Roadmap**: `docs/specs/host-native-lightweight-workflow-roadmap.spec.md`, Phase 5 R4
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Material - deletes the retired v3 dispatcher and five v3 command modules from source, flips six existence assertions to absence assertions, and updates contract tests; no shipped runtime, package, or authority change (the dispatcher was already absent from the npm package and unreachable from all bin wrappers).
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded file deletion with a fixed enumeration plus per-file assertion flips; the surviving module graph is enumerated in Scope.

## 1. Problem

`plugins/immune-brain/runtime/immune_brain_runtime.ts` (the retired v3
dispatcher) and five v3 command modules it alone imports
(`commands/{plan,work,review,finish,autowork,command_types}.ts`) remain in
source. Since Task 021, zero current-facing test files import or subprocess
the dispatcher; every bin wrapper routes through `v4_runtime.ts`; the npm
package excludes it. The remaining references are:

- 6 existence/absence-assert test files that still assert the dispatcher
  file exists in source (`roadmap-plan-host-acceptance`,
  `kernel-r2c1-boundary`, `python-reference-boundary`,
  `v4-storage-retirement-v3-writers`, `v4-runtime-launchers`,
  `pi-only-current-contracts`).
- `pi-only-current-contracts` reads the dispatcher and
  `commands/{finish,work}.ts` in its `activePaths` no-retired-token check.
- `v4-runtime-launchers` asserts `LEGACY_RUNTIME` absence in mise/bin (fine)
  and reads the constant path.
- Benchmark fixture workspace files carry legacy runtime literals as fixture
  data (updated to v4 references so the fixture remains a valid scenario).
- Docs (`docs/solutions/*`, historical plans/specs) reference the dispatcher
  as historical evidence; these are not current-facing and stay untouched.

## 2. Goal

- Delete `plugins/immune-brain/runtime/immune_brain_runtime.ts` and
  `plugins/immune-brain/runtime/commands/{plan,work,review,finish,autowork,command_types}.ts`.
- Keep `commands/kernel.ts` (imported by `v4_runtime.ts`).
- Keep `imm_core.ts`, `environment.ts`, `state_ledger.ts`,
  `project_migration.ts`, `authority_commit_receipts.ts` and the
  `kernel/*` deep modules: `kernel/observation.ts`,
  `kernel/automatic_observations.ts`, and test suites still import them.
- Flip the 6 existence assertions to absence assertions.
- Update `pi-only-current-contracts` `activePaths` and
  `v4-runtime-launchers` `LEGACY_RUNTIME` handling to the post-deletion
  state.
- Update benchmark fixture workspace literals (README, docs, test) from the
  legacy dispatcher path to `runtime/v4_runtime.ts`.
- Leave the shipped npm package contents unchanged (the dispatcher was never
  packaged).

## 3. Scope

### 3.1 Delete (6 files)

1. `plugins/immune-brain/runtime/immune_brain_runtime.ts`
2. `plugins/immune-brain/runtime/commands/plan.ts`
3. `plugins/immune-brain/runtime/commands/work.ts`
4. `plugins/immune-brain/runtime/commands/review.ts`
5. `plugins/immune-brain/runtime/commands/finish.ts`
6. `plugins/immune-brain/runtime/commands/autowork.ts`
7. `plugins/immune-brain/runtime/commands/command_types.ts`

### 3.2 Assertion flips (6 test files)

- `tests/roadmap-plan-host-acceptance.test.ts`: `existsSync(.../immune_brain_runtime.ts)` `true` -> `false`; the `runtime` field in the copied-plugin fixture becomes `runtime/v4_runtime.ts`.
- `tests/kernel-r2c1-boundary.test.ts`: the `canonical runtime manifest carries only the bounded intent surface` test reads the dispatcher source; retarget to `runtime/commands/kernel.ts` (or `v4_runtime.ts`) for the intent author/validate surface assertions.
- `tests/python-reference-boundary.test.ts`: `existsSync(.../immune_brain_runtime.ts)` `true` -> `false`.
- `tests/v4-storage-retirement-v3-writers.test.ts`: `existsSync(legacy)` `true` -> `false`; the `not.toContain` bin/source asserts remain.
- `tests/v4-runtime-launchers.test.ts`: `LEGACY_RUNTIME` constant points at the deleted path; keep the absence asserts, drop any existence assumption.
- `tests/pi-only-current-contracts.test.ts`: remove
  `immune_brain_runtime.ts`, `commands/finish.ts`, `commands/work.ts` from
  the `activePaths` no-retired-token list (they no longer exist); keep
  `imm_core.ts` in the list. The `does not retain the legacy progress
  projection surface` sources list drops the two deleted paths.

### 3.3 Benchmark fixture update (fixture workspace)

- `tests/fixtures/immune-brain-benchmark-workspace/README.md`,
  `docs/plans/runtime-adapter-alignment.md`,
  `docs/specs/runtime-adapter-alignment.md`, and
  `tests/fixture-contract.test.ts`: replace the legacy dispatcher path with
  `plugins/immune-brain/runtime/v4_runtime.ts` so the fixture scenario
  remains valid.
- `tests/fixtures/immune-brain-benchmark.json`: the userInput strings
  reference the legacy path; update to the v4 path.

### 3.4 Out of scope

- `imm_core.ts`, `environment.ts`, `state_ledger.ts`,
  `project_migration.ts`, `authority_commit_receipts.ts`, `kernel/*` —
  retained for library/test consumers.
- `commands/kernel.ts` — retained (v4 router imports it).
- `docs/solutions/*`, historical plans/specs, `dist/` packaged docs —
  historical evidence, untouched.
- Public Skill aliases (separate later slice).
- The unfinished TUI breaking-revision payload path.
- `pi-only-runtime-host-contract`, `runtime-state`, and other tests that
  import `imm_core`/`state_ledger` directly — unaffected.

## 4. Contract

After this task:

- `rg -l "immune_brain_runtime" tests/ plugins/immune-brain/tests/` returns
  zero files except `tests/active-runtime-docs-contract.test.ts`, which uses
  the literal as a stale-reference detector fixture input (the detector only
  flags `.py`/`.mcp.json`/`list-tools`, so the test stays green and is not a
  reference to the deleted module).
- No source file imports `immune_brain_runtime.ts` or any deleted command
  module.
- Full repository suite passes.

## 5. Tests

- `bun test tests/roadmap-plan-host-acceptance.test.ts tests/kernel-r2c1-boundary.test.ts tests/python-reference-boundary.test.ts tests/v4-storage-retirement-v3-writers.test.ts tests/v4-runtime-launchers.test.ts tests/pi-only-current-contracts.test.ts`
  — flipped assertions.
- `bun test tests/fixtures/immune-brain-benchmark-workspace/tests/fixture-contract.test.ts`
  — fixture consistency.
- `bun test tests/kernel-intent-authoring.test.ts tests/plan-validation.test.ts tests/kernel-r2a-boundary.test.ts tests/plugin-package-runtime.test.ts tests/host-runtime-cutover.test.ts tests/wrapper-retirement.test.ts tests/v4-plan-control-plane.test.ts`
  — v4 router and package surfaces.
- `bun test` — full regression.

## 6. Verification descriptors (TaskIntent)

1. Deleted files: the 7 enumerated source files absent.
2. Assertion flips: the 6 test files pass with absence semantics; no test file references the deleted paths.
3. Fixture update: benchmark workspace files reference `runtime/v4_runtime.ts`; fixture contract test passes.
4. No imports: no source or test file imports the deleted modules.
5. v4 surface intact: router/package/wrapper focused suites pass.
6. Full repository suite passes.
