---
name: imm-run
description: Use when the user explicitly requests execution or resumption of an Immune-Brain task.
---

# Immune-Brain: Loop

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Kernel Canary Routing and Authority

Only explicit `imm-run` entry starts or resumes this loop. Ordinary host input
stays host-native; it never resumes a Managed owner implicitly. Read the current
Host's `status` projection first and verify the exact active backend claim,
TaskIntent, and TaskRecord. Invalid or contradictory projections fail closed. A
candidate TaskIntent is not Enrollment authority.

Before the first Enrollment of a candidate TaskIntent, confirm the Planner
returned `tracker_associated` — but only when the candidate belongs to an
identified GitHub-carried Initiative. Standalone TaskIntents and Local
Initiatives carry no tracker prerequisite: their Enrollment needs only the
validated candidate. When membership is uncertain, resolve it against the
Planner's carrier decision before treating the candidate as exempt; do not
assume either way. For a GitHub-carried Initiative, `tracker_projection_failed` or
`awaiting_user_initiative_confirmation` blocks that Enrollment until the same
complete carrier batch succeeds; report the stable carrier reason and its exact
retry action instead of enrolling. A carrier command the Host refused, cancelled,
or never ran is not a completed batch, and a later `imm-run` entry does not
clear it. This pre-Enrollment gate is distinct from the post-settlement tracker
projection below, which never blocks the Loop.

TaskIntent defines the goal, acceptance, and `scope_hint`; TaskRecord and the
Kernel projection own lifecycle, artifact state, freshness, and next obligation.
Conversation memory, GitHub Issues, and `CONTEXT.md` never override them.
Historical prose Plans and State Ledgers are read-only history, not execution
instructions. Do not create Steps, workflow profiles, follow-up ledgers, or
successor Plans to drive a Kernel task.

At every internal role boundary call the invoking Host's read-only role-boundary
route. Use `route` for current-context Executor work, bounded repair,
architecture exploration, advisory review, Compounder, Kernel ownership, or
scope expansion. Use Kernel ownership for an enrolled task. This route projects
authority; it does not record execution evidence, mutate task state, or replace
Kernel operations.

On the Claude Host a read-only internal role is dispatched through the `Agent`
tool by its plugin agent type — `immune-brain:immune-brain-qa`,
`immune-brain:immune-brain-ui-review`,
`immune-brain:immune-brain-advisory-reviewer` — and architecture exploration uses
the Host's own `Explore` agent. The agent definition, not prompt text, bounds
that role's tools. On Pi the agent configuration belongs to the Pi user and the
read-only boundary remains prompt text; the Pi dispatch rules are unchanged.

Before a child dispatch, read the [Subagent Dispatch Protocol](docs/reference/subagent-dispatch-protocol.md#authorization-authority).
Never load an internal role as a public Skill or spawn another loop process;
the only exception is a Lane's Executor Host under
[Lane Executor Supervision](#lane-executor-supervision).
The standalone `imm-pr-fix`, `imm-doc-prune`, and `imm-doc-slim` are host-native
maintenance entries, never dispatched as the Loop role. Internal `test-fixer`
and `pr-fix` repairs remain bounded by the enrolled TaskIntent.

## Execution Loop

Continue while the current projection has a valid action:

1. For active artifacts, implement only the enrolled acceptance within the
   `scope_hint` envelope in the current conversation. New helpers or tests
   inside an approved directory or glob do not require a revision. Run focused
   checks. Before `advance_assurance`, inspect ownership and stage only the exact
   task-owned paths needed for delivery. Do not hand routine task-owned staging
   to the user. If a file mixes pre-existing user changes with task changes and
   the task-owned hunks cannot be isolated reliably, stop with that ownership
   conflict instead of staging the whole file. Staging grants no commit or push
   authority. Complete the [Executor Delivery Evidence](role-prompts/executor.md#delivery-evidence)
   table before the first Assurance attempt and update affected rows after repair.
   Executor checks are diagnostic evidence, not a QA or Review approval.
2. Call `advance_assurance` in the foreground and consume its direct terminal
   result. The Kernel freezes the artifacts itself before QA: it binds Git
   content identity in place without relocating source paths. A simple task has
   TaskIntent only; a complex task may bind one active Spec. Deterministic QA
   runs all descriptors in a disposable delivery materialization, never against
   unchecked live worktree source. Do not dispatch a separate per-Step QA Agent.
3. On `review_ready`, invoke the returned `agent_params` as one exact foreground
   Agent call, then pass its structured verdict to `submit_review`. Do not
   replace this snapshot-bound reviewer with a generic role dispatch. The Parent
   cannot issue its own QA or Review pass.
4. Follow the returned Kernel obligation. Fresh QA suffices for routine work;
   material and critical work additionally require fresh independent Review.
   Normal completion does not require a second user confirmation.
5. For rework, follow the projected artifact state before editing. Submit the
   rework verdict first, then edit: staging an in-scope change while the
   artifacts are frozen invalidates the snapshot and discards that verdict,
   forcing a fresh QA round. After the Kernel returns the artifacts to active,
   make the fix, resolve findings only after fixing and verifying their cause,
   then run the newly required obligations. Changed snapshots
   invalidate old evidence; run the newly required obligations. On the second
   rework of one acceptance id or anchor, the fix response must either state why
   it covers every known trigger class of the violated invariant — the shared
   guard, not only the reported path — or declare the trigger outside the
   accepted contract and answer with `refute_finding` bound to fresh QA evidence
   for that acceptance. Escalating a local heuristic a third time instead of
   choosing one of those two responses is the loop this step exists to break.
6. An unresolved decision pauses only dependent execution. On `awaiting_user`,
   invoke `request_authorization` directly before ending the turn; use the
   Decisions and Recovery route for its native-gate handling. End the turn if
   the decision remains unresolved, is cancelled, or the gate fails. Otherwise
   continue from the returned projection. Stop on terminal `done` or `stopped`,
   explicit cancellation, or a failure without a safe projected action.

Use the fresh projection returned by a successful operation when supplied. Read
`status` after interruption, ambiguous mutation results, absent projections, or
suspected external changes. Never repeat a mutation merely to obtain its result.
Kernel CAS and freshness checks remain mandatory; reducing Parent reads does
not bypass them. Do not poll or create detached jobs.

## Unattended Batch Opt-In

The only unattended batch entry is the privileged Host tool `start_unattended_batch`
with its `initiative_slug` parameter. That parameter is the opt-in (lane mode adds an optional `max_parallel`, see [Parallel Batch Opt-In](#parallel-batch-opt-in)): absent the call,
`imm-run` behavior is byte-identical to per-task Enrollment, and no batch state,
branch, or Batch Authorization exists. The Standalone Hosts expose the same tool
name and the same required parameter; it is never a batch of tasks the Host chose.
When an Initiative is referenced by its tracker Issue (e.g. `github #<number>`),
extract `initiative_slug` from the Issue body `<!-- immune-brain:initiative-id=<slug> -->`
marker or title prefix before invoking the tool.

Invoking it authorizes only a user-confirmed batch of already-planned child
TaskIntents. The Host projects the batch plan from the Initiative's published
children, excludes every `critical` child, renders the ordered child list, budget,
and plan digest through its native confirmation, and issues one Kernel Batch
Authorization for that exact plan. The extension mints no capability and owns no
batch state transition: the shared `startBatch` driver in
`runtime/unattended/` owns every batch transition, and each child is still
enrolled, assured, and settled by the Kernel under an ordinary TaskRecord.

A successful child Enrollment returns a `running` report with `handoff.role`
`executor`; the child remains `enrolled`. The Parent implements that TaskIntent
in the current foreground conversation, stages only its scoped changes, and
runs focused diagnostics before Kernel Assurance. Re-entering the batch before
implementation returns the same handoff without QA or another confirmation.
The runtime owns no model invocation and adds no persisted execution lifecycle.

After diagnostics pass, the Parent advances Kernel QA and dispatches any reserved
foreground Review once using the exact returned `agent_params`, then submits its
structured verdict. An open Review reservation stays with that Host invocation;
batch re-entry waits for it rather than redispatching. When a batch child's
foreground terminal mutation reaches Kernel `done`, the same tool call stages
only that child's generated terminal audit evidence and re-enters the batch under
the still-valid authorization, opening no gate. The driver reconciles settlement,
adopts or creates the one scope-bound commit, then enrolls the next ready child
or settles the batch as `completed`; the result carries the batch report as
`batch`. A reserved Review, a parked child and a stopped child end where they do
today and are never committed automatically. If the re-entry fails, the Kernel
result is unchanged and `batch` carries one recovery action: call
`start_unattended_batch` with the same slug, which is also how to continue by
hand. A commit that fast-forwards the batch branch outside the runner is adopted,
not attributed to a child; any other HEAD movement still fails closed. Ordinary Executor handoff and below-limit
QA repair do not park the batch; genuine budget/authority stops remain fail-closed.

Batch execution never pushes a ref, opens or updates a pull request, resolves a
user decision, or creates, switches, or deletes a Git worktree. Its sole Git
effect is the batch branch `imm/<initiative-slug>` plus one scope-bounded commit
per completed child.

### Parallel Batch Opt-In

Lane mode is opt-in through the optional `max_parallel` parameter of
`start_unattended_batch`; absent it, everything above is the whole contract and the
run stays serial and byte-identical. `max_parallel` is a positive integer; the
Standalone Hosts expose the same optional `lane_offers` list, each entry naming a
`task_id` and an absolute `path` of an already existing Git worktree. The runner
admits an offered Lane only when it shares the coordinator repository, is not the
coordinator worktree, is on the branch `imm-lane/<initiative-slug>/<task-id>` at the
named base, is clean and has no active run; otherwise it refuses the offer with a
stable reason and writes nothing. A call that passes `lane_offers` without
`max_parallel` resumes the recorded lane batch with its recorded `max_parallel`;
without a recorded active lane batch it is refused before any gate opens. The runner still never creates, switches or
deletes a Git worktree: when a child needs a Lane the report carries a
`lane-steward` handoff and the Lane is provisioned outside the runner.

In a Lane the child is enrolled, assured and settled exactly as in a serial batch.
The runner then commits the settled delivery on the Lane branch and fast-forwards
the batch branch only to a candidate whose changed paths and per-path content equal
that commit; a mismatch or conflict moves nothing and parks the child.
With `max_parallel` above 1 the reconcile tick keeps up to that many Lanes in
flight and reports one `provision` or `executor` handoff per child in `handoffs[]`.
Only children whose scopes are provably disjoint run together; a child whose scope
overlaps an in-flight Lane waits until that Lane is integrated. Settled children
integrate serially, and a parked child ends only itself and its dependents while a
disjoint sibling keeps moving. A lost Lane parks as `batch_lane_lost`, and
`qa_failure_limit` counts each child separately. A resume with a different
`max_parallel` is refused with `batch_parallel_mismatch`. A Lane holds no batch
state and its Host session never re-enters the batch.

#### Lane Executor Supervision

The Parent launches and supervises every Lane's Executor Host; no other role
starts one. This is the one case in which the Parent starts another Loop
process, and it starts it only in an admitted Lane. For each `executor` handoff
whose Lane has no live session of its own, the Parent starts exactly one
**supervised session** and keeps its handle. Handoffs of one report start
together; a Lane never has two sessions.

A supervised session is defined by what it guarantees, not by a Host's name:

- It is a separate Host process whose working directory is the Lane, so its
  Kernel root is the Lane's own Authority Store. A subagent that runs inside the
  Parent's process shares the Parent's root and is never a Lane Executor.
- It starts non-interactively with an explicit `imm-run` entry for that
  `task_id`, and nothing else.
- Its exit returns control to the Parent without the Parent polling or sleeping.
- The Parent can stop it.

The Parent Host and the Executor Host are chosen independently. The Executor
Host is any allowlisted Host (`claude-code` or `pi`) that the `lane-steward`
reported available in that Lane; prefer the Parent's own Host type, and use the
other when only it is available. The child's QA and Review then run under that
Executor Host's own Assurance adapter in the Lane. How the Parent obtains a
supervised session depends on the Parent Host:

| Parent Host | Supervised session | Stop |
| --- | --- | --- |
| Claude Code | The Host's background command execution, running the Executor Host's non-interactive entry in the Lane; its completion notice re-invokes the Parent. The `Agent` tool does not qualify. | The Host's own stop for that background task |
| Pi | A background process facility from the Pi user's own configuration that notifies the Parent on exit. Pi ships none that Immune-Brain may assume. | That facility's own stop |
| Any Host without one | None. The Parent launches nothing. | — |

When the Parent Host offers no supervised session, or no allowlisted Executor
Host is available in the Lane, the Parent does not substitute a detached job, an
in-process subagent or serial in-place work. It reports each `executor` handoff
to the user with the Lane path, `task_id` and the `imm-run` entry to start
there, and calls `start_unattended_batch` again when the user says a Lane has
finished. Supervision is per Lane: Lanes that can be supervised are, and the
rest are reported.

Supervision is event-driven. Each session exit is the cue to call
`start_unattended_batch` again with the same Initiative, and that report is the
only progress signal: a child's state and `next_obligation` come from its Lane's
Kernel projection, never from the session's output or exit status. When the
report still carries an `executor` handoff for a child whose session has ended,
the Parent starts it once more; after a second end without Kernel progress, or
when the report shows the child waiting on a user decision or an open Review
reservation, it stops relaunching and reports that child to the user while its
siblings continue. The Parent stops a session only when the user asks, when the
report shows its child parked or settled, or before handing that Lane to a
`release`; stopping a session changes no Kernel or batch state, so the next
report states what remains. Handles are not authority: after an interruption
the Parent calls `start_unattended_batch` first and launches only for the
handoffs it returns.

After a child is integrated, its Lane is clean and its `.imm/audit/<task-id>/`
pair is reachable from the batch branch, the report carries a
`{ role: "lane-steward", action: "release" }` handoff for that Lane. A parked,
failed, dirty or unintegrated Lane, or one whose audit pair is not on the batch
branch, is never offered for release. The runner removes no worktree and deletes
no branch: it records the child `released` only when a later tick observes the
Lane path gone, and a Lane that is still present stays `integrated` while the
batch still completes. The `lane-steward` internal role handles both handoffs; it
follows the project's own instructions to prepare a Lane, starts no Host session,
and reports "cannot supply" rather than improvising.

## Decisions and Recovery

- Resume from authority facts, not prose. After an uncertain interruption, bind
the exact `task_id`, `run_id`, record revision, lifecycle, artifact state,
obligation, and claim from the Kernel projection before acting. A compaction
heading, a Handoff summary, an Issue state, or any other prose summary is not
authority and can be stale or wrong: when it conflicts with the projection,
correct the prose and resume the existing owner instead of trusting the summary.
- The workflow stages are distinct and never inferred from one another:
authored, validated, published, enrolled, assured, and completed each require
their own evidence. An open or closed Issue is not Enrollment or completion; a
published Issue is not Enrollment; a plan-only delivery is not execution
readiness.
- Consume a successful operation's fresh projection directly. Do not add a
status read after an operation that already returned the current projection, and
never repeat a mutation merely to re-observe its result. Kernel CAS and
freshness checks remain mandatory, and reducing Parent reads does not bypass
them.
- A falsely claimed later-Slice enrollment is a summary defect, not authority.
Retain the actual owner, and do not create or replay a mutation, gate, or
completion to match the prose. Summary production outside this repository is not
locally fixed; the consumer-side protection is these rules, and a producer bug
is recorded as a separate follow-up rather than resolved here.
- Scope expansion returns to Planner's Enrolled Intent Revision route. Planner
  prepares the complete proposed revision without replacing the active owner;
  the current Loop submits it through Kernel revision authority. Collect all
  currently known missing paths, caller/test/generated mirrors, and verification
  reasons in one request. Do not edit outside scope while waiting or widen it
  piecemeal without new evidence. Bounded test or PR repair stays inside the same
  TaskIntent.
- Effects are separate grants. A stage-only recovery restores staging and grants
  no commit, push, or publication; an existing exact approval, including a valid
  batch capability bounded to one child, stays usable without another chat gate.
  Before a new outbound research call, check the project's existing channel and
  data scope; a public article, a mock, or a local read-only database authorizes
  no new provider or data effect.
- Text instructions are contracts, not a hard bash sandbox. They guide and are
  reviewed; the Kernel authority gates remain the real boundary.
- Invoke `approve_breaking_intent_revision` with the complete next intent
  directly; the native Host gate is the single user decision. Do not overwrite
  enrolled intent sidecars or ask for chat pre-confirmation.
- On `awaiting_user`, invoke `request_authorization` directly for a concrete
  unresolved decision or rework authorization, not risk tier alone.
- When the user explicitly asks to stop an active task, invoke the Kernel stop
  operation through the invoking Host directly. Its single native confirmation
  authorizes existing Kernel stop settlement.
  Cancellation is not task termination. A busy invocation must finish or be
  cancelled through existing Host controls before requesting stop; never clear
  claims manually or use this operation to force-kill QA.
- Invoke `repair_authority_state` directly for a proven stale claim. Kernel
  revalidation removes only the redundant claim without user interaction.
- A Managed native authority failure stays fail-closed. Report its stable reason
  and exactly one same-Host recovery action. Never recommend another Host,
  worktree, Direct Path, unmanaged implementation, or automatic retry.
- After interruption, read a fresh projection and run only the pending obligation.
  `recovery` carries that task/run/record identity, affected acceptance/finding IDs
  and one legal `next_action`; it is an observation, never execution readiness.
  Own-claim technical rework goes to foreground Executor, not user authorization.
  `review_preparation_failed` keeps the batch running/enrolled: repair the Review
  evidence environment and resume `run_review`, retaining fresh QA without batch
  re-confirmation.
  Repair and verify the cause, then dispose each identified finding explicitly by
  `resolve_finding` or evidence-bound `refute_finding`. Local green cannot close
  findings or settle the task; obtain fresh Kernel QA and required Review.
  Environment preparation/resolution/integrity failure is not an assertion finding.
  Use its canonical descriptor reference/digest, phase/outcome, timing and byte
  counts to diagnose; QA diagnostic metadata is capped at 16 KiB and contains no
  stdout/stderr, argv, environment values or arbitrary executor error text.
  A frozen child with `run_qa` pending returns to Parent; batch re-entry does not
  blindly retry an unchanged failure. Fix the environment before a fresh attempt.
  Scope/authority exceptions still use their existing native gates. A committed
  QA result is honored; an interrupted precommit QA run produces no approval.
  Do not rerun fresh QA simply because Review was interrupted.
- Malformed or stale reviewer output is not a verdict. Keep the existing
  reservation only if the Host reports it valid; use its exact recovery action.
  Do not fabricate a pass or blindly redispatch Review.
- Missing tools, credentials, invalid projections, or repeated unchanged failures
  stop with a concrete cause. Cancellation performs no decision write and is not
  task termination. Explicit task stop uses its native authority gate.

## Review and Learning

Reviewers are read-only and bound to the frozen snapshot. They cannot edit files,
write planning artifacts, mutate Kernel state, or settle decisions. Report all
substantiated blockers in one round, tied to acceptance or a concrete regression;
separate optional advice from blockers. Suggestions alone do not justify rework.
Use the returned verdict schema exactly, including omission of unsupported fields.
A Review pass verdict's approval must carry `inspected_paths`: an array of
unique repository-relative path strings listing every path of the reviewed
change set, deleted paths included; an empty change set is listed as an empty
array. A path may be listed only after its diff was read. A pass that omits any
changed path, lists a path outside the change set, or duplicates a path is
rejected as a correctable invalid verdict.

`dispatch_role` for `qa`, `code-review`, or `ui-review` is used only when an
explicit runtime-supported role boundary requests it, followed by the returned
foreground Agent envelope exactly. It is not an extra gate on Kernel Assurance.
Pass the returned Agent envelope through unchanged. On the Claude Host an Agent
call always returns an asynchronous launch receipt, which is normal and never a
configuration fault; the Parent waits for the reviewer to finish before
`submit_review`. A dispatched reviewer is never continued or re-prompted,
including through SendMessage. The reserved prompt is dispatched verbatim. Any
edit to it forfeits the reservation: the Host binds a reviewer start only to a
byte-identical prompt, so appending context, truncating or rewriting the body
leaves the reservation unobserved and `submit_review` blocked. Dispatch the same
envelope unchanged. A blocked `submit_review` is recovered only through its
returned `recovery_action`.

Role dispatches follow the user's interaction language: include
`"interaction_language"` in the `dispatch_role` or routed role context with
the current reply language (the current explicit user instruction, else the
project `AGENTS.md` reply-language default, for example `"中文"` or
`"English"`), so role findings and summaries arrive in the user's language.
Machine contracts stay literal regardless. Omit the field to keep English
role output.

The internal Compounder is optional: only closed work with structured evidence
of a reusable Learning may route to it. Routine completion creates no Learning.
It cannot approve successors or delay terminal settlement. A projection with
`recommended_authority: user` must not dispatch successor work automatically.

The Host may attach an opted-in GitHub projection after settlement. Only a fresh claimless
`done`/`stopped` projection plus its exact terminal tombstone projects
`completed`/`not planned`; Enrollment performs no GitHub projection. Report a
tracker failure separately; never use it as evidence, a Loop blocker, or a reason to
repeat a Kernel mutation.

## Observable Output

Emit progress at execution start, QA/Review phase changes, failures, and terminal
stop. Every Agent round has one dispatch line and one result line; never claim a
successful collection on timeout, cancellation, malformed output, or stale identity.
Normal conversation and visible Tool calls are the observation surface. Do not
narrate routine projection reads or add Footer status content.

Every exit includes a concise summary:

```text
Task:
Completed work:
QA:
Review:
Stop reason:
Next action:
```

Every line reports authority evidence, not prose inference: name the exact
task/run identity and the observed lifecycle, artifact, obligation, and claim
facts that decided the exit. If a summary claimed more than the projection
proves — for example a later Slice as enrolled or the task as completed — report
the projection instead and correct the prose.

## Failure Output

For `settlement_unknown`, call `advance_assurance` once to reconcile the Kernel
projection before resuming; never replay the uncertain write directly. The runtime
retries only explicit `EINTR`/`EAGAIN` failures of its initial projection read, once,
with cancellation checks. Semantic authority errors and mutation failures are not
retryable reads. For `review_preparation_failed`, repair the reported transport or
environment cause before advancing; committed QA remains valid. For
`verdict_invalid`, correct the existing payload once and resubmit without another
reviewer dispatch. If correction fails, report the schema failure and stop the
correction loop.

For failures, name the cause, stages already committed, the safe retry boundary,
and exactly one next action. Distinguish user approval from environment repair
and runtime failure. Do not ask the user to manually switch internal roles.
