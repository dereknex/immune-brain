# Deduplicate Capability Registry Scaffolding

**Status**: Proposed
**Task**: `2026-09-01-002-dedup-capability-registry-scaffolding`
**Origin**: GitHub Issue #17, `Dedup Capability registry scaffolding (enrollment_authority.ts / authority_port.ts)`.
**Output Language**: English prose; preserve commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Medium - this is a behavior-preserving refactor across two Kernel authority modules with a new internal generic interface; the risk floor for `plugins/immune-brain/runtime/kernel` raises the enrolled risk to `material`.
**Diagram decision**: not_required
**Diagram reason**: The change has one shared in-memory registry primitive and two thin domain adapters; the component and state-transition prose below is sufficient without a flow diagram.

## 1. Problem

`enrollment_authority.ts` and `authority_port.ts` each implement the same private registry scaffolding: a closure-owned `WeakMap`, an instance brand, opaque branded capability construction, registry-local recognition, state lookup, and one-time `issue`/`inspect`/`consume`/`isConsumed` lifecycle. Only binding validation and the validated result projection differ. The duplication makes future fixes to capability identity or single-use semantics liable to drift between the two authority paths.

## 2. Goal

Extract the shared scaffolding into one internal generic factory used by both `createEnrollmentAuthorityRegistry()` and `createMutationAuthorityRegistry()`. Preserve each constructor's exported signature and type shape, registry-local branding, opaque non-serializable capabilities, expiry and mismatch behavior, irreversible consumption, and domain-specific validation/projection. Reduce the combined line count of `enrollment_authority.ts` and `authority_port.ts` below the current 331 lines.

## 3. Technical Design

### 3.1 Design views

Selected views: architecture layers, service/component interfaces, and state transitions. The architecture view establishes that `capability_registry.ts` is an internal Kernel primitive and the two authority modules remain domain adapters. The interface view defines the generic factory boundary and preserves the existing public constructors. The state view protects registry-local recognition and single-use semantics. Data-flow and temporal-sequence views cannot materially change because no data leaves the process and no asynchronous interaction or persisted state is introduced.

### 3.2 Architecture layers and ownership

- `plugins/immune-brain/runtime/kernel/capability_registry.ts` owns only generic opaque-capability storage and lifecycle mechanics: per-instance `WeakMap`, per-instance brand, capability object creation, recognition, state lookup, expiry/consumed checks delegated through typed hooks as needed, and consumption.
- `plugins/immune-brain/runtime/kernel/enrollment_authority.ts` owns `EnrollmentCapabilityBinding` validation, enrollment error wording, and `ValidatedEnrollment` projection. It remains the owner of `ENROLLMENT_CAPABILITY_BRAND` and `createEnrollmentAuthorityRegistry()`.
- `plugins/immune-brain/runtime/kernel/authority_port.ts` owns `CapabilityBindingV2` validation, nullable `findings_digest` validation, `digestOfAction`, action/binding matching, and `ValidatedAuthorityV2` projection. It remains the owner of `MUTATION_AUTHORITY_CAPABILITY_BRAND` and `createMutationAuthorityRegistry()`.
- The shared module must not be exported through `kernel/index.ts`, must not introduce a module-level singleton, and must not absorb domain-specific binding rules.

### 3.3 Component interface and invariants

The internal factory may be typed around binding, stored state, expected inspection input, validated output, and capability object types. It must support:

- a caller-supplied capability brand and per-registry instance brand;
- a caller-supplied issue-time validation hook;
- a caller-supplied inspection/validation hook that receives stored state, expected input, and current time and returns the domain validated result;
- immutable, non-enumerable brand properties on a frozen opaque object;
- registry-private `WeakMap` state and cross-registry rejection;
- `inspect` as non-consuming validation and `consume` as validate-then-mark-consumed;
- `isConsumed` only for capabilities recognized by the issuing registry.

The factory must preserve the existing public interface types. Any necessary type assertion is confined to the shared primitive's opaque-object construction and must not move casts into callers or fixtures.

### 3.4 State transitions

Each registry owns the same state machine: `issued` -> `inspected` without mutation, or `issued` -> `consumed` through successful `consume`; an expired, mismatched, fabricated, serialized, or foreign capability never reaches `inspected`/`consumed`; `consumed` has no legal transition back. The shared factory owns lifecycle transitions, while each adapter owns the validation predicate and validated projection. No new terminal or persisted state is introduced.

## 4. Compatibility, Recovery, and Rollback

This is source-compatible and behavior-preserving. Existing imports, constructor exports, registry method signatures, fixtures, extension runtime stubs, Pi extension callers, and `kernel/index.ts` boundary behavior remain unchanged. No migration is needed for runtime state, plans, TaskRecords, package manifests, or generated mirrors; the new internal `.ts` module must remain inside the shipped runtime source set under the existing package inclusion rules.

If implementation stops midway, the workspace must retain either the original two self-contained registries or a fully compiling shared factory with both adapters updated; no authority state is written by this change. Rollback is the atomic source set consisting of `capability_registry.ts`, `enrollment_authority.ts`, and `authority_port.ts`. A failed verification restores those files together, leaving all callers and tests untouched.

## 5. Discovery Evidence and Reference Closure

- `plugins/immune-brain/runtime/kernel/enrollment_authority.ts`: public enrollment registry constructor and enrollment-specific validation/projection owner.
- `plugins/immune-brain/runtime/kernel/authority_port.ts`: public mutation registry constructor, mutation-specific validation, `digestOfAction`, and findings-digest enforcement owner.
- `tests/kernel-enrollment-authority.test.ts`: direct enrollment lifecycle, expiry, mismatch, replay, and cross-registry behavior.
- `tests/kernel-r2c2-authority.test.ts`: direct mutation lifecycle, action digest, findings digest, expiry, serialization, and cross-registry behavior.
- `tests/fixtures/enrollment-capability-test-seam.ts` and `tests/fixtures/mutation-authority-test-seam.ts`: test-only issue forwarding; their public fixture signatures must remain unchanged.
- `tests/kernel-canary-authority.test.ts`, `tests/kernel-canary-application.test.ts`, `tests/kernel-canary-rework-authority.test.ts`, `tests/kernel-canary-eligibility.test.ts`, `tests/kernel-canary-terminal-transaction.test.ts`, `tests/kernel-canary-drain-transaction.test.ts`, `tests/kernel-enrollment-transaction.test.ts`, `tests/kernel-canary-claim-writer-boundary.test.ts`, `tests/kernel-canary-rehearsal.test.ts`, `tests/pi-canary-work-extension.test.ts`, `tests/pi-canary-user-authority.test.ts`, `tests/user-approval-critical-completion.test.ts`, `tests/breaking-intent-revision-gate.test.ts`, and `tests/pi-canary-lifecycle-package.test.ts`: additional constructor consumers and authority behavior coverage.
- `plugins/immune-brain/.pi-extension/runtime-stub.ts`, `plugins/immune-brain/.pi-extension/imm-canary-enroll.ts`, and `plugins/immune-brain/.pi-extension/imm-canary-work.ts`: runtime integration consumers that depend on existing constructors/types; no API changes are required.
- `tests/kernel-p2b0-boundary.test.ts` and `tests/pi-canary-package-boundary.test.ts`: issuer export and capability boundary checks; the shared factory remains internal.
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`: rejected generic dispatch platformization is unrelated; this plan is limited to proven local registry scaffolding duplication and does not create a cross-host dispatcher.

## 6. Scope

In scope:

- `plugins/immune-brain/runtime/kernel/capability_registry.ts`
- `plugins/immune-brain/runtime/kernel/enrollment_authority.ts`
- `plugins/immune-brain/runtime/kernel/authority_port.ts`
- `tests/kernel-capability-registry-contract.test.ts`

Out of scope:

- public exports from `plugins/immune-brain/runtime/kernel/index.ts`;
- changes to registry behavior, binding rules, capability brands, fixtures, callers, or existing tests;
- generic dispatchers, module-level registries, or broader authority refactors;
- persisted state, migration, package metadata, generated output, and documentation contracts.

## 7. Step

### Step 1: Replace duplicated registry mechanics with one internal factory

- **Step ID**: `S1`
- **Result**: Both authority constructors use one internal capability-registry factory while preserving their existing public APIs and domain-specific validation behavior.
- **Scope**: `plugins/immune-brain/runtime/kernel/capability_registry.ts`, `plugins/immune-brain/runtime/kernel/enrollment_authority.ts`, `plugins/immune-brain/runtime/kernel/authority_port.ts`, `tests/kernel-capability-registry-contract.test.ts`
- **Verification**: `bun test tests/kernel-capability-registry-contract.test.ts tests/kernel-enrollment-authority.test.ts tests/kernel-r2c2-authority.test.ts tests/kernel-p2b0-boundary.test.ts tests/kernel-canary-authority.test.ts tests/kernel-canary-application.test.ts tests/kernel-canary-rework-authority.test.ts tests/kernel-canary-eligibility.test.ts tests/kernel-enrollment-transaction.test.ts tests/kernel-canary-terminal-transaction.test.ts tests/kernel-canary-drain-transaction.test.ts tests/kernel-canary-claim-writer-boundary.test.ts tests/kernel-canary-rehearsal.test.ts tests/pi-canary-work-extension.test.ts tests/pi-canary-user-authority.test.ts tests/user-approval-critical-completion.test.ts tests/breaking-intent-revision-gate.test.ts tests/pi-canary-lifecycle-package.test.ts`
- **Verification type**: automated
- **Failure behavior**: If either adapter no longer typechecks or focused authority tests fail, keep the original authority behavior as the rollback reference and revert the four-file source/test set together. Do not modify callers or weaken tests to accommodate the refactor.
- **Discovery cache**: `plugins/immune-brain/runtime/kernel/enrollment_authority.ts` (enrollment adapter and public constructor), `plugins/immune-brain/runtime/kernel/authority_port.ts` (mutation adapter and public constructor), `plugins/immune-brain/runtime/kernel/capability_registry.ts` (new shared lifecycle primitive), `tests/kernel-enrollment-authority.test.ts` (enrollment behavior seam), `tests/kernel-r2c2-authority.test.ts` (mutation behavior seam)
- **Execution note**: characterization-first

## 8. Test Scenarios

- Existing enrollment tests pass without modification, including incomplete binding, future expiry, all binding mismatches, expiry at injected time, consume irreversibility, replay, and cross-registry rejection.
- Existing mutation tests pass without modification, including missing/fabricated/serialized capability rejection, expiry, action digest and field mismatches, findings digest enforcement, future-expiry validation, consume irreversibility, and cross-registry rejection.
- Existing canary application, enrollment, rework, eligibility, transaction, package-boundary, and extension tests pass without modification.
- `tests/kernel-capability-registry-contract.test.ts`: structural contract test covers both adapters importing the shared factory, absence of duplicated `WeakMap` scaffolding, retained domain validation markers, and line-count reduction.

## 9. Devil's Advocate Audit

- **Rollback resilience**: The only mutation is the four-file source/test set. A mid-step failure cannot write authority state; reverting the new factory, both adapters, and the new contract test together restores the prior implementation. Existing callers and tests remain untouched, so rollback does not require data migration or state repair.
- **Verification vanity**: The focused Bun tests exercise actual issue, recognition, expiry, mismatch, cross-registry, serialization, and consume behavior through both public constructors. The new structural contract test separately fails if either adapter retains its own `WeakMap`, fails to import the shared module, loses domain validation markers, or misses the requested line-count reduction; it does not substitute for behavioral tests.
- **Spec dilution detection**: The full issue requirements remain explicit: one shared generic factory, separate enrollment/mutation validation including nullable findings digest and action hashing, unchanged exported shapes, unmodified existing tests, and reduced combined line count. Generic dispatcher/platformization and unrelated authority changes are explicitly out of scope rather than silently omitted.

## 10. Decision Summary

- Keep one TaskIntent and one Step because both adapters share one refactor boundary, one behavior contract, one rollback set, and one material Kernel authority review boundary.
- Use a `Symbol()`-style per-instance registry brand for isolation; the domain capability brands remain unchanged, and the generic factory receives them as inputs. The enrollment adapter may retain its existing `Symbol.for` capability brand because that is a domain brand, not the registry instance identity.
- Keep `capability_registry.ts` internal and omit it from `kernel/index.ts`, matching the existing non-exported authority modules.
- Add one focused structural test file because the source-shape and line-count acceptance criteria need a deterministic executable seam; keep all existing behavior tests unmodified.

## 11. Plan Boundary and Scope Pressure

This is one coherent executable slice: there is no independent migration, public API promotion, persisted-state transition, or separately releasable component. The two-file duplication is the reason to retain both adapters in one Step, not a reason to split micro-steps. Scope pressure is limited to three runtime files and one focused structural test plus broad existing behavioral coverage; no generated or packaged mirror is required because the public surface and package entrypoints are unchanged.
