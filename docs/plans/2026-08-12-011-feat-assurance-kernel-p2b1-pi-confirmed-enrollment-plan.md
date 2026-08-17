---
title: Assurance Kernel P2B1 Pi Confirmed Enrollment Plan
type: feat
status: active
date: 2026-08-12
risk: high
workflow_profile: strict
spec: docs/specs/assurance-kernel-v4-p2b1-pi-confirmed-enrollment.spec.md
parent_spec: docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md
predecessor: docs/plans/2026-08-12-010-feat-assurance-kernel-p2b0-canary-core-plan.md
---

# Assurance Kernel P2B1 Pi Confirmed Enrollment Plan

## Goal

Ship one dormant Pi TUI-only exact-task enrollment route whose read-only preparation rejects the current missing live evidence before confirmation, and whose sole published authority path performs host confirmation, complete post-confirm/final-lock revalidation, rehearsal, and P2B0 atomic enrollment without exposing a callback-based approval API, shipped test issuer, CLI/tool/RPC/OpenCode route, or automatic enrollment event.

## Origin

The user explicitly accepted skipping only the natural 14-day observation window and requested P2B1 planning. P2B0 delivered eligibility, time-only waiver policy, EnrollmentCapability validation, rehearsal, atomic enrollment, backend claims, and the v3 write guard, but intentionally shipped no production host route. P2B1 adds the Pi host boundary while current live evidence remains missing and no real enrollment is performed.

## Research Summary

### External Research

- Pi packages load extension paths from the root `pi.extensions` manifest.
- `pi.registerCommand` registers a user-entered slash command and is not an LLM-callable tool.
- Only `ctx.mode === "tui"` is accepted; RPC has UI support and therefore `ctx.hasUI` is insufficient.
- `ctx.ui.confirm` supports bounded timeout and AbortSignal cancellation and returns false on cancellation or timeout.
- JavaScript module brands do not authenticate against arbitrary malicious code in the same process; P2B1 proves published-route exclusivity and fail-closed identity checks instead.

### Repository Research

- P2B0 authority and enrollment live in `kernel/enrollment_authority.ts` and `kernel/enrollment.ts`; the runtime still exports `createEnrollmentCapabilityForTest`, which must leave shipped source.
- R2B readiness/evidence owners are `kernel/readiness.ts`, `kernel/readiness_evidence.ts`, and `commands/kernel.ts`.
- R2C1 secure Intent identity lives in `kernel/intent.ts`; P2B0 transaction/backend guards are already closed.
- Root `package.json` is the single Pi package authority and currently publishes Skills only.
- Current live repository has no `docs/evidence/assurance-kernel/readiness.json`, so the command must refuse before confirmation and preserve all authority/evidence bytes.

## Key Decisions

1. U1 delivers only read-only prepare/revalidate operations; it cannot confirm, mint, rehearse, or enroll.
2. U2 is the sole production authority Step and owns Pi confirmation, production authority migration, final-lock checks, package registration, and host tests.
3. No public API accepts a caller-supplied affirmative callback, serialized witness, actor, nonce, confirmation reference, `authorized`, or `user_confirmed` value.
4. Remove the shipped `createEnrollmentCapabilityForTest`; tests use a fixture excluded from packed artifacts.
5. Revalidate root, Ledger, receipts, observations, migration report, readiness, evidence, Intent, workspace, TaskRecord, backend claim, and transaction markers after confirmation and at the enrollment lock boundary.
6. Root `package.json` adds one extension path; no nested npm package is created and `bun.lock` changes only if dependency metadata truly changes.
7. Completion proves a dormant production route, not current live enrollment readiness.

## Devil's Advocate Audit

- **A true callback is forgeable:** U1 has no confirmation callback or mutation continuation; U2 owns confirmation and authority inside the extension route.
- **A test issuer is a production issuer if shipped:** the runtime test issuer is removed and packlist checks exclude test fixtures.
- **Module provenance is not host authentication:** the threat model does not claim protection from arbitrary same-process code; route exclusivity is proven across package, command, tool, CLI, RPC, JSON, print, OpenCode, and lifecycle surfaces.
- **Post-confirm state can drift again:** final-lock equality covers every mutable owner, including Intent content hash and backend/workspace/transaction absence.
- **RPC has UI:** the extension requires exact `ctx.mode === "tui"` before readiness reads or confirmation.
- **Timeout can resolve late:** the adapter burns a one-shot continuation before asynchronous post-confirm work and ignores late or repeated completion.
- **Current evidence is missing:** live tests assert confirm count zero and byte identity; synthetic success is not live authority evidence.
- **Package registration can drift:** root manifest, package parity, host acceptance, real extension loader, and packlist owners are in U2 Scope.

## Assumptions

- P2B0 and R2C1/R2C2 terminal contracts remain available.
- The root package remains the Pi package discovery authority.
- Same-user arbitrary code execution inside the extension process is outside the capability threat model.
- Actual first enrollment remains a later exact-task Pi command after a governed live evidence bundle exists.

## Steps

### Step 1

- Step ID: U1
- Result: One immutable preparation identity governs the read-only canary preview.
- Scope: plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts; tests/kernel-pi-canary-prepare.test.ts; tests/kernel-pi-canary-live-boundary.test.ts
- Discovery cache: plugins/immune-brain/runtime/kernel/canary_eligibility.ts (waiver policy); plugins/immune-brain/runtime/kernel/readiness.ts (readiness report); plugins/immune-brain/runtime/kernel/readiness_evidence.ts (tracked evidence); plugins/immune-brain/runtime/kernel/intent.ts (secure Intent reader); plugins/immune-brain/runtime/commands/kernel.ts (canonical migration digest); plugins/immune-brain/runtime/kernel/backend_claim.ts (backend claim); docs/specs/assurance-kernel-v4-p2b1-pi-confirmed-enrollment.spec.md (contract)
- Test scenarios: malformed task ID; missing live evidence rejects; blocked readiness rejects; synthetic candidate; synthetic time-only waiver; canonical root/state path; Ledger/receipt/observation/migration/readiness/evidence/Intent tuple; workspace/TaskRecord/backend/marker absence; immutable preview; deterministic digest; revalidation equality; each owner drift; direct import has no confirm/mint/rehearse/enroll function; live byte identity
- Verification: `test -f plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts && test -f tests/kernel-pi-canary-prepare.test.ts && test -f tests/kernel-pi-canary-live-boundary.test.ts && bun test tests/kernel-pi-canary-prepare.test.ts tests/kernel-pi-canary-live-boundary.test.ts tests/kernel-canary-eligibility.test.ts tests/kernel-readiness.test.ts tests/kernel-readiness-evidence.test.ts tests/kernel-intent-v2.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-011-feat-assurance-kernel-p2b1-pi-confirmed-enrollment-plan.md --json && git diff --check`
- Test type: integration
- Test scenarios order: syntax -> live rejection -> synthetic eligibility -> tuple -> per-owner drift -> no-authority surface -> live byte identity
- Verification tiers: target=8; surface=7; regression=8; live=8; cumulative=8
- Risks: preparation accidentally performs I/O writes or exposes an authorization continuation; digest omits a mutable owner
- Mitigations: read-only module boundary; exhaustive tuple tests; source/export assertions; before/after byte snapshots
- Rollback: remove preparation module and tests; preserve P2B0 and all historical evidence

### Step 2

- Step ID: U2
- Result: One project-local Pi TUI command is the sole shipped route that can complete confirmed canary enrollment.
- Scope: plugins/immune-brain/.pi-extension/imm-canary-enroll.ts; plugins/immune-brain/.pi-extension/tsconfig.json; plugins/immune-brain/runtime/kernel/enrollment_authority.ts; plugins/immune-brain/runtime/kernel/enrollment.ts; package.json; tests/fixtures/enrollment-capability-test-seam.ts; tests/pi-canary-enroll-extension.test.ts; tests/pi-canary-package-boundary.test.ts; tests/kernel-enrollment-authority.test.ts; tests/kernel-canary-eligibility.test.ts; tests/kernel-canary-rehearsal.test.ts; tests/kernel-enrollment-transaction.test.ts; tests/kernel-p2b0-boundary.test.ts; tests/plugin-package-runtime.test.ts; tests/roadmap-plan-host-acceptance.test.ts
- Discovery cache: /Users/derek/.local/share/mise/installs/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md (`registerCommand`, command contexts); /Users/derek/.local/share/mise/installs/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md (`ctx.ui.confirm`); /Users/derek/.local/share/mise/installs/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/packages.md (`pi.extensions`); /Users/derek/.local/share/mise/installs/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/timed-confirm.ts (timeout/AbortSignal); plugins/immune-brain/runtime/kernel/pi_canary_prepare.ts (U1 read-only tuple); plugins/immune-brain/runtime/kernel/enrollment.ts (atomic enrollment); package.json (root package authority)
- Test scenarios: authority singleton migration to explicit registries; isolated production registry held only in extension activation closure; test fixture creates isolated registries; cross-registry capability rejection; exact root extension path; real Pi loader registers exactly one command; zero tools/flags/shortcuts/automatic enrollment handlers; exact command args; TUI-only mode matrix; missing evidence before confirm; timeout; AbortSignal cancel; late true; duplicate handler/reentry; one-shot continuation; deterministic confirmation_ref golden vector; caller cannot supply actor/nonce/ref/waiver; post-confirm per-owner drift; final-lock Intent content hash and all-state equality; rehearsal failure; synthetic isolated enrollment; remove `createEnrollmentCapabilityForTest`; copied/packed package exposes no production registry instance, test issuer, or callback bridge; npm pack includes extension and excludes tests/fixtures; no CLI/runtime/OpenCode/RPC/JSON/print surface; live zero-write smoke; extension-local TypeScript; package/host parity; full regression
- Verification: `test -f plugins/immune-brain/.pi-extension/imm-canary-enroll.ts && test -f plugins/immune-brain/.pi-extension/tsconfig.json && test -f tests/fixtures/enrollment-capability-test-seam.ts && test -f tests/pi-canary-enroll-extension.test.ts && test -f tests/pi-canary-package-boundary.test.ts && bun test tests/pi-canary-enroll-extension.test.ts tests/pi-canary-package-boundary.test.ts tests/kernel-enrollment-authority.test.ts tests/kernel-canary-eligibility.test.ts tests/kernel-canary-rehearsal.test.ts tests/kernel-enrollment-transaction.test.ts tests/kernel-p2b0-boundary.test.ts tests/plugin-package-runtime.test.ts tests/roadmap-plan-host-acceptance.test.ts tests/kernel-pi-canary-prepare.test.ts tests/kernel-pi-canary-live-boundary.test.ts && bun x tsc --noEmit -p plugins/immune-brain/.pi-extension/tsconfig.json && bun install --frozen-lockfile && npm pack --dry-run --json && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-011-feat-assurance-kernel-p2b1-pi-confirmed-enrollment-plan.md --json && git diff --check`
- Test type: integration
- Test scenarios order: authority migration -> discovery -> loader registry -> mode/args -> confirm/cancel/replay -> drift/final-lock -> synthetic enrollment -> packlist -> live rejection -> full regression
- Verification tiers: target=9; surface=9; regression=9; live=9; cumulative=9
- Risks: production registry escapes the Pi activation closure; a test registry is accepted by the production core; extension or package exposes an unintended route; confirmation result races with timeout/drift; final-lock check omits an owner
- Mitigations: explicit paired registry/core factory with cross-registry rejection; production instance held only by the extension closure; test registry fixtures excluded by packlist; real loader and route inventory tests; one-shot continuation; full tuple final-lock tests; root manifest and package owners in Scope
- Rollback: remove extension registration/files, restore authority module without production issuer, keep test fixture under tests only, preserve P2B0 core and any pinned Kernel task
- Depends on: U1

## Completion Criteria

- Both Steps close with fresh evidence and strict QA.
- Final isolated `imm-code-review` passes the complete changed-files signature.
- Current missing-evidence live smoke rejects before confirmation with zero authoritative writes.
- Packlist contains the extension and no test issuer/test fixture.
- No real TaskRecord v2, workspace claim, backend claim, or live evidence bundle is created by this Plan.
- Completion means a dormant Pi production route is shipped; a future exact canary still requires governed live evidence and literal Pi TUI confirmation.
- `imm-finish` reaches `terminal_plan_complete`.
