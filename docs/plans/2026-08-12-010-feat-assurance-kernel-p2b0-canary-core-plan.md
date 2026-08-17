---
title: P2B0 Risk-Accepted Canary Core
kind: implementation
status: pending
created: 2026-08-12
spec: docs/specs/assurance-kernel-v4-p2b0-risk-accepted-canary-core.spec.md
workflow_profile: strict
compounder: required
---

# P2B0 Risk-Accepted Canary Core Plan

## Goal

Implement the host-neutral, non-routable core for one exact Pi Kernel canary while truthfully waiving only the remaining observation-window duration.

## Origin

The literal user directed the project to skip the remaining natural observation time. Current readiness is `collecting`, not `blocked`, with zero receipt/observation reconciliation gaps and sufficient lifecycle/family coverage, but the tracked evidence bundle and rollback rehearsal are not yet present. This Plan does not falsify readiness or enroll a real task. It implements the bounded waiver, enrollment transaction, v3 backend guard, and rehearsal core required before a separate Pi adapter can request exact-task confirmation.

## Decisions

- Only `observation_window_days` may be waived, for one task, one use, with explicit audit.
- All non-time readiness gates remain mandatory.
- P2B0 has no production issuer, CLI, host adapter, or actual enrollment path.
- TaskRecord v2, workspace working claim, and Kernel backend claim converge through one recoverable enrollment transaction.
- Active/draining Kernel claims block v3 managed mutations; read-only commands remain available.
- Rollback disables enrollment and drains/stops Kernel tasks; it never reconstructs v3 state or switches backend.

## Assumptions

- R2A receipts/observations, R2B readiness, R2C1 identity, and R2C2 mutation port remain reviewed and terminal.
- The literal user's current instruction is a policy risk acceptance for elapsed time only, not an enrollment confirmation for a specific TaskIntent.
- P2B1 will provide the only production issuer through Pi TUI `ctx.ui.confirm`.

## Scope Rules

- P2B0 does not modify Pi extension/package registration.
- No `imm-kernel` mutation subcommand, OpenCode/RPC route, LLM-callable tool, enrollment CLI, or environment-based override may be added.
- No real TaskRecord v2/backend claim may be created in the repository workspace during tests or rehearsal.
- Existing v3 behavior remains unchanged when no backend claim exists.

## Devil's Advocate Audit

- **Concern:** A waiver could silently turn readiness into `candidate`. **Resolution:** eligibility is a separate projection; readiness bytes/status remain unchanged and enrollment audit records actual `collecting` status.
- **Concern:** User text could mint enrollment privilege. **Resolution:** P2B0 has only an opaque capability contract and test issuer; production issuer is deferred to P2B1.
- **Concern:** Creating a TaskRecord without backend ownership allows v3 dual write. **Resolution:** TaskRecord/workspace/backend claim share one recoverable enrollment transaction and v3 guard.
- **Concern:** Backend claim sidecar can drift from TaskRecord/workspace. **Resolution:** exact hashes and one marker converge all three or fail closed.
- **Concern:** Rollback could imply backend switching. **Resolution:** rollback is enrollment-disable plus drain/authorized stop only.
- **Concern:** Scope may omit manifest/preflight owners. **Resolution:** canonical runtime and its exact-list/preflight tests are explicit Step 2 Scope owners.

## Steps

### Step 1

- Step ID: U1
- Result: One exact canary task can be mechanically eligible without falsifying ordinary readiness.
- Scope: plugins/immune-brain/runtime/kernel/canary_eligibility.ts; plugins/immune-brain/runtime/kernel/enrollment_authority.ts; tests/kernel-canary-eligibility.test.ts; tests/kernel-enrollment-authority.test.ts; tests/kernel-p2b0-boundary.test.ts
- Dependency: none
- Discovery cache: plugins/immune-brain/runtime/kernel/readiness.ts (readiness truth table); plugins/immune-brain/runtime/kernel/readiness_evidence.ts (evidence loader contract); plugins/immune-brain/runtime/kernel/authority_port.ts (opaque capability pattern); docs/specs/assurance-kernel-v4-p2b0-risk-accepted-canary-core.spec.md (authoritative canary-core contract)
- Test scenarios: ordinary candidate eligibility; collecting with only observation-window unmet plus exact waiver; blocked readiness rejection; reconciliation/digest/rehearsal/lifecycle/family rejection; live evidence bundle absent remains ineligible; capability task/intent/readiness/evidence mismatch; expiry and replay; non-time waiver rejection; R2C2 MutationAuthorityCapabilityV2 cross-capability confusion rejection; token/capability serialization invisibility; canonical index and runtime manifest expose no issuer/mutation/route
- Execution note: test-first; pure eligibility takes injected projections and synthetic `ReadinessEvidenceInput` values and performs no I/O; no test calls `loadReadinessEvidence` against the live repository; capability inspect/consume/test issuer remain private and production issuer absent.
- Verification: test -f tests/kernel-canary-eligibility.test.ts && test -f tests/kernel-enrollment-authority.test.ts && test -f tests/kernel-p2b0-boundary.test.ts && bun test tests/kernel-canary-eligibility.test.ts tests/kernel-enrollment-authority.test.ts tests/kernel-p2b0-boundary.test.ts tests/kernel-readiness.test.ts tests/kernel-readiness-evidence.test.ts tests/kernel-r2c2-boundary.test.ts && bun plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-010-feat-assurance-kernel-p2b0-canary-core-plan.md --json && git diff --check
- Rollback: remove pure canary eligibility and enrollment capability modules/exports while preserving R2A-R2C2 artifacts and readiness evidence.

### Step 2

- Step ID: U2
- Result: A confirmed Kernel backend claim is the sole managed mutation owner for its task.
- Scope: plugins/immune-brain/runtime/kernel/backend_claim.ts; plugins/immune-brain/runtime/kernel/enrollment.ts; plugins/immune-brain/runtime/kernel/storage.ts; plugins/immune-brain/runtime/immune_brain_runtime.ts; tests/kernel-enrollment-transaction.test.ts; tests/kernel-backend-claim.test.ts; tests/kernel-canary-rehearsal.test.ts; tests/kernel-migrate.test.ts; tests/imm-autowork-continuation-runtime.test.ts; tests/host-runtime-cutover.test.ts; tests/plugin-package-runtime.test.ts; tests/python-reference-boundary.test.ts
- Dependency: U1 closed
- Discovery cache: plugins/immune-brain/runtime/kernel/storage.ts (store lock and v1/v2 transaction recovery); plugins/immune-brain/runtime/kernel/application_v2.ts (existing TaskRecord v2 mutation port); plugins/immune-brain/runtime/immune_brain_runtime.ts (canonical dispatch/preflight); docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md (backend pinning and rollback invariants)
- Test scenarios: atomic absent-to-created TaskRecord/workspace/backend claim; marker-before-consume and consume-before-marker rejection; crashes at each rename boundary; contradictory partial bytes; every pairwise and all-three v1/v2/enrollment marker conflict; stale task/intent/readiness/evidence/capability/CAS rejection; active and draining claim reject v3 sync/activate/work/review/termination/autowork mutation; absent claim preserves v3 behavior; read-only status/progress/readiness remain available; enrollment-disabled drain; same-task Kernel completion/authorized stop; no v3 reconstruction; exact committed replay; live evidence bundle absent remains ineligible; full rehearsal injects synthetic evidence and emits strict evidence without touching source journals or repository TaskRecord/workspace
- Execution note: test-first; all eligibility and rehearsal tests inject synthetic `ReadinessEvidenceInput` values and use isolated temporary roots only; no test calls `loadReadinessEvidence` against the live repository and no production issuer or actual enrollment command is introduced.
- Verification: test -f tests/kernel-enrollment-transaction.test.ts && test -f tests/kernel-backend-claim.test.ts && test -f tests/kernel-canary-rehearsal.test.ts && bun test tests/kernel-enrollment-transaction.test.ts tests/kernel-backend-claim.test.ts tests/kernel-canary-rehearsal.test.ts tests/kernel-migrate.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts tests/python-reference-boundary.test.ts && bun test && bun plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-010-feat-assurance-kernel-p2b0-canary-core-plan.md --json && git diff --check
- Rollback: remove enrollment/backend-claim/rehearsal core and canonical v3 guard; recover any isolated test marker; preserve all prior P2A records and no production TaskRecord/backend claim.

## Verification Approach

- Each explicit test path must exist before Bun execution.
- QA must re-run focused and full-repository tests from the shared workspace and inspect exact transaction/guard boundaries.
- Final review must verify no production issuer, host adapter, CLI mutation, OpenCode/RPC route, enrollment side effect, or readiness falsification was introduced.
- Repository TaskRecord/workspace/backend-claim, Ledger, receipt, observation, readiness evidence, and migration-manifest bytes must remain unchanged by live smoke.

## Next Action

Run `imm-loop` to activate U1 after Plan validation and sync. P2B1 Pi adapter remains a separate successor Plan.
