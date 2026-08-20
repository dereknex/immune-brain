# Plan: Assurance Kernel P2B-Readiness Projection Scope Repair

**plan_format**: v2
**Plan ID**: 2026-08-11-007
**Type**: fix
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-11
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/archive/assurance-kernel-v4-p2b-readiness.spec.md
**Predecessor**: docs/plans/2026-08-11-006-feat-assurance-kernel-p2b-readiness-plan.md (QA replan; supersession required before sync)

## Goal

Close the existing read-only `assurance_kernel/readiness_report/v1` implementation by repairing the immutable Step Scope to include the canonical package manifest parity owner, without changing the R2B product or authority boundary.

## Origin

Strict QA on Plan `2026-08-11-006` found no implementation behavior defect. Focused verification passed 46/46, but the full suite failed because `tests/plugin-package-runtime.test.ts` owns an exact `imm-kernel` subcommand/example assertion and was omitted from the activated Step Scope. The existing correct canonical manifest adds `readiness`, so the test must be updated inside a replacement Plan rather than modified outside Scope.

## Research

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` owns the canonical `imm-kernel` manifest, examples, dispatcher, and `projectAccess="read"` classification.
- `tests/plugin-package-runtime.test.ts` owns package-level exact manifest parity and currently expects the pre-R2B subcommand list.
- Plan `2026-08-11-006` focused tests passed 46/46; full `bun test` reached 645 pass / 1 fail, with the single failure in the omitted exact-list owner.
- QA classified the omission as structural replan, not same-Scope rework.

## Decisions

- Reuse the unchanged R2B Spec and current partial implementation.
- Add only `tests/plugin-package-runtime.test.ts` to the executable Scope and focused Verification.
- Preserve all R2B read-only/non-authoritative constraints; no producer, routing, issuer, TaskRecord, Intent, or import changes.
- Do not inherit predecessor execution attempts, QA decisions, or gate evidence; rerun all verification fresh under this Plan.

## Assumptions

- The current working-tree implementation remains the intended R2B implementation baseline.
- The package manifest parity failure remains the only full-suite failure after updating the exact readiness subcommand/example expectations.
- No further package metadata file is required because `imm-kernel` already exists as the canonical packaged command.

## Output Language

Spec and Plan prose use English. Schema fields, CLI commands, file paths, JSON keys, enum values, Step IDs, and contract identifiers remain literal.

## Devil's Advocate Audit

- **Rollback resilience**: If the Step fails, remove the R2B readiness projector/evidence modules and readiness route, restore the R2A boundary expectation that readiness is absent, and restore the package manifest exact-list expectation. R2A receipt/observation behavior remains untouched.
- **Verification vanity**: Focused verification includes the previously failing package exact-list owner and the full suite. It fails if readiness is absent from the canonical manifest, if the package contract is stale, if readiness gains authority writes, or if any repository regression remains.
- **Spec dilution detection**: No R2B acceptance criterion is narrowed. This replacement changes only Scope completeness and verification ownership; the pure projector, evidence loader, canonical read route, sticky blocking, lifecycle/window policy, and no-authority-write requirements remain unchanged.

## Steps

### Step 1

- Step ID: U1
- Result: `imm-kernel readiness --json` emits a deterministic read-only `assurance_kernel/readiness_report/v1` whose status classification exactly follows the Spec promotion conditions for the supplied evidence.
- Scope: `plugins/immune-brain/runtime/kernel/readiness.ts`; `plugins/immune-brain/runtime/kernel/readiness_evidence.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-readiness-evidence.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-r2a-boundary.test.ts`; `tests/plugin-package-runtime.test.ts`
- Discovery cache: `docs/plans/2026-08-11-006-feat-assurance-kernel-p2b-readiness-plan.md` (predecessor implementation and QA replan evidence); `tests/plugin-package-runtime.test.ts` (canonical package manifest exact-list owner omitted by predecessor Scope); `plugins/immune-brain/runtime/authority_commit_receipts.ts` (receipt v2 reader and lifecycle actions); `plugins/immune-brain/runtime/kernel/automatic_observations.ts` (observation v2 schema and reader); `plugins/immune-brain/runtime/commands/kernel.ts` (readiness route and shared migration report digest); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (canonical manifest and read-only project access)
- Verification: `test -f plugins/immune-brain/runtime/kernel/readiness.ts && test -f plugins/immune-brain/runtime/kernel/readiness_evidence.ts && bun test tests/kernel-readiness.test.ts tests/kernel-readiness-evidence.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts tests/kernel-r2a-boundary.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-007-fix-assurance-kernel-p2b-manifest-scope-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; retain the predecessor implementation, first update the package exact manifest assertions to include the canonical `readiness` subcommand/example, then rerun the complete projector/evidence/CLI/package/full-suite verification. Do not treat predecessor execution or QA evidence as current evidence.
- failure_behavior: Any receipt/observation integrity failure, version or generation discontinuity, divergence, malformed or stale evidence bundle, digest mismatch, failed rehearsal, or canonical manifest/package parity mismatch fails closed. If closure requires changing R2A producer contracts or any authority write, stop and replan.
- security_considerations: Readiness remains operational evidence, not authority. The loader enforces containment, no-symlink, bounded size, strict schema, Git-clean state, freshness, and read identity; the route must remain `projectAccess="read"` and expose no enrollment, issuer, mutation, import, or backend switch.
- Test scenarios: Covers empty epoch collecting; Covers exact receipt-observation reconciliation; Covers sticky blocked generation; Covers UTC 13/14-day boundaries; Covers distinct lifecycle and family coverage; Covers missing/invalid/stale/dirty evidence bundles; Covers migration digest recomputation; Covers v1 diagnostic-only counts; Covers canonical manifest/help/read classification; Covers exact package manifest parity including readiness; Covers one non-qualifying friction event; Covers Ledger/TaskRecord/workspace/Intent/receipt/observation/manifest byte identity; Covers candidate only when every condition holds; Covers full repository regression suite.

## Plan Closure Verification

- Run the Step Verification command exactly as written.
- Live smoke: `plugins/immune-brain/bin/imm-kernel readiness --json` emits a valid report with status in `{blocked, collecting, candidate}`, appends exactly one non-qualifying friction event, and leaves Ledger, TaskRecord, workspace, Intent, receipt/observation journals, and migration manifests byte-identical.
- Final review gate: `imm-code-review` over the full current change set.

## Rollback Plan

Delete `readiness.ts`, `readiness_evidence.ts`, the readiness route and canonical manifest value, and the readiness test files; restore R2A boundary and package exact-list expectations. Do not modify R2A receipt/observation producers.

## Notes

- This is a minimal replacement for Plan `2026-08-11-006`; it repairs immutable Scope ownership only.
- R2C (TaskIntent v1, TaskRecord v2, reducer/authority port) and P2B canary enrollment remain separate successor candidates.
