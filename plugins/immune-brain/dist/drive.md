---
name: drive
description: Use when the user explicitly requests execution or resumption of an Immune-Brain task.
---

# Immune-Brain: Drive

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Kernel Canary Routing and Authority

Only explicit `drive` entry starts or resumes this loop. Ordinary host input
stays host-native; it never creates an execution binding. An already-bound run
keeps its binding across status questions and in-scope clarification. Explicit
cancel, planning entry or session replacement releases response continuation;
Kernel ownership changes only through its own operations. While a
non-terminal TaskRecord holds the workspace, both Hosts add a read-only notice
to ordinary input (Pi `before_agent_start`, Claude Code `UserPromptSubmit`)
naming the task, its next obligation and its scope: before committing or
modifying files inside that scope, read `status` and tell the user the task is
active and what it waits for. The notice resumes nothing. Read the current
Host's `status` projection first and verify the exact active backend claim,
TaskIntent, and TaskRecord. Invalid or contradictory projections fail closed. A
candidate TaskIntent is not Enrollment authority. For a Parent Issue, route to
[Unattended Batch Opt-In](drive-batch.md#unattended-batch-opt-in) after this authority
read. A Child entry verifies prerequisite settlement and integration before its
single-task native gate; it starts no other Slice.

Enrollment is the first step of a single-task explicit `drive` entry and belongs to no
other Skill. When the entry finds no active claim, resolve the validated
candidate the user named (or the Planner's recommended first Task when the entry
names none and exactly one candidate fits), then invoke the current Host's
native Enrollment gate once, without chat pre-confirmation, and continue from
the returned projection. Planner and Brainstorm never open that gate; a
confirmation given to either is not this entry. A gate failure preserves the
candidate and reports its stable reason plus exactly one same-Host recovery
action; never recommend another Host, worktree, Direct Path, unmanaged
implementation, or automatic retry.

A single task starts from a clean workspace (Spec branch-boundary-r2 D23).
Apart from its own TaskIntent and bound Spec, any tracked or untracked
non-ignored dirty path refuses with `workspace_not_clean: <paths>` before the
gate opens; commit, stash or remove that work, then enroll again. The task's
diff, attribution and changed paths are taken from its Enrollment HEAD, and
files beyond `scope_hint` are disclosed in Review evidence, not refused. A batch
child keeps its Lane's confirmed scope disclosure.

`status` is a read, not a freeze. It stays readable while the scope holds
unstaged or untracked paths and returns them as a `warnings` entry beside the
projection. Freezing a snapshot still refuses those paths, and an in-scope path
carrying a skip-worktree or assume-unchanged index flag still refuses both.

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
or never ran is not a completed batch, and a later `drive` entry does not
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
[Lane Executor Supervision](drive-batch.md#lane-executor-supervision).
The standalone `fix-pr`, `prune-docs`, `slim`, and `prune-tests`
are host-native maintenance entries, never dispatched as the Loop role. Internal
`test-fixer` and `pr-fix` repairs remain bounded by the enrolled TaskIntent.

## Execution Loop

Continue while the current projection has a valid action. Pi's response boundary
and Claude's Stop Hook re-read facts for the active session binding. A valid action
returns to this Loop; waiting Review/Executor invocations keep their existing call
identity. Submit a returned verdict before editing; use projected recovery after
a rejected submission. Only changed task/delivery facts or scoped source bytes
reset substantive progress. Three unchanged observations stop with one recovery
action; status, formatting and repeated failed commands do not reset the count.
Host native-gate failures pause with same-Host recovery and never auto-retry.
A single Slice ends at its own terminal proof; a Parent uses whole-plan completion
from the [batch contract](drive-batch.md#unattended-batch-opt-in).

1. For active artifacts, implement the enrolled acceptance in the current
   conversation. On a fresh enrollment, `submit_assurance` means implement first,
   not call `advance_assurance` immediately: implement, run focused checks, stage,
   then advance. `implementation_pending` names this no-changed-path case. Lane
   plugin skew (`loaded_plugin_differs_from_workspace`) is expected and
   non-blocking in a Lane; continue with the loaded build without a reload.
   `scope_hint` is an estimate; disclose changed files beyond it
   as `beyond_estimate` in Review evidence instead of revising scope. Preserve
   frozen acceptance and the bound Spec, and respect hard no-touch paths. Run focused
   checks. Before `advance_assurance`, inspect ownership and stage only the exact
   task-owned paths needed for delivery. Do not hand routine task-owned staging
   to the user. If a file mixes pre-existing user changes with task changes and
   the task-owned hunks cannot be isolated reliably, stop with that ownership
   conflict instead of staging the whole file. Staging grants no commit or push
   authority. The runtime satisfies an Enrollment precondition itself, staging
   or, under `Git integration: auto`, committing its set; never commit those
   paths by hand and never ask the user to. Complete the [Executor Delivery Evidence](role-prompts/executor.md#delivery-evidence)
   table for rework only; a first delivery needs no table.
   Executor checks are diagnostic evidence, not a QA or Review approval.
2. Call `advance_assurance` in the foreground and consume its direct terminal
   result. The Kernel freezes the artifacts itself before QA: it binds Git
   content identity in place without relocating source paths. A simple task has
   TaskIntent only; a complex task may bind one active Spec. Deterministic QA
   runs all descriptors in the task's working directory. Before the first
   command and after every command, the tracked content inside the task's scope
   must equal the frozen snapshot; a difference fails as
   `protected_input_or_output_drift`. Content outside the scope, and untracked
   or ignored files, are the user's environment and are not compared. Do not
   dispatch a separate per-Step QA Agent.
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
   When two fixes that share one premise fail the same gate, write the premise
   in one sentence, name the actors that hold it, and remove the assignment
   embodying it. Do not start another fix until that is done.
   A finding whose defect lies inside the TaskIntent goal and acceptance is
   ordinary rework even when no acceptance names its exact case: fix the code,
   add the test that pins the case, and dispose the finding. It is never a
   reason to revise the Intent. Acceptance text states principles; enumeration
   of specific inputs belongs in tests, so never append a single input case to
   an acceptance assertion in order to close a finding.
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

## Decisions and Recovery

A snapshot exhausted by two `incomplete` Reviews must not be redispatched automatically. When Kernel exposes `authorization.state: authorize_review_retry`, call `request_authorization` directly: the Host confirms exactly one extra attempt, bound to the current run, record, intent, diff and loaded Review contract. Preserve all history, QA evidence and frozen artifacts. A known previous contract must differ; legacy history without a contract hash requires an explicit “previous contract unknown; change cannot be verified” notice in the native gate. This legacy reader is drain-only (owner: runtime; remove when hash-less active tasks have drained). A grant cannot be repeated for the same snapshot, reused after content/intent changes, or treated as a Review approval. If the grant is exhausted or unavailable, stop and report the remaining constraint; do not clear counters or manufacture a TaskIntent change.

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
- `scope_hint` is an estimate (ADR 0028). Deliver files needed for the accepted
  outcome and disclose paths beyond it as `beyond_estimate`; a missing caller,
  test or generated mirror does not require a scope revision. Hard no-touch
  paths remain prohibited. Any scope-only revision that keeps the bound Spec
  path is `compatible` through `revise_intent`, including additions, removals,
  directories and globs; it has no same-directory exception or `scope_added:`
  history. A change of goal, bound Spec design or decomposition returns to
  Planner's Enrolled Intent Revision route: Planner prepares the complete
  proposed revision without replacing the active owner, and the current Loop
  submits it through Kernel revision authority. Bounded test or PR repair stays
  inside the same TaskIntent.
- Revision ownership: the Loop owner prepares a scope or acceptance revision in
  the executing session. Planner's route is for a change of goal, bound Spec
  design, or decomposition, and returns any other proposal to the executing
  session. No Host refuses a file edit because of the session's entry.
- Run entry decision hosting (ADR 0025). The literal-user `drive` entry needs
  no chat confirmation; Enrollment and unattended batch start each keep one native
  gate, and the entry token spares only retirement and same-Host recovery.
  Within one entry, only a side-effect-free rejection is retried, at most twice,
  and preflight is rerun before each retry; judge retryability from the
  rejection text and `recovery_action`. `plan_changed`, `head_moved` and a claim
  conflict are never retried. The third native-operation failure under one entry
  pauses the run and ends its token; only a new literal entry resumes. When
  preflight names a deterministic fix (for example a `.gitignore` that ignores
  `.imm/audit/`), apply it, commit the fixed files alone in one commit even under
  `Git integration: manual`, list that commit in the manifest, then retry. Push,
  PR, credentials, breaking intent revision and rework exits still stop for the
  user.
- Effects are separate grants. A stage-only recovery restores staging and grants
  no commit, push, or publication; an existing exact approval, including a valid
  batch capability bounded to one child, stays usable without another chat gate.
  Before a new outbound research call, check the project's existing channel and
  data scope; a public article, a mock, or a local read-only database authorizes
  no new provider or data effect.
- Text instructions are contracts, not a hard bash sandbox. They guide and are
  reviewed; the Kernel authority gates remain the real boundary.
- Frozen acceptance remains the authority subject (ADR 0026). In a Lane,
  acceptance changes pause the child for the literal user's native gate;
  the coordinator cannot approve them or reseal the batch. Existing records
  with delegation fields remain readable and retireable (ADR 0028).
- Invoke `approve_breaking_intent_revision` with the complete next intent
  directly; the native Host gate is the single user decision. Do not overwrite
  enrolled intent sidecars or ask for chat pre-confirmation. A breaking revision
  is used when the authority subject changes, including acceptance or a bound
  Spec change; scope-only changes keeping the bound Spec path are compatible.
  A defect inside the existing goal and acceptance is rework under the
  Execution Loop, not a revision, and the acceptance length limit is never
  worked around by shortening words: when an assertion grows toward it, the
  assertion is enumerating cases that belong in tests.
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
  The stage decides what else a failed result carries. A `prepare` stage ending
  in timeout, nonzero exit or output limit adds `prepare_observation` to the
  direct Tool result only: the execution conditions (the task's working
  directory), the declared timeout, and at most 2048 bytes of
  the end of stderr with control characters other than newline and tab removed. It is never persisted. A failing `check`
  stage returns no output text at all. A `protected_input_or_output_drift`
  failure adds `prepare_observation.drift_paths`, at most 64 in-scope paths that
  differ from the frozen snapshot, to the direct Tool result only; restore or
  stage those paths before a fresh attempt. The Lane batch integration recheck
  is the one run that still uses an isolated copy with no worktree
  `node_modules`, because its merge candidate is never checked out. The copy is
  created beside the Lanes, so it resolves the same ancestor dependencies, such
  as the repository's installed `node_modules` and its `.bin`, that the Lane
  resolved; a reproduction in the live worktree is still not equivalent to that
  run. A redo that recreates a Lane first pins its unintegrated commit at
  `refs/imm/retained/<slug>/<task_id>/<commit>`.
  A frozen child with `run_qa` pending returns to Parent; batch re-entry does not
  blindly retry an unchanged failure. Fix the environment before a fresh attempt.
  Scope/authority exceptions still use their existing native gates. A committed
  QA result is honored; an interrupted precommit QA run produces no approval.
  Do not rerun fresh QA simply because Review was interrupted.
- Provider quota or interruption is not Review budget exhaustion. Preserve
  fresh QA and follow the Host's exact `recovery_action`; an unchanged envelope
  returned by `advance_assurance` alone does not authorize redispatch of an
  already-dispatched reservation. Malformed or stale reviewer output is not a
  verdict. Keep a reservation only if the Host reports it valid; obtain a new
  one only through its supported recovery. If the returned action cannot clear
  the observed fault, report that concrete Host blocker rather than loop.
- Missing tools, credentials, invalid projections, or repeated unchanged failures
  stop with a concrete cause. Cancellation performs no decision write and is not
  task termination. Explicit task stop uses its native authority gate.

## Review and Learning

Reviewers are read-only and bound to the frozen snapshot. They cannot edit files,
write planning artifacts, mutate Kernel state, or settle decisions. Report all
substantiated blockers in one round, tied to acceptance or a concrete regression;
separate optional advice from blockers. Suggestions alone do not justify rework.
Inspect archived pass advice in `attestations[].advisory_findings`, not only
record-level `findings`. Cite its record/attestation before claiming it is
archived; session-only notes are not durable evidence. Reuse this storage rather
than creating another advisory archive.
Use the returned verdict schema exactly, including omission of unsupported fields.
A Review pass verdict's approval must carry `inspected_paths`: an array of
unique repository-relative path strings listing every path of the reviewed
change set, deleted paths included; an empty change set is listed as an empty
array. A path may be listed only after its diff was read, or the
[code-review role's generated snapshot proof](role-prompts/code-review.md#generated-snapshot-proof)
was completed for an eligible added Drizzle snapshot. A pass that omits any
changed path, lists a path outside the change set, or duplicates a path is
rejected as a correctable invalid verdict.

`dispatch_role` for `qa`, `code-review`, or `ui-review` is used only when an
explicit runtime-supported role boundary requests it, followed by the returned
foreground Agent envelope exactly. It is not an extra gate on Kernel Assurance.
Pass the returned Agent envelope through unchanged. On the Claude Host an Agent
call always returns an asynchronous launch receipt, which is normal and never a
configuration fault; the Parent waits for the reviewer to finish before
`submit_review`. A dispatched reviewer is never continued or re-prompted,
including through SendMessage. The reserved prompt is dispatched verbatim as a four-line handle:
operation marker, `Review packet: <absolute path>`, `Packet sha256: <hex>`, and
the fixed digest-verification instruction. The runtime writes
`review-packet-<operation>.md` beside the evidence manifest; the reviewer verifies
its digest before following its instructions and replies exactly
`review packet digest mismatch` on a difference. Pi packets contain the full
Review prompt including semantic-neighborhood rules; Claude packets contain only
snapshot facts because the reviewer definition supplies static rules. Releasing
the reservation removes the packet with its evidence directory; the manifest
bytes remain unchanged. A marker-targeted dispatch with a
non-matching reviewer type or Pi Agent parameters is blocked at dispatch before
binding a reviewer; prompt acceptance remains byte-identical. On `submit_review`,
an unbound reservation is released with recovery to `advance_assurance`; a bound
reviewer whose result is pending retains its reservation. Dispatch the same
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
the projection instead and correct the prose. When the bound Spec lists `manual`
scenarios owned by the settled Task's Slice, add one line naming those scenario
IDs as pending manual walkthrough; the line is informational and changes no
stop reason, obligation, or completion fact, and is absent when that Slice owns
no manual scenario.

Append a history digest to the exit summary: the TaskRecord `history[]`
action-and-reason entries, condensed, so the completed work is traceable to the
recorded actions that produced it.

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
