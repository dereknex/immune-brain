# Task Tier Classifier

**Status**: Proposed
**Task**: `2026-09-01-003-add-task-tier-classifier`
**Origin**: GitHub Issue #19, `Add task-tier classification function (routine/material/critical)`; child of #16 and blocker for #20.
**Output Language**: English prose; preserve commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: High - this adds a reusable Kernel risk-policy contract that will later control whether independent Review is required; a wrong floor can silently weaken assurance or make Routine unreachable.
**Design views**: Service/component interface and data flow are selected because this slice defines a pure policy API and its deterministic input-to-tier transformation. Architecture layers, state transitions, and temporal sequence are omitted because this slice does not wire the classifier into Kernel orchestration, mutate state, or add ordered interactions.
**Diagram decision**: not_required
**Diagram reason**: One pure function maps two inputs through a prefix floor and a rank maximum; prose and a truth table are clearer than a diagram.

## 1. Problem

Issue #19 asks for a standalone classifier over concrete changed paths and a declared `TaskIntent.risk`. The repository already has a related but different policy in `plugins/immune-brain/runtime/kernel/intent.ts`: `parseTaskIntentV1` derives a non-downgradable floor from glob-capable `scope_hint`, and `plugins/immune-brain/runtime/kernel/completion.ts` already maps the resolved stored risk to QA, Review, and user attestations.

The missing contract is a pure changed-path classifier that #20 can call as the task revision grows. It must not duplicate the existing scope parser or change current Review routing in this slice.

A repository conflict must be preserved explicitly: every new managed task contributes its own `docs/plans/**` TaskIntent and usually a `docs/specs/**` Spec after `git_base_head`. Therefore #20 cannot pass those task-owned authority sidecars as ordinary implementation changes, or every task will become `material`. This slice keeps the classifier literal and pure; #20 owns filtering only the current task's own authority sidecars before classification. Editing another task's Spec or TaskIntent remains a material path.

## 2. Result

`plugins/immune-brain/runtime/kernel/intent.ts` exports one pure changed-path risk resolver and one centrally editable material-floor prefix list. Given canonical project-relative changed paths and a declared `routine`, `material`, or `critical` tier, it returns the greater of the path-derived floor and declared tier.

This slice does not call the classifier from parsing, readiness, Assurance Projection, or completion.

## 3. Technical Design

### Component interface

Owner: `plugins/immune-brain/runtime/kernel/intent.ts`, alongside the existing `TaskRisk` ranking and scope-derived risk floor.

Inputs:

- `changedPaths: readonly string[]`: concrete canonical project-relative repository paths, not glob patterns.
- `declaredRisk: TaskRisk`: `routine`, `material`, or `critical` already validated by the caller's typed boundary.

Output:

- `TaskRisk`: the maximum of `declaredRisk` and the path-derived floor.

Errors:

- No new error mode. The function is pure and total for typed inputs. Path canonicalization remains the upstream changed-path collector's responsibility.

Compatibility:

- `parseTaskIntentV1` and `RISK_FLOOR_SCOPE_PREFIXES` retain their current `scope_hint` semantics, including documentation-only scopes remaining Routine.
- No TaskIntent, TaskRecord, Review manifest, or CLI schema changes.
- No caller is added in this slice; #20 consumes the function later.

### Data flow

1. Source: concrete paths supplied by a future caller from the immutable task revision.
2. Validation: caller supplies canonical project-relative paths and a typed declared risk.
3. Transformation: compare each path by whole prefix boundary against one material-floor list; derive `material` if any path matches, otherwise `routine`; take the higher rank with `declaredRisk`.
4. Destination: return one `TaskRisk`; write nothing.
5. Failure handling: none inside the typed pure function. Invalid or ambiguous path collection must fail at the upstream revision-capture boundary rather than silently normalize here.

### Policy

The centrally editable changed-path floor starts with canonical repository prefixes corresponding to Issue #19:

- `plugins/immune-brain/runtime/kernel`
- `plugins/immune-brain/.pi-extension`
- `docs/specs`
- `docs/plans`

Prefix matching is segment-safe: a prefix matches itself and descendants, but `docs/plans-old` does not match `docs/plans`.

| Changed-path floor | Declared risk | Resolved tier |
| --- | --- | --- |
| routine | routine | routine |
| routine | material | material |
| routine | critical | critical |
| material | routine | material |
| material | material | material |
| material | critical | critical |

## 4. Decisions

- Reuse `TaskRisk` and the existing rank order in `intent.ts`; do not add a new type, module, registry, factory, or configuration format.
- Keep changed-path classification separate from glob-capable `scope_hint` classification. Their input contracts differ, and changing parser behavior would exceed #19 and invalidate the existing documentation-only Routine contract.
- Use direct segment-boundary prefix checks because changed paths are concrete, canonical paths. Do not reuse the scope glob matcher.
- Export the floor list with the classifier so downstream inspection and tests can show the exact policy.
- Do not wire #20, alter `completion.ts`, or change Review obligations in this TaskIntent.

## 5. Compatibility, Recovery, and Rollback

Existing TaskIntent parsing, Enrollment, QA, Review, and completion behavior is unchanged because this slice adds no caller. No migration or persisted-state compatibility path is needed.

If execution stops midway, only the Spec, TaskIntent, one source file, and one focused test file may be staged; no Kernel state is mutated before Enrollment and no runtime state is changed by implementation. Rollback is the coherent removal of the new exports and their focused tests. #20 must not start until this classifier contract is accepted.

## 6. Acceptance

1. A standalone pure function resolves `routine`, `material`, or `critical` from concrete changed paths plus declared `TaskIntent.risk`, using one exported and centrally editable material-floor prefix list.
2. Ordinary paths with declared `routine` resolve to `routine`; every configured prefix and descendant resolves to at least `material`; near-prefix paths do not match.
3. Declared `critical` escalates an ordinary path to `critical`, while declared `routine` cannot lower a matched path below `material`.
4. Existing scope-derived risk-floor tests remain unchanged in behavior, proving this slice does not silently wire changed-path policy into TaskIntent parsing.

## 7. Verification

Highest existing observable seam: `tests/risk-tier-floor.test.ts` already imports the canonical risk policy from `runtime/kernel/intent.ts` and exercises floor, escalation, and non-floor behavior. Extending this file catches wrong prefix boundaries, scattered policy, escalation failures, de-escalation, and accidental parser coupling without invoking unrelated Kernel orchestration.

Focused command:

```bash
bun test tests/risk-tier-floor.test.ts
```

Descriptor budget: 30 seconds and 65,536 output bytes.

## 8. Discovery Evidence

- Public policy owner: `plugins/immune-brain/runtime/kernel/intent.ts` defines `TaskRisk` resolution during strict TaskIntent parsing.
- Parser and inspection callers: `plugins/immune-brain/runtime/commands/kernel.ts` and `plugins/immune-brain/runtime/kernel/validation.ts` consume `parseTaskIntentV1`; they need no edits for this additive function.
- Review obligation consumer: `plugins/immune-brain/runtime/kernel/completion.ts` maps stored risk to required attestations; wiring is reserved for #20.
- Concrete changed-path source: `plugins/immune-brain/runtime/workspace_scope.ts` captures the immutable base-to-index revision and exposes `changed_paths`; no edit is needed in #19.
- Review bundle reader: `plugins/immune-brain/.pi-extension/pi-canary-review-bundle.ts` consumes the same revision snapshot; no edit is needed in #19.
- Focused prior art: `tests/risk-tier-floor.test.ts` proves the existing `scope_hint` floor and documentation-only Routine invariant.
- Historical authority: `docs/plans/archive/2026-08-19-010-deterministic-risk-tier-floor.intent.json` requires scope-derived kernel/authority flooring while preserving documentation-only Routine behavior.
- Relevant ADR: `docs/adr/0003-internal-role-prompt-routing.md` confirms Review is an internal authority role; this slice changes no dispatch boundary.
- Rejected Learning checked: `docs/solutions/rejected-shared-registry-generic-dispatcher.md` reinforces avoiding a generic policy platform without evidence; the design remains one pure function in the existing owner.
- Generated/package mirror: none. Runtime TypeScript is packaged directly; no `dist/` source mirror is generated for this module.

## 9. Out of Scope

- Wiring the classifier into Assurance, readiness, projection, or completion (#20).
- Filtering the current task's own TaskIntent/Spec sidecars before #20 classification.
- Changing `parseTaskIntentV1`, `RISK_FLOOR_SCOPE_PREFIXES`, or current `scope_hint` semantics.
- Reclassifying an active TaskRecord or changing persisted risk identity.
- Capability registry dedup, Enrollment precondition dedup, CAS locking, Review bundle shape, or Review workload classification from #16.
- GitHub Issue state mutation.

## 10. Devil's Advocate Audit

**Rollback resilience**: The change is additive and has no caller. Removing the exports and focused tests restores the previous runtime with no state migration or partial authority transition.

**Verification vanity**: The focused test must invoke the exported classifier across every configured prefix, descendants, near-prefix negatives, declared escalation, and floor-preserving de-escalation. A text-existence assertion would not catch the intended regression and is insufficient.

**Spec dilution detection**: The Issue's pure function, all three tiers, centralized path list, ordinary Routine behavior, path-forced Material behavior, critical escalation, and non-downgrade rule are retained. Only routing integration and dynamic re-evaluation are deferred to their existing dependent Issue #20, as #19 explicitly requires.
