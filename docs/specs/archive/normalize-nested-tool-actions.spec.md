# Spec: Normalize Nested Tool Action Arguments

**Task ID**: `2026-08-28-001-normalize-nested-tool-actions`
**Owner**: user
**Status**: Proposed
**Design risk**: Medium

This change prevents a recoverable provider encoding defect from trapping Managed
workflow routing in repeated pre-execution schema failures. It keeps the public
Tool schemas strict and changes no Kernel action, authority, persistence, or
settlement semantics.

**Diagram decision**: not_required
**Diagram reason**: The change is one synchronous pre-validation transformation
with no state transition, asynchronous sequence, or new component dependency;
the interface and data-flow rules below fully specify it.

## Brainstorm Manifest

- `BR-REQ-001`: Prevent recoverable nested-object double encoding from causing a Managed workflow retry loop.
- `BR-REQ-002`: Preserve the existing public Tool schemas and strict Kernel authority validation.
- `BR-REQ-003`: Recover the already-enrolled production-readiness task with a verified model instead of re-enrollment.
- `BR-DEC-001`: Use Pi `prepareArguments` as the pre-validation normalization boundary.
- `BR-DEC-002`: Normalize only the complete `action` field on the two proven Tools.
- `BR-DEC-003`: Track the temporary compatibility layer in a GitHub cleanup Issue with a maintainer owner and auditable removal condition.
- `BR-DEC-004`: Deliver focused tests and a patch changeset through the existing Changesets release flow.
- `BR-OUT-001`: Do not recursively coerce JSON strings.
- `BR-OUT-002`: Do not modify Pi or an OpenAI-compatible provider adapter.
- `BR-DEFER-001`: Do not add a generic repeated-Tool-failure circuit breaker without another reproduced model or Tool failure.
- `BR-DEFER-002`: Do not add live provider calls to CI.

## Problem

Session `01a04663-e6d7-7610-b38b-548057e22edc` recorded 48 validation failures
after `hyper/qwen3.8-flash` encoded object-valued Tool actions as JSON strings.
Pi rejected each call before `execute` because `imm_loop_action.action` and
`imm_kernel_canary.action` require objects. Scalar-only Enrollment succeeded,
which isolates the failure to nested Tool argument encoding rather than Kernel
state or TaskIntent authority.

The current extension registers strict TypeBox unions but has no
`prepareArguments` hook. Existing extension tests invoke `execute` directly, so
they do not exercise Pi's pre-validation compatibility boundary.

## Result

Both affected Tool registrations accept their unchanged object-valued public
contract. Before schema validation, each also recovers the exact observed form
where the top-level `action` value is a JSON string representing a non-null,
non-array object. All malformed or broader coercion candidates remain rejected
by the existing schema.

The temporary behavior is tracked by
[GitHub Issue #14](https://github.com/dereknex/immune-brain/issues/14) and ships
as a patch through the existing Changesets workflow.

## Research And Discovery Evidence

- `plugins/immune-brain/.pi-extension/imm-canary-work.ts` owns both affected Tool registrations, their schemas, and their direct execution adapters.
- `tests/pi-canary-work-extension.test.ts` loads the production extension and inspects both registered Tool definitions; it is the highest focused behavioral seam for `prepareArguments` plus schema acceptance.
- Root `package.json` loads `plugins/immune-brain/.pi-extension` directly and publishes it in the npm package, so there is no generated runtime mirror to update.
- Pi `docs/extensions.md` specifies that `prepareArguments` runs before schema validation, should preserve a strict public schema, and is the supported compatibility hook.
- `docs/adr/0002-maintenance-surface-ownership.md` confirms root `package.json` as the sole Pi package authority and checked-in `dist/` as documentation output, not an extension-code mirror.
- No relevant ADR or rejected Learning defines a conflicting Tool-argument compatibility policy.

## Technical Design

### Design Views

Selected views: service/component interface and data flow. The change alters the
input boundary between Pi Tool dispatch and two extension Tool registrations.
Architecture layers are unchanged; state-transition and temporal-sequence views
cannot affect a stateless synchronous pre-validation transform.

### Interface Contract

A single file-local helper accepts unknown Tool arguments and returns unknown
Tool arguments for Pi to validate:

- Non-object top-level input is returned unchanged.
- Object input whose `action` is not a string is returned unchanged.
- A string `action` is parsed once with `JSON.parse`.
- Only a parsed non-null, non-array object replaces `action` in a shallow copy.
- Parse failure or any other parsed JSON type returns the original input.
- The helper never validates `op`, recursively parses fields, mutates the input,
  catches schema errors, or calls Tool execution.

Both `imm_kernel_canary` and `imm_loop_action` reference this helper through
`prepareArguments`. Their TypeBox schemas remain byte-for-byte strict about
accepted operations and nested fields. Pi remains the owner of post-preparation
schema validation; each Tool remains the owner of execution after validation.

### Data Flow

Provider Tool arguments enter Pi as unknown JSON. `prepareArguments` performs at
most one parse of `action`, then returns either the unchanged input or a shallow
copy containing the recovered object. Pi validates that result against the
existing TypeBox schema. Valid input reaches `execute`; invalid JSON, arrays,
`null`, primitives, unknown operations, and invalid nested fields stop at normal
schema validation.

### Failure Behavior

Normalization has no side effects. A failed parse deliberately returns the
original input so the standard host validation error remains authoritative.
There is no fallback operation, inferred `op`, retry, notification, state write,
or silent execution path.

## Compatibility, Recovery, And Rollback

This is a temporary provider-compatibility layer, not a public schema expansion.
No data migration or dual write exists. GitHub Issue #14 owns removal: after Pi
or Hyper adapter upgrades, a live nested-object probe must pass in two
consecutive upgrade cycles at least 30 days apart. Removal deletes the helper,
both hooks, compatibility-only tests, and source Issue reference while retaining
strict-object coverage.

If implementation stops midway, no runtime or Kernel state has changed; the
next execution can resume from the repository diff. Rollback reverts the source,
focused test, and patch changeset together. The already-enrolled task in the
originating workspace is operationally recovered by switching to
`gpt-5.6-sol / openai-responses` and explicitly entering `imm-loop`; that action
is outside this repository mutation.

## Scope

- `plugins/immune-brain/.pi-extension/imm-canary-work.ts`
- `tests/pi-canary-work-extension.test.ts`
- `.changeset/nested-tool-action-normalization.md`
- `docs/specs/normalize-nested-tool-actions.spec.md`
- `docs/specs/archive/normalize-nested-tool-actions.spec.md`

## Out Of Scope

- Recursive coercion of `context`, `finding`, `next_intent`, or arbitrary fields.
- Pi core, provider adapters, model allowlists, prompt changes, or schema weakening.
- Generic repeated-failure detection or circuit breaking.
- Live provider calls in deterministic QA or CI.
- Re-enrollment or execution of the separate production-readiness Task.
- Direct npm publication or local package installation during this Task.

## Acceptance

1. The production registrations for `imm_loop_action` and `imm_kernel_canary` use Pi pre-validation argument preparation to recover only a JSON-string `action` that parses to a non-null, non-array object; native object input remains unchanged, nested string fields remain untouched, and invalid JSON, arrays, `null`, primitives, unknown operations, and invalid nested fields still fail the existing schemas. The same focused contract test proves that a patch changeset describes the provider compatibility fix and that the temporary source contract references GitHub Issue #14 with its maintainer-owned, two-upgrade-cycle, minimum-30-day removal milestone.

## Plan Boundary

One TaskIntent is sufficient because both registrations share one helper, one
public contract boundary, one focused test seam, one release unit, and one
rollback. Splitting either Tool would temporarily give identical Managed action
schemas different provider behavior without independent promotion or authority
value.

## Devil's Advocate Audit

**Rollback resilience**: The helper is stateless and pre-validation only.
Reverting the source, focused test, and changeset restores the previous behavior
without Kernel repair, persisted migration, or remote cleanup beyond leaving the
tracking Issue open.

**Verification vanity**: The focused test must call each registered
`prepareArguments`, then validate its result against each real registered
TypeBox schema. Source-string assertions alone do not prove ordering or strict
rejection. The changeset/Issue assertion checks exact release metadata and
cleanup reference rather than mere file existence.

**Spec dilution detection**: The plan covers both observed failing Tools and all
confirmed malformed-type boundaries. It does not claim to eliminate every
possible model retry loop; that generic circuit breaker and network CI were
explicitly deferred, not omitted for implementation convenience.

## Brainstorm Trace

| ID | Status | Mapping |
|---|---|---|
| `BR-REQ-001` | `covered_by_step` | Acceptance 1 proves the observed double encoding is recoverable before validation. |
| `BR-REQ-002` | `covered_by_step` | Technical Design and Acceptance 1 preserve strict TypeBox validation. |
| `BR-REQ-003` | `captured_as_decision` | Recovery is documented as an operational action outside this repository Task. |
| `BR-DEC-001` | `covered_by_step` | Both Tools use Pi `prepareArguments`. |
| `BR-DEC-002` | `covered_by_step` | The helper parses only the complete top-level `action` field. |
| `BR-DEC-003` | `captured_as_decision` | GitHub Issue #14 records owner, probes, timing, and cleanup. |
| `BR-DEC-004` | `covered_by_step` | Acceptance includes focused tests and a patch changeset; publish remains the existing release workflow. |
| `BR-OUT-001` | `out_of_scope` | Recursive parsing is explicitly prohibited and tested. |
| `BR-OUT-002` | `out_of_scope` | Pi and provider adapter changes are outside the repository scope. |
| `BR-DEFER-001` | `deferred` | Revisit only after a second model or Tool reproduces the loop. |
| `BR-DEFER-002` | `deferred` | Live provider calls remain non-deterministic and network-dependent. |
