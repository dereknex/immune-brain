# Branch boundary r2 follow-ups

**Status**: candidate decomposition, confirmed by the user on 2026-10-23 (Initiative name, slug and decomposition in one review table). This document grants no execution authority.
**Initiative name**: Branch boundary r2 follow-ups
**Immutable slug**: `branch-boundary-r2-followups`
**Carrier**: GitHub, selected by root `CLAUDE.md` (`Initiative carrier default: github`).
**Planning baseline**: `1c4fbf6`; recheck affected paths if HEAD changes before Enrollment.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — the batch start contract, Review authority on both Hosts, a new non-verdict Review outcome, parked-child recovery, Lane admission and the TaskIntent validator all change; several are authority or state-machine owners.
**Execution posture**: characterization-first for S4 and S5: pin today's `lane_committed` integration and parked-resume refusal at the batch seam before changing them.
**Design views**: component interfaces, state transitions.
**Threat model and supported environment**: the adversary is the executing model (Executor or Reviewer), which may skip implementation, retype or alter a reserved prompt, redispatch a Reviewer to shop for a pass, or report truncated work as a verdict. The user, the Host process, the coordinator's loaded plugin build and the repository's committed declarations are trusted. Supported: Git 2.38+, SHA-1 object format, UTF-8 paths, Claude Code with the plugin hooks, Pi with the bundled extension, macOS and Linux, Bun 1.4.

## Outcome

Ten problems observed while running Initiative #273 as a parallel Lane batch are fixed so the next batch runs without coordinator hand-holding:

- A batch cannot complete without running the repository's full verification.
- A Pi Review cannot run on a drifted prompt or be redispatched in hiding.
- A truncated Review is retried with a larger budget instead of counting as a verdict.
- A parked child is revived in place instead of retiring the whole batch.
- The Planner caps Slice size.
- Lane Executors are no longer stalled by expected status lines.
- A Lane is not admitted on a stale runtime build without the user knowing.
- An authority change between Lane commit and integration is caught.
- Tracker titles and close states match the plan.

## Sources

No Brainstorm manifest exists. Sources are the user's post-batch list of 2026-10-23 (items C1–C10, confirmed with "用planner进行实现") and the user's answers in this planning session.

| Source | Evidence or decision |
| --- | --- |
| C1 | Batch #273 completed while its Parent tip had 32 failing existing tests: the Lane batch was started without `final_verification`, and `batch_lanes.ts:1281-1284` skips final verification when the list is empty and no derived files are declared, then sets `batch_state: "completed"` (`batch_lanes.ts:1291`). |
| C2 | Pi binds a Review dispatch to its reservation only by an exact prompt digest (`.pi-extension/pi-canary-assurance-progression.ts:93-109`); an Executor that retypes the ~16KB prompt with drift dispatches a Reviewer that runs, returns a verdict, and is then refused with "the reserved foreground Agent was not observed in this session" (`:126,131`). In S6 and S9 of #273 a real rework verdict was dropped this way, and a redispatch could shop for a pass. |
| C3 | A Reviewer that runs out of turns (`reviewTurnBudget`, `assurance/coordinator.ts:626-630`, cap 48) returns a blocking "insufficient coverage" finding that settles as rework; the verdict parser admits only `pass` and `rework` (`coordinator.ts:784`). |
| C4 | Resuming a `needs_human` Lane batch refuses the whole batch when any parked child has an unreadable Lane or no recoverable owned run (`batch_lanes.ts:781-806`); the only recovery is `retire_stale_batch` and a fresh batch. |
| C5 | #273 Slices S4 (28 files, +1914/−12305) and S6 (33 files) exceeded what one Review could cover. User answer 2026-10-23: hard cap of 15 counted `scope_hint` paths, deletion-heavy retirement in its own Slice, validator refuses an over-cap TaskIntent unless it states a reason. |
| C6 | In a Lane worktree `status` reports `loaded_plugin_differs_from_workspace` with "reload the Host" (`runtime/plugin_source_skew.ts:50-54`, `assurance/coordinator.ts:413`); Lane Executors of S4, S10 and S2 stopped on it without writing code. |
| C7 | A fresh enrollment projects `next_obligation: "submit_assurance"` while `artifact_state` is `active` (`kernel/completion.ts:254-255`); Lane Executors read it as "submit now" and stopped without implementing. |
| C8 | Lanes run the coordinator's loaded build (`batch_lanes.ts:218-224`, Round 1 D4), so a runtime change integrated onto the Parent branch does not reach later children (S5's beyond-estimate disclosure did not apply to S6). User answer 2026-10-23: keep D4; detect the stale build and pause for a reload. |
| C9 | The first S6 Reviewer found that the `lane_committed` integration loop (`batch_lanes.ts:1150-1167`) and the parked-resume promotion to `lane_committed` (`batch_lanes.ts:797-800`) integrate without rechecking `laneAuthorityChange`, which is checked only on `settled` (`batch_lanes.ts:1116`); that verdict was dropped by C2. |
| C10 | Child Issue titles use the positional ordinal (`github_issue_tracker.ts:406-407`, "S<n> with n the declared Slice position" in `dist/imm-planner.md`), not the TaskIntent's `slice_id` marker: #275 was titled "S4" with marker `slice-id=S2`. A child stopped in a retired batch was closed `not_planned`, and its later re-delivery left it closed `not_planned` (`github_issue_tracker.ts:1630-1636` treats the second terminal event as `ambiguous_remote_state`). |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Slice |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | user | a new batch start request with no `final_verification` | the Parent calls `start_unattended_batch` | it is refused with `final_verification_required` before any side effect | automated | S1 |
| SCN-2 | user | a pending Pi Review reservation | the Executor dispatches a Review Agent whose prompt differs from the reserved bytes | the dispatch is blocked before the Reviewer runs, with an instruction to dispatch the reserved prompt verbatim | automated | S2 |
| SCN-3 | user | a Reviewer that cannot cover every changed path within its turn budget | it returns `incomplete` | the round is not a verdict; the next dispatch gets a larger budget, and a second incomplete round stops with a recovery action | automated | S3 |
| SCN-4 | user | a Lane child committed but not yet integrated whose TaskIntent changed | the coordinator ticks | the child is parked naming the authority change instead of integrating | automated | S4 |
| SCN-5 | user | a parked batch whose child's run was stopped or whose Lane is unreadable | the user confirms a resume | that child restarts in a recreated Lane at the Parent tip while the other children resume | automated | S5 |
| SCN-6 | user | a candidate TaskIntent with more than 15 counted `scope_hint` paths | the Planner validates it | validation reports `scope_estimate_too_wide` and `enrollment_ready: false` unless the intent states `scope_size_reason` | automated | S6 |
| SCN-7 | user | a freshly enrolled Lane child with plugin skew | its Executor reads `status` | the skew line says it is expected and non-blocking in a Lane, and the guidance says to implement before `advance_assurance` | automated | S7 |
| SCN-8 | user | an integrated child that changed the plugin build | the next child would be admitted | admission pauses with `runtime_reload_required`; a confirmed resume after reload admits it, and a confirmed resume without reload admits it with the skew recorded in the final report | automated | S8 |
| SCN-9 | user | a published Initiative whose Slice positions differ from slice IDs, and a child closed `not_planned` that is later delivered | the tracker projects titles and the done settlement | titles carry the slice ID, and the Issue ends closed `completed` | automated | S9 |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | A new batch start through `start_unattended_batch` (Claude MCP tool and Pi tool) refuses with `final_verification_required` before any side effect when `final_verification` is absent or empty. A resume of an existing record does not need it. A batch whose children all integrate without any final verification ends with a completion summary that names `final verification not run` instead of `all enrollable children integrated`. Lane and integration steps keep running only per-child descriptors; the full suite runs once, as final verification. | C1 |
| D2 | Pi binds a Review `Agent` dispatch to its reservation by the reserved `description` (`Review <task> <operation>`). A dispatch whose description matches a pending reservation but whose prompt digest differs, or a `subagent_type: "Review"` dispatch that matches no pending reservation while one is pending, is blocked in `tool_call` before the Reviewer runs, with a reason that names the reservation and says to dispatch the reserved prompt verbatim. A verbatim dispatch binds as today. A second dispatch for the same reservation stays refused. | C2 |
| D3 | The Review child verdict gains a third decision, `incomplete`, with `inspected_paths` and a one-line reason. It is not an assurance verdict: it settles no finding, consumes no rework round, and releases the reservation. The Kernel records the incomplete round durably; the next dispatch for the same snapshot uses twice the previous turn budget, capped at 96. A second `incomplete` for the same snapshot stops the run with `review_incomplete` and one recovery action. The reviewer prompt tells the Reviewer to return `incomplete` instead of a coverage finding. | C3 |
| D4 | Before integrating a `lane_committed` child, both the integration loop and the parked-resume promotion recheck `laneAuthorityChange`; a change parks the child naming it, exactly as on `settled`. | C9 |
| D5 | Resuming a parked Lane batch with a fresh literal-user confirmation no longer refuses as a whole when one child is unrecoverable. A parked child whose run is terminal `stopped` or whose Lane is unreadable or lost is revived in a recreated Lane at the current Parent tip with a fresh Lane store, using the S10 redo grant (at most two per child). With no grant left, or with an open user decision or replan, it stays parked and its dependents stay `skipped_blocked`, while independent children resume. | C4 |
| D6 | `imm-kernel intent author` and `intent validate` refuse a candidate whose counted `scope_hint` exceeds 15 paths with `scope_estimate_too_wide` (`enrollment_ready: false`) unless it carries an optional `scope_size_reason` (1–500 characters). Counted paths exclude `.changeset/**`, the intent's own `docs/plans/<task_id>.intent.json`, `docs/specs/*.spec.md`, and outputs declared in `docs/agents/derived-files.json`. Enrollment of an already enrolled record and `revise_intent` do not apply the cap. The Planner contract adds that deletion-heavy retirement is its own Slice. | C5 |
| D7 | In a Lane worktree (a worktree under the Git common directory's `imm/worktrees/`), `status` keeps the `loaded_plugin_differs_from_workspace` code but its message says the skew is expected in a Lane, does not block, and must not trigger a reload. Batch start keeps refusing on coordinator-side skew (Round 1 D4). | C6 |
| D8 | When `next_obligation` is `submit_assurance` and the task has no changed path since its base, `status` adds an `implementation_pending` warning telling the Executor to implement the enrolled acceptance, run focused checks, stage and then call `advance_assurance`. The obligation enum is unchanged. The `imm-run` Execution Loop and the Executor prompt name this case. | C7 |
| D9 | Before admitting or redoing a Lane child, a plugin-source repository compares the Parent tip's `plugins/immune-brain/dist/claude/mcp-server.mjs` with the coordinator's loaded build. A difference pauses admission with `runtime_reload_required`, naming the integrated commit; in-flight children continue. A fresh literal-user resume admits the child; if the build still differs, the child record and the final report carry `runtime_skew_acknowledged`. | C8 |
| D10 | Child Issue titles use the TaskIntent's `slice_id` (`[<short_name>] <slice_id> <title>`) instead of the positional ordinal. A `done` terminal event for a Child already closed `not_planned` by an earlier `stopped` terminal event of the same task replaces the terminal marker and ends the Issue closed `completed` (reopen then close). A manually closed nonterminal Issue is still preserved. | C10 |

Delegated technical choices:

| ID | Choice | Reason |
| --- | --- | --- |
| T1 | D1 enforces at the Host tool boundary, not inside `startLaneBatch`. | Keeps runtime fixtures that drive the batch core directly; the user-facing entry is what skipped verification. |
| T2 | D2 blocks a drifted dispatch instead of rewriting its prompt. | A blocked call never runs a Reviewer, so no verdict is dropped and none can be shopped; Pi's `tool_call` hook already blocks (`imm-canary-work.ts:491-494`). |
| T3 | D3's budget doubling is capped at 96 turns and tried once. | Bounds Review cost and keeps truncation an execution failure rather than a loop. |
| T4 | D9 compares the generated bundle bytes. | The bundle already stands in for the build (`plugin_source_skew.ts:1-6`). |

## Technical Design

### Component interfaces

- S1: `claude/mcp_server.ts` and `.pi-extension/imm-unattended-batch.ts` start handlers; the `batch_lanes.ts` completion summary; `dist/imm-run-batch.md` names the requirement.
- S2: `PiReviewHost.observeReviewDispatch` returns a block decision consumed by the `tool_call` handler in `imm-canary-work.ts`; `reservedAgentDescription` is the binding key.
- S3: `parseChildVerdict` and the verdict shapes in `coordinator.ts`; `reviewTurnBudget` takes the recorded incomplete count; both Hosts' review hosts and continuation handle the non-verdict outcome; the reviewer prompt gains the `incomplete` shape.
- S4: `batch_lanes.ts` integration loop and resume.
- S5: `batch_lanes.ts` resume, `batch_worktrees.ts` `recreateLaneWorktree`, `kernel/batch_authority.ts` redo grants.
- S6: `kernel/intent.ts` (allowed key and counted-path rule), the `imm-kernel intent` CLI, `dist/imm-planner.md`.
- S7: `plugin_source_skew.ts`, `assurance/coordinator.ts` status warnings, `dist/imm-run.md`, `prompts/executor.md`.
- S8: `batch_lanes.ts` admission, `plugin_source_skew.ts` build comparison at a commit, `batch_final_report.ts`.
- S9: `github_issue_tracker.ts` title composition and `markChildTerminal`; `dist/imm-planner.md` title rule.

Every runtime Slice regenerates `plugins/immune-brain/dist/claude/mcp-server.mjs` (a declared derived output) and adds a changeset.

### State transitions

- Review round (S3): `dispatched → incomplete (recorded, reservation released) → dispatched (budget ×2, cap 96) → verdict | incomplete → stopped (review_incomplete)`.
- Parked child (S5): `needs_human → (resume) enrolled | settled | lane_committed` (recoverable owned run, unchanged), or `→ redo (recreated Lane, grant used) → enrolled`, or `→ needs_human` (no grant, open decision); dependents `skipped_blocked → pending` only when their blocker resumes.
- Admission (S8): `pending → admission paused (runtime_reload_required) → (confirmed resume) laning`.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one commit on the Parent branch. S3 adds a verdict branch: reverting S3 leaves a recorded incomplete round in the store unread by the old reader, which must fail closed; the recovery is `stop` and re-enroll. S5 uses the existing redo grant, so reverting it returns to whole-batch refusal. S6 adds an optional field, so intents without it stay valid after a revert, and intents with it fail validation closed.
- **Verification vanity**: each acceptance names its negative case: an empty `final_verification` list and a resume without it (S1); a one-character prompt drift and an unreserved Review dispatch (S2); a second incomplete round and an `incomplete` submitted as rework (S3); an unchanged intent that still integrates (S4); a child with an open user decision and a child with no grant left (S5); exactly 15 and 16 counted paths, and excluded paths (S6); skew outside a Lane keeps the reload text, and a task with changes gets no `implementation_pending` (S7); an equal build admits with no pause (S8); a manually closed nonterminal Issue stays preserved (S9).
- **Spec dilution**: C1–C10 each map to exactly one Slice below; none is deferred. Round 1 D4 and r2 D14 and D16 stand.

## Slices and acceptance mapping

| Slice | Task | Result when landed alone | Acceptance seams | Risk | Blocked by |
| --- | --- | --- | --- | --- | --- |
| S1 | `batch-final-verification-required` | A batch cannot start without final verification; a run without it says so | `tests/batch-final-verification-required.test.ts` (new) | material | — |
| S2 | `pi-review-dispatch-binding` | A drifted or unreserved Pi Review dispatch is blocked before it runs | `tests/pi-canary-review-dispatch-resilience.test.ts`, `tests/pi-canary-work-extension.test.ts` | critical | — |
| S3 | `review-incomplete-redispatch` | A truncated Review retries once with a doubled budget and then stops | `tests/review-incomplete-redispatch.test.ts` (new), `tests/pi-canary-review-outcome-evidence.test.ts` | critical | — |
| S4 | `lane-committed-authority-recheck` | An authority change after Lane commit parks instead of integrating | `tests/unattended-batch-lanes.test.ts` | critical | — |
| S5 | `parked-child-revive` | A stopped or lost parked child restarts in place on resume | `tests/batch-parked-revive.test.ts` (new), `tests/batch-redo-slot.test.ts` | critical | S4 |
| S6 | `slice-size-limit` | Over-cap TaskIntents fail validation unless they state a reason | `tests/kernel-intent-validation.test.ts`, `tests/imm-planner-kernel-intent-contract.test.ts` | material | — |
| S7 | `lane-executor-status-guidance` | Lane Executors see skew as expected and are told to implement first | `tests/claude-bundle-staleness.test.ts`, `tests/lane-executor-status-guidance.test.ts` (new) | material | — |
| S8 | `lane-runtime-reload-gate` | A stale runtime build pauses Lane admission until a confirmed resume | `tests/batch-runtime-reload-gate.test.ts` (new) | critical | S5, S7 |
| S9 | `tracker-slice-title-redelivery` | Titles carry slice IDs and a re-delivered child closes completed | `tests/github-issue-projection-contract.test.ts`, `tests/github-initiative-recovery.test.ts` | material | — |

S4 lands before S5 because both edit the parked-resume block in `batch_lanes.ts`; S8 follows S5 and S7, which own the admission path and `plugin_source_skew.ts`. Every other overlap is limited to the regenerated bundle, which the merge queue regenerates (r2 D17).

## Discovery evidence

- Final verification: `batch_lanes.ts:1275-1300`; `batch_final_verification.ts:43-48,131-138`; `batch_final_report.ts:42`; start inputs at `.pi-extension/imm-unattended-batch.ts:120,393` and `claude/mcp_server.ts` start handler.
- Pi review binding: `.pi-extension/pi-canary-assurance-progression.ts:62-133`; `.pi-extension/pi-canary-native-review.ts:19-63`; `.pi-extension/imm-canary-work.ts:491-519`; Claude counterpart `claude/review_host.ts:503-556`.
- Review parsing and budget: `assurance/coordinator.ts:141,170,196,615-630,685-687,777-839,1381`.
- Parked resume and integration: `batch_lanes.ts:697-740,781-806,858-883,951-1050,1110-1205`.
- Intent parser: `kernel/intent.ts:76-82,138-184,212,232`.
- Skew and obligation: `plugin_source_skew.ts:41-61`; `assurance/coordinator.ts:401-427`; `kernel/completion.ts:246-262`; `dist/imm-run.md:110-123`.
- Tracker: `github_issue_tracker.ts:394-407,1587-1650`.

## Out of scope

The separately planned U2 follow-up acceptance-run Initiative and its four carried-over items (`docs/specs/branch-boundary-r2.spec.md`, Follow-up acceptance run); loading Lane-branch runtimes (C8 answer); Claude review dispatch binding, which C2 did not observe; push, PR and release.
