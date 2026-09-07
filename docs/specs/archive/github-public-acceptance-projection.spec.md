# Spec: GitHub Public Acceptance Projection

**Task ID**: `2026-09-07-002-github-public-acceptance-projection`
**Owner**: user
**Status**: Proposed
**Output language**: English (project policy)

**Design risk**: Medium

This changes the complete Initiative publication input contract and its outbound GitHub rendering, but it does not change TaskIntent, Kernel authority, remote mutation ownership, or lifecycle state.

**Design views**: component interface and data flow are selected because publication needs a new explicit public field whose identity is checked against canonical TaskIntent acceptance IDs. Architecture layers, state transitions, and temporal sequence are omitted because component ownership and mutation ordering remain unchanged.

**Diagram decision**: not_required
**Diagram reason**: The contract is a single preflight mapping with no new component or state relationship.

## Outcome

Complete Initiative publication accepts TaskIntents whose canonical assertions contain internal authority context without copying that context into public GitHub Issues. Each Child carries explicit, bounded public acceptance summaries whose IDs match the canonical acceptance IDs exactly.

## Discovery Evidence

- `plugins/immune-brain/runtime/github_issue_tracker.ts:1286` currently copies each canonical TaskIntent assertion into `acceptance[].summary`.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:888` correctly rejects internal authority context from all public projection text.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:671` renders acceptance IDs and summaries into the public Child body.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:605` already provides the final 65,536-byte UTF-8 body preflight before remote mutation.
- `plugins/immune-brain/dist/imm-planner.md` defines the complete batch input and requires tracker rereads to bind canonical TaskIntent identity, risk, and acceptance.
- `tests/plugin-package-runtime.test.ts` owns complete publication, projection denylist, dependency topology, and zero-write body-limit coverage.
- The confirmed `unattended-initiative-batch-run` batch reproduces the conflict because S2's canonical assertion names `docs/plans/<task-id>.intent.json`, which public projection intentionally forbids.

## Technical Design

### Interface

Every `InitiativePublicationInput.tasks[]` item gains a required `acceptance` array of `{id, summary}`. `summary` remains safe public text of 1-500 characters. Preflight requires the array to contain each canonical TaskIntent acceptance ID exactly once, with no duplicate, missing, or extra IDs.

The tracker continues to reread the canonical TaskIntent for task identity, risk, goal, and acceptance IDs. The publication input cannot add, remove, or rename acceptance obligations and cannot widen Kernel authority. It controls only the public prose associated with those IDs.

### Data Flow

Planner derives public summaries from the confirmed Slice result and acceptance intent. `taskPublication` reads the canonical TaskIntent, validates exact ID equality, and passes only the supplied public summaries into `validateOperation`. `childBody` renders those summaries. Canonical assertion bytes never enter the public projection validator or GitHub body.

The complete body remains subject to `bodyLimitFailure`; malformed summary arrays and body overflow fail before the first GitHub mutation.

### Failure and Compatibility

This is an intentional fail-closed replacement of an unusable unpublished batch-input shape. There is no fallback to copying canonical assertions. Existing callers and tests must provide explicit summaries. The current Initiative has not created any Issues, so no remote migration exists. Rollback reverts the input field, validation, tests, and Planner text together.

## Scope

- `docs/specs/github-public-acceptance-projection.spec.md`
- `docs/specs/archive/github-public-acceptance-projection.spec.md`
- `plugins/immune-brain/runtime/github_issue_tracker.ts`
- `plugins/immune-brain/dist/imm-planner.md`
- `tests/plugin-package-runtime.test.ts`

## Acceptance and Verification

1. `acc-public-acceptance-id-binding`: Complete publication requires bounded public acceptance summaries whose IDs match each canonical TaskIntent acceptance ID exactly; missing, duplicate, extra, and mismatched IDs return `permanent_failure` before any GitHub mutation.
   - Verification: `bun test tests/plugin-package-runtime.test.ts`
2. `acc-canonical-assertion-not-published`: A canonical TaskIntent assertion longer than 500 characters or containing restricted authority context can publish when its explicit public summary is safe; the Child body includes the summary and ID but excludes the canonical assertion, while the aggregate GitHub body limit remains fail-closed with zero mutations.
   - Verification: `bun test tests/plugin-package-runtime.test.ts`
3. `acc-planner-publication-contract`: The packaged Planner contract requires public acceptance summaries, exact canonical ID matching, and non-disclosure of canonical assertion prose.
   - Verification: `bun test tests/plugin-package-runtime.test.ts`

## Devil's Advocate Audit

**Rollback resilience**: No persisted Kernel or remote state changes. Source, tests, and the packaged Planner contract revert as one unit.

**Verification vanity**: Type-level coverage is insufficient. Tests must publish tracked canonical sidecars through the real complete-batch function, inspect rendered Child bytes, and assert mutation counts on every malformed input.

**Spec dilution detection**: The task does not weaken the projection denylist, omit acceptance identity, allow projection fields to widen TaskIntent authority, truncate assertions, or add a compatibility fallback.

## Brainstorm Trace

Not applicable: this is a direct Planner repair of a reproduced publication contract conflict and introduces no user-owned product decision.
