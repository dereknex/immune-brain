# Plan: Assurance Kernel P2B1 Enrollment Scope Repair

**plan_format**: v2
**Plan ID**: 2026-08-12-012
**Type**: fix
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-12
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/assurance-kernel-v4-p2b1-pi-confirmed-enrollment.spec.md
**Predecessor**: docs/plans/2026-08-12-011-feat-assurance-kernel-p2b1-pi-confirmed-enrollment-plan.md (U1 closed; U2 QA replan; supersession required before sync)

## Goal

Close the existing P2B1 Pi-confirmed enrollment implementation by repairing the immutable U2 Scope to include the extension-local runtime adapter and the two exact readiness contract owners required by extension TypeScript verification, without changing the P2B1 behavior, authority boundary, or current dormant-route posture.

## Task

Replace only predecessor Step U2. Predecessor U1 remains closed evidence for the read-only preparation identity and is not repeated by this Plan.

## Output Language

Spec and Plan prose use English. Schema fields, CLI commands, file paths, JSON keys, enum values, Step IDs, and contract identifiers remain literal.

## Origin

Strict QA on predecessor Plan `2026-08-12-011` confirmed that the P2B1 implementation behavior is focused-test clean, but predecessor U2 is structurally uncloseable because three required files are outside its immutable Scope. `plugins/immune-brain/.pi-extension/runtime-stub.ts` is the `tsconfig` path-remap owner that isolates extension type checking from the cumulative runtime graph. `plugins/immune-brain/runtime/kernel/storage.ts` owns the `readiness_query_nonqualifying` journal reason consumed by the readiness query. `plugins/immune-brain/runtime/commands/kernel.ts` owns the required `ProjectReadinessInput.legacy_counts` value. QA explicitly found that `plugins/immune-brain/runtime/kernel/intent.ts` is type-only and not required by U2.

## Research

- Predecessor U1 is `closed`; replacement work must not recreate or mutate its Plan contract.
- The predecessor U2 focused enrollment/package/kernel tests pass, and the extension-local `tsc` gate passes only with `runtime-stub.ts` present in the extension `tsconfig` include/path mappings.
- `runtime-stub.ts` forwards dynamically to the real Kernel modules while presenting structural extension-local types, so it is part of the shipped Pi adapter boundary rather than unrelated runtime cleanup.
- `storage.ts` requires only the additive non-authoritative journal reason `readiness_query_nonqualifying` for this replacement boundary.
- `commands/kernel.ts` requires only the explicit `legacy_counts` input needed by the readiness projection consumed by P2B1 preparation.
- `tests/kernel-shadow-cli.test.ts` exercises both readiness projection and the non-qualifying journal reason; it belongs in focused Verification but requires no replacement-Scope edit unless fresh evidence exposes a direct P2B1 regression.
- Read-only hostile review found no fourth owner required by this Scope repair and confirmed that `intent.ts` stays excluded; it required explicit final-lock owner equality, same-revision Intent content drift, timeout/abort/replay/reentry, packed runtime-stub loading, and live zero-write coverage, all retained in this Plan's Verification and test scenarios.
- Existing P2B1 Spec behavior and Technical Design remain valid; this is a Plan boundary repair, not a Spec change.

## Decisions

1. Reuse the unchanged P2B1 Spec and current partial implementation.
2. Replace only predecessor U2 with one independently closable Step; do not copy predecessor U1 into the replacement Plan.
3. Add exactly `plugins/immune-brain/.pi-extension/runtime-stub.ts`, `plugins/immune-brain/runtime/kernel/storage.ts`, and `plugins/immune-brain/runtime/commands/kernel.ts` to the predecessor U2 Scope.
4. Constrain `storage.ts` to the `readiness_query_nonqualifying` journal reason and `commands/kernel.ts` to the `ProjectReadinessInput.legacy_counts` input for this Step. Any broader change in either owner requires replan.
5. Exclude `plugins/immune-brain/runtime/kernel/intent.ts` and unrelated prior-Plan accumulations from Scope.
6. Do not inherit predecessor execution attempts, QA decisions, or review-gate evidence; rerun all verification fresh under this Plan.
7. Preserve the dormant production route: current missing live evidence must reject before confirmation and produce zero authoritative writes.

## Assumptions

- The current working-tree implementation remains the intended P2B1 implementation baseline.
- The three QA-confirmed omitted owners are the complete Scope delta required to close predecessor U2.
- No root dependency metadata change is required beyond the existing P2B1 `package.json` extension registration.
- Predecessor U1 behavior remains available and is covered by cumulative verification rather than repeated execution.

## Plan Boundary

This Plan is one coherent replacement slice: the Pi command, its private enrollment authority, extension-local type adapter, package registration, exact readiness inputs, and route/package/enrollment tests share one authority, verification, rollback, and review boundary. Readiness architecture, TaskIntent design, TaskRecord v2 mutation, and real canary enrollment remain outside this repair.

## Boundary Rationale

The three added owners are not independent cleanup. They are direct compile-time or runtime inputs to the same P2B1 command route and are required for its recorded Verification to close. Splitting them would leave the enrollment Step unverifiable, while widening into adjacent readiness or Intent work would cross a separate completed Plan boundary.

## Scope Pressure

The Step spans the Pi extension, Kernel enrollment/readiness edges, root package manifest, and focused contract tests. Retain one Step because these files jointly prove one published enrollment route and roll back as one dormant adapter; constrain the two shared runtime owners to their exact additive fields to prevent scope drift.

## Devil's Advocate Audit

- **Rollback resilience**: Remove the root extension registration, extension entry, runtime stub, production authority wiring, and P2B1-specific tests; restore only the two additive readiness fields if no other closed Plan consumes them. Preserve predecessor U1, P2B0 core, R2B readiness implementation, historical journals, and any pinned Kernel task. Partial execution must leave the current missing-evidence route unable to confirm or write.
- **Verification vanity**: Verification includes the extension-local `tsc` gate that exposed the Scope defect, the readiness/journal owner test, real package and loader boundaries, packed-artifact runtime-stub loading, complete final-lock owner equality including same-revision Intent content drift, timeout/abort/replay/reentry behavior, packlist inspection, live no-evidence zero-write rejection, full repository regression, and Plan validation. It fails on a missing adapter, stale readiness input, unregistered or overexposed route, shipped test issuer, confirmation-before-evidence, authority drift, or unrelated repository regression.
- **Spec dilution detection**: No accepted P2B1 requirement is narrowed. The replacement preserves sole-route authority, TUI-only confirmation, post-confirm/final-lock freshness, cancellation/replay rejection, package exclusion, synthetic enrollment coverage, current zero-write behavior, and full rollback semantics. Only immutable Scope completeness changes.

## Steps

### Step 1

- Step ID: U1
- Result: One project-local Pi TUI command is the sole shipped route that can complete confirmed canary enrollment.
- Scope: `plugins/immune-brain/.pi-extension/imm-canary-enroll.ts`; `plugins/immune-brain/.pi-extension/runtime-stub.ts`; `plugins/immune-brain/.pi-extension/tsconfig.json`; `plugins/immune-brain/runtime/kernel/enrollment_authority.ts`; `plugins/immune-brain/runtime/kernel/enrollment.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `package.json`; `tests/fixtures/enrollment-capability-test-seam.ts`; `tests/pi-canary-enroll-extension.test.ts`; `tests/pi-canary-package-boundary.test.ts`; `tests/kernel-enrollment-authority.test.ts`; `tests/kernel-canary-eligibility.test.ts`; `tests/kernel-canary-rehearsal.test.ts`; `tests/kernel-enrollment-transaction.test.ts`; `tests/kernel-p2b0-boundary.test.ts`; `tests/plugin-package-runtime.test.ts`; `tests/roadmap-plan-host-acceptance.test.ts`
- Discovery cache: `docs/plans/2026-08-12-011-feat-assurance-kernel-p2b1-pi-confirmed-enrollment-plan.md` (predecessor U1 closure and U2 QA replan evidence); `docs/specs/assurance-kernel-v4-p2b1-pi-confirmed-enrollment.spec.md` (Technical Design authority); `plugins/immune-brain/.pi-extension/runtime-stub.ts` (extension-local type and runtime forwarding boundary); `plugins/immune-brain/.pi-extension/tsconfig.json` (path remap and isolated type-check owner); `plugins/immune-brain/runtime/kernel/storage.ts` (`readiness_query_nonqualifying` journal reason only); `plugins/immune-brain/runtime/commands/kernel.ts` (`ProjectReadinessInput.legacy_counts` only); `plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts` (closed predecessor U1 preparation identity); `package.json` (root Pi package authority)
- Verification: `test -f plugins/immune-brain/.pi-extension/imm-canary-enroll.ts && test -f plugins/immune-brain/.pi-extension/runtime-stub.ts && test -f plugins/immune-brain/.pi-extension/tsconfig.json && test -f tests/fixtures/enrollment-capability-test-seam.ts && test -f tests/pi-canary-enroll-extension.test.ts && test -f tests/pi-canary-package-boundary.test.ts && bun test tests/pi-canary-enroll-extension.test.ts tests/pi-canary-package-boundary.test.ts tests/kernel-enrollment-authority.test.ts tests/kernel-canary-eligibility.test.ts tests/kernel-canary-rehearsal.test.ts tests/kernel-enrollment-transaction.test.ts tests/kernel-p2b0-boundary.test.ts tests/kernel-shadow-cli.test.ts tests/plugin-package-runtime.test.ts tests/roadmap-plan-host-acceptance.test.ts tests/kernel-pi-canary-prepare.test.ts tests/kernel-pi-canary-live-boundary.test.ts && bun x tsc --noEmit -p plugins/immune-brain/.pi-extension/tsconfig.json && bun install --frozen-lockfile && npm pack --dry-run --json && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-012-fix-assurance-kernel-p2b1-enrollment-scope-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: characterization-first; retain the predecessor implementation and first prove the three omitted owners are the only required delta. In `storage.ts`, permit only the `readiness_query_nonqualifying` journal reason. In `commands/kernel.ts`, permit only the explicit `legacy_counts` readiness input. Do not treat predecessor execution or QA evidence as current evidence.
- failure_behavior: Any non-TUI path, missing or stale evidence, tuple drift, timeout, cancellation, replay, registry mismatch, rehearsal failure, final-lock mismatch, package-route mismatch, type-check failure, or out-of-Scope change fails closed. If closure requires modifying `intent.ts`, widening readiness behavior, changing TaskRecord v2 contracts, or adding another host/CLI/tool route, stop and replan.
- security_considerations: The extension activation closure remains the sole holder of the production registry. No shipped test issuer, callback approval bridge, serialized authority, CLI/runtime/OpenCode/RPC/JSON/print route, or automatic enrollment handler may exist. Current live missing evidence must reject before `ctx.ui.confirm` and preserve authoritative bytes.
- Test scenarios: Covers extension-local runtime adapter loading; Covers packed-artifact runtime-stub dynamic loading against the real Kernel modules; Covers isolated TypeScript path remaps; Covers exact `legacy_counts` readiness input; Covers non-qualifying readiness journal reason; Covers isolated authority registries and cross-registry rejection; Covers exact root extension registration and one-command loader surface; Covers zero tool/flag/shortcut/automatic routes; Covers exact args and TUI-only mode matrix; Covers missing evidence before confirmation; Covers timeout, AbortSignal cancellation, late true, duplicate reentry, and one-shot continuation replay; Covers deterministic internally derived confirmation reference and caller-field rejection; Covers post-confirm owner drift; Covers final-lock equality for canonical root/state path, Ledger bytes/revision, receipt and observation journals, migration/readiness generation and digest, evidence bytes/digest, Intent identity/revision/content hash, waiver/capability tuple, workspace, TaskRecord, backend claim, and transaction markers; Covers same-revision Intent content drift; Covers rehearsal failure and synthetic isolated enrollment; Covers removal and package exclusion of the test issuer; Covers no CLI/runtime/OpenCode/RPC/JSON/print enrollment surface; Covers live pre-confirmation zero-write rejection with authoritative byte identity; Covers package/host parity; Covers predecessor U1 preparation regression; Covers full repository regression.

## Plan Closure Verification

- Run the Step Verification command exactly as written with fresh current-file signatures.
- Confirm `git diff` for `plugins/immune-brain/runtime/kernel/storage.ts` is limited to the required journal-reason contract attributable to this replacement and `plugins/immune-brain/runtime/commands/kernel.ts` is limited to the required readiness input attributable to this replacement.
- Live smoke must reject before confirmation because the governed readiness evidence bundle is absent and must leave Ledger, receipts, observations, evidence, Intent, TaskRecords, workspace, backend claim, and transaction markers byte-identical.
- Packed-artifact verification must load the shipped extension through `runtime-stub.ts` against the real Kernel modules; source-presence or packlist membership alone is insufficient.
- Synthetic final-lock verification must mutate every bound owner independently, including Intent content with an unchanged revision, and prove each drift burns or rejects authority before authoritative writes.
- Final review gate: `imm-code-review` over the complete replacement changed-files signature.

## Rollback Plan

Remove `package.json` extension registration, the Pi extension entry, runtime stub, production authority wiring, and P2B1-specific tests. Restore only the P2B1-attributable additive readiness fields if no closed predecessor consumes them. Preserve the closed U1 preparation module, P2B0 enrollment core, R2B readiness system, R2C1/R2C2 contracts, historical journals, and any real Kernel state.

## Notes

- This is a minimal replacement for predecessor U2; it repairs immutable Scope ownership only.
- Predecessor U1 remains closed and is not re-executed as a Step, but its behavior is included in cumulative verification.
- Actual canary enrollment remains a later exact-task Pi TUI operation after governed live evidence exists.
