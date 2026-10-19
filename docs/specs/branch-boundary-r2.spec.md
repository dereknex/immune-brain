# Branch boundary Round 2

**Status**: candidate decomposition, confirmed by the user on 2026-10-19 (Initiative name, slug and decomposition in one review table). This document grants no execution authority.
**Initiative name**: Branch boundary round 2
**Immutable slug**: `branch-boundary-r2`
**Carrier**: GitHub, selected by root `CLAUDE.md` (`Initiative carrier default: github`).
**Planning baseline**: `712ad99`; recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — batch progress moves from a hidden ref to a runtime-owned Parent branch, the runtime starts creating and removing Git worktrees, integration gains automatic redo, the serial runner and delegated reseal are retired, and scope stops being a delivery boundary.
**Execution posture**: characterization-first for S1, S4 and S6: pin today's hidden-ref, serial and delegation behavior at the batch seams before replacing it, then delete the characterization that guarded retired behavior.
**Design views**: component interfaces, state transitions.
**Threat model and supported environment**: the adversary is the executing model, which may try to widen its delivery, edit authority state, credentials or CI, or weaken acceptance to pass QA. The user, the Host process, the repository's declarations under `docs/agents/` and `.imm/risk-floor.json` as committed at batch start, and the local filesystem owner are trusted. Supported: Git 2.38+ (`merge-tree --write-tree`), SHA-1 object format, UTF-8 paths, Claude Code with the plugin hooks installed, Pi with the bundled extension, macOS and Linux, Bun 1.4.

## Outcome

The user types one Parent `imm-run` and confirms one batch gate. Each child runs in its own runtime-created worktree and branch, cut from the Parent branch `imm/<slug>`. A child that settles enters a merge queue: its commit is rebuilt on the Parent tip, its acceptance reruns on the merged result, derived files are regenerated, and a conflict sends the child back to reimplement at most twice before only that child pauses. Scope is an estimate: delivery outside it is disclosed, not refused; risk follows the actual diff; hard no-touch paths are refused. The batch ends with a final report and returns to main by the Git integration preference. Serial is a Lane batch with `max_parallel` 1; delegated reseal and same-directory scope extension are gone.

This Initiative builds that mechanism on today's integration (ADR 0026 item 5). It cannot be its own acceptance run: a batch runs on the coordinator's loaded plugin build, and a Lane start refuses on plugin skew (Round 1 D4). The U2 acceptance run is a follow-up Initiative planned after this one lands and the plugin is reinstalled (see Follow-up acceptance run).

## Sources

No Brainstorm manifest exists. Round 1 sources U1–U9 are in `docs/specs/branch-boundary.spec.md`; the grill decisions of 2026-10-18 and the planning confirmation of 2026-10-19 are Spec-local sources here.

| Source | Evidence or decision |
| --- | --- |
| U2 | Q2: closure means one Parent entry and one batch gate; accepted by a real Initiative run with ≥3 children and ≥2 concurrent. |
| U7′ | Planning confirmation 2026-10-19: Round 2 splits into this mechanism Initiative and a follow-up acceptance-run Initiative built from the carried-over items, because a running batch cannot load the mechanism it is building. Supersedes U7's "one Initiative that is also the acceptance run". |
| U8 | Q19 B: `manual` stops with a final report (per-child approved acceptance vs QA results, files beyond the estimated scope, risk changes); `auto` fast-forwards main when possible, otherwise stops. |
| U10 | Q7 A, Q10 B: optimistic concurrency; only batch and Lane children get their own worktree and branch; single-task stays in the main workspace, requires a clean workspace at start and takes its diff from the HEAD at Enrollment. |
| U11 | Q9 B: scope is an estimate. Delivery outside it is disclosed in Review evidence; diff attribution and the batch commit boundary use `base..HEAD`; scheduling ignores scope overlap; risk is max(declared, actual-diff risk) and only strengthens Review; delegation rules, the stage-before-revise rule and dead `assertChangedFilesWithinScope` are deleted. |
| U12 | Q11 A+C: hard no-touch paths are `.imm/state/**`, credential-type files and CI and release config; critical prefixes escalate risk instead; the repository extends the list under `docs/agents/`. |
| U13 | Q12 A: a repository-declared derived-file list (sources, generate command, `--check` command); when every conflicted file is a declared output, merge the sources, regenerate, run `--check`, and do not count a conflict. Lanes still commit generated files. |
| U14 | Q13: no textual conflict → rerun the child's acceptance on the merged result, a failure counts as a conflict; conflict → reimplement from the new Parent tip with full QA and Review; at most 2 automatic redos, then pause only that child; others continue and the summary reports it. |
| U15 | Round 2 outline and ADR 0026 item 5: Parent branch with one worktree branch per child; serial runner removed (serial is Lane `max_parallel` 1); delegated revision, reseal and remaining scope extension removed, superseding ADR 0018 and ADR 0021; Q14 superseded by frozen acceptance. |
| E1 | Batch progress lives on hidden ref `refs/imm/batches/<batch_id>` (`runtime/unattended/batch_ref.ts:1-31`), created at preflight from `base_head` (`batch_git.ts:181-189`); Lane integration copies changed files into the coordinator working tree (`batch_integration.ts:203-239`). |
| E2 | ADR 0005 §6 and ADR 0013 §3 forbid the runtime from creating, switching or deleting a worktree; Lanes are offered paths admitted at `batch_lanes.ts:393-401,1265-1291`; ADR 0013 rejects merging lane branches. |
| E3 | Integration rebuilds one commit with `merge-tree --write-tree` and `commit-tree`, reruns QA and compare-and-swaps the ref (`batch_integration.ts:110-145,298-371`); a conflict parks the child as `batch_integration_conflict` with no retry (`batch_lanes.ts:1243-1255`). |
| E4 | Final verification runs in the coordinator working tree, not the batch tree (`batch_final_verification.ts:114-142`); nothing regenerates `dist/claude/mcp-server.mjs`, whose drift is caught only by `bun scripts/build-claude-plugin.ts --check` in CI. |
| E5 | `resolveLaneParallel` treats `max_parallel <= 1` as serial (`batch_lanes.ts:81-91`); the serial path in `batch_runner.ts:208-530,585-1289` and `batch_reconfirmation.ts` are serial-only; v1 records use `BatchRunStateRecord` (`batch_state.ts:59-92`). |
| E6 | Delegated revision lives in `batch_delegation.ts`, `batch_lanes.ts:518,573-584,999-1038,1242`, `batch_state.ts:198-204,696-716`, both Hosts' `lane_revision` and delegation checkbox; same-directory scope extension in `kernel/intent.ts:358-478`, `kernel/reducer.ts:531-553`, `prompts/executor.md:26-31`. |
| E7 | Risk already rises by changed paths (`kernel/intent.ts:326`, `kernel/completion.ts:49-63`) and Review is required from `material` up (`completion.ts:15-19`); no hard no-touch concept exists. |
| E8 | Single-task Enrollment neither requires a clean workspace nor records a base for its diff (`kernel/enrollment.ts:188-270,597`). |
| E9 | No batch path fast-forwards the user's branch; `auto` writes separate settle commits (`batch_integration.ts:396-410`); ADR 0024 §5 excludes batches. |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | user | a confirmed Lane batch | children run and settle | each runs in a runtime-created worktree, integrates as one commit on `imm/<slug>`, and the user's own checkout is untouched | automated | S1 |
| SCN-2 | user | two children whose changes conflict | the second reaches the merge queue | it reimplements from the new Parent tip; after two failed redos only it pauses and the rest finish | automated | S2 |
| SCN-3 | user | two children that both regenerated `dist/claude/mcp-server.mjs` | the second integrates | the bundle is regenerated from merged sources, `--check` passes, and no conflict is reported | automated | S3 |
| SCN-4 | user | a batch started without `max_parallel` | it runs | it runs as one Lane at a time, and an old serial record can still be inspected and retired | automated | S4 |
| SCN-5 | user | a batch child that edits a file outside its `scope_hint` | it settles | it integrates, and Review evidence lists the file as beyond the estimate | automated | S5 |
| SCN-6 | user | a Lane child that changes its acceptance | the coordinator ticks | the child pauses for the user; no delegated approval or reseal exists | automated | S6 |
| SCN-7 | user | a delivery that edits `.github/workflows/ci.yml` or `.imm/state/**` | it reaches settlement or integration | it is refused naming the path; a change under a critical prefix only raises risk and Review | automated | S7 |
| SCN-8 | user | uncommitted changes in the workspace | they start a single task | Enrollment refuses until the workspace is clean; the task's diff is taken from its Enrollment HEAD | automated | S8 |
| SCN-9 | user | a finished batch under `manual` | the last child integrates | the batch stops with a final report; under `auto` main fast-forwards to the Parent branch when possible | automated | S9 |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D11 | A new batch's progress ref is the Parent branch `refs/heads/imm/<slug>`, created at preflight at `base_head` with `update-ref` and never checked out by the runtime. A pre-existing `imm/<slug>` that does not point at `base_head` refuses with `batch_parent_branch_exists` before any side effect. Hidden-ref and legacy branch records keep their recorded mode. | U15, E1 |
| D12 | The runtime creates each Lane child's worktree on branch `imm-lane/<slug>/<task_id>` at the current Parent tip, under the Git common directory (`imm/worktrees/<slug>/<task_id>`), and returns its path in the Executor handoff. After integration it removes a clean worktree and its branch; a dirty one is kept and reported. `lane_offers` is refused with `lane_offers_retired` for new batches. This supersedes ADR 0005 §6 and ADR 0013 §3 for worktree management (ADR 0027). | U10, U15, E2 |
| D13 | Integration stays one rebuilt commit per child on the Parent branch (linear history, ADR 0013's rejection of merge commits stands). For new batches it no longer copies changed files into the coordinator working tree. | U15, E1, E3 |
| D14 | Final verification of a new batch runs in a runtime-created detached worktree at the Parent tip, removed afterwards; a failure is reported and nothing is rolled back. | U15, E4 |
| D15 | The merge queue integrates settled children one at a time in settle order. Before advancing the Parent branch it reruns the child's frozen acceptance descriptors on the rebuilt commit; a failing descriptor counts as a conflict. | U14, E3 |
| D16 | On a conflict the child's worktree is reset to the new Parent tip and the child runs implementation, QA and Review again under the same authorization. The third conflict parks only that child as `batch_integration_redo_exhausted`; its dependents become `skipped_blocked`; independent children continue; the batch summary lists each parked child with its redo count. | U14, E3 |
| D17 | The repository declares derived files in `docs/agents/derived-files.json` (`contract: immune_brain/derived_files/v1`; each entry has `id`, `sources`, `outputs`, `generate` and `check` commands as executable and argv). When every file conflicting in the queue is a declared output, the queue takes the merged sources, runs `generate`, then `check`, and integrates the result; a failing `check` or any conflicting file that is not a declared output is a conflict. Final verification runs every declared `check`. This repository declares `plugins/immune-brain/dist/claude/mcp-server.mjs`. | U13, E4 |
| D18 | A batch started without `max_parallel` runs as a Lane batch with `max_parallel` 1. The serial runner path and `batch_reconfirmation.ts` are deleted; the shared start entry, ports and report types move out of `batch_runner.ts`. A v1 serial record can still be read by `status` and retired by `retire_stale_batch`; resuming it refuses with `batch_record_shape_retired` and the retire action. Plan reconfirmation is not ported: a changed authority subject parks a child (ADR 0026 item 3) and any other plan change fails the batch. | U15, E5 |
| D19 | For batch and Lane children, the delivery boundary is the child branch: `assertNoEnvelopeEscape` no longer refuses a file outside `scope_hint`; the child's diff, `taskDiffHash`, QA tracked drift and the batch commit use `base..HEAD` of the child branch; files outside the estimate are listed in Review evidence as `beyond_estimate`. The scheduler starts children whose `scope_hint` overlaps concurrently and orders only by `blocked_by`. Dead `assertChangedFilesWithinScope` is deleted. | U10, U11 |
| D20 | Delegated in-Lane revision and reseal are deleted: `lane_revision`, the delegation checkbox, `revision_delegation`, `delegated_revisions` and `reseals` writers, `batch_delegation.ts`, and the delegation exception in `laneAuthorityChange`. Readers still accept those fields on existing v2 records. The same-directory scope rule is deleted: any `scope_hint` change that keeps the bound Spec path is a compatible revision with no `scope_added:` history; the Executor prompt tells the Executor to disclose files beyond the estimate instead of revising scope; the Enrollment stage-before-revise rule is deleted. ADR 0028 supersedes ADR 0018 and ADR 0021. | U11, U15, E6 |
| D21 | Projected risk is max(declared, scope floor, floor of the actual changed paths), where the changed paths are the child branch's `base..HEAD` diff or the single task's diff from its Enrollment HEAD; a raise strengthens Review and opens no gate. | U11, E7 |
| D22 | Hard no-touch paths are `.imm/state/**`, credential-type files (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.netrc`), `.github/workflows/**` and `.changeset/config.json`. The repository adds paths in `docs/agents/no-touch.json` (`contract: immune_brain/no_touch/v1`), never removes defaults; that declaration file is itself a critical risk-floor path, so changing it forces Review instead of being refused. A changed no-touch path refuses single-task settlement and batch integration with `no_touch_path_changed` naming the paths; a TaskIntent whose `scope_hint` names one fails validation. Critical prefixes stay in `.imm/risk-floor.json` and only raise risk. | U12, E7 |
| D23 | Single-task Enrollment refuses with `workspace_not_clean` when any tracked or untracked non-ignored path outside the Planner-produced intent and Spec is dirty, records `enrollment_head`, and takes the task's diff, attribution and changed paths from `enrollment_head..HEAD` plus the working tree. Out-of-estimate files are disclosed as in D19. | U10, U11, E8 |
| D24 | When the last child is integrated and final verification ran, a new batch writes a final report: per child the approved acceptance ids against QA results, files beyond the estimate, declared vs projected risk, redo count and parked reason. Under `manual` the batch stops with that report and the Parent branch left for the user. Under `auto` it fast-forwards the coordinator's branch to the Parent branch when HEAD is an ancestor and the working tree is clean, otherwise it stops with the report and the reason. ADR 0027 amends ADR 0024 §5 for batches. | U8, E9 |

Delegated technical choices:

| ID | Choice | Reason |
| --- | --- | --- |
| T5 | Worktrees live under the Git common directory. | Never tracked, never inside the user's tree, removed with the repository. |
| T6 | The Parent branch is a real branch the runtime writes with `update-ref` but never checks out. | Keeps ADR 0005's untouched HEAD while giving the user a reviewable branch. |
| T7 | Redo keeps the same authorization and TaskIntent; only the Lane's run restarts. | The authority subject did not change; a conflict is an integration fact. |
| T8 | v1 serial records become read-and-retire only, with no migration. | No serial batch is active at the planning baseline; a migration would carry retired semantics. |

## Technical Design

### Component interfaces

- `runtime/unattended/batch_ref.ts`, `batch_git.ts`, `batch_preflight.ts`: progress-ref mode `parent_branch` beside `hidden_ref` and `legacy_branch` (D11).
- New `runtime/unattended/batch_worktrees.ts`: create, reset, remove worktrees and lane branches (D12, D14, D16).
- `batch_integration.ts`, `batch_lanes.ts`: merge queue, acceptance rerun, redo counter, derived regeneration hook (D13, D15–D17).
- New `runtime/derived_files.ts` and `runtime/no_touch.ts`: strict declaration readers (D17, D22).
- `batch_runner.ts` reduced to the shared start entry, or replaced by `batch_start.ts`; `batch_reconfirmation.ts` deleted (D18).
- `workspace_scope.ts`, `assurance/review_evidence.ts`, `assurance/qa.ts`, `batch_schedule.ts` (D19); `kernel/risk_floor.ts`, `kernel/completion.ts` (D21); `kernel/enrollment.ts` (D23).
- `batch_delegation.ts` deleted; `kernel/intent.ts`, `kernel/reducer.ts`, both Hosts' batch tools, `prompts/executor.md` (D20).
- New final report writer beside `batch_final_verification.ts`; `git_integration_preference.ts` consulted for batches (D24).

### State transitions

A new-mode child: `pending → laning (worktree created) → enrolled → settled → queued → integrated`. From `queued`: conflict or failing acceptance → `redo` (worktree reset, run restarts) → `enrolled`; third conflict → `parked` (`batch_integration_redo_exhausted`), dependents → `skipped_blocked`. Batch: `running → verifying → reported`; under `auto` `reported → returned` when the fast-forward succeeds.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one bounded commit. New batch records carry `progress_mode: parent_branch`; reverting S1 leaves such a record unreadable by the old reader, which fails closed; the recovery is `retire_stale_batch`, and the Parent branch and worktrees stay for the user to inspect. S4 and S6 delete writers but keep readers, so records written before them stay retireable. A failed `auto` return leaves the Parent branch intact.
- **Verification vanity**: each acceptance names its negative case: a pre-existing Parent branch, a dirty Lane worktree at removal, a coordinator-local edit during final verification (S1); a clean textual merge whose acceptance fails (S2); a non-derived file in the conflict set and a failing `check` (S3); resuming a v1 record (S4); a no-touch path inside a batch child (S7); a dirty untracked file at single-task start (S8); a diverged HEAD under `auto` (S9).
- **Spec dilution**: this Initiative does not run its own acceptance (U7′); the follow-up acceptance run below is planned, not optional. Acceptance stays frozen; nothing here relaxes ADR 0026.

## Slices and acceptance mapping

| Slice | Task | Result when landed alone | Acceptance seams | Risk | Blocked by |
| --- | --- | --- | --- | --- | --- |
| S1 | `batch-parent-branch` | New Lane batches run on runtime-created worktrees and integrate onto `imm/<slug>`; final verification runs on the Parent tip | `tests/batch-parent-branch.test.ts` (new), `tests/unattended-batch-lanes.test.ts`, `tests/unattended-batch-integration.test.ts` | critical | — |
| S2 | `merge-queue-redo` | Conflicts and failing merged acceptance trigger up to two redos before one child pauses | `tests/batch-merge-queue.test.ts` (new) | critical | S1 |
| S3 | `derived-file-regeneration` | Derived-file conflicts regenerate and pass `--check` instead of pausing | `tests/derived-files.test.ts` (new), `tests/batch-merge-queue.test.ts` | material | S2 |
| S4 | `serial-runner-retirement` | Serial is a one-Lane batch; v1 records are read-and-retire only | `tests/batch-serial-retirement.test.ts` (new), `tests/batch-stale-disposition.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts` | material | S1 |
| S5 | `scope-as-estimate` | Batch children deliver beyond their estimate with disclosure; overlap no longer serializes | `tests/batch-scope-estimate.test.ts` (new), `tests/unattended-batch-schedule.test.ts` | critical | S2 |
| S6 | `delegated-reseal-removal` | Delegated reseal and same-directory scope extension are gone; ADR 0028 accepted | `tests/kernel-intent-v2.test.ts`, `tests/scope-revision-contract.test.ts`, `tests/unattended-batch-lanes.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/pi-batch-authority.test.ts` | critical | S4, S5 |
| S7 | `diff-risk-no-touch` | Risk follows the actual diff; no-touch paths are refused | `tests/no-touch-paths.test.ts` (new), `tests/risk-tier-floor.test.ts` | critical | S5 |
| S8 | `single-task-clean-workspace` | Single tasks start from a clean workspace and diff from their Enrollment HEAD | `tests/single-task-clean-workspace.test.ts` (new), `tests/enrollment-dirty-scope.test.ts` | material | S5 |
| S9 | `final-report-return` | A finished batch reports and returns to main by preference | `tests/batch-final-report.test.ts` (new), `tests/git-integration-preference.test.ts` | material | S1, S5, S7 |

Every runtime Slice also regenerates `plugins/immune-brain/dist/claude/mcp-server.mjs` and adds a changeset. Because every Slice touches the bundle, today's scheduler serializes them; that is the problem this Initiative removes.

## Follow-up acceptance run (separate Initiative, planned after this one lands)

After S1–S9 land and the plugin is reinstalled, the Planner publishes the U2 acceptance-run Initiative from the carried-over items, run as one Parent entry with ≥3 children and ≥2 concurrent, with real overlap on the regenerated bundle:

1. Pi stall yield: Pi yields on an assurance stall as Claude does (`runtime/claude/run_continuation.ts:282-284`; `.pi-extension/pi-canary-assurance-progression.ts:26`).
2. Final-verification confirmation reference: the Parent final report records which confirmation authorized the replayed commands (`batch_git.ts:986-996`).
3. Tighter third-failure assertion in `tests/claude-run-continuation.test.ts:125`, which also passes on `null`.
4. `start_unattended_batch` handler end-to-end test through `runtime/claude/mcp_server.ts:225-258` with real arguments.

## Discovery evidence

- Lane integration and progress ref: `batch_ref.ts:1-31,137`; `batch_git.ts:181-189,507-630`; `batch_integration.ts:4-5,110-239,298-410`; `batch_lanes.ts:257-259,393-437,1183-1318`; `batch_preflight.ts:221-272`; `batch_reconfirmation.ts:60,181`.
- Serial vs Lane: `batch_runner.ts:305-327,462-475,511,580-584,615-640,959-1289`; `batch_lanes.ts:81-91,413,710-721,807-811,1388-1399`; `batch_state.ts:59-92,158-213,867,892,932`; `claude/mcp_server.ts:42,61,225-256,566`; `.pi-extension/imm-unattended-batch.ts:214,271-275,358,549`.
- Delegation and scope extension: see E6; tests `tests/batch-delegation-gate.test.ts`, `tests/unattended-batch-lanes.test.ts:1957-2300`, `tests/claude-batch-authority.test.ts:994`, `tests/pi-batch-authority.test.ts:1664`.
- Risk: `kernel/risk_floor.ts:236-276`; `kernel/completion.ts:15-19,49-63`; `assurance/coordinator.ts:597-600,1225`.
- Workspace and Enrollment: `workspace_scope.ts:90-100,474,618,1043`; `kernel/enrollment.ts:188-270,597`; planning paths treated as non-task work at `batch_git.ts:192`, `batch_preflight.ts:702`.
- Related Issues: #220 (fixed lane branch names, one commit per child, fast-forward only, cleanup left to the user) is answered by S1, S2 and S9; #251 (adopting a critical child finished outside a batch) stays open.

## Out of scope

The follow-up acceptance run (planned separately); #251; Planner changes; push, PR and release; remote merge queues.
