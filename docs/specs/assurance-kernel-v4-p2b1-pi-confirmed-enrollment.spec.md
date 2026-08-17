# Assurance Kernel v4 P2B1 Pi-Confirmed Enrollment Adapter Specification

## Status

- **Status:** Draft
- **Owner:** Immune-Brain maintainers
- **Date:** 2026-08-12
- **Parent:** `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md`
- **Predecessors:** `docs/specs/assurance-kernel-v4-p2b0-risk-accepted-canary-core.spec.md`, `docs/specs/assurance-kernel-v4-p2c2-mutation-port.spec.md`
- **Risk:** High

**Design risk**: P2B1 introduces the first published production route that can enroll one exact TaskIntent into the Kernel backend. A false host boundary, stale post-confirm state, shipped test issuer, non-TUI route, incomplete final-lock check, or package-discovery error could create an unauthorized TaskRecord v2.

**Diagram description**: The sequence diagram shows a user-entered Pi slash command, a read-only preparation module, a TUI-only `ctx.ui.confirm`, an extension-owned one-shot continuation, complete post-confirm and final-lock revalidation, rehearsal, private capability issuance, and the P2B0 atomic enrollment transaction. Missing evidence, non-TUI mode, cancellation, timeout, drift, replay, and package-loading failures terminate before authority issuance.

## Problem

P2B0 provides bounded eligibility, EnrollmentCapability validation, rehearsal, atomic TaskRecord/workspace/backend-claim creation, and a v3 managed-write guard. It deliberately exposes no production host route. R2C1/R2C2 provide exact Intent identity and a non-routable TaskRecord v2 mutation port.

P2B1 must add the first legitimate production route through Pi without weakening these boundaries:

- slash-command arguments remain untrusted;
- only a command handler running with `ctx.mode === "tui"` may call `ctx.ui.confirm`;
- RPC, print, JSON, OpenCode, CLI, LLM-callable tools, prompt text, actor fields, and serialized flags cannot reach enrollment;
- confirmation binds one exact repository/task/Intent/readiness/evidence/waiver tuple;
- all live evidence and Intent identity are recomputed after confirmation and again at the final enrollment lock boundary;
- current live evidence is missing, so the shipped command currently refuses before showing confirmation and performs zero authoritative writes.

This is an operational host boundary, not a cryptographic sandbox against arbitrary same-user code execution or malicious code loaded into the same Pi process. P2B1 proves route exclusivity and fail-closed state validation; it does not claim JavaScript module provenance can authenticate a hostile in-process caller.

## Goals

1. Add a read-only preparation/revalidation core with no authority issuance or mutation.
2. Add one project-local Pi extension command, `/imm-canary-enroll <task-id>`, registered through the root Pi package.
3. Make the extension command handler the sole published route that can issue and consume enrollment authority.
4. Remove the shipped P2B0 test issuer and replace it with a test-only fixture excluded from packed artifacts.
5. Preserve exact-task binding, post-confirm freshness, final-lock freshness, single-use authority, atomic enrollment, backend pinning, and v3 write rejection.
6. Ensure current missing live evidence rejects before confirmation and causes zero authoritative writes.

## Non-Goals

- Do not enroll a real canary task during implementation or tests.
- Do not create or commit a synthetic live readiness evidence bundle.
- Do not waive receipt/observation reconciliation, lifecycle/family coverage, migration digest, rollback rehearsal, Intent identity, or backend pinning.
- Do not add an OpenCode, CLI, JSON, print, RPC, or LLM-tool issuer.
- Do not claim security against arbitrary same-user code execution inside the extension process.
- Do not change supported-host defaults or retire v3.

## Technical Design

```mermaid
sequenceDiagram
    participant U as Literal Pi TUI user
    participant X as Project-local Pi extension
    participant P as Read-only preparation core
    participant R as Readiness and evidence readers
    participant I as Secure Intent reader
    participant E as P2B0 enrollment core
    participant S as Worktree-local Kernel store

    U->>X: /imm-canary-enroll task-id
    X->>X: require ctx.mode == tui and exact args
    X->>P: prepare exact task preview
    P->>R: recompute readiness and evidence
    P->>I: secure-read TaskIntent
    alt missing evidence or non-waivable gap
        P-->>X: ineligible
        X-->>U: notify; no confirm and no writes
    else eligible candidate or time-only waiver
        P-->>X: immutable preview and identity token
        X->>U: ctx.ui.confirm exact tuple with timeout
        alt cancelled, timed out, or aborted
            X-->>U: cancelled; zero writes
        else affirmative
            X->>X: consume one-shot continuation and derive confirmation_ref
            X->>P: revalidate full tuple
            P->>R: reread Ledger, receipts, observations, migration report, evidence
            P->>I: reread Intent and root/path identities
            X->>E: rehearse with extension-private authority
            X->>E: final locked reread, authority consume, atomic enrollment
            E->>S: TaskRecord v2 + workspace claim + backend claim
        end
    end
```

### 1. Read-Only Preparation Core

Add `kernel/pi_canary_prepare.ts` with two exported read-only functions:

```ts
preparePiCanaryEnrollment({ root, task_id, now }): Promise<PiCanaryPreparation>
revalidatePiCanaryEnrollment({ root, preparation, now }): Promise<PiCanaryPreparation>
```

The module:

1. validates exact task-id syntax;
2. canonicalizes repository root and state-path identity;
3. strictly reads Ledger bytes/revision, authority receipts v2, automatic observations v2, canonical migration report, and tracked readiness evidence;
4. computes readiness report/digest/generation and eligibility;
5. secure-reads TaskIntent and captures path/revision/hash/file/root identity;
6. verifies TaskRecord/workspace/backend-claim absence;
7. returns an immutable preview and opaque preparation identity token.

It has no confirm callback, authority issuer, rehearsal call, enrollment call, or writer. Direct import cannot authorize or mutate. Missing live evidence rejects here before any Pi confirmation.

### 2. Full Confirmation Tuple

The preview binds:

- canonical repository and State Ledger path identities;
- Ledger bytes hash/revision;
- receipt-journal and automatic-observation journal identities and digests;
- migration report digest;
- readiness status/digest/generation/window/lifecycle/family facts;
- evidence file path/device/inode/bytes digest and evidence digest;
- task ID and Intent path/device/inode/parent identity/revision/content hash;
- TaskRecord/workspace/backend-claim absence;
- exact waived gate (`observation_window_days` or none);
- backend (`kernel`), expiry, and drain-only rollback consequence.

`revalidatePiCanaryEnrollment` rereads every owner and requires byte/identity equality. Any drift returns a structured rejection.

### 3. Pi Extension Owns Production Authority

Add one extension entry at `plugins/immune-brain/.pi-extension/imm-canary-enroll.ts`. The default export registers exactly one command and owns the full production continuation:

1. require `ctx.mode === "tui"` before readiness reads or confirmation;
2. parse exactly one task ID and call the read-only preparation core;
3. reject missing/non-waivable evidence before `ctx.ui.confirm`;
4. call `ctx.ui.confirm` with `{ timeout, signal }` and the exact preview;
5. on `false`, timeout, abort, late resolution, or duplicate handler/reentry, return zero writes;
6. consume an extension-local one-shot continuation before post-confirm asynchronous work;
7. derive `confirmation_ref` internally;
8. perform full preparation revalidation;
9. internally mint one EnrollmentCapability, rehearse, and invoke atomic enrollment;
10. notify the outcome without appending session entries or storing workflow state in Pi sessions.

No public bridge accepts `confirm: () => true`. No serialized witness, caller nonce, actor, `authorized`, or `user_confirmed` field is accepted.

### 4. Confirmation Reference and Waiver

The extension derives, rather than accepts, authority facts:

- `actor_id = "pi-tui-user"`;
- adapter-generated 128-bit nonce;
- short expiry no longer than five minutes;
- `confirmation_ref = sha256(domain || repository_identity || preview_digest || nonce || confirmed_at)`;
- waiver gate is exactly `observation_window_days` when the only gap is the observation duration, otherwise none;
- waiver reason records the user's earlier risk acceptance, exact task scope, expiry, failure action, and non-waivable gates.

The prompt digest, nonce, `confirmation_ref`, waiver, capability, and one-shot continuation bind the same tuple. Command arguments cannot choose them.

### 5. Authority Registry, Production Instance, and Test Isolation

P2B0 currently uses one module singleton and exports `createEnrollmentCapabilityForTest`. P2B1 replaces this with an explicit factory boundary:

```ts
createEnrollmentAuthorityRegistry(): EnrollmentAuthorityRegistry
createEnrollmentCore(registry): EnrollmentCore
```

The registry owns one private WeakMap and returns issuer/inspect/consume operations bound to that registry. The enrollment core accepts only the paired registry instance. Capabilities from another registry are rejected.

The Pi extension creates the sole production registry/core instance inside its default-export activation closure. No root/kernel index, package export map, CLI/runtime manifest, tool, RPC, OpenCode adapter, or event handler exposes that instance. The extension never returns the instance or issuer from its default export.

Tests create isolated registries through `tests/fixtures/enrollment-capability-test-seam.ts`; no runtime function is named or documented as a test issuer, and no global singleton test hook remains. Packlist excludes test fixtures.

This factory is a library primitive, not host authentication. Same-process arbitrary code execution can instantiate a separate registry, but it cannot reach the production extension closure or create a published enrollment route. The supported threat model relies on route exclusivity plus exact state validation, not on JavaScript source secrecy.

### 6. Final-Lock Freshness

Post-confirm bridge revalidation is necessary but not sufficient. Immediately before capability consumption and enrollment-marker creation under the existing Kernel store lock, the enrollment core must require:

- canonical root and state-path identities unchanged;
- Ledger bytes/revision unchanged;
- receipt and observation journal identities/digests unchanged;
- migration report/readiness digest/generation unchanged;
- evidence bytes/digest unchanged;
- Intent path/root/parent/device/inode/revision/content hash unchanged;
- waiver/confirmation/capability tuple unchanged and unexpired;
- workspace, TaskRecord, backend claim, and all transaction markers absent.

`enrollCanaryTask` must enforce Intent content-hash equality, not only revision. Any final-lock drift burns the one-shot authority and performs zero authoritative writes.

### 7. Timeout, Cancellation, and Replay

Timeout/cancellation are owned entirely by the Pi adapter:

- use Pi's documented `ctx.ui.confirm` timeout and `AbortSignal` options;
- treat timeout and abort as cancellation;
- invalidate the continuation before accepting any late result;
- reject second continuation invocation, duplicate handler reentry, and stale expiry;
- cancellation, timeout, late `true`, and replay issue no capability and perform zero writes.

The preparation core only handles immutable preparation/revalidation and has no timeout behavior.

### 8. Package Boundary

The root package remains the single Pi package. `package.json` adds:

```json
{
  "pi": {
    "skills": ["./plugins/immune-brain/skills"],
    "extensions": ["./plugins/immune-brain/.pi-extension/imm-canary-enroll.ts"]
  }
}
```

No nested package is created. `bun.lock` changes only if root dependency metadata requires it.

Package verification uses `npm pack --dry-run --json` or equivalent packlist inspection to prove:

- extension entry is shipped;
- test fixtures and test issuers are not shipped;
- exactly one enrollment command is registered;
- zero tools, flags, shortcuts, automatic enrollment handlers, CLI/runtime/OpenCode/RPC routes are added.

### 9. Dormant Route and Live Boundary

The current repository lacks `docs/evidence/assurance-kernel/readiness.json`. P2B1 therefore ships a dormant production route:

- command loading and rejection are production-ready;
- current live enrollment remains unreachable;
- live smoke proves `ctx.ui.confirm` call count zero and byte identity for Ledger, receipts, observations, evidence, Intent, TaskRecords, workspace, backend claim, and transaction markers;
- synthetic success proves code-path mechanics only, not current live authority readiness.

Actual first enrollment remains a separate exact-task Pi TUI operation after a governed live evidence bundle exists.

## Invariants

1. The read-only preparation core cannot confirm, mint authority, rehearse, or mutate.
2. The sole published enrollment route is one Pi command handler requiring `ctx.mode === "tui"` and affirmative `ctx.ui.confirm`.
3. Current missing evidence rejects before confirmation and performs zero authoritative writes.
4. Confirmation binds one exact repository/task/Intent/readiness/evidence/waiver tuple and derives its own authority metadata.
5. Post-confirm and final-lock rereads cover every mutable identity owner; drift rejects before enrollment writes.
6. The shipped package contains no test issuer, raw mint API, callback-based approval API, CLI/runtime/OpenCode/RPC/tool route, or automatic enrollment event.
7. Cancellation, timeout, abort, late resolution, reentry, replay, expiry, rehearsal failure, or drift performs zero authoritative writes.
8. Successful synthetic enrollment creates one TaskRecord v2, one workspace claim, and one Kernel backend claim through P2B0 atomic enrollment.
9. No test or implementation creates a live readiness evidence bundle or enrolls a live task.

## Verification Matrix

- read-only preparation and direct-import mutation rejection;
- missing live evidence before confirmation;
- exact tuple and prompt digest;
- candidate and observation-window waiver synthetic preparation;
- root/Ledger/receipt/observation/migration/evidence/Intent/workspace/backend drift;
- final-lock Intent content-hash and state-owner equality;
- Pi TUI mode matrix, timeout, AbortSignal cancellation, late true, duplicate handler, continuation replay;
- deterministic `confirmation_ref` golden vector and caller-field rejection;
- shipped-package direct-import and packlist assertions;
- real Pi extension-loader registry assertions: one command, zero tools/flags/shortcuts/automatic enrollment handlers;
- removal of `createEnrollmentCapabilityForTest`, isolated registry tests, and cross-registry capability rejection;
- synthetic isolated successful enrollment;
- live no-evidence byte-identity smoke;
- full repository regression.

## Rollback

1. Remove root `pi.extensions` registration and the Pi extension entry.
2. Remove preparation modules and production authority wiring; preserve P2B0/R2B/R2C1/R2C2 contracts and historical journals.
3. Restore test-only capability fixtures only under `tests/` if tests still require them; never restore a shipped runtime test issuer.
4. Do not delete or migrate a successfully enrolled Kernel task; drain/stop it under its pinned backend.
