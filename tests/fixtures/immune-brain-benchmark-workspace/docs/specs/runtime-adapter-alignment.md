# Spec: Runtime Adapter Alignment

## Purpose
Define the requirements for maintaining runtime adapter references aligned with `plugins/immune-brain/runtime/v4_runtime.ts` across workspace documentation, test contracts, and plugin shims.

## Context
The packaged plugin runtime entrypoint is `plugins/immune-brain/runtime/v4_runtime.ts`. All contract definitions, documentation, tests, and executable shims must consistently target this TypeScript entrypoint.

## Requirements
1. **Documentation Alignment**: `README.md` must state `plugins/immune-brain/runtime/v4_runtime.ts` as the canonical packaged runtime path.
2. **Contract Enforcement**: `tests/fixture-contract.test.ts` must assert the presence of `plugins/immune-brain/runtime/v4_runtime.ts` and reject legacy `immune_brain_runtime.py` references.
3. **Shim Consistency**: Any provisioned shims under `plugins/immune-brain/bin/` must reference `runtime/v4_runtime.ts` rather than Python runtimes.

## Acceptance Criteria
- All tests in `tests/fixture-contract.test.ts` pass cleanly.
- No obsolete `immune_brain_runtime.py` references exist in contract files or documentation.
