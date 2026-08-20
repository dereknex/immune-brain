# Plan: Assurance Kernel P2B-Readiness Projection

**plan_format**: v2
**Plan ID**: 2026-08-11-006
**Type**: feat
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-11
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/archive/assurance-kernel-v4-p2b-readiness.spec.md
**Predecessor**: docs/plans/2026-08-11-005-fix-assurance-kernel-p2a-exact-observation-plan.md (terminal: finish_reset)

## Goal

Deliver the read-only `assurance_kernel/readiness_report/v1` projection over R2A v2 evidence: a pure readiness projector, a deterministic lifecycle/family classifier, an external evidence-bundle loader, and the canonical `imm-kernel readiness --json` route, with zero authority writes and no enrollment or routing.

## Risks

- Window math errors produce false candidates; mitigate with UTC inclusive-day tests at exact boundaries.
- Lifecycle detection could match partial sequences; mitigate with strict family ordering and distinct Plan paths.
- Evidence bundle could be forged by the same process that computes it; mitigate with Git-tracked + clean + containment + window checks, documented as not tamper-proof.
- Readiness reintroduction could regress R2A v1 compatibility; mitigate with legacy-counts-only handling and strict v2 validation.

## Devil's Advocate Audit

- **Adversarial reviewer (foreground, R2 planning)**: flagged oversized scope, cross-Step mutable overlap, missing seed replay, hidden first-observation gap, and unverifiable evidence-bundle freshness. Addressed by: single-Step projection-only scope, R2A terminal-seed input contract, epoch from first v2 prepared receipt, Git-clean windowed bundle.
- **Late observation-repair advisory**: v1 records readable but never qualifying; implemented via legacy_counts and strict v2 gates.
- **Boundary review (final R2 split)**: readiness is the only projection added here; TaskIntent/reducer remain R2C; no mixed rollback boundary.
- **Residual risk**: lifecycle classification depends on v3 history action names; a rename fails closed toward `collecting`, detected by family-coverage tests.
- **Out of scope**: any change to receipt/observation producers; R2A contracts consumed as-is.

## Steps

### Step 1

- Step ID: U1
- Result: `imm-kernel readiness --json` emits a deterministic read-only `assurance_kernel/readiness_report/v1` whose status classification exactly follows the Spec promotion conditions for the supplied evidence.
- Scope: `plugins/immune-brain/runtime/kernel/readiness.ts`; `plugins/immune-brain/runtime/kernel/readiness_evidence.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-readiness-evidence.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-r2a-boundary.test.ts`
- Discovery cache: `plugins/immune-brain/runtime/authority_commit_receipts.ts` (receipt records and canonical lifecycle history action names); `plugins/immune-brain/runtime/kernel/automatic_observations.ts` (observation v2 schema and reader); `plugins/immune-brain/runtime/commands/kernel.ts` (kernel subcommand wiring, canonical migration dry-run report builder/serializer, and non-qualifying journal event); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (canonical command manifest, help, migration preflight, and read-only project-access classification); `plugins/immune-brain/runtime/kernel/storage.ts` (path security patterns); `docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md` (D3 promotion conditions); `docs/specs/archive/assurance-kernel-v4-p2a-observation-r2.spec.md` (evidence classification); `tests/kernel-r2a-boundary.test.ts` (boundary expectations to update)
- Verification: `test -f plugins/immune-brain/runtime/kernel/readiness.ts && test -f plugins/immune-brain/runtime/kernel/readiness_evidence.ts && bun test tests/kernel-readiness.test.ts tests/kernel-readiness-evidence.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts tests/kernel-r2a-boundary.test.ts tests/host-runtime-cutover.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-006-feat-assurance-kernel-p2b-readiness-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; pure projector takes injected (receipts, observations, bundle, current migration report digest, now) and performs no I/O; the CLI layer only reads journals and the bundle, recomputes the migration report digest through the shared in-process builder, computes the report, and journals exactly one non-qualifying invocation event. Canonical runtime tests must prove manifest/help registration, `projectAccess="read"`, migration preflight, and argument forwarding.
- failure_behavior: Missing observations, field mismatches, version or generation discontinuity, divergence, malformed records, invalid bundles/digest recomputation, or failed rehearsal produce sticky `blocked` for the current epoch; short windows, thin lifecycle coverage, or a missing bundle produce `collecting`; never candidate and never a partial write. If closure requires changing R2A producer contracts or any authority write, stop and replan.
- security_considerations: Readiness is operational evidence, not tamper-proof audit; the bundle loader enforces containment, no-symlink, size, schema, Git-clean, and window freshness; the report exposes bounded counts and reason codes only.
- Test scenarios: Covers empty v2 journal epoch_empty; Covers normative UTC formula at 13-day and 14-day boundaries; Covers terminal receipt without observation missing_observation; Covers observation field mismatch including state_path_identity binding_mismatch; Covers observer version change version_discontinuity and sticky blocked until generation change; Covers lifecycle classification using `record_execution_evidence` and canonical `record_work_probe_evidence`, lifecycle without an activation receipt, optional activation ordering, repeated plan_path rejection, two-lifecycle lifecycle_coverage, and required family coverage; Covers missing bundle evidence_bundle_missing and malformed/dirty/digest-mismatched bundle blocked; Covers deterministic canonical migration-report bytes and digest recomputation through the shared in-process builder; Covers a subprocess-spawn failure sentinel and no migration-manifest writes; Covers v1 records in legacy_counts only; Covers divergence shadow_divergence; Covers manifest/help registration, projectAccess read classification, canonical migration preflight, and argv forwarding; Covers exactly one non-qualifying friction journal event per readiness invocation and complete friction-journal exclusion from projector inputs; Covers byte snapshots for Ledger, TaskRecord, workspace, Intent, receipt, observation, and migration manifests; Covers candidate only when all conditions hold.

## Plan Closure Verification

- Step verification commands above plus a live smoke: `plugins/immune-brain/bin/imm-kernel readiness --json` against the real workspace emits a valid `assurance_kernel/readiness_report/v1` with status in `{blocked, collecting, candidate}`, appends exactly one non-qualifying friction event, and leaves Ledger, TaskRecord, workspace, Intent, receipt/observation journals, and migration manifests byte-identical. The smoke does not assume the workspace remains below 14 days or non-candidate.
- Final review gate: `imm-code-review` over the full change set.

## Rollback Plan

Delete `readiness.ts`, `readiness_evidence.ts`, the readiness route in `commands/kernel.ts`, and the readiness test files; restore the R2A boundary expectation that the route is absent. R2A receipt/observation behavior is untouched.

## Notes

- R2B is the readiness projection slice only. R2C (TaskIntent v1, TaskRecord v2, reducer boundary) and P2B (Pi canary) remain separate successor Plans.
- The readiness report never authorizes anything; P2B promotion additionally requires literal user approval.
