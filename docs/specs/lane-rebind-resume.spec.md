# Resume a single-task Lane batch after an in-Lane intent revision

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: High — changes what the persisted batch authorization binding (`plan_digest`) covers after a literal-user revision, adds a validated field to the batch run state record, and changes the resume projection that compares against that binding.
**Execution posture**: test-first. The parked-resume regression in Issue #500 is reproducible at an existing seam, `tests/single-task-lane-decision.test.ts`, and must fail before the fix lands.
**Document language**: English, following the Planner document-language default.

## Outcome

A single-task `drive` batch whose Lane committed a breaking intent revision approved by the user through the Parent's native gate can be resumed after it parks. Resume no longer refuses `plan_changed` ("batch plan changed after native confirmation", `plugins/immune-brain/runtime/unattended/batch_reasons.ts`). The batch report shows the recorded rebind to the new revision, and the resume opens no native gate beyond the one it already opens.

Root cause (Issue #500):
- `rebindSingleTaskIdentity` (`plugins/immune-brain/runtime/unattended/batch_state.ts:1166-1183`) rewrites `intent_identities[task]` to the revision committed in the Lane but leaves `plan_digest` unchanged.
- On resume, `projectPlanSurface` (`plugins/immune-brain/runtime/unattended/batch_preflight.ts:518-593`) rebuilds each child's identity:
  - The revision and content hash come from the checkout sidecar. A Lane child has no TaskRecord in the checkout, and the sidecar there is still at revision 1.
  - For the states `pending`, `lane_admitted`, `skipped_blocked` and `needs_human`, the authority hash comes from the rebound record identity, which is at revision 2.
- The recomputed digest therefore matches neither the old binding nor the new one, and `batch_preflight.ts:854-855` refuses `plan_changed`.
- The happy path (still `running`, re-attach) passes today only because it reads the checkout at revision 1 on both sides, which matches the unchanged revision-1 digest.

## User scenarios

- **BR-SCN-1** — `automated`, AC3.
  - **Actor:** user
  - **Given:** a single-task `drive` Lane where the user approved breaking revision 2 through the Parent gate, after which the batch parked `needs_human`
  - **When:** the user re-enters `drive` and passes the existing resume gate
  - **Then:** the report shows the task continuing at revision 2 instead of "batch plan changed after native confirmation"

## Brainstorm Trace

| ID | Disposition | Where |
| --- | --- | --- |
| BR-REQ-1 | covered | D1, D4, D5; AC1, AC3 |
| BR-REQ-2 | covered | D4 (non-rebound children unchanged), D6; AC3 bound control, AC4 |
| BR-DEC-1 | decisioned | D1 (rewrite `plan_digest` in the rebind's atomic write, record before and after), D4 (resume reads the record identity), D7 (ADR 0018 amendment); AC1, AC3, AC5 |
| BR-DEC-2 | decisioned | D8: the checkout `docs/plans/<task>.intent.json` is never written |
| BR-OUT-1 | out | Initiative batches stay on ADR 0028 clause 5; D3 refuses `lane_rebinds` on a non-`single_task` record (AC2) |
| BR-OUT-2 | out | A run already terminal after a Kernel `stop` is untouched; no terminal-run re-enrollment path is added |
| BR-OUT-3 | out | The F19 decision relay (PR #449) is unchanged; `lane_decision.ts` keeps calling `rebindSingleTaskIdentity` as it does now |
| BR-SCN-1 | covered | AC3 |

## Scope and exclusions

**In scope**
- The rebind write (D1, D2).
- The record shape for the new `lane_rebinds` field (D3).
- The resume plan projection (D4).
- Exposing `lane_rebinds` in the batch report (D5).
- The ADR 0018 amendment (D7).
- Focused tests and a changeset.

**Excluded**
- Initiative batches (BR-OUT-1).
- Terminal runs after a Kernel `stop` (BR-OUT-2).
- The F19 relay (BR-OUT-3).
- Healing records written before this change (D6).
- The final-report planning check in `batch_final_report.ts:72-79`. It reads `intent_identities`, whose meaning this change keeps, so it is not touched.

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/unattended/batch_state.ts`
  - `:1166-1183` is `rebindSingleTaskIdentity`, the producer of the rebound identity.
  - `:751` is `validateLaneRecordShape`.
  - `:449-454` validates `intent_identities`.
  - `:864-881` validates `delegated_revisions` and `reseals`. The `reseals` check (last `to_digest` equals `plan_digest`, `:880`) is the precedent for D3.
  - `:1301-1302` holds the report fields `delegated_revisions` and `reseals`.
- `plugins/immune-brain/runtime/unattended/batch_preflight.ts`
  - `:518-593` is the resume branch of `projectPlanSurface`, the consumer that recomputes the digest.
  - `:854-855` is the `plan_changed` comparison.
- `plugins/immune-brain/runtime/kernel/batch_authority.ts:118-135`: `computeBatchPlanDigest` binds `intent_authority_hash` when every child carries one, and otherwise binds `intent_revision` plus `intent_content_hash`. The rebind recomputes with this same function.
- `plugins/immune-brain/runtime/unattended/lane_decision.ts:154-160`: the only caller of the rebind. It reads the committed Lane TaskRecord and is unchanged.
- `plugins/immune-brain/runtime/unattended/batch_lanes.ts`
  - `:622-633` is `laneAuthorityChange`. It compares the Lane sidecar with the recorded authority hash, is already consistent with a rebound identity, and is unchanged.
  - `:707-708` projects `delegated_revisions` and `reseals` into the report. D5 adds `lane_rebinds` here.
- `docs/adr/0018-delegated-in-lane-intent-revision.md:126-140`: the single-task amendment says "`plan_digest` is not touched". D7 rewrites it.
- Tests: `tests/single-task-lane-decision.test.ts`
  - `:265-280` covers the rebind unit path: replay, stale, then the next `startBatch`.
  - `:502-537` relays a breaking revision through the Claude Host and checks that re-attach does not refuse `plan_changed`. It is the positive control for the still-running path.
- Derived outputs, per `docs/agents/derived-files.json`, are regenerated rather than hand-edited:
  - `plugins/immune-brain/dist/claude/mcp-server.mjs`
  - `plugins/immune-brain-antigravity/runtime/unattended/batch_state.ts`
  - `plugins/immune-brain-antigravity/runtime/unattended/batch_preflight.ts`
  - `plugins/immune-brain-antigravity/runtime/unattended/batch_lanes.ts`
  - `plugins/immune-brain-antigravity/dist/antigravity/mcp-server.mjs`

**Threat model and supported environment**: None beyond the repository's own tooling. The batch record is a Kernel-store file written under `withKernelStoreLock`. A record edited by hand is handled only through the enumerated negative cases in AC1 and AC2.

## Technical Design

**Design views**: data shape (the `lane_rebinds` entry and its invariants), then state transitions (which child states the resume projection reads from the record). Temporal sequence is covered by D1's single locked write; no separate interface or layer view is needed because no module boundary moves.

### D1. Rebind rewrites the binding in the same write (BR-DEC-1)

`rebindSingleTaskIdentity` does all of the following inside the existing `withKernelStoreLock` call and the single `writeFileAtomically`:
1. Builds the new identity, as it does today.
2. Recomputes `plan_digest` with `computeBatchPlanDigest` over `record.children` (`task_id`, `blocked_by`) joined with the updated `intent_identities`.
3. Appends one entry to `lane_rebinds`:
   `{ at, task_id, from_revision, to_revision, from_digest, to_digest, intent_content_hash, intent_authority_hash?, risk }`
   - `from_digest` is the record's previous `plan_digest`.
   - `to_digest` is the new one.
   - `risk` is the committed revision's declared risk.
4. Writes the record once.

There is no intermediate write. A crash leaves either the old record or the new one.

### D2. Precondition and idempotency (delegated technical choice)

The rebind first recomputes the digest over the record's *current* identities.
- If that digest differs from `record.plan_digest`, the rebind refuses `lane_decision_rebind_failed` and writes nothing. It never seals over a binding that was already inconsistent.
- Replaying the identity already recorded returns the record unchanged. No second entry is added.
- An older or equal revision with another hash stays `lane_decision_stale`.

### D3. Record shape (delegated technical choice, precedent `batch_state.ts:880`)

`lane_rebinds` is optional and must satisfy all of the following:
- It is valid only when `plan_source` is `single_task`.
- Each entry is well formed: digests match `sha256:<64 hex>`, `to_revision` is greater than `from_revision`, and `risk` is a `TASK_RISKS` member.
- The last entry's `to_digest` equals `plan_digest`.
- The last entry for a task equals that task's `intent_identities` revision and content hash.

A record that violates any of these does not parse.

### D4. Resume reads the rebound identity (BR-DEC-1, BR-REQ-1)

In the resume branch of `projectPlanSurface`, a child whose `task_id` has a last `lane_rebinds` entry (validated by D3) takes its identity from the record, in every child state:
- `intent_revision`, `intent_content_hash` and `intent_authority_hash` come from `intent_identities`.
- `risk` comes from that entry.

Children without an entry keep the current read path unchanged:
- TaskRecord, then checkout sidecar, then archive.
- The authority hash comes from the recorded identity in the not-yet-enrolled states and from a live read otherwise.

This also fixes the still-running path. Once D1 moves the digest to revision 2, the projection reads revision 2 for that child in every state rather than the checkout's revision 1.

State view:

| Child state at resume | Before | After (rebound child) |
| --- | --- | --- |
| `pending` / `lane_admitted` / `skipped_blocked` / `needs_human` | revision and hash from the checkout (rev 1), authority hash from the record (rev 2): mixed | everything from the record (rev 2) |
| enrolled and working states in the Lane | everything from the checkout (rev 1), matching the stale rev-1 digest | everything from the record (rev 2), matching the D1 digest |
| `committed` / `settled` / `integrated` / `released` | the checkout carries the integrated rev 2 | the record (rev 2), equal to the checkout |

### D5. Report exposure (BR-SCN-1)

The batch report carries `lane_rebinds` beside `reseals`. This lets the user see the task continuing at the rebound revision (`batch_lanes.ts:707-708`, report type `batch_state.ts:1301-1302`).

### D6. Records written before this change (delegated technical choice)

A record rebound before this change has a revision-2 identity, no `lane_rebinds` and a revision-1 digest. It is not inferred or healed and keeps failing closed with `plan_changed`. Recovery stays the existing `retire_stale_batch` path. Healing it would mean trusting a binding no recorded gate produced.

### D7. ADR 0018 amendment (BR-DEC-1)

The "single-task Lane decisions" amendment replaces "`plan_digest` is not touched". It states that the rebind recomputes `plan_digest` in the same write and records the before and after digests in `lane_rebinds`. It also notes that the change is covered by the literal-user Parent gate that approved the revision. The ADR's #178 narrowing clause names this second producer.

### D8. Checkout untouched (BR-DEC-2)

No code path writes the checkout `docs/plans/<task>.intent.json`. The revision reaches the checkout only by Lane integration.

### False-compromise check

The accepted trade-off is that a record rebound before this change is not recovered in place (D6). Self-Service healing (re-deriving from the Lane TaskRecord) would remove it, at the cost of sealing an authorization no recorded gate wrote, which is an authority-invariant boundary. No false compromise detected.

## Verification and acceptance mapping

All descriptors are focused `bun test tests/single-task-lane-decision.test.ts` runs, except AC5, which is a document check.

| AC | Source | Seam | Done looks like |
| --- | --- | --- | --- |
| AC1 | D1, D2 | `rebindSingleTaskIdentity` + `readAnyBatchRunState` in the rebind unit test (`:265`) | The rebound record's digest is the revision-2 digest, with one `lane_rebinds` entry recording before and after; an inconsistent record is refused without a write |
| AC2 | D3 | `readAnyBatchRunState` over hand-written records in the same file | Malformed or misplaced `lane_rebinds` does not parse |
| AC3 | D4, D5; BR-SCN-1, BR-REQ-1, BR-REQ-2 | the Claude-Host relay harness (`:428`, `:502`) | After an approved revision and a `needs_human` park, the next `drive` start resumes `running` with `lane_rebinds[0].to_revision === 2` in the report and no extra gate |
| AC4 | D4; BR-REQ-2 | the existing re-attach test (`:502`) | The still-running re-attach after a revision continues without `plan_changed` |
| AC5 | D7 | the ADR text | ADR 0018 no longer says `plan_digest` is not touched, and it names `lane_rebinds` |

Controls:
- **Positive:** AC1 digest equality; AC3 resume `running`.
- **Negative:** AC1 tampered digest refused; AC1 older revision stale; AC2 four malformed shapes; AC3 no `plan_changed`.
- **Bound:** AC1 replay adds no entry; AC3 gate delta equals that of the same fixture parked without a revision.

## Devil's Advocate Audit

- **Rollback resilience**
  - Reverting the change leaves records that carry `lane_rebinds`. Older code ignores the unknown field only if its validator tolerates it, and today's `validateLaneRecordShape` does not enumerate allowed keys. Such a record then fails the old resume exactly as today, `plan_changed`, which is still fail-closed.
  - A partial implementation of D1 without D4 would break the still-running re-attach. AC4 catches that.
- **Verification vanity**
  - AC3 parks the batch through `parkLaneForExecutor`, the real park writer, and resumes through the Host harness's start, which runs the real preflight. It fails today with `plan_changed`.
  - AC4 fails if D1 lands without D4.
  - AC1's tampered-digest case fails if the D2 precondition is skipped.
- **Spec dilution detection**
  - Every BR item maps in the Brainstorm Trace above.
  - BR-SCN-1's Then is checked through the report's `lane_rebinds` and `batch_state`, not internal state alone.

## Delivery boundary

One TaskIntent, `lane-rebind-resume`. D1, D3 and D4 must land together: the binding the rebind writes and the projection that reads it form one atomic authority outcome. Splitting them would leave either the still-running path or the parked path refusing.
