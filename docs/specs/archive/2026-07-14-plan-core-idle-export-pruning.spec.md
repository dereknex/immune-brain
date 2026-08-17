# Spec: Plan Core Idle Export Pruning

**Task ID**: IMM-PLAN-CORE-CLEANUP-001  
**Owner**: Planner  
**Status**: Proposed

## 1. Goal

Remove three unused exports from `plugins/immune-brain/runtime/plan_core.ts` while preserving all active Plan parsing, normalization, signature, and validation behavior.

## 2. Background

Repository-wide reference inspection found that `resolveSpecPath`, `inferProjectRootFromPlanPath`, and `buildProofStep` occur only at their declarations. Active runtime and tests use `parsePlan`, `normalizePlan`, `buildPlanSignature`, and `validatePlan` directly. The package root is private, and no repository contract identifies these three helpers as supported public API.

The cleanup also makes `join`, `dirname`, and `isAbsolute` unused imports; those imports should be removed in the same local edit. `resolve`, `relative`, and `process` remain required by `canonicalizePlanPath`.

## 3. Requirements

### R1. Remove only the idle helpers

- Remove `resolveSpecPath`.
- Remove `inferProjectRootFromPlanPath`.
- Remove `buildProofStep`.
- Remove only imports made unused by those deletions.

### R2. Preserve active Plan behavior

- `normalizeSpecReference` remains unchanged.
- `parsePlan`, `normalizePlan`, `buildPlanSignature`, `canonicalizePlanPath`, and `validatePlan` retain their existing behavior and exports.
- Existing CLI Plan validation output remains compatible.

### R3. Verify repository ownership and behavior

- A repository search confirms no remaining references to the removed identifiers.
- Focused Bun tests exercise Plan parsing, normalization, signatures, and validation.
- The new Plan validates successfully through the plugin-local `imm-plan` command.

## 4. Non-goals

- No CLI wrapper consolidation or removal.
- No changes to stale managed-copy wrapper inspection or retirement.
- No OpenCode in-process invocation change.
- No parser redesign, new abstraction, dependency, State Ledger schema change, or historical document rewrite.

## 5. Compatibility and Failure Boundary

The repository has no active caller or documented public contract for the three helpers. If execution discovers a runtime, test, package, or external compatibility contract that imports one of them, stop and return to Planner rather than adding a replacement compatibility abstraction within this slice.

## 6. Verification

```bash
bun test tests/plan-validation.test.ts tests/plugin-package-runtime.test.ts
! git grep -n -E 'resolveSpecPath|inferProjectRootFromPlanPath|buildProofStep' -- 'plugins/immune-brain/runtime/**' 'tests/**' 'plugins/immune-brain/tests/**'
plugins/immune-brain/bin/imm-plan docs/plans/2026-07-14-001-refactor-plan-core-idle-export-pruning-plan.md --json
git diff --check
```
