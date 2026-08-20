# Plan: Assurance Kernel P2C2 Mutation Port

**plan_format**: v2
**Plan ID**: 2026-08-12-009
**Type**: feat
**Workflow profile**: strict
**Compounder**: required
**Created**: 2026-08-12
**Status**: pending
**Priority**: P1
**Spec**: docs/specs/assurance-kernel-v4-p2c2-mutation-port.spec.md

## Goal

Freeze one closed TaskRecord v2 factual mutation port with exact Intent identity, opaque authority consumption, deterministic reducer replay, and recoverable CAS storage while exposing no production issuer or route.

## Origin

R2C1 closed TaskIntent identity, TaskRecord v2 exact wire, and all-acceptance completion. P2A still lacks D5/D6: a closed production factual action vocabulary, authority-consumption contract, event replay, and CAS mutation path. R2C2 delivers that contract without adding production routing, enrollment, issuer, CLI mutation, or TaskRecord v2 creation.

## Research

- `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md` D5/D6 requires closed factual actions, authority consumption, event replay, and CAS tests.
- R2C1 `intent.ts`, `types.ts`, `validation.ts`, and `completion.ts` own secure Intent identity, TaskRecord v2 wire, and completion semantics.
- P1 `reducer.ts`, `storage.ts`, and `tests/kernel-migrate.test.ts` provide v1 replay, authority audit, workspace ownership, and recoverable transaction precedents that must remain unchanged.
- R2C1 boundary tests preserve v1 APIs and prevent new command, issuer, import, or routing surfaces.
- Combining Pi issuer/enrollment with this mutation port was rejected because host authentication and backend routing have separate promotion and rollback boundaries.

## Decisions

- Add independent v2 reducer, authority, and application modules; do not widen the v1 `TaskAction` union or generic v1 writer.
- Reuse store-lock and atomic-transaction concepts through a distinct v2 transaction contract/parser, not a union record parser.
- Consume the R2C1 Intent token once after a same-lock secure reread; ordinary actions require exact current Intent identity.
- Bind opaque privileged capabilities to action, event, task, record, Intent, diff, actor, reference, and expiry. Keep the test issuer direct-module-only.
- Detect exact committed replay before capability consumption; reject conflicting event reuse. Uncommitted retries require fresh tokens and capability.
- Include the complete D5 vocabulary, including compatible and breaking Intent revision, so P2A retains no unfrozen factual mutation family.
- Export the application port as a library API for later trusted Pi wiring, but add no CLI, runtime manifest, host adapter, RPC, or enrollment surface.
- Keep TaskRecord v2 creation unavailable; P2B owns enrollment and creation.

## Assumptions

- R2C1's secure reader and private token producer are correct and independently reviewed.
- Existing workspace transaction concepts can be reused without changing v1 wire behavior.
- P2B will provide the first production authority issuer; R2C2 only consumes capabilities.
- Full repository tests remain mandatory because storage and reducer behavior are shared infrastructure.

## Output Language

Spec and Plan prose use English. Schema fields, file paths, contract identifiers, hashes, Step IDs, and CLI commands remain literal.

## Devil's Advocate Audit

- **Serialized authority replay**: Persisted audit descriptors are output only; authority is WeakMap-backed and branded.
- **Single-use versus idempotency**: Exact committed replay returns before capability consumption; uncommitted retries require fresh capability.
- **Intent TOCTOU**: Application v2 owns the same-lock reread, token consumption, and CAS sequence.
- **Generic writer risk**: Storage accepts only a module-branded reducer result and exposes no direct v2 snapshot writer or creation API.
- **V1 compatibility**: V2 has a distinct transaction contract/parser; v1 signatures and behavior remain unchanged.
- **Test issuer leakage**: The issuer is direct-module-only; boundary tests enumerate public exports, runtime manifest, and command surface.
- **Breaking revision smuggling**: Reducer uses the R2C1 classifier; compatible and breaking paths are distinct, with user capability mandatory for breaking.
- **Capability burned by stale or invalid work**: Task/workspace content-hash CAS, Intent token inspection, action parsing, replay/conflict checks, pure reduction, completion, and update-invariant validation precede capability consumption. A failure before consumption preserves the capability; after consumption only the transaction-marker write remains, and a marker-write failure intentionally burns the capability.
- **Transaction wire collision**: V1 and v2 markers have distinct paths/contracts under one exclusive store lock. Simultaneous markers fail closed; each parser rejects the other contract; crash tests cover every write boundary and contradictory partial state.

## Steps

### Step 1

- Step ID: U1
- Result: Every TaskRecord v2 mutation is one identity-bound reducer result committed through one recoverable CAS transaction.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/intent.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/reducer_v2.ts`; `plugins/immune-brain/runtime/kernel/authority_port.ts`; `plugins/immune-brain/runtime/kernel/application_v2.ts`; `tests/kernel-r2c2-reducer.test.ts`; `tests/kernel-r2c2-authority.test.ts`; `tests/kernel-r2c2-application.test.ts`; `tests/kernel-r2c2-transaction.test.ts`; `tests/kernel-r2c2-boundary.test.ts`
- Discovery cache: `docs/specs/assurance-kernel-v4-p2c2-mutation-port.spec.md` (exact action, authority, transaction, and compatibility contract); `plugins/immune-brain/runtime/kernel/reducer.ts` (v1 replay and authority-audit precedent); `plugins/immune-brain/runtime/kernel/storage.ts` (store lock, workspace ownership, and recoverable transaction precedent); `plugins/immune-brain/runtime/kernel/intent.ts` (R2C1 opaque token producer and secure reread); `plugins/immune-brain/runtime/kernel/completion.ts` (v2 completion and projection owner); `tests/kernel-migrate.test.ts` (v1 storage/recovery compatibility owner); `tests/kernel-r2c1-boundary.test.ts` (public export and command-surface baseline); `tests/plugin-package-runtime.test.ts` (canonical command manifest exact-list owner); `tests/host-runtime-cutover.test.ts` (runtime dispatch boundary owner)
- Verification: `for f in tests/kernel-r2c2-reducer.test.ts tests/kernel-r2c2-authority.test.ts tests/kernel-r2c2-application.test.ts tests/kernel-r2c2-transaction.test.ts tests/kernel-r2c2-boundary.test.ts; do test -f "$f" || exit 1; done && bun test tests/kernel-r2c2-reducer.test.ts tests/kernel-r2c2-authority.test.ts tests/kernel-r2c2-application.test.ts tests/kernel-r2c2-transaction.test.ts tests/kernel-r2c2-boundary.test.ts tests/kernel-task-record-v2.test.ts tests/kernel-intent-reader.test.ts tests/kernel-r2c1-boundary.test.ts tests/kernel-migrate.test.ts tests/kernel-core.test.ts tests/plugin-package-runtime.test.ts tests/host-runtime-cutover.test.ts && bun test && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-12-009-feat-assurance-kernel-p2c2-mutation-port-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; add closed v2 actions and pure replay, then opaque authority consumption, then the same-lock Intent reread and dedicated recoverable v2 transaction. Preserve v1 public signatures and expose no production issuer, mutation command, route, creation, enrollment, or import path.
- failure_behavior: Reject unknown or generic patch actions, invalid phases, conflicting event reuse, stale task/workspace CAS, Intent drift, token mismatch/reuse, missing or mismatched authority, invalid diff binding, invariant violations, partial transaction state, any v2 entry into existing v1 writers, and any new production issuer/CLI/route/import/enrollment surface. If TaskRecord v2 creation or a host issuer is required, stop and replan to P2B.
- security_considerations: Caller-supplied audit fields grant no authority. Intent tokens and privileged capabilities are module-private, non-serialized, single-use, exact-identity-bound, and consumed only inside the locked application transaction. Persisted audit data cannot authorize another operation.
- Test scenarios: Covers exact strict payload fields and generic patch rejection for every D5 action; Covers every action's success and invalid-phase rejection; Covers exact replay and conflicting event reuse for every action; Covers record/Intent/acceptance/diff binding and `task_revision` as Intent revision; Covers one-batch request_rework effects; Covers ordinary finding resolution versus unresolved_user_decision; Covers distinct QA/review/user authority roles; Covers compatible and breaking Intent revisions with prior/current token pairing; Covers privileged stop and user-decision resolution; Covers missing, fabricated, serialized, mismatched, expired, cloned, and reused authority; Covers authority inspection before reducer/invariant validation, non-consumption on preflight rejection, intentional burn after marker-write failure, and exact replay before consumption; Covers missing, fabricated, serialized, mismatched, stale, reused, and A-to-B-to-A prior/current Intent tokens; Covers stale task/workspace content-hash CAS and capability non-consumption on stale rejection; Covers v2 transaction interruption at marker/task/workspace/removal boundaries; Covers v1-only and v2-only marker recovery plus simultaneous-marker rejection; Covers workspace ownership and contradictory partial-state rejection; Covers v1 signatures and v1 transaction compatibility plus v1 rejection of v2; Covers completion after revision/approval combinations; Covers absence of v2 creation, generic writer, CLI, manifest route, host issuer, enrollment, import, and mutation command; Covers full repository regression.

## Plan Closure Verification

- Run the Step Verification command exactly as written.
- Confirm every D5 factual action is reducer-owned and has success, phase rejection, exact replay, and conflict tests.
- Confirm privileged actions require exact opaque capabilities while persisted audit descriptors remain non-authoritative.
- Confirm the application port rereads and consumes Intent identity inside the same store lock before one recoverable CAS transaction.
- Confirm v1 public signatures/behavior remain unchanged and v1 writers reject v2.
- Confirm no TaskRecord v2 creation, production issuer, CLI mutation, runtime route, host adapter, enrollment, import, or generic patch surface appears.
- Final review gate: `imm-code-review` over the full current change set.

## Rollback Plan

Remove v2 reducer/authority/application modules and the distinct v2 transaction path, restore additive type/validation/token-consumer/index changes, and delete R2C2 tests. Preserve R2C1 identity and exact pre-R2C2 v1 public signatures, records, storage/reducer paths, runtime routes, and persisted state.

## Notes

- R2C2 closes P2A's mutation vocabulary and authority-consumption contract but does not make Kernel production-routable.
- P2B remains a separate user-approved candidate blocked on R2B readiness promotion. It owns Pi `ctx.ui.confirm` issuance, exact-task enrollment/creation, backend pinning, trusted callback wiring, and drain-only rollback.
