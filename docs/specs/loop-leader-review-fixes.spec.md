# Loop Leader Review Fixes: Replan, Initiative Dependencies, Shape Atomicity, Waiting Pointers

- **Initiative**: none — one TaskIntent `loop-leader-review-fixes`, a follow-up to `loop-leader` (`docs/specs/loop-leader.spec.md`) and `loop-leader-uls` (`docs/specs/loop-leader-uls-alignment.spec.md`) on branch `agent-loop` (PR #574, head `0401f62407`).
- **Output language**: English (repository default; clarification ran in Chinese).
- **Design risk**: Medium — single module (`runtime/loop_daemon/` plus one config diagnostic) but it changes a WorkItem transition's effects, removes rebuildable plan-publication state, changes the Initiative plan contract the plan role emits, and amends a settled Spec decision (loop-leader D4.2).
- **Design views**: service/component interfaces, state transitions, data flow. Architecture layers are omitted because no module, layer or dependency edge is added; temporal sequence is omitted because every change happens inside one existing tick step.
- **Execution posture**: Standard

## Outcome

A PR #574 review (2026-11-21) found nine defects, and clarification confirmed fixing all nine. When this task lands: `resolve{replan}` stops spending a plan-role session whose output nobody reads, and instead invalidates the item's plan so the existing planning path produces a new digest. A leader-shaped Initiative with dependencies plans and drives instead of failing later with `depends on unknown Task`. A refused shape leaves no files behind. Annotating an existing owner request records a waiting pointer that status shows. The four P3 cleanups also land.

| Slice | Task ID | Result when landed alone | Remaining gap | Risk | Blocked by | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| `S1` | `loop-leader-review-fixes` | All nine review findings fixed with focused tests; the two tests that encoded defects are corrected; the D4.2 amendment is recorded | none — complete confirmed outcome | `material` | — | `BR-SCN-1`–`BR-SCN-5` |

## Sources and Discovery Evidence

- **Clarify manifest** (this session, 2026-11-21): `BR-REQ-1`–`BR-REQ-9`, `BR-DEC-1`–`BR-DEC-3`, `BR-OUT-1`–`BR-OUT-4`, `BR-SCN-1`–`BR-SCN-5`. Every recommendation was adopted.
- **CI baseline**: PR #574 check "Typecheck, build and test" is SUCCESS at head `0401f62407`, so the review's four local 5 s timeouts were load jitter (`BR-OUT-4`).
- **Repository paths inspected**:
  - `plugins/immune-brain/runtime/loop_daemon/leader_dispatch.ts:427-481`: the `replan` branch starts a plan-role session through `deps.startSession`, reads only `{completed, reason}`, then calls `countResolveRound(..., "triage")`. `:153-189`: `parseInitiativePlan` checks only that `blocked_by` entries are strings. `:215-222`: `renderLocalInitiativeCarrier` writes `blocked_by` verbatim. `:229-260`: `shapeInitiative` authors intents one by one and throws mid-loop. `:191-208`: `leaderEventFor`.
  - `plugins/immune-brain/runtime/loop_daemon/cli.ts:318`: the role session runs in an empty `mkdtempSync` directory. `:330-342`: `initiativePlanPrompt` uses `"blocked_by": ["<id>"]`, the same placeholder as `slice_id`. `:1248`: `host: (... ?? "claude-code") as never`. `:1458-1478`: the `resumeBatch` dependency only checks batch state.
  - `plugins/immune-brain/runtime/local_initiative.ts:44,75,91`: the carrier's `Blocked by:` line names task ids. `plugins/immune-brain/runtime/unattended/batch_plan.ts:112-113` throws `depends on unknown Task`.
  - `plugins/immune-brain/runtime/loop_daemon/replan.ts:297-330`: `askOwnerQuestion` returns after `annotate` without `recordWaitingPointer` (only `:316` records one). `:78-90`: `resolveBlockers`. `:170-205`: `batchStateForTarget` returns nonterminal batches only.
  - `plugins/immune-brain/runtime/loop_daemon/interaction/protocol.ts:146-170`: `fitInteractionContext` cuts `blocked_on` one character per re-render. `:259`: `link(interaction_id, subject)`.
  - `plugins/immune-brain/runtime/config/agent_roles.ts:13-17`: the comment says triage "runs loop judging"; nothing outside this file reads `roles.triage`. `plugins/immune-brain/runtime/config/layered_config.ts:244-263`: `deprecated_config_source` diagnostics exist for `agents.planner`, `agents.executor` and preset `roles.judging`, but not `agents.triage`.
  - `plugins/immune-brain/runtime/loop_daemon/agent_handlers.ts:448-472`: plan publication records live at `<stateDir>/plans/<issue>.json`. `:1715-1727`: `loadPublishedPlanDigests` feeds G8 approval matching and `work_items.ts:602-616` rebuild. `:821-870`: `draft_plan` authors in the `imm-loop/<issue>` branch worktree, and `:1833-1846` reuses an existing branch worktree with its tree as-is.
  - `plugins/immune-brain/runtime/commands/kernel.ts:786-810`: `intent author` opens with `O_EXCL` and refuses an existing destination with `destination_exists`.
- **Test prior art**: `tests/loop-leader-replan.test.ts:162-176` (asserts the discarded session as expected), `tests/loop-leader-dispatch.test.ts:252-300` (asserts `Blocked by: s1`), `tests/loop-sched-interaction-github.test.ts:398-440,614-626`, `tests/loop-sched-interaction-local.test.ts:501-540`, `tests/layered-config.test.ts:340-355`, `tests/agent-roles-config.test.ts:224-240`.

## Threat model and supported environment

The new input is plan-role output (Initiative slices). It comes from a model running under the daemon, so it is treated as untrusted structured data: it can be malformed or inconsistent, but nobody is assumed to be crafting it adversarially. The supported environment is the repository's own tooling (Bun, Git SHA-1 repositories, macOS and Linux).

## User scenarios

| ID | Mode | Scenario | Acceptance |
| --- | --- | --- | --- |
| `BR-SCN-1` | `automated` | **Actor**: Repository owner. **Given**: the leader shapes an Issue as an Initiative whose second slice depends on the first. **When**: the daemon drives the work item. **Then**: `docs/initiatives/<slug>.md` lists `Blocked by: <first task-id>`, and `imm-loop status` shows the item driving with no planning error. | `RF-AC2` |
| `BR-SCN-2` | `automated` | **Actor**: Repository owner. **Given**: an Initiative shape where one slice's TaskIntent fails Kernel validation. **When**: the leader's `shape` item is applied. **Then**: `git status` shows no new or changed files under `docs/plans/` or `docs/initiatives/`, and the journal records the shape as rejected. | `RF-AC3` |
| `BR-SCN-3` | `automated` | **Actor**: Repository owner. **Given**: a work item with a pending `plan_approval` request on its Issue. **When**: the leader asks the owner about that item. **Then**: the existing Issue comment is annotated with the context pack, and `imm-loop status` lists the item as waiting with a link to that comment. | `RF-AC4` |
| `BR-SCN-4` | `automated` | **Actor**: Repository owner. **Given**: an escalated work item with a published plan. **When**: the leader's `resolve{replan}` is accepted. **Then**: `imm-loop status` shows the item in triage with no plan digest and no plan-role session started for the replan. | `RF-AC1` |
| `BR-SCN-5` | `automated` | **Actor**: Repository owner. **Given**: `.imm/config.json` still binds `agents.triage`. **When**: they run `imm-kernel config --json`. **Then**: the output shows one `deprecated_config_source` diagnostic for `agents.triage`, and `agents.valid` stays true. | `RF-AC6` |

## Brainstorm Trace

| Item | Summary | Maps to |
| --- | --- | --- |
| `BR-REQ-1` | `replan` starts no session; it clears the plan binding and publication and moves `escalated -> triage`, so the existing path re-plans with a new digest | `D1`; `RF-AC1` |
| `BR-REQ-2` | Amend loop-leader D4.2; fix `tests/loop-leader-replan.test.ts:170` | [Amendments](#amendments-to-settled-specs); `RF-AC1` |
| `BR-REQ-3` | `blocked_by` uses slice ids, mapped to task ids in the carrier; an unknown or self reference rejects the shape; the prompt states it; fix `tests/loop-leader-dispatch.test.ts:279` | `D2`; `RF-AC2` |
| `BR-REQ-4` | A refused shape leaves the worktree byte-identical | `D3`; `RF-AC3` |
| `BR-REQ-5` | Annotating an existing request records its waiting pointer | `D4`; `RF-AC4` |
| `BR-REQ-6` | Remove `as never` at `cli.ts:1248` | `D5`; `RF-AC7` |
| `BR-REQ-7` | Byte-excess truncation of `blocked_on` in one cut | `D5`; `RF-AC5` |
| `BR-REQ-8` | `agents.triage` reported with `deprecated_config_source`; fix the comment | `D5`; `RF-AC6` |
| `BR-REQ-9` | `resumeBatch` reads as a batch-state check; D3.4 comment at `leaderEventFor` | `D5`; `RF-AC7` |
| `BR-DEC-1` | Replan option A (no session) | `D1` |
| `BR-DEC-2` | Slice ids from the leader, task ids in the carrier | `D2` |
| `BR-DEC-3` | P3 cleanups in the same task; one TaskIntent on `agent-loop` | Outcome table |
| `BR-OUT-1` | A real replan session (repo access, output parsing, publication) | out: rejected by `BR-DEC-1` |
| `BR-OUT-2` | Requiring the leader to emit task ids in `blocked_by` | out: rejected by `BR-DEC-2` |
| `BR-OUT-3` | Line-by-line review of `agent_handlers.ts` / `drive_dispatcher.ts` / `batch_lanes.ts` delivery and discard paths | out: a review gap, not a defect this task fixes |
| `BR-OUT-4` | Full-suite load timeouts | out: CI passed at `0401f62407` |
| `BR-SCN-1`–`BR-SCN-5` | Owner-visible results | [User scenarios](#user-scenarios) |

## Amendments to Settled Specs

| Settled decision | Amended to | Where |
| --- | --- | --- |
| loop-leader D4.2: `replan` = "new plan session; for Initiatives a new digest and new plan approval" | `replan` starts no session of its own. It invalidates the item's current plan (binding, publication record, and the prior plan's unchanged daemon-authored drafts) and moves `escalated -> triage`. The existing `draft_plan` / `shape` path then produces the new plan, its new digest, and, where risk or posture requires it, a new plan approval. The replan cap (D4.3) and the authority-gated rejection (D4.2, ULS D5.1) are unchanged. | `D1` |

## Technical Design

### D1: Replan Invalidates the Plan (`BR-REQ-1`, `BR-REQ-2`, `BR-DEC-1`)

State transition: `escalated -> triage` (existing edge, `work_items.ts:64`).

1. **Guards, in order, each rejecting with zero side effects**: the existing `replan_cap_reached` and `authority_gated` checks are unchanged. Then (delegated technical choice) a new check: when `batchStateForTarget` reports a nonterminal batch for the item, the replan is rejected with `replan_batch_active`. A live batch owns enrolled intents, which a replan must not discard; such a batch is handled by `resume` or `abandon` (ULS D4/D5). A final new check (delegated technical choice; it protects a user's or another session's edits): when a draft file the prior plan authored no longer matches the content hash recorded in its publication, the replan is rejected with `replan_draft_changed`.
2. **Effects when accepted**:
   - (a) Clear `binding.plan_digest`, `binding.task_ids` and `binding.initiative_slug`.
   - (b) Remove `<stateDir>/plans/<issue>.json`. A stale `/approve <old digest>` then no longer matches G8, and the work-item rebuild no longer restores `plan_published`.
   - (c) Remove the prior plan's daemon-authored drafts whose hash still matches, so the next `intent author` is not refused `destination_exists`. These are the Initiative carrier and the TaskIntents a shape authored in the checkout, or the drafts in the `imm-loop/<issue>` plan worktree.
   - (d) Advance to `triage` and increment `replan_rounds`.

   No role session starts, and the daily dispatch budget is not read or moved.
3. **Invariant**: after an accepted replan, no state the daemon reads (binding, publication, digests map, rebuild) still names the old digest. A re-plan that reuses the same task ids is not refused `destination_exists`.
4. **Failure behavior**: if removal fails partway, the error is journaled and the item stays `escalated` with its binding intact. Removal is idempotent, so the next accepted replan retries it.

### D2: Initiative Dependencies in the Slice Namespace (`BR-REQ-3`, `BR-DEC-2`)

Interface: `immune_brain/loop_initiative_plan/v1` keeps its shape; `blocked_by` is defined as a list of `slice_id`s of the same plan.

- `parseInitiativePlan` (or a validation step before any write) rejects the whole plan when a `blocked_by` entry names an unknown slice id, names its own slice, repeats an id, or when slice ids or intent `task_id`s are duplicated. A rejected plan produces the existing `shape_plan_missing` / `shape_plan_failed` rejection with zero side effects.
- `renderLocalInitiativeCarrier` writes `Blocked by:` with the mapped task ids, which is the namespace `local_initiative.ts:44` and `batch_plan.ts:112` read. Cycle detection stays with `batch_plan.ts` and is not duplicated.
- `initiativePlanPrompt` states that `blocked_by` lists the `slice_id`s of earlier slices.
- **Data flow**: plan-role JSON → parse/validate (reject) → Kernel author (D3) → carrier render (mapped ids) → `observeLocalInitiative` → batch plan projection. The done-looks-like check runs the last two stages on the written carrier.

### D3: Shape Is All-or-Nothing (`BR-REQ-4`)

`shapeInitiative` must leave the checkout byte-identical when it refuses at any point: plan validation, any slice's Kernel author result, a missing `task_id`/`content_hash`, or the carrier write. Delegated technical choice: the Executor either validates everything before the first write, or records the paths it created and removes exactly those on failure. Pre-existing files at a destination are never overwritten (the Kernel refuses with `destination_exists`) and are never removed by the rollback.

### D4: Waiting Pointer on Annotation (`BR-REQ-5`)

After `channel.annotate` returns `annotated`, `askOwnerQuestion` records a waiting pointer for the annotated `interaction_id` (kind of the pending request, `channel.id`, `link` from `channel.link(interaction_id, subject)`) before returning. This applies to a pending `plan_approval`, a `lane_decision`, or a `lane_entry_blocked` escalation. A `null` link records nothing, matching the post branch. `clearWaitingPointersForTarget` still runs first and keeps the annotated id.

### D5: Cleanups (`BR-REQ-6`–`BR-REQ-9`)

- `cli.ts:1248` passes a value typed as the discard dependency's host type without `as never`. An executor host outside that type is narrowed or refused explicitly, not cast.
- `fitInteractionContext` computes the byte excess once and cuts `blocked_on` to a prefix that ends on a UTF-8 code-point boundary, with at most one corrective re-render.
- `layered_config.ts` emits one `deprecated_config_source` warning per bound `agents.triage` layer (key path `agents.triage`) saying triage judging is retired. The binding stays parseable, and `agents.valid` and the other roles resolve unchanged. The `agent_roles.ts` comment is corrected.
- The `resumeBatch` dependency of `LeaderDispatchDeps` is renamed so it reads as a batch-state check (for example `checkBatchResumable`); its behavior is unchanged.
- `leaderEventFor` / `applyNext` gains a comment stating that repeat dispatch is guarded by `WORK_ITEM_TRANSITIONS` plus the Tier-0 guards (loop-leader D3.4), with no per-tick dedup.

### Compatibility, Interruption Recovery, and Rollback

- **Persisted state**: no schema change. Removing `plans/<issue>.json` uses the existing "rebuildable orchestration state" status of that file. Older daemons that still read a removed record simply see no publication.
- **Plan contract**: `loop_initiative_plan/v1` is unchanged in shape. Plans whose `blocked_by` already named task ids were always broken downstream, so rejecting them is not a compatibility loss.
- **Interruption**: D1 and D3 are idempotent and fail closed; a stopped tick leaves either the old plan intact or the state fully invalidated.
- **Rollback**: revert this task's commit. No migration is needed.
- **Derived outputs**: `plugins/immune-brain/dist/claude/mcp-server.mjs` and the antigravity runtime mirror are regenerated by `scripts/build-claude-plugin.ts` and `scripts/build-antigravity-plugin.ts`.
- **False-compromise check**: `replan` without a session gives up a distinct "re-think" step (it becomes release plus invalidation). That was accepted by `BR-DEC-1` and is not a contradiction. Draft removal could overwrite user edits; Preliminary Action (the hash check in D1.1) already removes that trade-off. No false compromise detected.

## Verification and Acceptance Mapping

| AC | Source | Agreed seam | Done looks like | Negative / bound |
| --- | --- | --- | --- | --- |
| `RF-AC1` | `BR-REQ-1`, `BR-REQ-2`, `BR-DEC-1`, `BR-SCN-4`; `D1` | `tests/loop-leader-replan.test.ts` | An accepted replan on an escalated item with a published plan starts no role session, leaves the daily dispatch count unchanged, removes the publication record, clears the binding, and moves the item to `triage` with `replan_rounds` + 1. A following shape with the same task ids is accepted. | A nonterminal batch → `replan_batch_active`; an edited prior draft → `replan_draft_changed`; authority-gated → only `ask_owner`. Each rejection leaves binding, publication and files unchanged. The fourth replan → `replan_cap_reached`. |
| `RF-AC2` | `BR-REQ-3`, `BR-DEC-2`, `BR-SCN-1`; `D2` | `tests/loop-leader-dispatch.test.ts` | Slice `s2` with `blocked_by: ["s1"]` writes `Blocked by: task-a`, and the written carrier parses through `observeInitiative` and `projectBatchPlan` without `depends on unknown Task`. | `blocked_by` naming an unknown slice, its own slice, or a task id that is not a slice id; duplicate slice ids → rejected with no carrier, no intent, no binding. |
| `RF-AC3` | `BR-REQ-4`, `BR-SCN-2`; `D3` | `tests/loop-leader-dispatch.test.ts` | The third slice's Kernel author fails → `docs/plans/` and `docs/initiatives/` match their pre-shape listing and bytes; the work item has no new binding. | A carrier write failure after all intents are authored → intents removed. A pre-existing file at a slice path is neither overwritten nor removed. |
| `RF-AC4` | `BR-REQ-5`, `BR-SCN-3`; `D4` | `tests/loop-sched-interaction-github.test.ts`, `tests/loop-sched-interaction-local.test.ts` | `ask_owner` on a subject with a pending `plan_approval` annotates it, and `listWaitingStatus` lists that interaction with its link (GitHub comment URL / local link). | A channel whose `link` returns `null` records no pointer. A failed annotate falls through to posting as today. Stale pointers for the target are still cleared. |
| `RF-AC5` | `BR-REQ-7`; `D5` | `tests/loop-sched-interaction-github.test.ts` | A 256 KiB multi-byte `blocked_on` renders within `CONTEXT_MAX_BYTES` with the marker, as a valid UTF-8 prefix of the original. | A `blocked_on` exactly at the cap is not truncated; the existing structured trimming of evidence, options and tried still runs first. |
| `RF-AC6` | `BR-REQ-8`, `BR-SCN-5`; `D5` | `tests/layered-config.test.ts`, `tests/agent-roles-config.test.ts` | A project `agents.triage` binding yields exactly one `deprecated_config_source` at `agents.triage`, with `agents.valid` true. | No `agents.triage` → no such diagnostic; the executor and reviewer roles resolve unchanged. |
| `RF-AC7` | `BR-REQ-6`, `BR-REQ-9`; `D5` | `bun run typecheck`, `tests/loop-leader-replan.test.ts` | Typecheck passes with no `as never` on the discard host; the batch-check dependency is renamed and replan tests pass with it; `leader_dispatch.ts` cites D3.4 at `leaderEventFor`. | `rg` finds no `resumeBatch` identifier in `runtime/loop_daemon/`. |

Every descriptor also runs `bun scripts/build-claude-plugin.ts --check`, `bun scripts/build-antigravity-plugin.ts --check` and `bun run typecheck`, so derived outputs stay current.

## Devil's Advocate Audit

- **Rollback resilience**: every change is inside one commit. D1 and D3 fail closed and are idempotent; a partial D1 leaves the item `escalated` with its binding, so nothing is half-invalidated.
- **Verification vanity**: `RF-AC1` asserts side effects (no session record, dispatch count unchanged, publication file absent, a later same-id shape accepted), not just the state name; the old test asserted exactly the defect. `RF-AC2` runs the written carrier through the real downstream reader and batch projection, which is where the defect surfaced. `RF-AC3` compares directory bytes, not just the absence of a binding.
- **Spec dilution**: replan still counts rounds and still respects authority gating; option A was chosen explicitly (`BR-DEC-1`) and recorded as an amendment rather than silently diverging from D4.2. No acceptance relaxes an existing loop-leader or ULS acceptance.
