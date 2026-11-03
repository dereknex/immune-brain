# Merge queue follow-ups

**Status**: candidate decomposition, confirmed by the user on 2026-11-02 (Initiative name, slug and decomposition in one review table). This document grants no execution authority.
**Initiative name**: Merge queue follow-ups
**Immutable slug**: `merge-queue-followups`
**Carrier**: GitHub, resolved by `imm-kernel config --json` (`initiative_carrier: github`, source `project`, from `.imm/config.json`).
**Planning baseline**: `fcc74b7`. Recheck the affected paths if HEAD changes before Enrollment.
**Document language**: English. User discussion stays in Chinese.
**Design risk**: Medium. Both Slices change one module's internal contract: how `batch_integration.ts` builds and proves a Lane candidate. Its identity proof (`laneCandidateMatches`) is reused by restart adoption and by completion verification in `batch_git.ts`, and its reason set is read by the park logic in `batch_lanes.ts`. No persisted record shape, authority gate or cross-Host contract changes.
**Execution posture**: characterization-first for S2. Pin today's refusal of a fully duplicated delivery at the integration seam before changing its reason.
**Design views**: component interfaces, data flow.
**Threat model and supported environment**: the adversary is the executing model, which produces the Lane commit and may leave a derived output stale, deliver a change a sibling already delivered, or try to smuggle an undeclared path through regeneration. The user, the coordinator's loaded runtime and the declaration frozen at batch start (`docs/agents/derived-files.json` at the batch `base_head`) are trusted. Declared `generate` commands are assumed deterministic for a given tree. Supported: Git 2.38+, SHA-1 object format, UTF-8 paths, macOS and Linux, Bun 1.4.

## Outcome

1. A Lane whose change touches a declared derived-file source or output integrates with that output regenerated from the merged tree, whether or not the merge conflicts. A sibling integrated later no longer parks because an earlier Lane left the output stale. A regeneration that fails parks the Lane that triggered it, with the derived entry named. (#371)
2. A Lane whose entire change is already on the batch head parks with its own reason, `batch_change_already_present`, instead of `batch_integration_conflict`. `drive-batch.md` states this. A Lane that repeats one sibling edit but carries other paths integrates as it does today. (#359)

## Sources

| ID | Source |
| --- | --- |
| I371 | Issue #371 and its correction comment: a clean merge can leave `dist/claude/mcp-server.mjs` stale, which parked S3 of batch `batch-layered-config-d295124a-dd3f-4beb-8705-c28db7188284` as `batch_integration_check_failed` (AC3) on candidate `235d2b5`. |
| I359 | Issue #359: a fully duplicated delivery is refused as `batch_integration_conflict`, which disagrees with "the merge queue refuses only a real conflict". |
| U1 | User decision, 2026-11-02, in this session: for #359, keep refusing a fully duplicated delivery with a distinct reason, state it in `drive-batch.md`, and test it (Issue option 2). Settling it as integrated (option 1) and closing #359 are rejected. |
| E1 | `batch_integration.ts:121-178`: `buildCandidate` regenerates derived outputs only when `merge-tree` exits 1 and every conflicted path is a declared output. |
| E2 | Batch state `.imm/state/batches/batch-layered-config-d295124a-dd3f-4beb-8705-c28db7188284.json`: S3 parked `batch_lane_redo_retained (batch_integration_check_failed: config-decision-model-consumer:AC3 failed on candidate 235d2b5…)`. In `235d2b5`, `runtime/config/layered_config.ts` contains `project_defaults`, but bundle blob `20f8286` does not. S3 Lane commit `91b8d5d` regenerated the bundle from its own tree. S5 `5829cff` changed `layered_config.ts` and left the bundle blob unchanged. |
| E3 | `batch_integration.ts:186-197`: `laneCandidateMatches` refuses when the rebuilt tree equals the batch head tree. `tests/unattended-batch-lanes.test.ts:677` pins that refusal as `batch_integration_conflict`. |
| E4 | `batch_lanes.ts:1254-1262`: `batch_integration_conflict` and `batch_integration_check_failed` on a Parent branch park as `batch_lane_redo_retained`; any other reason parks with the reason itself. |
| E5 | Batch commits carry per-run evidence at `.imm/audit/<task_id>/<run_id>/`. 45 of 46 commits with an `Immune-Brain-Batch` trailer touch that path; the exception is `c0954ab`. A Lane that shares one identical edit with a sibling therefore still carries other paths, and the rebuilt tree differs from the batch head. |
| E6 | `batch_git.ts:736,922`: completion and evidence retention rerun `laneCandidateMatches` against the recorded integrated commit. |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | user | a batch in which one Lane changes a declared runtime source without regenerating the bundle, and a later sibling regenerates the bundle from its own tree | the merge queue integrates both | both children integrate with no park, and the bundle on the Parent branch passes its declared `--check` | automated | S1 |
| SCN-2 | user | a batch child whose whole change is already on the batch head | the merge queue tries to integrate it | the child parks with `batch_change_already_present` and the batch head does not move | automated | S2 |

SCN-1 is sourced from I371. SCN-2 is sourced from U1.

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | **Regeneration trigger.** When building a candidate, select every declared entry, read from the declaration frozen at `declaration_head` (else the lane base) as today, whose `sources` or `outputs` match a path changed by the Lane (`lane_base..lane_commit`). Run each selected entry's `generate`, then its `check`, in the materialized delivery workspace of the merged tree. Do this on a clean merge (exit 0), on a declared-output conflict (exit 1), and when the batch head is still the lane base. Source globs match the way the declaration's `**` and `*` are already read. The matcher is a delegated technical choice. | I371, E1 |
| D2 | **Selection union.** On a conflict, the selected entries are the union of D1's entries and the entries whose outputs conflict. The existing rule stays: a conflict on an undeclared path is a conflict. | E1 |
| D3 | **Containment.** Regeneration may change only the selected entries' declared outputs, both in the working tree and in the written tree, which is the existing guard. A change to any other path refuses the candidate. | E1 |
| D4 | **No-op stays identical.** When regeneration changes nothing, the candidate is exactly what it is today: the lane commit itself when the batch head equals the lane base, otherwise the plain merge commit. A Lane that already delivered a current output keeps today's candidate. | E1 |
| D5 | **Failure reason.** A failed `generate` or `check`, or a containment breach, on a clean merge or a no-conflict fast path, refuses with `batch_integration_check_failed`, and the message names the derived entry `id` and the step that failed. It parks as `batch_lane_redo_retained` like every other check failure (E4). The conflict path keeps `batch_integration_conflict`. | I371, E4 |
| D6 | **Reproducible proof.** `laneCandidateMatches` accepts a regenerated candidate only when its tree equals the tree that `buildCandidate` rebuilds from the same inputs. Restart adoption (`findIntegratedCandidate`) and the `batch_git.ts` rechecks therefore keep refusing a regenerated output that was altered after integration. | E1, E6 |
| D7 | **Duplicate reason.** When the merge is clean and the rebuilt tree equals the batch head tree, `prepareLaneCandidate` refuses with a new `BatchIntegrationReason` `batch_change_already_present`, and the message names the lane commit. `laneCandidateMatches` keeps returning false for that case, so adoption still never accepts an empty change. | U1, E3 |
| D8 | **Duplicate park.** `batch_change_already_present` parks the child with that reason. It is not wrapped as `batch_lane_redo_retained`, because a redo would rebuild the same empty change. | U1, E4 |
| D9 | **Regeneration text.** `plugins/immune-brain/dist/drive-batch.md` states at its merge-queue paragraph (`:178-181`) that derived outputs are regenerated whenever a child changes a declared source or output, and that a failed regeneration parks that child. | I371 |
| D10 | **Duplicate text.** The same paragraph states that a child whose whole change is already on the batch head parks with `batch_change_already_present`, while a child sharing one identical edit with a sibling still integrates. | U1 |

## Technical Design

### Component interfaces

- `buildCandidate(input)` (`batch_integration.ts`): same signature. New behaviour per D1–D5. Errors: `BatchIntegrationError("batch_integration_conflict")` for a conflict on an undeclared path or a failed regeneration on the conflict path; `BatchIntegrationError("batch_integration_check_failed")` for a failed regeneration without a conflict.
- `laneCandidateMatches(input)`: same signature, boolean. It rebuilds through `buildCandidate`, so D6 follows. A thrown rebuild still returns false.
- `BatchIntegrationReason`: adds `batch_change_already_present` (D7). Its only runtime consumer is the park branch in `batch_lanes.ts:1254-1262` (D8). `batch_git.ts` imports only `laneCandidateMatches`.
- Callers that are unchanged: `prepareLaneCandidate`, `integrateGuardedLaneCommit`, `findIntegratedCandidate`, and `batch_git.ts:736,922`.

### Data flow

Lane commit → merge onto the batch head (`merge-tree`) → derived selection (D1, D2) → generate and check in the delivery workspace → containment (D3) → candidate commit → identity proof (D6, D7) → descriptor rerun (`verifyCandidateDescriptors`, unchanged) → fast-forward. A failure at any step leaves the batch ref, the user's working tree and the index unmoved, as today.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one commit. Reverting S1 restores conflict-only regeneration. Records integrated under S1 carry a regenerated output that the old `laneCandidateMatches` cannot rebuild, so completion verification of a batch still in flight across the revert fails closed with `batch_head_lineage_broken`. The recovery is `retire_stale_batch`. Reverting S2 restores the `batch_integration_conflict` reason, and no persisted shape changes.
- **Verification vanity**: every acceptance names its negative case.
  - S1: a failing `generate` on a clean merge; a `generate` that writes an undeclared path; a Lane that touches no declared path runs no `generate`; an already-current Lane keeps the lane commit as its candidate; a regenerated output altered after integration is refused at adoption.
  - S2: a full duplicate gets the new reason with the batch head unmoved; a partial duplicate carrying another path integrates; the extra-hunk and extra-path tamper refusals stay.
  - Why S1's seam catches the regression: the S1 scenario test reproduces E2. The second Lane regenerates its output from its own tree, the first left it stale, and the queue must produce a current output. Today that ends in a park, so the test fails before the fix.
- **Spec dilution**: I371 maps to S1 and I359 to S2. U1 is carried by D7, D8 and D10. Nothing is deferred. Lane-side enforcement (QA or Review requiring `--check` when a declared source changes) is out of scope, because it does not protect the queue; #371 records it as not verified.
- **Cost**: a Lane that touches `plugins/immune-brain/runtime/**/*.ts` now runs one bundle build at integration and one at each later identity rerun. This is accepted as the price of a current bundle.

## Slices and acceptance mapping

| Slice | Task | Result when landed alone | Acceptance seams | Risk | Blocked by |
| --- | --- | --- | --- | --- | --- |
| S1 | `derived-regenerate-on-change` | A Lane that leaves a declared output stale integrates with it regenerated, and later siblings stop parking on it | `tests/derived-files.test.ts`, `tests/batch-merge-queue.test.ts`, `tests/scope-revision-contract.test.ts` | material | — |
| S2 | `batch-change-already-present` | A fully duplicated delivery parks with its own reason, and a partial one integrates | `tests/unattended-batch-integration.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/batch-merge-queue.test.ts`, `tests/scope-revision-contract.test.ts` | material | S1 |

S2 follows S1 because both edit `buildCandidate` and `laneCandidateMatches` in `batch_integration.ts`, and both regenerate `dist/claude/mcp-server.mjs`. Each Slice regenerates that bundle and adds a changeset.

## Discovery evidence

- Candidate build, identity proof and adoption: `batch_integration.ts:121-197,206-260,470-517`.
- Derived declaration reader and runner: `runtime/derived_files.ts:51-71`; declaration `docs/agents/derived-files.json`.
- Park branch: `batch_lanes.ts:1233-1270`.
- Identity rechecks: `batch_git.ts:26,736,922`.
- Contract text: `plugins/immune-brain/dist/drive-batch.md:178-181`. The ADR is `docs/adr/0028-scope-as-estimate.md` item 2. Prior Spec: `docs/specs/branch-boundary-r2.spec.md` D17. `drive-batch.md` is an owned packaged file with no mirror (`scripts/dist-sync-manifest.ts:209-214`); `tests/scope-revision-contract.test.ts` pins its ADR 0028 text.
- Test prior art:
  - `tests/derived-files.test.ts:84-120`: regeneration, recovery and tamper on the conflict path.
  - `tests/batch-merge-queue.test.ts:117-143`: two children regenerating a fake bundle.
  - `tests/unattended-batch-integration.test.ts:320-331`: honest, extra-hunk and extra-path candidates.
  - `tests/unattended-batch-lanes.test.ts:677-702`: duplicate refusal.

## Out of scope

- Lane-side `--check` enforcement in QA or Review.
- Settling a fully duplicated child as integrated (#359 option 1, rejected by U1).
- #369 and #370.
- Push, PR and release.
