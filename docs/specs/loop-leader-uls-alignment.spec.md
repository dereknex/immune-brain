# Loop Leader on Unified Lane Sessions: Initiative Entry, Discard, and Resolve Alignment

- **Initiative**: `loop-leader-uls` (short name `leader-uls`), follow-up to `loop-leader` (`docs/specs/loop-leader.spec.md`) after `unified-lane-sessions` (`docs/specs/unified-lane-sessions.spec.md`, #570, merged in #581) landed under it.
- **Output language**: English (repository default; clarification ran in Chinese).
- **Design risk**: High — extends the `runtime/lane_sessions/` composition root with an Initiative entry for the daemon, changes the audit-backed daemon PR gate (ULS D13), adds a daemon-side terminal batch disposition that closes sessions and deletes branches, and narrows a confirmed loop-leader acceptance (S4-AC1) to the ULS authority rule.
- **Design views**: architecture layers, service/component interfaces, state transitions, temporal sequence.
- **Diagram decision**: not required
- **Diagram reason**: every change reuses the ULS layer diagram (`docs/proposals/unified-lane-sessions.md` §4.1) unchanged; no new layer, port or cross-layer edge is added.
- **Execution posture**: Standard

## Outcome

The loop leader built in `loop-leader` S1–S5 runs on the ULS v4.1 architecture: the branch compiles and passes its boundary tests, an Initiative-shaped work item runs as one `v3` batch through `startLanes` / `advanceLanes` with batch final verification and opens exactly one PR from `imm/<slug>`, `abandon` ends a batch with proof-based cleanup and `pause` freezes daemon reconciliation, and the leader's resolve logic follows the ULS recovery rules without duplicate questions or budget burn from environmental refusals.

| Slice | Task ID | Result when landed alone | Remaining gap | Risk | Blocked by | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| `S1` | `loop-leader-uls-s1-compile-contract` | `bun run typecheck` and every loop-daemon boundary test pass on the rebased branch; Initiative-shaped dispatch refuses `lane_initiative_entry_pending` instead of calling the retired drive shape; ADR numbering, judging references and the ULS D15 role coverage are corrected | Initiative execution (`S2`), Initiative PR (`S3`), discard and pause (`S4`), resolve alignment (`S5`) | `material` | — | exempt: restores compilation and documentation only |
| `S2` | `loop-leader-uls-s2-initiative-entry` | An Initiative-shaped work item starts one `v3` batch through `startLanes` with `final_verification.required: true`, records its `batch_id` on the WorkItem, and every later tick re-enters `advanceLanes` for that batch until it settles | PR from `imm/<slug>` (`S3`) | `material` | `S1` | exempt: the owner-visible result is the PR, observed through `BR-SCN-A1` in `S3` |
| `S3` | `loop-leader-uls-s3-initiative-pr-gate` | A completed Initiative batch whose final verification passed opens exactly one PR from `imm/<slug>`, gated on the batch commit and every child's `.imm/audit/` digest | none for Initiative delivery | `material` | `S2` | `BR-SCN-A1` |
| `S4` | `loop-leader-uls-s4-discard-pause` | `abandon` discards the item's active batch (gated stop, `closeWithProof`, Lane and `imm/<slug>` removal, terminal record); `pause` stops `advanceLanes` for the item and `resume` observes before any stall judgment | none for steering | `material` | `S2` | `BR-SCN-A3` |
| `S5` | `loop-leader-uls-s5-resolve-alignment` | Leader `resume` applies only to WorkItem `escalated`; parked and no-progress batches only reach `ask_owner`; Lane dialogs are asked once by `planEscalation`; `lane_session_unavailable` neither counts as a refusal nor changes the briefing fingerprint; briefing batch summaries read `v3` session facts through `findActiveLaneBatchForTask` | none — complete confirmed outcome | `material` | `S1` | `BR-SCN-A2`, `BR-SCN-A4` |

## Sources and Discovery Evidence

- **Clarify manifest** (this session, 2026-11-20): `BR-DEC-A1`–`BR-DEC-A7`, `BR-REQ-A1` (the framing's incidental fixes: `batchStateForTarget` lookup, `v3` briefing fields, dead `exit_recorder` import, `executor_model` rename), `BR-SCN-A1`–`BR-SCN-A4`. Earlier answers in the same session: Initiative delivery opens a PR from `imm/<slug>` under `retain_branch`; fixes land forward on `agent-loop` without rewriting history.
- **Verification baseline** (rebased HEAD `2eccf01c1d`): `bun run typecheck` reports 7 errors, all in `driveInitiativeLane` (`plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts:2036-2150`); `tests/loop-daemon-boundary.test.ts` LDP-A4 fails on `executor_model` at `agent_handlers.ts:2113`; `tests/loop-daemon-drive-pr.test.ts` LDP-A2 fails only when `HERDR_*` is inherited from the running pane and passes 9/9 with it scrubbed.
- **Repository paths inspected**:
  - `plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts:1238-1330` `driveInitiativeJob` records one settled lane per slice so the reconciler emits one E13 per slice; `:1870` wires `driveInitiative`; `:1938` `driveSingleTaskLane` already uses the ULS `dispatchLoopDrive`; `:2036-2150` `driveInitiativeLane` uses the retired shape (`initiative_slug`, `plugin_dir`, `wait_ms`, `executor_model`, `exit_record`, fresh `batch-<slug>-<uuid>` per call) and an unimported `projectAssurance`.
  - `plugins/immune-brain/runtime/loop_daemon/drive_dispatcher.ts:119-149` `dispatchLoopDrive` hardcodes `max_parallel: 1`, `entry_kind: "single_task"`, `final_verification: { required: false }`, `retain_branch`, `parent_relayed`; `:190` `daemonAdvanceTask`; `:209-261` `advanceDaemonLanes` (again `entry_kind: "single_task"`).
  - `plugins/immune-brain/runtime/lane_sessions/index.ts:70` `entry_kind?: "single_task"`; `:244` `startLanes`; `:263` `advanceLanes`; `:453` `observeLanes`.
  - `plugins/immune-brain/runtime/unattended/batch_preflight.ts:197` `findActiveLaneBatchForTask`; `:1220-1237` `laneDeliveryEvidence` resolves one child commit and `auditEvidenceDigest(root, commit, taskId)`.
  - `plugins/immune-brain/runtime/loop_daemon/dispatch.ts:1109-1157` D13 `open_pr`: one PR per task from `laneDeliveryEvidence`.
  - `plugins/immune-brain/runtime/unattended/lane_decision.ts:136-152` per-child `stop` parks `lane_executor_stopped`; `batch_disposition.ts:208-299` `retireStaleBatch` (Host only, by Initiative slug, literal-user gate, marks `superseded`, no session or branch cleanup).
  - `plugins/immune-brain/runtime/host-core/runtime.ts:1350-1352` a Host Initiative without final verification commands refuses `final_verification_required`.
  - `plugins/immune-brain/runtime/loop_daemon/steering.ts:88-121` `abandon` moves the WorkItem to `abandoned` and never touches a running batch; `pause` sets `paused` only.
  - `plugins/immune-brain/runtime/loop_daemon/replan.ts:75-76` batch `needs_human` is `batch_parked`; `:146-164` `batchStateForTarget` scans `.imm/state/batches/*.json` directly.
  - `plugins/immune-brain/runtime/loop_daemon/leader_agent.ts:168` refusals enter the briefing; `:217-245` `readBatchSummaries` copies only `batch_state` and child `state`.
  - `plugins/immune-brain/runtime/loop_daemon/work_items.ts:104-111` `WorkItem.binding` (`initiative_slug`, no `batch_id`); `:412-422` plan source chosen by `binding.initiative_slug`.
  - `docs/adr/0041-loop-leader-role-catalog.md` and `docs/adr/0041-simplified-configuration.md` share number 0041 (other duplicates such as 0038 and 0039 predate this work and are out of scope); `0041-simplified-configuration.md:29` still names `triage (judging)`; ULS Spec D15 (`docs/specs/unified-lane-sessions.spec.md:59`) still names `judging` and omits leader and catalog sessions; D19 (`:63`) cites "ADR 0041 Decision 4".
  - `tests/loop-daemon-dispatch.test.ts:141` imports the deleted `loop_daemon/exit_recorder.ts`.
- **Focused test prior art**: `tests/lane-sessions.test.ts`, `tests/loop-daemon-drive-pr.test.ts`, `tests/loop-daemon-boundary.test.ts`, `tests/loop-daemon-agent-handlers.test.ts`, `tests/loop-leader-dispatch.test.ts`, `tests/loop-leader-steering.test.ts`, `tests/loop-leader-replan.test.ts`, `tests/loop-leader-briefing.test.ts`, `tests/session-lane-cleanup.test.ts`, `tests/runtime-layering-boundary.test.ts`.

## Threat model and supported environment

- **Untrusted inputs**: unchanged from `loop-leader` — Issue and PR text, comments and leader output reach code only as typed, validated data. No slice adds a new external input.
- **Destructive operations**: `discard` closes Executor sessions and deletes `imm-lane/` and `imm/<slug>` branches. It runs only for a WorkItem whose `abandon` request was written by the privileged `steer_loop_work_item` tool under native confirmation, only for the batch recorded on that WorkItem, closes only sessions whose `[imm:<session_key>]` ownership `closeWithProof` verifies, and deletes a branch only when that branch's worktree is clean; any unproven condition retains the named resource and reports `batch_lane_retained`.
- **Authority**: daemon batches keep `confirmation.source` `tracker_approval` or `policy_auto`; no slice adds a confirmation source, and the leader never clears `needs_human` (ULS D10).
- **Supported environment**: macOS and Linux; the daemon executes Lanes only inside Herdr until #495 (ULS D18). Tests scrub every `HERDR_*` variable.

## User scenarios

| ID | Slice | Mode | Actor / Given / When / Then | Acceptance |
| --- | --- | --- | --- | --- |
| `BR-SCN-A1` | `S3` | `automated` | **Actor**: Repository owner. **Given**: the leader shaped a work item as an Initiative and the daemon runs inside Herdr. **When**: every slice integrates and batch final verification passes. **Then**: exactly one PR from `imm/<slug>` appears for the work item and `imm-loop status` shows the item in review. | `S3-AC1` |
| `BR-SCN-A2` | `S5` | `automated` | **Actor**: Repository owner. **Given**: a Lane Executor of a daemon batch waits on a startup dialog. **When**: the daemon ticks and the leader wakes. **Then**: exactly one escalation question about that dialog appears on the Issue. | `S5-AC2` |
| `BR-SCN-A3` | `S4` | `automated` | **Actor**: Repository owner. **Given**: an Initiative work item is in progress. **When**: they abandon it with `steer_loop_work_item` and confirm natively. **Then**: its Executor sessions are closed, no `imm-lane/` or `imm/<slug>` branch of that batch remains, and `imm-loop status` shows the item `abandoned`. | `S4-AC1` |
| `BR-SCN-A4` | `S5` | `automated` | **Actor**: Repository owner. **Given**: the daemon runs outside Herdr. **When**: ticks repeat over a work item ready to drive. **Then**: `imm-loop status` shows `lane_session_unavailable` for it and the leader wake count does not grow. | `S5-AC3` |

### Scenario Exemptions

- `S1`: restores compilation, boundary tests and documentation; the only behavior change is a temporary refusal that `S2` removes.
- `S2`: the batch runs but its owner-visible result is the PR, covered by `BR-SCN-A1` in `S3`.

## Brainstorm Trace

| Item | Decision | Mapped to |
| --- | --- | --- |
| `BR-DEC-A1` | Daemon Initiative entry through `lane_sessions`, `batch_id` on the WorkItem, `advanceLanes` every tick; D13 gate aggregates audit under `imm/<slug>` and opens one PR | `D2`, `D3`; `S2-AC1`, `S2-AC2`, `S3-AC1` |
| `BR-DEC-A2` | Follow ULS recovery: parked or `lane_executor_no_progress` only reach `ask_owner`; leader `resume` only for WorkItem `escalated`; amend loop-leader S4-AC1 | `D5.1`; `S5-AC1` |
| `BR-DEC-A3` | Lane dialogs are asked only by `planEscalation`; the briefing treats them as pending interactions | `D5.2`; `S5-AC2` |
| `BR-DEC-A4` | Daemon `discard` (gated stop, `closeWithProof`, delete `imm-lane/` and `imm/<slug>`, terminal batch) as the landing of abandon; pause stops `advanceLanes`; resume observes first and skips one stall judgment | `D4`; `S4-AC1`, `S4-AC2` |
| `BR-DEC-A5` | Daemon Initiative batches use `final_verification.required: true`; single task keeps `false` | `D2.3`; `S2-AC1` |
| `BR-DEC-A6` | `lane_session_unavailable` never counts as a refusal or replan round and never changes the briefing fingerprint; shown in status | `D5.3`; `S5-AC3` |
| `BR-DEC-A7` | Renumber the loop-leader ADR to 0042; fix judging references in ADR 0041 (simplified configuration) and ULS D15; D15 states leader and catalog sessions keep `agent_runner` | `D1.3`; `S1-AC2` |
| `BR-REQ-A1` | Incidental fixes: `batchStateForTarget` via `findActiveLaneBatchForTask`; `v3` session facts in the briefing; drop the dead `exit_recorder` import; `executor_model`/`executor_effort` become `model`/`effort` | `D1.1`, `D1.2`, `D5.4`; `S1-AC1`, `S5-AC1` |
| `BR-SCN-A1` | Initiative PR | `S3-AC1` |
| `BR-SCN-A2` | One dialog question | `S5-AC2` |
| `BR-SCN-A3` | Abandon cleans up | `S4-AC1` |
| `BR-SCN-A4` | Outside Herdr does not burn wakes | `S5-AC3` |

No `BR-Q-*` item remains open.

## Amendments to Settled Specs

`docs/specs/loop-leader.spec.md` and `docs/specs/unified-lane-sessions.spec.md` belong to settled Initiatives and stay unedited (`kernel/spec_binding.ts:83-96` binds at most one active Spec per TaskIntent). Where they disagree with the rows below, this Spec wins from the Slice named.

| Settled clause | Amendment | From |
| --- | --- | --- |
| loop-leader S3 row, `BR-DEC-4`, D3.6: "ADR 0041" | Read as ADR 0042 (`docs/adr/0042-loop-leader-role-catalog.md`) | `S1` |
| loop-leader D3.3, S3-AC1: Initiative-shaped work runs through `observeInitiative` | Runs through `startLanes` / `advanceLanes` per D2 of this Spec; between `S1` and `S2` it refuses `lane_initiative_entry_pending` | `S1`, `S2` |
| ULS D13: daemon PR gate reads `refs/heads/imm/<task_id>` | Also the Initiative gate of D3: `imm/<slug>` with every child's audit digest | `S3` |
| ULS D15: non-`drive` daemon agents are `judging`, clarify, plan, repair | `judging` is retired (loop-leader S3); the leader and catalog `dispatch{role}` sessions with clarify, plan and repair keep `agent_runner` as processes | `S1` |
| ULS D15: daemon `final_verification.required: false` | Initiative batches use `required: true` (D2.3) | `S2` |
| ULS D19: "ADR 0041 Decision 4" | Means `0041-simplified-configuration.md` | `S1` |
| loop-leader D5 `abandon` / `pause` | `abandon` discards the item's batch; `pause` stops `advanceLanes` (D4) | `S4` |
| loop-leader D4.1, S4-AC1: `resume` resumes a batch on a transient Lane escalation | `resume` applies only to WorkItem `escalated` without a batch blocker; `needs_human` and `lane_executor_no_progress` admit only `ask_owner` (D5.1) | `S5` |

## Technical Design

### Architecture Layers and Dependency Direction

Unchanged from ULS §6 (`docs/proposals/unified-lane-sessions.md:152-160`): `loop_daemon/` reaches execution only through `lane_sessions/`, `batch_agreement.ts`, `lane_decision.ts` and the read-only `batch_preflight.ts` lookups it already imports; it never imports `runtime/session/` or `batch_lanes.ts`. The new `discardLanes` lives in `lane_sessions/` because it needs the session port; its record and Git cleanup lives in `unattended/`. `plan_source` stays in entry selection (`drive_dispatcher.ts`, `work_items.ts:412-422`), never in execution modules. `tests/loop-daemon-boundary.test.ts` and `tests/runtime-layering-boundary.test.ts` enforce both rules (Source: repository evidence, ULS Spec D1, D4).

### D1: Compile and Contract Restoration (`S1`)

1. `driveInitiativeLane` (`agent_handlers.ts:2036-2150`) and its `driveInitiative` wiring are replaced by a stub that refuses `lane_initiative_entry_pending` with recovery text naming `S2`; `driveInitiativeJob` fails the job with that reason and leaves the WorkItem retryable. Exit condition: `S2` deletes the refusal (Source: delegated technical choice — the smallest change that compiles without inventing an Initiative entry `S2` owns).
2. Retired identifiers leave `loop_daemon/`: no `executor_model` or `executor_effort` (the ULS `ExecutorPreferences` fields are `model`/`effort`); `tests/loop-daemon-dispatch.test.ts` drops the `exit_recorder.ts` import; `tests/loop-daemon-drive-pr.test.ts` scrubs every `HERDR_*` variable so LDP-A2 holds inside a Herdr pane (Source: `BR-REQ-A1`).
3. `docs/adr/0041-loop-leader-role-catalog.md` becomes `docs/adr/0042-loop-leader-role-catalog.md`, whose header states it was numbered 0041 until this Slice; `.changeset/loop-leader-s3-guarded-dispatch.md` cites ADR 0042; every other "ADR 0041" citation in code and docs means the simplified-configuration ADR and stays; `0041-simplified-configuration.md` stops naming the retired `judging` role. The settled Specs `loop-leader.spec.md` and `unified-lane-sessions.spec.md`, settled TaskIntents and `.imm/audit/` records are historical and are not edited; their corrections are recorded in [Amendments to Settled Specs](#amendments-to-settled-specs) (Source: `BR-DEC-A7`; keeping the settled Specs unedited is repository evidence — `kernel/spec_binding.ts:83-96` binds at most one active Spec per TaskIntent).

### D2: Daemon Initiative Entry (`S2`)

1. `lane_sessions` `entry_kind` widens to `"single_task" | "initiative"`; `entry_kind` remains an entry-layer label passed through to `advanceBatch` and never read by `child_session_reconciler.ts` (Source: `BR-DEC-A1`).
2. `dispatchLoopDrive` takes a discriminated input: `{ kind: "single_task", task_id }` as today, or `{ kind: "initiative", slug }`, whose children come from `prepareBatchPreflight` with `observeInitiative` over the Local carrier. Initiative batches keep `retain_branch` and `parent_relayed`, use `max_parallel` from `.imm/config.json` Lane preferences (default 1), and reuse the same confirmation the single-task path resolves (Source: `BR-DEC-A1`, `drive_dispatcher.ts:119-149`).
3. An Initiative batch is authorized with `final_verification.required: true`; its commands are the project's configured batch final verification commands, and when none are configured the drive refuses `final_verification_required` before writing anything, as the Host Initiative entry does (`host-core/runtime.ts:1350-1352`). Single-task batches keep `required: false` (Source: `BR-DEC-A5`; command source is a delegated technical choice).
4. `WorkItem.binding` gains `batch_id: string | null`. The first drive writes it right after `startLanes` succeeds; every later tick calls `advanceDaemonLanes(root, binding.batch_id)` and never mints a new batch while that record is active. A missing or terminal recorded batch clears `batch_id` before a new `startLanes` (Source: `BR-DEC-A1`, ULS §4.2 "every tick calls `advanceLanes`").
5. The job no longer records one settled lane per slice; it records batch completion once, so the reconciler emits one E13 for the batch (`agent_handlers.ts:1238-1330`, `jobs.ts:355-363`) (Source: `BR-DEC-A1`).

### D3: Initiative PR Gate (`S3`)

1. `batch_preflight.ts` gains `batchDeliveryEvidence(root, batch_id)`: the record must be `completed` with `final_verification_result.passed === true`; the commit is the retained `refs/heads/imm/<slug>` tip recorded on the batch; every child must be `integrated` with a non-null `auditEvidenceDigest(root, commit, child.task_id)`. The aggregate digest is SHA-256 over the sorted `task_id:digest` lines (Source: `BR-DEC-A1`; aggregation format is a delegated technical choice).
2. `open_pr` (`dispatch.ts:1109-1157`) uses `batchDeliveryEvidence` when the E13 carries an Initiative batch and opens one PR whose head is `imm/<slug>`, listing every child's acceptance IDs and digests; single-task delivery is unchanged. A second E13 for the same batch is idempotent (existing PR found by head branch) (Source: `BR-DEC-A1`).
3. This gate amends ULS Spec D13 as recorded in [Amendments to Settled Specs](#amendments-to-settled-specs) (Source: `BR-DEC-A1`).

### D4: Discard, Pause and Resume (`S4`)

1. `lane_sessions/` gains `discardLanes(root, batch_id, deps)`: for each non-terminal child with a session handle, `stop` then `closeWithProof`; children whose exit is proven have their worktree and `imm-lane/<slug>/<task_id>` removed by the existing per-child cleanup; `refs/heads/imm/<slug>` is deleted only when every child Lane is removed; the record becomes terminal `discarded` with a report. Any unproven close or unclean worktree retains that resource, records `batch_lane_retained` with the named condition, and leaves the record `discarding` so the next tick retries (Source: `BR-DEC-A4`).
2. `applySteeringRequests` (`steering.ts:88-121`) on `abandon` of a WorkItem with `binding.batch_id` moves the item to `abandoned` and the tick runs `discardLanes` for that batch until it is terminal. Host `retire_stale_batch` is unchanged (Source: `BR-DEC-A4`).
3. A `paused` WorkItem's batch is skipped by the tick's `advanceDaemonLanes`; sessions are left as they are. On `resume`, the first tick runs `observeLanes` and then one `advanceLanes` with a one-shot stall exemption so a session that went idle while paused is not counted toward `no_progress` (Source: `BR-DEC-A4`).

### D5: Leader Resolve Alignment (`S5`)

1. `replan.ts` accepts `resolve{kind:"resume"}` only for a WorkItem in `escalated` whose blocker is not a batch fact; a batch in `needs_human` or a child parked `lane_executor_no_progress` admits only `ask_owner`. This rule amends `loop-leader.spec.md` D4 and S4-AC1 as recorded in [Amendments to Settled Specs](#amendments-to-settled-specs) (Source: `BR-DEC-A2`, ULS Spec D10).
2. A child in `entry_submitted: false` or `blocked`, or a pending `lane_entry_blocked` escalation, appears in the briefing as a pending interaction; the leader's `ask_owner` for the same subject is folded into it (annotation in place, per loop-leader D4.6) and never posts a second question (Source: `BR-DEC-A3`).
3. A refusal whose reason is `lane_session_unavailable` is excluded from `refused_transitions` counting, from `replan_rounds`, and from the briefing fingerprint; `imm-loop status --json` reports it on the item as `environment_blocked: "lane_session_unavailable"` (Source: `BR-DEC-A6`).
4. `batchStateForTarget` resolves through `findActiveLaneBatchForTask` (refusing ambiguous or corrupt matches instead of taking the first file) and `readBatchSummaries` adds each child's `session.generation`, `session.no_progress` and `session.attention` from the `v3` record (Source: `BR-REQ-A1`, ULS Spec D12).

### Compatibility, Interruption Recovery, and Rollback

- WorkItems written before `S2` have no `binding.batch_id`; it reads as `null`. No migration is needed; `v2` batch records stay read-and-retire only (ULS D17).
- Crash between `startLanes` and writing `binding.batch_id`: the next tick finds the active batch by `findActiveLaneBatchForTask` on any child task and adopts its id instead of starting a second batch.
- Crash during `discardLanes`: the record stays `discarding`; re-entry repeats `find`/`closeWithProof` per child, which is idempotent under ULS D8.
- Rollback: each slice reverts independently; reverting `S2` restores the `S1` refusal.

## Verification and Acceptance Mapping

Every acceptance also runs `bun scripts/sync-dist-docs.ts --check`, `bun scripts/build-claude-plugin.ts --check`, `bun scripts/build-antigravity-plugin.ts --check` and `bun run typecheck`.

- `S1-AC1` *(Source: `BR-REQ-A1`; D1.1, D1.2)*. Agreed seam: `tests/loop-daemon-boundary.test.ts`, `tests/loop-daemon-drive-pr.test.ts`, `tests/loop-daemon-dispatch.test.ts`, `tests/loop-leader-dispatch.test.ts`. Done looks like: typecheck passes; LDP-A4 finds no retired identifier; LDP-A2 refuses `lane_session_unavailable` even when the test process inherits `HERDR_*`; an Initiative-shaped dispatch fails its job with `lane_initiative_entry_pending` and leaves the WorkItem retryable.
- `S1-AC2` *(Source: `BR-DEC-A7`; D1.3)*. Agreed seam: `tests/loop-daemon-contracts.test.ts` (extended; it already reads loop ADRs). Done looks like: `docs/adr/0042-loop-leader-role-catalog.md` exists and is the only ADR numbered 0042; outside historical records (`docs/plans/*.intent.json` of settled tasks and `.imm/audit/`, which stay immutable) no tracked file names `0041-loop-leader-role-catalog`; `.changeset/loop-leader-s3-guarded-dispatch.md` cites ADR 0042; `0041-simplified-configuration.md` does not name `judging` as a live role; this Spec's Amendments section carries the ULS D15/D19 and loop-leader ADR-citation corrections.
- `S2-AC1` *(Source: `BR-DEC-A1`, `BR-DEC-A5`; D2.1–D2.3)*. Agreed seam: `tests/loop-daemon-drive-pr.test.ts`, `tests/lane-sessions.test.ts`. Done looks like: an Initiative drive with a fake provider writes one `v3` record with `entry_kind: "initiative"`, `retain_branch`, `parent_relayed` and `final_verification.required: true`. Negative: without configured final verification commands it refuses `final_verification_required` and writes no record; outside Herdr it refuses `lane_session_unavailable`.
- `S2-AC2` *(Source: `BR-DEC-A1`; D2.4, D2.5)*. Agreed seam: `tests/loop-leader-dispatch.test.ts`. Done looks like: `binding.batch_id` is written after the first drive; three later ticks call `advanceLanes` with that id and create no second record; a crash before the binding write is adopted by task lookup; batch completion yields exactly one E13.
- `S3-AC1` *(Source: `BR-DEC-A1`, `BR-SCN-A1`; D3)*. Agreed seam: `tests/loop-daemon-drive-pr.test.ts`. Done looks like: a completed Initiative batch with passing final verification opens one PR with head `imm/<slug>` listing every child's digest; status shows the item in review. Negative: a child without audit evidence, a failed or missing final verification, or a non-`completed` batch opens no PR and records the named reason; a repeated E13 opens no second PR; single-task PRs are unchanged.
- `S4-AC1` *(Source: `BR-DEC-A4`, `BR-SCN-A3`; D4.1, D4.2)*. Agreed seam: `tests/loop-leader-steering.test.ts`, `tests/session-lane-cleanup.test.ts`. Done looks like: abandoning an item with an active two-child batch stops and proof-closes both fake sessions, removes both `imm-lane/` branches and `imm/<slug>`, marks the record `discarded`, and status shows `abandoned`. Negative: a session whose ownership label does not match is not closed and its branch is retained with `batch_lane_retained`; a dirty child worktree is retained; the next tick retries only the retained parts.
- `S4-AC2` *(Source: `BR-DEC-A4`; D4.3)*. Agreed seam: `tests/loop-leader-steering.test.ts`. Done looks like: while paused, ticks call no `advanceLanes` for the item's batch and the session generation is unchanged; after resume, an idle session at the unchanged baseline is not rotated on the first tick and is judged normally on the second.
- `S5-AC1` *(Source: `BR-DEC-A2`, `BR-REQ-A1`; D5.1, D5.4)*. Agreed seam: `tests/loop-leader-replan.test.ts`, `tests/loop-leader-briefing.test.ts`. Done looks like: `resume` on an `escalated` item with no batch blocker is accepted; `resume` on a `needs_human` batch or a `lane_executor_no_progress` child is rejected and only `ask_owner` is accepted; two active records for one task make `batchStateForTarget` refuse; briefing batches carry `generation`, `no_progress` and `attention`.
- `S5-AC2` *(Source: `BR-DEC-A3`, `BR-SCN-A2`; D5.2)*. Agreed seam: `tests/loop-leader-replan.test.ts`, `tests/loop-sched-interaction-github.test.ts`. Done looks like: a blocked child yields one `lane_entry_blocked` Issue comment; a leader `ask_owner` on the same subject annotates it and posts nothing new.
- `S5-AC3` *(Source: `BR-DEC-A6`, `BR-SCN-A4`; D5.3)*. Agreed seam: `tests/loop-leader-briefing.test.ts`, `tests/loop-leader-replan.test.ts`. Done looks like: five ticks refused `lane_session_unavailable` leave `refused_transitions`, `replan_rounds`, the briefing fingerprint and the wake count unchanged, and status shows `environment_blocked: "lane_session_unavailable"`. Negative: a different refusal reason still counts.

## Devil's Advocate Audit

- **"S1 ships a refusal where S3 of loop-leader promised execution."** True for the interval between S1 and S2; it replaces code that cannot compile, not working behavior, and S2 removes it. The refusal leaves the WorkItem retryable so no work is lost.
- **"`discard` is a second retirement path next to `retire_stale_batch`."** It differs in authority (WorkItem steering under native confirmation vs Host literal-user gate on a slug) and in effect (it closes sessions and deletes branches, which `retireStaleBatch` never does, `batch_disposition.ts:243-299`). Unifying them would widen Host behavior beyond the confirmed scope.
- **"Aggregated audit digest could hide a missing child."** The gate requires every child digest individually before aggregating; aggregation only names the PR evidence.
- **"Skipping one stall judgment after resume could hide a dead session."** Only one tick is exempt; `exited` sessions are still detected because `observe` runs, and the second tick applies the normal D8 rule.
- **"Excluding `lane_session_unavailable` hides a real problem."** It is shown in status on every tick and stays a hard refusal; only the leader's counters ignore it.
- **False-compromise check** (`docs/reference/planning-quality-gate.md`): no acceptance trades a confirmed outcome for a smaller one; the only narrowing (loop-leader S4-AC1) is the owner's own decision `BR-DEC-A2`.
