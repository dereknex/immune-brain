# Immune-Brain: Batch, Lane and Herdr Contract

Loaded by the `imm-run` Skill only on its batch, Lane or Herdr route. The main
Loop contract in [`imm-run.md`](imm-run.md) owns every other branch.

## Unattended Batch Opt-In

The privileged Host tool `start_unattended_batch` executes a confirmed Initiative.
An explicit `imm-run <Parent Issue>` selects that Parent's complete published plan:
resolve its `<!-- immune-brain:initiative-id=<slug> -->` marker and call the tool
with `initiative_slug`, directly opening native Batch Authorization. Parent
selection is the batch opt-in; it needs no separate chat question. An explicit
`imm-run <Slice/Child Issue>` executes only that TaskIntent after its entrypoint
verifies predecessor settlement and Git integration. Reading Parent context
grants no authority to start predecessors or siblings. A standalone task id uses
single-task Enrollment.

Every new batch uses runtime-created Lanes. Before confirmation, select capacity
from dependency readiness, scope conflicts, configured Lane capacity and available
supervised Executor capability. Omitting `max_parallel` defaults to 1, as does
explicitly passing 1; both run one Lane at a time. If no Executor can be supervised,
report the blocker rather than implementing in the coordinator checkout. The
confirmed batch records `final_verification` commands. See
[Parallel Batch Opt-In](#parallel-batch-opt-in).

The Initiative's carrier decides where the children are read from. When
`docs/initiatives/<initiative_slug>.md` exists, the Host reads that Local carrier
and performs no GitHub operation for the plan; otherwise it reads the GitHub
Parent Issue's native Sub-issues. A Local carrier yields one child per Slice:
each `## <slice-id>: <result>` section names exactly one Task under `Tasks:` and
may add one `Blocked by: <task-id>, <task-id>` line. A Slice that names no Task or
several, or a dependency outside the Initiative, refuses the plan before any
confirmation.

Invoking it authorizes only a user-confirmed batch of already-planned child
TaskIntents. The Host projects the batch plan from the Initiative's published
children, renders the ordered child list with each child's risk, final commands,
budget and plan digest through its native confirmation, and issues one Kernel
Batch Authorization for every enrollable Slice. A valid `critical` child is
enrolled like any other: it keeps its own TaskRecord, full Assurance, a per-child
bounded commit, and the runner never pushes. Children whose scopes overlap run in
Slice order: a later overlapping child starts only after the earlier one is done,
and when the earlier one parks, the later one is skipped with it. A Slice settled `done` with an unchanged TaskIntent
is delivered wherever its bytes live (any commit, the index or the working
tree); the runtime makes no commit for it and the user may commit however they
prefer. Independent branches keep progressing while one branch is blocked. The extension mints no capability and owns no
batch state transition: the shared `startBatch` driver in
`runtime/unattended/` owns every batch transition, and each child is still
enrolled, assured, and settled by the Kernel under an ordinary TaskRecord.

A `batch_lane_unreadable` observation means unknown state, not lost ownership or
completion. Read contract mismatches and escaped scope/flag details as causes,
not permission to widen scope. Revalidate the original task/run and use existing
fresh-authorization recovery before considering retirement. For provider or
Review interruptions follow [Decisions and Recovery](imm-run.md#decisions-and-recovery);
Herdr idle/done is only a session signal, never terminal Kernel proof.

A successful child Enrollment returns a `running` report with an `executor`
entry in `handoffs[]`; the child remains `enrolled` in its Lane. The Parent
supervises an Executor Host at the returned worktree path; that Executor implements
the TaskIntent, stages only its scoped changes, and runs focused diagnostics
before Kernel Assurance. Re-entering the batch before implementation returns the
same handoff without QA or another confirmation.
The runtime owns no model invocation and adds no persisted execution lifecycle.
Keep the Parent binding across child settlement, handoffs and status questions.
Continue filling dependency-ready, non-conflicting capacity; below-limit QA/Review
failures return to bounded repair in this Loop. Repeated failures use the existing
coordinator correction limits, retaining failure history and counters.

A new Parent-branch batch includes `final_report` when it finishes or parks:
approved acceptance ids against QA results, beyond-estimate files, declared and
projected risk, redo counts and parked reasons. Unknown evidence is `null`, not a
pass. `manual` leaves the coordinator and Parent branch unchanged. `auto` returns
the coordinator's existing branch by fast-forward only after final verification
passes on the Parent tip, with a clean working tree and ancestor HEAD. Otherwise
`return_to_coordinator` records the blocking reason and retains the Parent branch;
there is no reset, forced update, push or automatic retry on terminal replay.

A batch `completed` flag proves only the ordinary child driver finished. Parent
success requires all necessary Slices and separately enrolled repairs settled
`done` with current Intent evidence, and recorded final commands passing on the
current scoped content of those Slices. A user commit, amend, branch switch or
stash round trip with equal content keeps that pass; an in-scope edit after it
needs a rerun. The integration Slice
owns cross-Slice verification and repair scope before its settlement. On a later
final failure, restore a recoverable local environment and retry the recorded
commands; otherwise diagnose, author and validate the smallest repair TaskIntent
for the original goal, then open a fresh single-task native Enrollment without
chat pre-confirmation. Settled Slices retain their evidence. Track only an observed
repair run and rerun final verification once it settles. Parent
Issue closure waits for this whole-plan proof; a tracker failure reports the local
proof and one synchronization recovery action.

A delivered-only Parent starts no batch and makes no commit, but
its first run of caller-supplied final commands executes outside Host permission.
Before any command runs, the current Host opens its native confirmation listing
those exact commands; a decline, cancellation or missing gate leaves no command
effect. A Parent whose final commands are already recorded needs no gate. Recorded commands rerun under that earlier
confirmation, and changed commands need a fresh explicit Parent entry.

After diagnostics pass, the Lane Executor advances Kernel QA and dispatches any
reserved foreground Review once using the exact returned `agent_params`, then
submits its structured verdict. An open Review reservation stays with that Host
invocation. A Lane settlement changes only its local Kernel state and does not
re-enter the coordinator. The Parent observes settlement, then calls
`start_unattended_batch` with the same slug under the still-valid authorization.
The driver commits the child's scoped delivery and terminal audit evidence,
integrates it onto the Parent ref, and enrolls the next ready child or completes
the batch. A reserved Review, parked child or stopped child is never integrated
automatically. Your own commits, amends and branch switches never move the batch;
a progress ref rewritten outside the runner fails closed. Ordinary Executor handoff
and below-limit QA repair do not park the batch; genuine budget/authority stops
remain fail-closed.

Batch execution never pushes a ref, opens or updates a pull request, or resolves a
user decision. New Lane batches keep progress on `refs/heads/imm/<slug>`, created
at `base_head` and never checked out by the runtime. A different existing tip
refuses with `batch_parent_branch_exists` before creating refs, worktrees or a
batch record. The coordinator's HEAD, branch, index and working tree stay
untouched. Existing hidden-ref and legacy branch records retain their recorded
behavior. A v1 serial record remains readable by status and explicitly retireable
through `retire_stale_batch`, but any resume refuses with
`batch_record_shape_retired` and that retirement recovery action. There is no
serial runner or plan reconfirmation path. A native Parent writes no Git effect.

### Parallel Batch Opt-In

Every new `start_unattended_batch` call uses Lane mode. The optional positive
integer `max_parallel` is selected before native confirmation; omitted or 1
means one Lane at a time and records a v2 Lane batch with `max_parallel: 1`. The
runtime creates each new batch's Lane under the Git common directory at
`imm/worktrees/<slug>/<task_id>`, on `imm-lane/<slug>/<task_id>` at the current
Parent tip. The report returns its absolute path in an `executor` handoff;
there is no provision handoff for a new batch. `lane_offers`, including an empty
list, refuses with `lane_offers_retired` for a new or Parent-branch batch.
Resume a Parent-branch batch with its slug and no offers; its recorded parallelism
is retained when `max_parallel` is omitted.

Only existing hidden-ref and legacy branch records still accept `lane_offers`
and use `lane-steward` provision/release handoffs. Each offer names `task_id` and
an absolute worktree path; admission requires the same repository, a separate
clean worktree on the expected Lane branch and base, and no active run. These
legacy instructions retire when the old records drain (runtime owner).

In each Lane the child has its own Enrollment, full Assurance and settlement.
The runner then commits the settled delivery on the Lane branch and fast-forwards
the recorded progress ref only to a candidate whose changed paths and per-path content equal
that commit; a mismatch or conflict moves nothing and parks the child. New
Parent-branch batches do not copy the integrated delta into the coordinator
checkout. After integration, the runtime removes a clean, unoccupied Lane and
its branch; a dirty Lane is kept and reported. Final verification runs in a
detached worktree at the Parent tip and removes that worktree afterwards; a
failure is reported without moving the Parent ref.
With `max_parallel` above 1 the reconcile tick keeps up to that many Lanes in
flight and reports one `executor` handoff per running child in `handoffs[]`
(`provision` remains only for legacy records).
Only children whose scopes are provably disjoint run together; a child whose scope
overlaps an in-flight Lane waits until that Lane is integrated. Settled children
integrate serially, and a parked child ends only itself and its dependents while a
disjoint sibling keeps moving. A lost Lane parks as `batch_lane_lost`, and
`qa_failure_limit` counts each child separately. A completed settlement inside a
Lane changes Kernel state only and writes nothing to the tracker: the coordinator
closes the child's Issue after it integrates that child's commit, exactly once,
and reports the attempt in `tracker_observations`. A parked or lost child is
never integrated, so its Issue stays open; an explicit stop inside a Lane still
projects `not planned` at once.

Frozen acceptance remains the authority subject (ADR 0026). A Lane child whose
acceptance changes pauses for the literal user's native gate; the coordinator
cannot approve revisions or reseal `plan_digest` (ADR 0028). There is no
`lane_revision` input or delegation checkbox. Existing v2 records containing
`revision_delegation`, `delegated_revisions` or `reseals` remain readable and
retireable as historical evidence; those fields grant no current authority.
`scope_hint` is an estimate: disclose changed paths beyond it as `beyond_estimate`
instead of revising scope. A scope-only revision keeping the bound Spec path is
compatible; a changed authority subject parks the child rather than resealing
the batch.
On either Host, status queried with the Parent slug as `task_id` reports the
persisted batch in `batch.record`, including v1 identity, state and child
progress, even without an enrolled Parent TaskRecord. This evidence-only read
never grants execution authority; retired records remain visible.

The v2 record also fixes the complete confirmed Parent topology in
`topology_digest`, including excluded prerequisites. Confirmation drift and
resume compare that identity before Lane admission; changed topology, or an
older record without that evidence, refuses as `plan_changed` rather than
reconstructing authorization from the current carrier.

Before a new lane batch provisions any Lane, the runner compares the Kernel
contract identifiers (TaskRecord, tombstone, projection, store schema) of the
coordinator's runtime with those of the runtime a Lane Executor loads — never the
plugin version number — and refuses with `batch_runtime_contract_mismatch`,
naming both sources, when they differ; a match adds no confirmation. A Lane whose
state exists but whose contract the coordinator refuses to read parks as
`batch_lane_contract_mismatch` with the original parse error, distinct from a
missing Lane's `batch_lane_lost`.

Inside a Lane, the Pi extension and the Claude Code `PreToolUse` hook refuse an
`edit`/`write` (Claude: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`) whose
resolved target lies outside the Lane, naming the Lane path. A shell command is
not intercepted; this is no bash sandbox. Parent-branch batches never restore
coordinator edits. Only when a legacy lane batch is re-entered with a
dirty coordinator checkout, each dirty path is restored to HEAD only if every one
of them is an unstaged modification or untracked file that a Lane of this batch
changed (its bytes differ from that Lane's base) and whose bytes equal the Lane's,
in its worktree or a Lane-branch commit. The read-only preflight only attributes;
the runner restores after the batch is authorized. The bytes are
backed up first under `.imm/state/batches/restores/`, and the backup is recorded
in the batch record and report as `restores`. If any change has another origin,
or is staged or deleted, no file is touched and the refusal names it; never
stage such changes to get past the refusal. A resume with any different explicit
`max_parallel` is refused with `batch_parallel_mismatch`. A Lane holds no batch
state and its Host session never re-enters the batch.

#### Lane Preferences

A repository can keep standing lane-mode choices next to its other Immune-Brain
preferences. Before the first `start_unattended_batch` call for an Initiative,
the Parent resolves each of the four directives below in this order, reading the
source directly rather than assuming the Host injected it into context:

1. a literal user instruction for the current request;
2. the directive in the repository root agent instruction file, whichever this
   repository tracks: `AGENTS.md` or `CLAUDE.md`;
3. the same directive in the Host's user-level agent instruction file; or
4. the behavior without a directive, given in the table.

| Directive | Value | Effect | Without it |
| --- | --- | --- | --- |
| `Lane max parallel: <n>` | positive integer | The Parent passes it as `max_parallel` when it starts a batch. The native confirmation shows the Lane capacity. | No `max_parallel`: one Lane at a time |
| `Lane Executor Host: <host>` | `claude-code` or `pi` | Every Lane's Executor Host is that Host. When the `lane-steward` did not report it available in a Lane, that Lane has no Executor Host; the Parent does not fall back to the other one. | The Parent's own Host type, else the other allowlisted Host |
| `Lane Executor model: <model>` | a model identifier of the configured Executor Host | Passed to the Executor Host as `--model <model>` | The Executor Host's own default |
| `Lane Executor effort: <level>` | a level the configured Executor Host accepts | Passed as `--effort <level>` to `claude-code` and as `--thinking <level>` to `pi` | The Executor Host's own default |
| `Batch final verification: <command>; <command>` | plain commands without shell syntax or quoting, at most 8 | Passed as `final_verification` when a new lane batch starts and shown in its native confirmation; the runner runs them on the batch branch once every child is integrated and writes each command's exit status and timing into the completion report as `final_verification`. A failing command reports the batch as not passed; integrated commits are never rolled back | The commands the repository instruction file names for its full test suite and type check, else none and the completion report says nothing was run |

A model identifier and an effort level mean something only to one Host, so
`Lane Executor model` and `Lane Executor effort` apply only together with
`Lane Executor Host` from the same or a higher source; without it they are
reported and not applied. A repository directive overrides the user-level one.
Report an invalid value and ask instead of guessing or clamping. After resolving
them, display one non-blocking line with each selected value and its source. On
a resume the recorded `max_parallel` stands and the directive is not passed
again. The directives configure how the Parent starts sessions; the runner reads
none of them, and they grant no permission or trust option.

A repository that names its full test and type-check commands in prose (for
example "uses `bun test`; type checking is `bun run typecheck`") supplies them as
the final verification without a directive; the Parent never invents a command
the repository does not name.

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
- It is given one explicit `imm-run` entry for that `task_id`, and nothing else.
- When it stops working — it exits, or it settles waiting for input — control
  returns to the Parent without the Parent polling or sleeping.
- The Parent can stop it.

The Parent Host and the Executor Host are chosen independently. The Executor
Host is any allowlisted Host (`claude-code` or `pi`) that the `lane-steward`
reported available in that Lane. A `Lane Executor Host` directive under
[Lane Preferences](#lane-preferences) decides it; without one, prefer the
Parent's own Host type, and use the other when only it is available. The child's QA and Review then run under that
Executor Host's own Assurance adapter in the Lane. The Executor Host loads the
same Immune-Brain plugin or package the Parent runs: a Parent started from a
local plugin directory passes that same directory to the Executor Host. The
Parent adds no permission or trust option of its own; the Executor Host runs
under the user's own settings, with the model and effort of its own defaults
unless Lane Preferences name them. How the Parent obtains a supervised session
depends on where the Parent runs; the first matching row applies, and the user
is not asked to choose:

| Parent Host | Supervised session | Stop |
| --- | --- | --- |
| Either Host, inside Herdr (`HERDR_ENV=1`) | One Herdr tab per Lane holding an interactive Executor Host, under [Herdr Lane Tabs](#herdr-lane-tabs) | Close the tab the Parent created |
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

##### Herdr Lane Tabs

Inside Herdr the Parent drives the `herdr` CLI itself; the runtime and the
`lane-steward` never do. Each Lane gets a tab of its own, so its Executor Host
has a full-size terminal the user can read. For each `executor` handoff without
a live tab:

1. Take the Lane from the handoff's `lane_path`. Pick the Executor Host as above;
   `claude-code` is Herdr kind `claude` and `pi` is kind `pi`.
2. Create the tab without taking focus, in the Parent's own workspace and rooted
   in the Lane:
   `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd <lane_path> --label <name> --no-focus`.
   Without `--workspace` the tab lands in whichever workspace has focus. `<name>`
   is a label of at most 32 characters such as the Slice ID; a `task_id` is
   usually too long. Read `tab.tab_id` and `root_pane.pane_id` from the JSON
   result and keep `task_id → tab_id, pane_id`: the pane ID addresses the
   session, the tab ID closes it.
3. Start the Host in that tab's root pane:
   `herdr agent start <name> --kind <kind> --pane <pane_id> -- <host arguments>`.
   Host arguments are only those that load the Parent's plugin and those that
   [Lane Preferences](#lane-preferences) resolved for model and effort.
4. Submit the entry and nothing else (later text follows only the instruction
   rule below), and confirm the turn began:
   `herdr agent prompt <pane_id> "<imm-run entry> <task_id>" --wait --until working --until blocked --timeout 30000`.
   The entry is the Executor Host's own `imm-run` invocation as that Host names
   it: a Claude Code Host that loaded the plugin from a directory names it
   `/immune-brain:imm-run`.
5. Supervise with `herdr agent wait <pane_id>` as a Host background command, so
   its return re-invokes the Parent. Start it only after step 4 reported
   `working`: a wait attached to a still-`idle` session returns at once. Do not
   loop on `herdr agent get` or read the pane to judge progress.

`agent_not_ready` from step 3, or a `blocked` state at any time, means the tab
shows a dialog only the user may answer: workspace trust, sign-in, a permission
request, a question, or a native confirmation such as an Intent revision gate.
The Parent sends that tab no keys and no prompt, and never answers such a dialog
for the user. As soon as the wait returns `blocked` it tells the user which tab
and `task_id` is waiting and what the dialog asks, without waiting to be asked,
leaves the tab open, and continues the other Lanes; once the user has answered, step 3's tab is resumed
from step 4 if the entry was never submitted, otherwise from step 5. `idle` or
`done` is a session end for the rules below, although the tab stays open: the
Parent calls `start_unattended_batch`, and a relaunch submits the entry again in
the same tab instead of creating another. When that report shows the child
neither settled nor waiting on a user decision, the Parent tells the user which
tab and `task_id` went idle and what the Kernel projection still requires.

The Parent may send one text instruction to a Lane session, and only while it is
`idle` and its child is still running in the Lane: a correction to the
Executor's approach, never an answer to a dialog. It first calls
`start_unattended_batch` with `lane_instruction` (`task_id`, `text`, `kind`
`instruction` or `correction`, and the `session_state` it just observed with
`herdr agent get`). The runner records the text in the batch record and report
as `interventions` and answers `lane_instruction.accepted`; only when accepted
does the Parent submit it with `herdr agent prompt <pane_id> "<text>" --wait
--until working --until blocked --timeout 30000` and re-arm step 5. A `blocked`
or `working` session is refused and receives nothing. Every instruction the
coordinator sent is therefore in the report, so Executor-initiated behavior and
coordinator intervention can be told apart afterwards. This never applies to a
Review agent: a dispatched reviewer is still never continued or re-prompted.

When a Lane child exhausts its rework budget (the per-child `qa_failure_limit`)
it does not park for the user at once: the report carries a
`{ role: "coordinator", action: "correct" }` handoff and the runner makes no
further attempt for that child. The Parent reads the findings of every round
from that Lane's Kernel state, decides whether they point at one root cause, and
writes one design-level correction — the invariant to hold and the shared seam to
fix — never a patch of its own. It starts a new Executor session in the Lane
(the old context is not reused; the new session resumes from the Kernel
projection and the Lane workspace alone) and sends the correction as
`lane_instruction` kind `correction`; the runner counts it. At most two
corrections are spent per child: the third exhaustion parks the child as
`batch_correction_limit_reached`, its dependents are skipped, siblings that do not
depend on it keep executing and integrating, and the batch reports it at the end.
Single tasks outside a batch keep their existing budget behavior, and Review
independence is unchanged. A Review rework budget that the Kernel turns into a
`replan_required` decision still needs the user's own native decision.

Every live Lane session keeps exactly one `herdr agent wait` armed, so `blocked`
and idle-without-settlement wake the Parent on their own; a Parent that has
nothing else to do still ends its turn with those waits armed. A failed or timed-out `herdr` command
proves nothing about delivery; inspect the session's state before repeating it.

The Parent only creates: it closes no tab, including the tabs it created, and
every tab stays open for the user to read and close. It splits no pane and
creates no workspace. Outside Herdr the Parent never invokes `herdr`.

Supervision is event-driven. Each session end is the cue to call
`start_unattended_batch` again with the same Initiative, and that report is the
only progress signal: a child's state and `next_obligation` come from its Lane's
Kernel projection, never from the session's output or exit status. When the
report still carries an `executor` handoff for a child whose session has ended,
the Parent starts it once more; after a second end without Kernel progress, or
when the report shows the child waiting on a user decision or an open Review
reservation, it stops relaunching and reports that child to the user while its
siblings continue. The Parent stops no session: when the report shows a child
parked or settled while its session is still working, the Parent tells the user
which tab and `task_id` to close. A session that stays open changes no Kernel
or batch state, so the next report states what remains. Handles are not
authority: after an interruption
the Parent calls `start_unattended_batch` first and launches only for the
handoffs it returns.

After a child is integrated, its Lane is clean and its `.imm/audit/<task-id>/`
pair is reachable from the batch branch, the report carries a
`{ role: "lane-steward", action: "release" }` handoff for that Lane. A parked,
failed, dirty or unintegrated Lane, or one whose audit pair is not on the batch
branch, is never offered for release. The runner removes no worktree and deletes
no branch: it records the child `released` only when a later tick observes the
Lane path gone, and a Lane that is still present stays `integrated` while the
batch still completes. The `lane-steward` internal role handles a `provision`
handoff; it follows the project's own instructions to prepare a Lane, starts no
Host session, and reports "cannot supply" rather than improvising. A `release`
handoff is the user's to carry out: the Parent removes no Lane and dispatches no
one to remove it. It reports each such Lane once, with its `task_id`, Lane path
and tab, as ready for the user to close and remove.
