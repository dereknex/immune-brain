# Single-task delivery path identity

**Status**: Candidate; planning only.
**Design risk**: Medium — one containment: the manual checkout delivery boundary. No Kernel, state-machine or host-adapter change.
**Output language**: English.
**Execution posture**: test-first at the existing exported delivery seam.

## Outcome

A single-task Lane delivery succeeds when some delivered paths already sit in the coordinator checkout with byte-, mode- and index-identical content, instead of parking the whole delivery as a conflict. Every path that is not identical keeps the current protection: it still blocks on any dirty overlap and is never overwritten.

This removes the structural deadlock that currently blocks every single-task Lane delivery whose delta includes the task's own planning files, because the coordinator must keep `docs/plans/<task>.intent.json` present for resume while the same file is part of the delivery.

Delivering the two already-integrated parked batches is **not** this task's work: each stays with its own batch, evidence and authorization. This task delivers the mechanism and proves it at the driver seam.

## Evidence

| ID | Concrete source |
| --- | --- |
| E1 | `plugins/immune-brain/runtime/unattended/checkout_delivery.ts:20` `deliveryAlreadyApplied` requires **every** delivered path to be exactly applied (index mode+blob, worktree bytes and mode, or absent for a deletion). A partial match returns false. |
| E2 | `checkout_delivery.ts:46` computes overlaps by **path** only, so a dirty path whose bytes equal the delivered bytes still blocks with `checkout_delivery_overlap`. |
| E3 | Observed on `batch-single-task-batch-finalization-315522f4`: after successful integration and passing final verification, delivery parked with `checkout_delivery_overlap: docs/plans/single-task-batch-finalization.intent.json, docs/specs/single-task-batch-finalization.spec.md`; both files' worktree hashes equalled the delivered blobs (verified with `git hash-object` against commit `7a991e97`). |
| E4 | Resume re-projects the plan and requires the sidecar: removing those two files made `start_unattended_batch` fail with `failed to project batch plan: TaskIntent sidecar is missing at docs/plans/single-task-batch-finalization.intent.json`. Keeping them present reproduces E3. The two requirements are unsatisfiable together under E1+E2. |
| E5 | `plugins/immune-brain/runtime/unattended/batch_lanes.ts:1368` calls `deliverSingleTask` and parks on any blocked return; `tests/single-task-lane-batch.test.ts` already drives that path end to end and asserts a `staged` return for a clean checkout. |
| E6 | `tests/single-task-checkout-delivery.test.ts:87` already tests whole-delivery replay and `:98` tests byte/mode/unstaged drift after apply, both against `deliveryAlreadyApplied` and `deliverSingleTask`. These are the existing seams to extend; no new module is required. |
| E7 | `docs/agents/derived-files.json:6` declares `plugins/immune-brain/dist/claude/mcp-server.mjs` as generated from `runtime/**/*.ts`, so the bundle must be regenerated and checked. |

## Decisions

| ID | Decision | Exactly one source |
| --- | --- | --- |
| D1 | Make satisfaction per delivered path, not per delivery. A path is satisfied only when its new identity matches exactly: index mode+blob equal the delivered entry, worktree bytes hash to that blob and the executable bit matches, and a delivered deletion is absent from both index and worktree. | E1 |
| D2 | Apply the remaining patch to the unsatisfied paths only, by explicit pathspecs, and keep the existing `--check` before `--apply`. Never rewrite a satisfied path. | E2 |
| D3 | Unchanged auto mode: it is already a lineage fast-forward and gains no per-path branch. | E1 |
| D4 | Keep path-based overlap protection for every unsatisfied path, including unrelated user files. A satisfied-looking path with different bytes, a different mode, or a still-present deletion is unsatisfied and must still block. | E2 |

## Technical Design

**Design views**: data flow of one delivery attempt. No state machine, persistence or authority owner changes.

`deliverSingleTask(root, base, head)`:

1. Read the delivered change list from `git diff --raw -z --abbrev=40 --no-renames base head` and, for each path, the new mode, new blob and status — the same identity `deliveryAlreadyApplied` already reads.
2. Classify each path as satisfied (D1) or pending. When nothing is pending, return the existing success (`staged`); `deliveryAlreadyApplied` keeps its current meaning and callers.
3. Overlap-check the pending paths only against `porcelainEntries`.
4. Build the patch with `git diff --binary --full-index --no-renames base head -- <pending paths>`, `--check` it, then apply with `--index`. An empty pending set never applies.
5. Return `staged`. A satisfied path keeps whatever index/worktree state it already had; the delivery asserts identity, it does not restage.

Failure handling is unchanged and explicit: unreadable status, unreadable diff, failed `--check`, and failed apply each return their existing `blocked` reasons with no partial write beyond what `git apply --index` itself does. Interruption before apply leaves the checkout untouched; interruption after apply is covered by the existing all-satisfied replay guard.

## User scenarios

Source: the user's request to plan the per-path reconciliation described in E1–E4.

| Scenario | Observable result | Mapping |
| --- | --- | --- |
| SCN-1 | A delivery whose planning sidecar already exists identically in the coordinator completes and stages the rest. | automated: AC1 |
| SCN-2 | The same shape with different bytes, a drifted mode, or a still-present deletion still parks without writing. | automated: AC2 |
| SCN-3 | Re-running a completed delivery changes nothing and reports the same success. | automated: AC3 |
| SCN-4 | Through the batch driver, a parked task with an identical planning sidecar delivers on resume and keeps the sidecar. | automated: AC4 |

## Acceptance and verification

Local Bun tests with installed repository dependencies and QA-host Git. Fixtures build disposable repositories under the system temporary directory and remove them. No network, credential, model call or real batch state is used. Required checks must execute; a skipped or zero-match run fails.

| ID | Exactly one source | Seam and controls |
| --- | --- | --- |
| AC1 | E1 | `tests/single-task-checkout-delivery.test.ts`: manual-mode fixture where one delivered path is already staged with identical bytes and mode while the others are absent; delivery returns `staged`, applies the remaining paths, leaves the pre-satisfied path byte- and index-identical, and the checkout ends fully applied. |
| AC2 | E2 | Same file: the same fixture with (a) different worktree bytes, (b) an executable-bit drift, (c) a delivered deletion still present, (d) an overlapping unrelated user file; each returns `blocked` with `checkout_delivery_overlap` and leaves the full snapshot (HEAD, index, worktree) unchanged. |
| AC3 | E1 | Same file: after a successful partial delivery, a second call reports the same success and changes nothing; `deliveryAlreadyApplied` agrees. |
| AC4 | E5 | `tests/single-task-lane-batch.test.ts`: `startBatch` for a settled child whose delivery includes the coordinator's own staged planning sidecar reports `batch_state: completed` with `return_to_coordinator.status: staged`; the sidecar keeps its bytes, every delivered path is applied exactly once, and the task's audit pair is present. |

Completion diagnostics: regenerate the declared Claude bundle and run its `--check`, `bun run typecheck`, and the full `bun test`.

## Execution prerequisite and exit plan

The running Host loads the plugin build that performs delivery. After this task settles, self-delivery therefore requires loading the settled Lane build: point the Pi package source at that Lane, reload, resume the batch, and verify the delivery report before claiming completion. The currently loaded source is the `single-task-batch-finalization` Lane; the switch back to `/Users/derek/workspaces/immune-brain` happens once that Lane's build has landed there.

Temporary source selection: owner user/Host operator; exit as soon as the workspace carries the fixes and is verified loaded; no compatibility layer and no installed-checkout edit by the Planner. Installation or package-source changes are separate protected effects and are not granted by approving this candidate. If the Host cannot load the required build, report that activation blocker as incomplete rather than falling back to another Host, a manual state edit or an unmanaged delivery.

## Completeness and remaining gap

No Brainstorm manifest was supplied. The confirmed outcome — per-path identity delivery — maps once to AC1; its negative controls to AC2; replay determinism to AC3; driver integration to AC4. Deliberately outside: writing the two other parked batches' payloads, and any change to auto mode, Kernel settlement, batch records or user files.

Remaining gap at handoff: implementation, all checks, self-delivery and the two later batch deliveries are pending. Those later deliveries each keep their own parked batch and authorization; this task does not claim them.

## Devil's Advocate Audit

- **Rollback resilience**: one function changes shape; revert the module and bundle together. No persisted state, so no migration. Partial `git apply` failure keeps the existing non-destructive behavior.
- **Verification vanity**: the positive case would pass under a naive "skip everything already present" rule, so AC2 pins the four negative identities (bytes, mode, deletion, unrelated file) and AC4 exercises the real driver path rather than the helper alone.
- **Spec dilution detection**: accepting a path on bytes alone, silencing the overlap reason, restaging a satisfied path, or touching auto mode would each fail an assertion here. Fixture-only success without driver-level delivery is also rejected by AC4.
