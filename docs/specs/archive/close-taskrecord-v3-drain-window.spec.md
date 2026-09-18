# Close the TaskRecord v3 drain window

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: High — this is a live behavior change, not a pure refactor: it narrows the accepted contract of the reducer/coordinator state machine so a `TaskRecordV3` record is rejected at live entry instead of progressing to completion, and it requires rewriting the core assertions (not just fixtures) of two existing regression tests.
**Execution posture**: narrow-then-extract — narrow the live `TaskRecord` union and its entry-point guards first, then extract the v2/v3 frozen historical reader into its own module so `readAuditTaskPair` keeps reading `.imm/audit/`'s existing v2 and v3 terminal records unchanged.
**Document language**: English, following the Planner document-language default.

## Outcome

`TaskRecord` narrows from `TaskRecordV3 | TaskRecordV4` to `TaskRecordV4` alone at every live entry point: the reducer, the Claude host's review-bundle construction, and `validation.ts`'s live-dispatch parser. A record whose `contract` is not `assurance_kernel/task_record/v4` is rejected at the moment it would enter the live reducer/coordinator path — it does not progress to `review_ready`, `completed`, or `done` — matching the fail-closed treatment the coordinator already gives a `vFuture` or stale-identity record today. `TaskRecordV2` and `TaskRecordV3` are not deleted: `TaskRecordV4 extends Omit<TaskRecordV3, "contract">`, so the v3 shape remains as V4's structural ancestor, and both interfaces plus their frozen parsers move into a dedicated historical-only reading path used exclusively by `readAuditTaskPair` for already-terminal `.imm/audit/` records — never by the live reducer/coordinator.

This is the completion of the state the `types.ts:278` comment already names as transitional ("during the v3 drain window"): after this change there is no drain window left, only a frozen historical record of it.

## Brainstorm Trace

| ID | Confirmed requirement | Design / acceptance |
|---|---|---|
| BR-DEC-01 | Narrow `TaskRecord` to `TaskRecordV4` alone; remove the reducer/validation v3 dual-path judgment | D1; AC1, AC2, AC4 |
| BR-DEC-02 | Keep `TaskRecordV2`/`V3` historical reading as an independent, frozen, no-longer-touched minimal read-only module (an isolated equivalent of the existing `audit --legacy` path); do not delete it alongside the reducer narrowing | D2; AC3 |

`bin/imm-kernel status --json` confirmed at brainstorm time that this repository's own worktree currently holds `claim: null` (no active v3 record mid-flight), which is what makes narrowing safe to schedule now rather than blocked on an in-flight v3 task.

## Scope and exclusions

Include: `plugins/immune-brain/runtime/kernel/types.ts` (the `TaskRecord` union and its doc comment), `plugins/immune-brain/runtime/kernel/reducer.ts` (the `record.contract !== TASK_RECORD_CONTRACT_V4` branch), `plugins/immune-brain/runtime/claude/kernel_ports.ts` (`isTaskRecordV4`, `reviewBundle`/`reviewManifest` construction), `plugins/immune-brain/runtime/kernel/validation.ts` (`parseTaskRecord`'s live-dispatch default), `plugins/immune-brain/runtime/kernel/storage.ts` (`readAuditTaskPair`'s non-v2 branch), a new historical-only module housing `TaskRecordV2`/`TaskRecordV3` and their frozen parsers, and the tests enumerated in Verification below.

Exclude: `TaskRecordV3`'s own interface declaration (stays, as `TaskRecordV4`'s structural base and as the frozen reader's parse target); any change to `.imm/audit/` file contents (the physical v2/v3 JSON already on disk is untouched — only the reader is reorganized, per BR-OUT-02); `verification_descriptor` v1/v2 (a separate, already-resolved slice, `project-owned-verification`); dual-host neutrality (BR-DEC-08, kept as-is — both Claude and Pi host paths must fail closed on a v3 record identically, not diverge); capability-binding types and the reservation-snapshot comparison (separate slices, `extract-capability-binding-base-type` and `extract-review-reservation-comparison`). No new TaskRecord version, no schema migration tool (that is the separate, dependent `imm-kernel migrate --to-vNext` slice), no change to what a v4 record itself requires.

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/kernel/types.ts:239-250` (`TaskRecordV2`), `:254-271` (`TaskRecordV3`), `:272-275` (`TaskRecordV4 extends Omit<TaskRecordV3, "contract">`), `:278` (`export type TaskRecord = TaskRecordV3 | TaskRecordV4;`, doc comment: "the record shape every Kernel owner passes around during the v3 drain window").
- `plugins/immune-brain/runtime/kernel/reducer.ts:435-437`: `if (record.contract !== TASK_RECORD_CONTRACT_V4) { if (reviewRevision) throw ... }` — the live reducer today actively accepts and mutates a v3-contract record; a v3 review approval is only rejected if it happens to carry a `review_revision` it isn't allowed to have. This branch disappears once the live type is v4-only; the `else if (approval.kind === "review")` branch's `review_revision` requirement becomes unconditional.
- `plugins/immune-brain/runtime/claude/kernel_ports.ts:278-281`: `isTaskRecordV4(record)` gates `reviewBundle` (the non-v4 branch, built when `role === "review" && !isTaskRecordV4(record)`) versus `reviewManifest` (the v4 branch). Once the live type is v4-only, `reviewBundle` construction and its dead branch are removed; `reviewManifest` becomes unconditional for `role === "review"`.
- `plugins/immune-brain/runtime/kernel/validation.ts:844-848`: `export function parseTaskRecord(raw) { const contract = ...; if (contract === TASK_RECORD_CONTRACT_V4) return parseTaskRecordV4(raw); return parseTaskRecordV3(raw); }` — the live-dispatch parser used by every durable Kernel owner today silently accepts any non-v4 contract as v3. After narrowing, this default-to-v3 fallback must become a rejection (throw) for any non-v4 contract; `parseTaskRecordAtVersion`/`parseTaskRecordV3` (lines 701-839) stay as named exports, but are no longer reachable from `parseTaskRecord`'s live dispatch — they move to being called only from the new historical-only reading path.
- `plugins/immune-brain/runtime/kernel/storage.ts:953-1010` (`readAuditTaskPair`): branches on `raw.contract === "assurance_kernel/task_record/v2"` (line 991) via `parseTaskRecordV2`, else calls `parseTaskRecord` (line 1004, today's v3/v4 live dispatch). Since `.imm/audit/` holds real terminal v3 records (confirmed present alongside v2 and v4 at brainstorm time) that this function must keep serving, its non-v2 branch changes to: try the (now v4-only) live `parseTaskRecord` first, and on rejection fall back to the frozen `parseTaskRecordV3` reader for a historical terminal record. `readAuditTaskPair`'s return type widens to the frozen union (`TaskRecordV2 | TaskRecordV3 | TaskRecordV4`), distinct from the live `TaskRecord` type, which stays v4-only.
- Callers of `readAuditTaskPair` needing unchanged external behavior after this reorganization: `plugins/immune-brain/runtime/unattended/batch_git.ts:461,763`, `plugins/immune-brain/runtime/unattended/batch_preflight.ts:262`, `plugins/immune-brain/runtime/kernel/assurance_projection.ts:304`, `storage.ts:1747` (`readTaskRecord`, an internal caller).
- `tests/kernel-assurance-obligation.test.ts`: imports `TaskRecordV3`/`parseTaskRecordV3`/`reduceTask` directly; its fixture builds a `contract: "assurance_kernel/task_record/v3"` record and asserts `reduceTask(record, action)` progresses the record's `lifecycle` to `"done"` through the live reducer. This is a genuine live-path test, not a frozen-reader test — its core assertion must invert to a rejection once the live union narrows.
- `tests/dual-host-assurance-conformance.test.ts:489` (`v3() { contract = "assurance_kernel/task_record/v3"; }`, a fixture mutator alongside `stale()`/`future()`) and `:761-770` (test `"v3 drain remains readable while vFuture, stale identity, and concurrent continuation fail closed"`): today asserts `v3.claude().coordinator.advance(TASK, ctx)` reaches `{ state: "completed" }`, and separately that the Pi host's `advance()`/`submitReview()` also reach `"completed"`. This test's own title already frames v3 as the temporary case among four; after this change v3 must fail closed exactly like `vFuture`, stale identity, and concurrent continuation already do in the same test — the test's name and body both need to state that inversion, not just its fixture.
- File overlap with the sibling slice `extract-review-reservation-comparison`: both this Spec and that one touch `coordinator.ts` and `tests/dual-host-assurance-conformance.test.ts`. That slice is a pure, behavior-preserving extraction; this Spec is a behavior change. Recommended execution order: `extract-review-reservation-comparison` first, so this Spec's fail-closed rewrite lands on the already-extracted `compareReservationSnapshot`/`reservationStillValid` functions rather than needing to be re-based across an in-flight pure refactor of the same file and test.
- Dependent slice: `imm-kernel migrate --to-vNext` (a separate, not-yet-authored slice) flattens historical `.imm/audit/<task-id>/` evidence to pure v4 JSON; that flattening is only correct once this Spec's live union is v4-only, so that slice must execute after this one, not before or concurrently.

## Technical Design

**Design views**: none beyond the existing reducer/coordinator/storage call paths; this narrows an existing type and its guards, and relocates two existing parsers behind a clearer boundary — it does not introduce a new structural or sequence element.
**Diagram decision**: not required
**Diagram reason**: no new control-flow branch, actor, or state is introduced; the reducer/coordinator's existing branches are removed or made unconditional, and the parser relocation is a module boundary change, not a new call shape.

### D1. Narrow the live `TaskRecord` union and reject v3 at every live entry point

`types.ts:278` becomes `export type TaskRecord = TaskRecordV4;` with its doc comment corrected to state the drain window is closed. `reducer.ts:435`'s `record.contract !== TASK_RECORD_CONTRACT_V4` branch and its guarded exception are removed; the `review_revision` requirement for a `"review"`-kind approval (currently the `else if` branch) becomes unconditional, since every live record is now a `TaskRecordV4`. `kernel_ports.ts`'s `isTaskRecordV4` check and `reviewBundle` branch are removed; `reviewManifest` is built unconditionally for `role === "review"`. `validation.ts`'s `parseTaskRecord` stops falling back to `parseTaskRecordV3` for a non-v4 contract and instead throws, matching the rejection behavior already given to an unrecognized or `vFuture` contract elsewhere in the same file.

### D2. Extract the v2/v3 frozen historical reader

`TaskRecordV2` and `TaskRecordV3`, together with `parseTaskRecordV2` and `parseTaskRecordV3` (relocated, not reimplemented — their parsing logic does not change), move into a dedicated historical-only module (e.g. `kernel/legacy_task_record.ts`) that nothing in the live reducer/coordinator/validation dispatch imports. `storage.ts`'s `readAuditTaskPair` becomes the sole caller of this frozen module for its non-v2 branch: it tries the (now v4-only) live `parseTaskRecord` first, and on rejection falls back to the frozen `parseTaskRecordV3` reader, since `.imm/audit/` holds real terminal v3 records this function must keep serving unchanged. Its v2 branch (line 991) is otherwise unchanged. `readAuditTaskPair`'s return type widens to the frozen union `TaskRecordV2 | TaskRecordV3 | TaskRecordV4`, kept distinct from the now-narrower live `TaskRecord` type so no live caller can accidentally widen back to accepting v3.

## Verification and acceptance mapping

| Acceptance | Focused verification | Required regression behavior |
|---|---|---|
| AC1 | `bun test tests/kernel-assurance-obligation.test.ts` | its v3 fixture, fed through the live reducer (`reduceTask`), is rejected instead of progressing to `"done"`; the test's assertion is rewritten to prove rejection, not deleted |
| AC2 | `bun test tests/dual-host-assurance-conformance.test.ts` | the "v3 drain remains readable..." test is rewritten (title and body) so a v3-contract record fails closed identically to `vFuture`, stale identity, and concurrent continuation, for both the Claude and Pi host adapters |
| AC3 | `bun test tests/kernel-storage-layout-migration.test.ts tests/task-record-durability.test.ts` | `readAuditTaskPair` and its callers (`batch_git.ts`, `batch_preflight.ts`, `assurance_projection.ts`) continue reading existing `.imm/audit/` v2 and v3 terminal records unchanged through the relocated frozen reader |
| AC4 | `bun test tests/kernel-r2c2-reducer.test.ts tests/risk-downgrade-guard.test.ts tests/kernel-record-v3.test.ts tests/kernel-record-v4.test.ts` | v4-only live-path reducer/risk-guard behavior is unaffected; the frozen `parseTaskRecordV3`/`parseTaskRecordV2` parser-level tests keep passing from their new module location |

Outside these acceptance descriptors: `bun run typecheck` (every live caller must type-check against the narrowed `TaskRecord = TaskRecordV4`; every historical caller must type-check against the frozen union) and, given the file overlap noted above, a full `bun test` pass after `extract-review-reservation-comparison` has landed, to confirm the two slices compose cleanly on `coordinator.ts` and its shared test file.

## Devil's Advocate Audit

- **Rollback resilience**: this is not a mechanical revert like a pure extraction. Reverting requires restoring the removed v3-acceptance branches in `reducer.ts`/`kernel_ports.ts`/`validation.ts` and re-widening `TaskRecord`; the physical `.imm/audit/` v2/v3 files are never touched by this Spec, so a revert loses no historical data, but it is a real code revert, not a type-inline.
- **Verification vanity**: AC1/AC2 must prove active rejection (an explicit fail-closed assertion, matching the existing pattern already used for `vFuture`/stale/concurrent-continuation in the same test file), not merely delete the old success assertion and leave the case unasserted — an untested v3 record would be a silent regression back to accepting it.
- **Spec dilution**: this must not become a dual-host consolidation (BR-DEC-08 stays as-is — both hosts fail closed identically, no host is dropped), a `verification_descriptor` v1/v2 change (separate, already-resolved slice), or the migration-tool slice itself (`imm-kernel migrate --to-vNext` depends on this Spec, but is not part of it).

## Delivery boundary

One Spec and one TaskIntent settle together. This candidate authorizes nothing until native Enrollment. Execution completion requires the focused acceptance checks, `bun run typecheck`, and required Review (a live authority-adjacent state-machine behavior change requires it); planning completion requires canonical author/validate success, a tracked candidate artifact, and the complete BR trace above.
