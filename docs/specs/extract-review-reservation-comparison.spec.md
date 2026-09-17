# Extract review-reservation snapshot comparison

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: Medium — refactors two duplicated inline authority-adjacent comparisons inside `runtime/assurance/coordinator.ts` into named pure functions, with no intended change to which requests are accepted or rejected.
**Execution posture**: characterization-first (existing tests already pin current accept/reject behavior), then extract-and-reuse, verified by the unmodified existing suites.
**Document language**: English, following the Planner document-language default.

## Outcome

The five-field reservation snapshot comparison (`record_revision`, `workspace_revision`, `intent_revision`, `intent_content_hash`, `diff_hash`) that currently appears as two separate inline boolean expressions in `coordinator.ts` — one inside `advance()`, one inside `submitReview()` — becomes one named, testable, pure function shared by both call sites. `advance()`'s full review-ready validity check (claim identity, lifecycle, next obligation, and the five-field match) becomes a second named pure function, `reservationStillValid`, so the condition governing whether a cached Review reservation may be reused is readable and unit-testable independent of the surrounding async control flow. No field is removed, merged, or reinterpreted: each of the five fields answers a distinct question (record identity, workspace identity, intent revision, intent content, and diff content) and stays as its own comparison, per the confirmed decision to keep this precision rather than collapse it into a single combined digest.

This does not change `submitReview()`'s own extra `lifecycle`/`artifact_state` check or its separate `review_revision` verification — those remain in place, layered on top of the shared five-field comparison, exactly as today.

## Brainstorm Trace

| ID | Confirmed requirement | Design / acceptance |
|---|---|---|
| BR-DEC-06 | Keep all five reservation snapshot fields distinct; extract the inline `&&` comparison into a named function returning the mismatched fields; extract `advance()`'s review-ready validity check into an independent pure function `reservationStillValid()` | D1, D2; AC1–AC3 |

## Scope and exclusions

Include: `plugins/immune-brain/runtime/assurance/coordinator.ts` (`advance()` lines ~614-639, `submitReview()` lines ~916-935, and wherever the new functions are placed in the same file or an adjacent module); existing coordinator/host-conformance tests that already exercise both matching and mismatching reservation snapshots.

Exclude: any change to the five fields' meaning, count, or the values compared; `submitReview()`'s `review_revision` verification block (a separate, already-isolated check); the QA/settlement flow after a reservation is accepted or released; the capability-binding types (separate slice); the verification-descriptor v1/v2 boundary (separate, deferred slice). No new snapshot schema, no generic diff-hashing abstraction, and no behavior change for any currently-passing or currently-failing case in the existing suites.

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/assurance/coordinator.ts:625-635` (`advance()`): computes `matches` from `!projection.error && projection.claim?.task_id === taskId && current.lifecycle === "active" && current.next_obligation === "run_review" && reservation !== undefined` **and** the five-field equality chain against `reservation.snapshot`. On mismatch it releases the reservation and clears `rejectedReviewOperations`.
- `plugins/immune-brain/runtime/assurance/coordinator.ts:931` (`submitReview()`): a single long `||`-chained rejection condition combining `fresh.error`, claim/task-id identity, the same five fields, **plus** `lifecycle` and `artifact_state` (fields `advance()`'s check does not compare directly against the reservation snapshot in the same expression, since `advance()` re-derives `lifecycle`/`next_obligation` from the fresh projection rather than the cached snapshot). On mismatch it releases the reservation with a reason and returns `blocked`.
- These two expressions are independently maintained today: a future field addition to the snapshot risks being added to only one of the two inline expressions. A shared `compareReservationSnapshot` removes that risk for the five common fields; each call site's additional, genuinely different conditions stay local to that call site.
- `tests/host-neutral-assurance-coordinator.test.ts`, `tests/claude-host-authority.test.ts`, `tests/pi-canary-assurance-progression.test.ts`, `tests/dual-host-assurance-conformance.test.ts`: all four contain reservation/`record_revision`/`review_ready` assertions and exercise both the matching and the stale-snapshot paths through real coordinator calls (confirmed by direct grep for `reservation`/`review_ready`/the revision fields).

## Technical Design

**Design views**: none beyond the two existing call sites; this is an extraction of already-described behavior, not a new structural or sequence element.
**Diagram decision**: not required
**Diagram reason**: no new control-flow branch, state, or actor is introduced; both call sites keep their existing position in `advance()`/`submitReview()`.

### D1. `compareReservationSnapshot`

A pure function `compareReservationSnapshot(snapshot: ReservationSnapshot, current: { record_revision; workspace_revision; intent_revision; intent_content_hash; diff_hash }): string[]` returns the list of field names that differ (empty means an exact match on all five). Both `advance()` and `submitReview()` call it and combine its result with their own additional, already-distinct conditions (claim/lifecycle/next_obligation in `advance()`; lifecycle/artifact_state/error in `submitReview()`) exactly as those conditions exist today — only the five-field comparison itself moves into the shared function.

### D2. `reservationStillValid`

A pure function `reservationStillValid(reservation, projection, taskId)` wraps `advance()`'s complete review-ready validity predicate (claim identity, `lifecycle === "active"`, `next_obligation === "run_review"`, and a clean `compareReservationSnapshot` result) and returns a boolean. `advance()` calls this function in place of its current inline `matches` expression; the release-on-mismatch and `rejectedReviewOperations` cleanup that follow stay in `advance()` itself, since they are side effects, not part of the pure predicate. `submitReview()` keeps composing `compareReservationSnapshot` directly with its own extra conditions rather than reusing `reservationStillValid`, because its accept/reject shape genuinely differs (different extra fields, and a `reason` string rather than a boolean).

## Verification and acceptance mapping

| Acceptance | Focused verification | Required regression behavior |
|---|---|---|
| AC1 | `bun test tests/host-neutral-assurance-coordinator.test.ts` | `advance()` still reuses a matching Review reservation and still releases a stale one on every one of the five fields changing individually; identical accept/reject outcomes to pre-refactor behavior |
| AC2 | `bun test tests/claude-host-authority.test.ts tests/pi-canary-assurance-progression.test.ts` | both hosts observe the same reservation-validity outcomes through their real adapters; no host-specific divergence introduced by the extraction |
| AC3 | `bun test tests/dual-host-assurance-conformance.test.ts` | `submitReview()`'s stale-snapshot rejection (including its `lifecycle`/`artifact_state` conditions, which stay outside the shared function) is unchanged for both hosts |

Outside these acceptance descriptors: `bun run typecheck` (new function signatures must type-check against existing callers) and `bun test tests/host-neutral-assurance-coordinator.test.ts tests/claude-host-authority.test.ts tests/dual-host-assurance-conformance.test.ts tests/pi-canary-assurance-progression.test.ts` together once, to confirm no cross-suite interaction was disturbed by moving shared logic into one module.

## Devil's Advocate Audit

- **Rollback resilience**: pure extraction with identical inputs/outputs at each call site; reverting is a straightforward inline-the-function operation. No persisted state, snapshot schema, or authority record changes shape.
- **Verification vanity**: a passing suite must still exercise at least one true mismatch per field (not just the identical-snapshot happy path) for both `advance()` and `submitReview()`, since a naive extraction could accidentally drop one field from the shared comparison without any test noticing if only matching cases are exercised. Confirm the four listed test files individually vary at least one of the five fields before authoring a TaskIntent revision that depends on this Spec's acceptance mapping.
- **Spec dilution**: this must not become a general "snapshot framework," a change to what triggers `run_review` vs `blocked`, or a merge of the five fields into fewer comparisons — BR-DEC-06 explicitly keeps them distinct.

## Delivery boundary

One Spec and one TaskIntent settle together. This candidate authorizes nothing until native Enrollment. Execution completion requires the focused acceptance checks, `bun run typecheck`, and required Review (authority-adjacent coordinator changes require it); planning completion requires canonical author/validate success, a tracked candidate artifact, and the complete BR trace above.
