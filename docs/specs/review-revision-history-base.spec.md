# Persisted review_revision base check and round-3 delta wiring

**Status**: Candidate; no execution authority.
**Task ID**: `review-revision-history-base`
**Design risk**: High — the change tightens parsing of persisted TaskRecord v4 state, so a stored record that parses today can fail tomorrow; the code change is one parse rule plus one test, with no schema, interface, or writer change.
**Design views**: data flow (persisted `request_rework` history `review_revision` → `parseTaskRecordAtVersion` → `reviewDeltaInput` → `captureReviewManifest` delta → snapshot `review_delta`).
**Document language**: English, following Planner's default document policy.

## Outcome

Parsing a TaskRecord v4 rejects any history `review_revision` whose `base_head` differs from `record.git_base_head`, the same way it already rejects such an attestation. One end-to-end test drives a real record through a round-2 Review rework via `createVerdictAuthority` and a round-3 Review capture via `buildAssuranceSnapshot`. It proves that the persisted revision reaches the round-3 snapshot as `prior_review_commit` and `delta_paths`.

## Sources

- **#244** — Problem, Result, Out of scope (https://github.com/dereknex/immune-brain/issues/244).
- **Brainstorm manifest** (clarify, 2026-10-28) — `BR-REQ-1..4`, `BR-DEC-1..3`, `BR-OUT-1..3`; no `BR-SCN-*`, `BR-DEFER-*`, or open `BR-Q-*`.
- Repository evidence:
  - `plugins/immune-brain/runtime/kernel/validation.ts:594-599` — v4 parse checks only `attestations[*].review_revision.base_head` against `git_base_head`.
  - `plugins/immune-brain/runtime/kernel/validation.ts:282-318,601` — `parseHistoryV3` (used for v3 and v4 history) checks only shape and `authority_kind === "review"`.
  - `plugins/immune-brain/runtime/kernel/reducer.ts:630-642` — the write-time check that a Review rework revision names the Enrollment base on v4.
  - `plugins/immune-brain/runtime/assurance/verdict_authority.ts:84-98` — `reviewDeltaInput` takes the prior `review_commit`/`review_tree` from the latest `review_round_<n-1>` history entry without a base check.
  - `plugins/immune-brain/runtime/assurance/verdict_authority.ts:172-205,255-267` — `buildAssuranceSnapshot` builds a Review manifest only for v4 and derives `review_delta` through `reviewDeltaOf`.
  - `plugins/immune-brain/runtime/assurance/verdict_authority.ts:357-360` — `reworkRevision` persists `snapshot.review_revision` on Review rework only.
  - Existing coverage is unit-only: `tests/kernel-canary-rework-authority.test.ts:784-873` passes `delta` to `captureReviewManifest` by hand, and `tests/kernel-record-v4.test.ts:115-123` covers the attestation base rejection.
  - Stored-state probe (read-only, 2026-10-28): across 207 local v4 TaskRecords under `.imm/`, 30 history entries carry `review_revision` and none disagrees with `git_base_head`.

## Threat model and supported environment

The input is a TaskRecord v4 JSON file in the repository's own `.imm` store, written only by the Kernel reducer. There is no hostile adversary. The case handled is a corrupted or hand-edited record that the reducer would never have written. Supported: TaskRecord v3 and v4 as parsed today; SHA-1 Git object ids, as `GIT_OBJECT_ID` already requires.

## Decisions and technical design

### D1 — Parse-time base check on v4 history (source: BR-REQ-1, BR-DEC-1)

In `parseTaskRecordAtVersion`, when `version === 4`, every parsed history entry that carries `review_revision` must have `review_revision.base_head === git_base_head`. Otherwise the parser records the violation `record.history[<i>].review_revision.base_head must equal record.git_base_head`. The violation flows through the existing aggregated violation path, so the record does not parse. This mirrors the attestation rule at `validation.ts:594-599`. The rule rejects rather than ignores, because both the attestation parse rule and the reducer write rule reject.

### D2 — Unchanged compatibility (source: BR-REQ-2, BR-DEC-2)

- A v4 history entry without `review_revision` parses and behaves unchanged.
- A v3 record keeps today's parse behavior, including a review-authored history `review_revision`. v3 has no `git_base_head`, and `buildAssuranceSnapshot` never builds a manifest for v3 (`verdict_authority.ts:172-205`), so that field never feeds the delta.
- The reducer, `reviewDeltaInput`, `reviewDeltaOf`, `reworkRevision`, and the manifest builder do not change.

### D3 — End-to-end wiring test (source: BR-REQ-3, BR-DEC-3)

Extend `tests/host-neutral-assurance-coordinator.test.ts`, reusing `authorityFixture` and the `createVerdictAuthority` wiring at `:940-952`. The test runs these steps:

1. Bring a v4 record to Review round 2 (round 1 of Review rework already recorded).
2. Capture a Review snapshot with `buildAssuranceSnapshot`.
3. Apply a Review `rework` verdict through `createVerdictAuthority().applyVerdict`, and assert that the new `request_rework` history entry (`review_round_2`) carries `review_revision` equal to the round-2 snapshot's revision.
4. Stage a rework edit to exactly one in-scope path, return the task to Review, and capture the round-3 snapshot with `buildAssuranceSnapshot`.
5. Assert that `review_delta` has `round: 3`, `prior_review_commit` equal to the round-2 `review_commit`, and `delta_paths` equal to exactly the edited path, with no `skipped` field.

How the fixture reaches round 2 (seeded history or real round-1 rework) is the Executor's choice, as long as round 2 and later go through the real authority and snapshot functions.

### D4 — Release (source: delegated; runtime change is inlined in `plugins/immune-brain/dist/claude/mcp-server.mjs` per `docs/agents/derived-files.json`)

Regenerate the Claude bundle and add a `patch` changeset.

## User scenarios

`no user-visible change` — the change is an internal parse invariant on Kernel-written state plus test coverage, and no command output, file, Issue, or UI state changes for an operator.

## Verification and acceptance mapping

| AC | Seam | Controls |
|---|---|---|
| AC1 parse rule | `tests/kernel-record-v4.test.ts` — `parseTaskRecordV4` / `parseTaskRecord` on in-memory records (prior art `:115-123`) | Negative: v4 record with a review-authored `request_rework` history entry whose `review_revision.base_head` differs from `git_base_head` throws, and the error names `record.history[<i>].review_revision.base_head`. Positive: the same entry with a matching base parses and keeps the field. Bound: a v4 history entry with no `review_revision` parses; a v3 record carrying a review-authored history `review_revision` still parses. |
| AC2 wiring | `tests/host-neutral-assurance-coordinator.test.ts` — `createVerdictAuthority` + `buildAssuranceSnapshot` over `authorityFixture` | Positive: the round-2 history entry carries the snapshot revision, and the round-3 `review_delta` has `prior_review_commit` and `delta_paths`. Negative: a path left byte-identical since round 2 is absent from `delta_paths`, and `skipped` is absent. Any break in `reworkRevision`, `reviewDeltaInput`, or `reviewDeltaOf` makes `skipped` appear or `delta_paths` disappear, so the test fails instead of silently degrading. |
| AC3 unchanged rules | `tests/kernel-canary-rework-authority.test.ts` (existing write-time and manifest delta cases, including rounds 1–2 digest stability at `:875+`) | Bound: existing assertions pass unedited (BR-OUT-1, BR-OUT-2). |
| AC4 packaging | `bun scripts/build-claude-plugin.ts --check`; changeset file | Negative: stale bundle; missing or non-`patch` changeset. |

`bun run typecheck` and the full `bun test` remain the Executor's regression run, not acceptance.

## Reference closure and scope

- Runtime: `plugins/immune-brain/runtime/kernel/validation.ts`.
- Generated: `plugins/immune-brain/dist/claude/mcp-server.mjs`.
- Tests: `tests/kernel-record-v4.test.ts`, `tests/host-neutral-assurance-coordinator.test.ts`.
- Release: `.changeset/review-revision-history-base.md`.

Other consumers of `review_revision` were checked and need no edit:

- `reducer.ts` already rejects at write time.
- `verdict_authority.ts`, `coordinator.ts`, `qa.ts`, `review_evidence.ts`, `batch_integration.ts`, and `canary_application.ts` read the attestation or snapshot revision, not history.
- `legacy_task_record.ts` (v2) has no `review_revision`.

Records that fail the new rule surface through the existing `readTaskRecordRaw` invalid-record path. Today no local record does (Sources, stored-state probe).

## Devil's Advocate Audit

- **Rollback resilience**: one parse rule and tests; no schema, writer, or migration. Reverting the commit restores today's parsing. If a historical record ever failed the rule, it would already be a reducer-impossible record, and the probe found none locally.
- **Verification vanity**: AC1 includes the mismatched-base case, which passes today and must fail after the change, plus v3 and absent-field bounds so the rule cannot be over-broad. AC2 asserts `delta_paths` content and the absence of `skipped`, which is exactly the silent degradation #244 names. A test built around a hand-passed `delta` would not satisfy it, because the seam is `createVerdictAuthority` plus `buildAssuranceSnapshot`.
- **Spec dilution**: both #244 Result bullets and every `BR-*` item map in the trace below; the Out of scope items are guarded by AC3.

## Brainstorm Trace

| Item | Mapping |
|---|---|
| BR-REQ-1 | D1, AC1 |
| BR-REQ-2 | D2, AC1 bounds |
| BR-REQ-3 | D3, AC2 |
| BR-REQ-4 | D1, AC1 negative |
| BR-DEC-1 | D1 |
| BR-DEC-2 | D2, AC1 v3 bound |
| BR-DEC-3 | D3, AC2 seam |
| BR-OUT-1 | Out: admission rule and S2 exits untouched; AC3 |
| BR-OUT-2 | Out: rounds 1–2 manifests byte-identical; AC3 |
| BR-OUT-3 | Out: no #284 verifier or #260 work in this task |

## Handoff completeness

Single Slice. Result when landed: a v4 record carrying a history `review_revision` with a foreign base no longer parses, and the round-2 → round-3 delta wiring is pinned end to end. Remaining gap: none.
