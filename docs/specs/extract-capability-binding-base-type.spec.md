# Extract shared capability-binding base type

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: Medium — a type-level extraction across three authority-adjacent binding interfaces; the shared runtime validator (`createCapabilityRegistry`) already treats every binding field generically, so no runtime validation logic changes, but the touched files sit in the mutation/enrollment/batch authority path.
**Execution posture**: type-only refactor, verified by the existing per-binding regression suites; no new validation, no widened acceptance.
**Document language**: English, following the Planner document-language default.

## Outcome

`EnrollmentCapabilityBinding`, `BatchAuthorizationBinding`, and `CapabilityBindingV2` stop independently repeating the three fields every capability binding actually shares (`actor_id`, `confirmation_ref`, `expires_at`) and instead compose a shared `BaseCapabilityBinding` interface. `nonce` is **not** promoted into the shared base: `EnrollmentCapabilityBinding` and `BatchAuthorizationBinding` both carry it, but `CapabilityBindingV2` uses `action_digest` for replay-safety instead and has no `nonce` field at all, so a four-field base would be inaccurate for all three consumers. `createCapabilityRegistry` (`kernel/capability_registry.ts`) is untouched: its `validateBinding`/`validateAndProject` hooks already iterate `Object.entries`/`Object.keys` generically and impose no fixed field list, so composing the binding type behind it changes nothing it does.

## Brainstorm Trace

| ID | Confirmed requirement | Design / acceptance |
|---|---|---|
| BR-DEC-09 | Extract genuinely common capability-binding fields into a shared base type; leave `createCapabilityRegistry` itself unchanged since it is already validated as correctly reused by three call sites | D1; AC1–AC3 |
| BR-DEC-07 | `nonce` is a load-bearing field (`enrollmentRequestDigest()` folds it into the idempotent replay digest), already confirmed and left untouched; it is not a candidate for the shared base because `CapabilityBindingV2` has no `nonce` field at all | D1 (exclusion) |
| BR-DEFER-01 | The exact field set and naming of `BaseCapabilityBinding` was left to this Planner/implementation pass rather than decided at brainstorm time | D1 |

## Scope and exclusions

Include: `plugins/immune-brain/runtime/kernel/enrollment_authority.ts` (`EnrollmentCapabilityBinding`), `plugins/immune-brain/runtime/kernel/batch_authority.ts` (`BatchAuthorizationBinding`), `plugins/immune-brain/runtime/kernel/authority_port.ts` (`CapabilityBindingV2`), and wherever the new `BaseCapabilityBinding` is declared (one of these three files or a small shared types module already used by all three, whichever avoids a new import cycle).

Exclude: `createCapabilityRegistry` and its generic `validateBinding`/`validateAndProject` hook shape (already confirmed correctly reused, per prior discovery, by three call sites — not part of this change); the `nonce` field (BR-DEC-07: already confirmed load-bearing via `enrollmentRequestDigest()`'s idempotent replay digest and left untouched; also absent from `CapabilityBindingV2`, so it cannot be part of a base shared by all three); `action_digest`/`expected_record_hash`/`intent_revision`/`intent_content_hash`/`diff_hash`/`findings_digest` on `CapabilityBindingV2`, and the batch-specific `budget`/`plan_digest`/`branch`/`base_head` fields — all stay exactly where they are, on their own interface, not the shared base. No new capability kind, no change to who issues or consumes a binding, no change to any expiry or mismatch error message.

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/kernel/enrollment_authority.ts:9-19`: `EnrollmentCapabilityBinding { task_id, intent_path, intent_revision, intent_content_hash, preparation_digest, actor_id, confirmation_ref, expires_at, nonce }`.
- `plugins/immune-brain/runtime/kernel/batch_authority.ts:46-57`: `BatchAuthorizationBinding { batch_id, initiative_slug, plan_digest, branch, base_head, budget, actor_id, confirmation_ref, expires_at, nonce }`.
- `plugins/immune-brain/runtime/kernel/authority_port.ts:18-38`: `CapabilityBindingV2 { authority_kind, task_id, run_id?, action_digest, expected_record_hash, intent_revision, intent_content_hash, diff_hash, actor_id, confirmation_ref, expires_at, findings_digest }` — no `nonce`; uses `action_digest` instead.
- The only fields present, identically named and typed (`string`), on all three interfaces are `actor_id`, `confirmation_ref`, `expires_at`. `nonce` is on two of three, not all three, so it is excluded from the shared base per the discovery above (this refines an earlier four-field assumption made before this file-level check).
- `plugins/immune-brain/runtime/kernel/capability_registry.ts:47-56` (`enrollment_authority.ts`'s `validateBinding`): iterates `Object.entries(binding)` generically for non-empty checks, and `validateAndProject` iterates `Object.keys(expected)` for equality — neither hook hard-codes the enrollment field list, confirming the shared registry factory needs no change when the binding interface is recomposed.
- `tests/kernel-capability-registry-contract.test.ts`: exercises `createCapabilityRegistry` generically across binding shapes.
- `tests/kernel-enrollment-authority.test.ts`, `tests/kernel-batch-authority.test.ts`, `tests/kernel-r2c2-authority.test.ts`: per-binding-type regression coverage for enrollment, batch, and mutation-authority (`CapabilityBindingV2`) issue/inspect/consume behavior respectively.

## Technical Design

**Design views**: none beyond the three existing interfaces; this is a type composition, not a new runtime shape.
**Diagram decision**: not required
**Diagram reason**: no new control flow, state, or call path; only interface declarations change.

### D1. `BaseCapabilityBinding`

Declare `interface BaseCapabilityBinding { actor_id: string; confirmation_ref: string; expires_at: string }`. Change `EnrollmentCapabilityBinding`, `BatchAuthorizationBinding`, and `CapabilityBindingV2` to extend it (`extends BaseCapabilityBinding`), removing their own repeated declarations of the three fields while keeping every other field exactly as it is today, including `nonce` on the two interfaces that have it. No consumer of any of the three interfaces needs a code change beyond the import of the new type, since structural field access (`binding.actor_id`, etc.) is unaffected by where the field is declared.

## Verification and acceptance mapping

| Acceptance | Focused verification | Required regression behavior |
|---|---|---|
| AC1 | `bun test tests/kernel-capability-registry-contract.test.ts` | the generic registry factory issues/inspects/consumes capabilities identically for a binding shape composed from `BaseCapabilityBinding` as it did for the previous flat interface |
| AC2 | `bun test tests/kernel-enrollment-authority.test.ts tests/kernel-batch-authority.test.ts` | enrollment and batch capability issue/inspect/consume, including `nonce` presence and expiry validation, are unchanged |
| AC3 | `bun test tests/kernel-r2c2-authority.test.ts` | mutation-authority (`CapabilityBindingV2`) issue/inspect/consume, including `action_digest`/`findings_digest` handling, is unchanged |

Outside these acceptance descriptors: `bun run typecheck` (the primary signal for a type-only refactor — every existing literal object assigned to one of the three interfaces must still satisfy it structurally).

## Devil's Advocate Audit

- **Rollback resilience**: pure type declaration change; no runtime behavior, persisted schema, or authority record is affected. Reverting is a mechanical inline of the three fields back into each interface.
- **Verification vanity**: `bun run typecheck` alone would pass even if a field were silently duplicated instead of shared, since TypeScript structural typing does not care how a shape is composed — the three focused test files must still be run to prove issue/inspect/consume semantics are unchanged, not just that the types compile.
- **Spec dilution**: this must not become a nonce redesign, a new `expected` cross-binding validation, or a merge of `CapabilityBindingV2` with the other two into a single generic authority-capability type. `nonce`'s replay-safety guarantee (BR-DEC-07) is already settled and stays untouched; BR-DEFER-01's design latitude (the base type's exact field set and naming) is fully exercised by D1, not left open.

## Delivery boundary

One Spec and one TaskIntent settle together. This candidate authorizes nothing until native Enrollment. Execution completion requires the focused acceptance checks and `bun run typecheck`; a type-only, behavior-preserving change across authority-adjacent files still requires the code-review gate. Planning completion requires canonical author/validate success, a tracked candidate artifact, and the complete BR trace above.
