---
title: "refactor: prune idle plan-core exports"
type: refactor
status: proposed
date: 2026-07-14
origin: user-confirmed architecture exploration and brainstorm framing
spec: docs/specs/archive/2026-07-14-plan-core-idle-export-pruning.spec.md
---

# Iteration Plan

## Task

- Summary: Remove three repository-unused exports from `plan_core.ts` while preserving active Plan parsing, normalization, signature, and validation behavior.
- Spec: `docs/specs/archive/2026-07-14-plan-core-idle-export-pruning.spec.md`
- Origin: Architecture exploration identified three declaration-only exports; Brainstorm rejected broader CLI wrapper and OpenCode execution changes; the user confirmed the minimal cleanup direction.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-DEC-1; BR-OUT-1; BR-OUT-2; BR-DEFER-1
- Scope Mode: New one-Step executable slice. The currently synced 2026-07-12 Plan is closed, so this is not an append.
- Planner research dispatch: solo; this is a small single-module cleanup with direct repository references and focused existing tests.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- Preserved literals: file paths, commands, code identifiers, `Plan`, `Spec`, `Step`, and `State Ledger`.

## Brainstorm Manifest

| ID | Item |
|---|---|
| BR-REQ-1 | Remove `resolveSpecPath`, `inferProjectRootFromPlanPath`, and `buildProofStep` from `plugins/immune-brain/runtime/plan_core.ts`. |
| BR-REQ-2 | Verify active Plan parsing, normalization, signature, and validation behavior remains unchanged. |
| BR-DEC-1 | Use one low-risk, independently closable cleanup Step. |
| BR-OUT-1 | Do not consolidate or remove `imm-*` CLI wrappers. |
| BR-OUT-2 | Do not modify stale managed-copy wrapper governance. |
| BR-DEFER-1 | Defer OpenCode in-process execution until measurements prove subprocess startup is a bottleneck. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|---|---|---|---|
| BR-REQ-1 | covered_by_step | U1 | U1 removes exactly the three declaration-only exports and their newly unused imports. |
| BR-REQ-2 | covered_by_step | U1 | U1 runs focused Plan parser, normalization, signature, CLI validation, and package runtime checks. |
| BR-DEC-1 | captured_as_decision | D1 | D1 keeps implementation and verification in one closable outcome. |
| BR-OUT-1 | out_of_scope | Non-goals | Stable user-facing CLI wrappers remain unchanged. |
| BR-OUT-2 | out_of_scope | Non-goals | Historical managed-copy drift governance is unrelated to idle exports. |
| BR-DEFER-1 | deferred | Future measured slice | No current latency evidence justifies changing the OpenCode process boundary. |

## Research

- `CONTEXT.md` defines a `Step` as one independently closable outcome and maps Plan validation to `plugins/immune-brain/runtime/plan_core.ts` plus the plugin-local CLI runtime.
- Repository search found `resolveSpecPath`, `inferProjectRootFromPlanPath`, and `buildProofStep` only at their declarations; no source or test imports them.
- Removing the first two helpers makes `join`, `dirname`, and `isAbsolute` unused. `resolve`, `relative`, and `process` remain used by `canonicalizePlanPath`.
- `tests/plan-validation.test.ts` directly exercises `parsePlan`, `normalizePlan`, `buildPlanSignature`, and `validatePlan`; `tests/plugin-package-runtime.test.ts` exercises the packaged CLI validation path.
- Existing decisions preserve plugin-local shell wrappers and installed/cache-root OpenCode behavior. This Plan does not reopen them.

## Decisions

- D1: Keep this as one Step because code deletion and behavior proof form one closable result.
- D2: Delete the three idle helpers rather than deprecating or wrapping them; no repository caller or public contract was found.
- D3: Remove only imports made unused by the helper deletion; do not reorganize `plan_core.ts`.
- D4: Do not add a test that asserts deleted text alone. Use existing behavioral tests plus a negative repository reference check.
- D5: If a compatibility consumer is discovered during execution, stop and replan instead of creating speculative compatibility machinery.

## Assumptions

- The private repository package and plugin runtime files are not promising arbitrary internal `plan_core.ts` exports as a stable third-party API.
- Historical Plans and Specs may mention old helpers as evidence and do not need rewriting.
- Existing focused Bun tests are sufficient to detect changes to active Plan parsing, normalization, signatures, and CLI validation.

## Devil's Advocate Audit

1. **Rollback Resilience**: The implementation touches one runtime source file plus this Spec and Plan. Restoring the deleted functions and imports fully rolls back behavior; no State Ledger or persisted Plan migration exists.
2. **Verification Vanity**: A grep proving identifiers disappeared would not prove active behavior. U1 also runs tests that parse and normalize Plans, calculate signatures, validate Plans, and exercise the plugin-local CLI runtime. The grep is only a scope/reference check.
3. **Spec Dilution Detection**: Both confirmed requirements map to U1. CLI wrapper consolidation and stale-wrapper governance are explicitly excluded, while OpenCode in-process invocation remains explicitly deferred rather than silently dropped.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/runtime/plan_core.ts`, `tests/plan-validation.test.ts`, `tests/plugin-package-runtime.test.ts`, this Spec, and this Plan.
- compatibility: active parser and CLI exports remain unchanged; only repository-unused helpers are removed.
- interruption recovery: a partial source edit is restored or completed in one file, then the focused verification command is rerun.
- rollback path: restore the deleted functions and path imports; no schema or state rollback is required.
- verification strength: behavioral Bun tests, plugin-local `imm-plan --json`, a negative repository reference check, and `git diff --check`.
- Brainstorm traceability: every confirmed `BR-*` item is mapped; no open `BR-Q-*` remains.

## Steps

### Step 1

- Step ID: U1
- Result: Plan core exposes only the active helper surface covered by repository behavior
- Verification type: automated
- Verification: `bun test tests/plan-validation.test.ts tests/plugin-package-runtime.test.ts && ! git grep -n -E 'resolveSpecPath|inferProjectRootFromPlanPath|buildProofStep' -- 'plugins/immune-brain/runtime/**' 'tests/**' 'plugins/immune-brain/tests/**' && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-14-001-refactor-plan-core-idle-export-pruning-plan.md --json && git diff --check`
- Test scenarios: Covers existing Plan parsing and normalized Step output; Covers stable Plan signature generation; Covers Plan validation warnings and errors; Covers plugin-local CLI Plan validation; Covers no active runtime or test reference remains for the three removed helpers; Covers `normalizeSpecReference` and `canonicalizePlanPath` remaining available through existing tests and runtime use.
- Discovery cache: plugins/immune-brain/runtime/plan_core.ts (three declaration-only exports and affected path imports); tests/plan-validation.test.ts (parser, normalization, signature, and validator behavior); tests/plugin-package-runtime.test.ts (plugin-local CLI behavior); docs/specs/archive/2026-07-14-plan-core-idle-export-pruning.spec.md (accepted cleanup boundary)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If any runtime, focused test, or established package contract imports a removed helper, stop and return to Planner instead of adding a compatibility wrapper or widening the cleanup.
- security_considerations: No security-sensitive boundary changes; verification must not read or rewrite user State Ledger data beyond normal isolated test behavior.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-14-001-refactor-plan-core-idle-export-pruning-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-14-001-refactor-plan-core-idle-export-pruning-plan.md --sync`

## Notes

- No new abstraction, compatibility layer, dependency, or test file is planned.
- Execution begins through `imm-work`; Planner does not edit implementation code.
