# Plan: Runtime Adapter Alignment

## Summary
Single-step iteration plan to align runtime adapter references with `plugins/immune-brain/runtime/v4_runtime.ts`.

## Steps

### Step 1: Synchronize and Validate Runtime Adapter References
- **Objective**: Confirm that `README.md`, `tests/fixture-contract.test.ts`, and provisioned shims reference `plugins/immune-brain/runtime/v4_runtime.ts`.
- **Tasks**:
  1. Audit `README.md` to ensure `plugins/immune-brain/runtime/v4_runtime.ts` is declared under `## Runtime Adapter Contract`.
  2. Validate contract tests in `tests/fixture-contract.test.ts`.
  3. Execute `bun test tests/fixtures/immune-brain-benchmark-workspace/tests/fixture-contract.test.ts` to verify assertion pass.
- **Verification Command**: `bun test tests/fixtures/immune-brain-benchmark-workspace/tests/fixture-contract.test.ts`
