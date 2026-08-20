# Plan: Assurance Kernel P2C1 Intent Identity

**plan_format**: v2
**Plan ID**: 2026-08-11-008
**Type**: feat
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-11
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/archive/assurance-kernel-v4-p2c1-intent-identity.spec.md

## Goal

Freeze the secure TaskIntent and additive TaskRecord v2 identity contract required before any Kernel production mutation can be exposed.

## Origin

R2A delivered durable receipt-bound observations and R2B delivered deterministic readiness projection. The next P2C boundary must bind Task state, evidence, approvals, and completion to one exact Git-owned intent snapshot. P1 currently has only compatibility `intent/v1` and `task_record/v1` schemas whose evidence freshness uses revision and diff hash but not canonical intent content identity.

## Research

- `docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md` D4 requires tracked intent sidecars, stable acceptance IDs, `intent_ref`, and evidence bound to acceptance/revision/intent/diff identity.
- `plugins/immune-brain/runtime/kernel/types.ts`, `validation.ts`, and `completion.ts` own the strict P1 v1 wire, invariants, and completion predicate.
- `plugins/immune-brain/runtime/kernel/readiness_evidence.ts` proves reusable containment, symlink, Git tracking, bounded-read, and TOCTOU checks, but its clean-worktree requirement is intentionally not reused for editable intent input.
- Existing P1 TaskIntent/TaskRecord v1 fixtures must remain readable with unchanged wire semantics.
- TaskIntent identity and reducer authority have different rollback boundaries and touch the same core owners; combining them would recreate cross-Step evidence coupling.

## Decisions

- Implement only R2C1 identity/read/validation/completion; keep R2C2 reducer actions and authority-consumption port as a successor candidate.
- Add `assurance_kernel/task_intent/v1` and `assurance_kernel/task_record/v2` through independently named read-only APIs without changing existing P1 v1 contract constants, parser/completion/projection signatures, or writer meanings.
- Require Git tracking but allow dirty/staged sidecar bytes; tracking is ownership convention, not authentication.
- Hash canonical normalized JSON as `sha256:<64-lowercase-hex>` so formatting-only edits preserve identity while semantic edits change it.
- Return a module-private branded, non-enumerable identity token excluded from JSON/spread projections; P2C1 exposes no token consumer.
- Existing v1 storage/reducer exports remain unchanged and must reject v2; P2C1 adds no mutation, issuer, routing, import, or generic union-dispatch surface.

## Assumptions

- The canonical sidecar path `docs/plans/<task_id>.intent.json` is sufficient for P2C1 identity and containment.
- A 64 KiB limit is sufficient for one managed task intent.
- P1 v1 records remain shadow/test compatibility data and are production-ineligible.
- R2C2 can consume the returned intent_ref and file identity token without changing their semantics.

## Output Language

Spec and Plan prose use English. Schema fields, file paths, contract identifiers, hashes, Step IDs, and CLI commands remain literal.

## Devil's Advocate Audit

- **Rollback resilience**: P2C1 is additive and has no production writes. Rollback removes only independently named v2 APIs/types/exports and tests, restoring exact v1 public signatures and behavior; it does not alter existing v1 mutation exports.
- **Verification vanity**: Tests include root/parent/file swap security, formatting/semantic hash behavior, dirty tracked input, opaque token serialization boundaries, exact v2 wire, v1 compile-time/API compatibility, storage/reducer v2 rejection, every-acceptance completion, revision/hash/diff staleness, and command/export baseline assertions.
- **Spec dilution detection**: No authority or routing requirement is deferred into an implicit implementation. P2C1 adds no authority issuer or new mutation surface; R2C2 remains a named successor.
- **Boundary pressure**: Task identity and reducer authority both modify core kernel owners, but they have independent rollback and review criteria. They remain separate Plans despite file reuse.

## Steps

### Step 1

- Step ID: U1
- Result: One canonical intent snapshot determines task completion identity.
- Scope: `plugins/immune-brain/runtime/kernel/intent.ts`; `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-intent-v2.test.ts`; `tests/kernel-record-v2.test.ts`; `tests/kernel-core.test.ts`; `tests/kernel-r2c1-boundary.test.ts`
- Discovery cache: `docs/specs/archive/assurance-kernel-v4-p2c1-intent-identity.spec.md` (TaskIntent/TaskRecord v2 authority); `docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md` (P2 D4 compatibility contract); `plugins/immune-brain/runtime/kernel/types.ts` (P1 v1 wire owner); `plugins/immune-brain/runtime/kernel/validation.ts` (v1 parser signature and independent v2 parser owner); `plugins/immune-brain/runtime/kernel/completion.ts` (v1 completion/projection signatures); `plugins/immune-brain/runtime/kernel/readiness_evidence.ts` (tracked-file path security precedent); `plugins/immune-brain/runtime/kernel/storage.ts` (existing v1 production writer call sites); `plugins/immune-brain/runtime/kernel/reducer.ts` (existing v1 reducer call site); `plugins/immune-brain/runtime/kernel/index.ts` (existing public mutation/read exports); `plugins/immune-brain/runtime/commands/kernel.ts` (command surface owner); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (manifest/routing owner); `docs/solutions/contracts.md` (positive evidence and reducer-owned mutation rules)
- Verification: `for f in tests/kernel-intent-v2.test.ts tests/kernel-record-v2.test.ts tests/kernel-core.test.ts tests/kernel-r2c1-boundary.test.ts; do test -f "$f" || exit 1; done && bun test tests/kernel-intent-v2.test.ts tests/kernel-record-v2.test.ts tests/kernel-core.test.ts tests/kernel-r2c1-boundary.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-008-feat-assurance-kernel-p2c1-intent-identity-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; add the secure descriptor intent reader and canonical identity before exact-wire v2 parsing, then add independently named v2 completion/projection APIs. Preserve v1 public signatures, keep existing storage/reducer v1-only, and expose no token consumer, mutation, or authority.
- failure_behavior: Reject ambiguous root/path identity, unsupported no-follow, parent/file/A→B→A swaps, untracked or malformed intent, token serialization/forgery, snapshot/ref mismatch, mixed v1/v2 item shapes, malformed hashes, unknown acceptance IDs, stale revision/hash/diff evidence, duplicate IDs, any v2 entry into existing v1 storage/reducer, or any new mutation/issuer/routing/import surface. If production mutation or token consumption is required, stop and replan to R2C2.
- security_considerations: Git tracking is not authentication. One canonical root is shared by Git and filesystem access; exact descriptor bytes, parent/path/fd identity, `O_NOFOLLOW`, canonical hash, and an opaque non-serialized token prevent accidental source drift. No caller-controlled path, token constructor, token consumer, or authority descriptor is accepted.
- Test scenarios: Covers formatting-independent `sha256:` canonical hash and semantic drift; Covers root symlink, Git-cwd mismatch, parent replacement, file replacement, A→B→A, unsupported no-follow, traversal, wrong-name, oversize, malformed, and descriptor race rejection; Covers dirty and staged tracked intent acceptance; Covers duplicate or empty acceptance rejection; Covers opaque token non-enumerability, JSON/spread exclusion, and no exported constructor/consumer; Covers exact TaskRecord v2 wire and hash format; Covers TaskRecord v1 fixtures plus compile-time/public-signature compatibility; Covers existing storage/reducer rejection of valid v2 without writes; Covers snapshot/ref and mixed-item validation; Covers evidence and approval revision/hash/diff staleness; Covers every current acceptance ID required; Covers compatible and breaking revision classification; Covers unchanged command/manifest/export baselines and no new mutation, host route, authority issuer, import, or generic dispatcher; Covers full repository regression.

## Plan Closure Verification

- Run the Step Verification command exactly as written.
- Confirm canonical intent hashing is stable across formatting-only source changes and changes for semantic edits.
- Confirm independently named v2 APIs leave `parseTaskRecord`, `completionDecision`, and `projectTask` v1 signatures/behavior unchanged.
- Confirm existing storage/reducer paths reject `task_record/v2` before writes and command/manifest/export baselines gain no mutation, issuer, routing, import, or token-consumer surface.
- Final review gate: `imm-code-review` over the full current change set.

## Rollback Plan

Remove `kernel/intent.ts`, remove independently named v2 types/parser/completion/projection exports, and delete R2C1 tests. Restore the exact pre-R2C1 v1 exported signatures and call behavior; existing v1 mutation exports, records, storage/reducer paths, runtime routes, and persisted state remain untouched.

## Notes

- R2C2 reducer factual actions and opaque authority-consumption port remain a separate successor candidate.
- P2B canary routing still requires qualifying R2B readiness evidence and separate literal user approval.
