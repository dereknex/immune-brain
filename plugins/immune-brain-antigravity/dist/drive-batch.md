# Immune-Brain: Batch, Lane and Herdr Contract

Loaded by the `drive` Skill only on its batch, Lane or Herdr route. The main
Loop contract in [`drive.md`](drive.md) owns every other branch.

## Unattended Batch Opt-In

The privileged Host tool `start_unattended_batch` executes a confirmed Initiative.
An explicit `drive <Parent Issue>` selects that Parent's complete published plan:
resolve its `<!-- immune-brain:initiative-id=<slug> -->` marker and call the tool
with `initiative_slug`, directly opening native Batch Authorization. Parent
selection is the batch opt-in; it needs no separate chat question. An explicit
`drive <Slice/Child Issue>` executes only that TaskIntent after its entrypoint
verifies predecessor settlement and Git integration. Reading Parent context
grants no authority to start predecessors or siblings. A standalone task id, and
every Child entry, uses the [Single-Task Lane](#single-task-lane).

Every new batch uses runtime-created Lanes. Fixed Parent/Lane names do not prove
ownership: a same-tip Parent can be reused only with a validated matching batch
record at its recorded delivery tip. A settled record proves resource provenance,
not authorization for new work. Existing unbound Lane paths or branches are
collisions, even when clean and at the requested base. Creation is exclusive,
and the runtime records the Lane's path, branch and base in the batch record
before creating anything; a later tick completes or adopts only resources that
still match that reservation (the reserved branch at the reserved base, checked
out in the reserved worktree) and refuses anything else. An unreserved orphan
is retained and never adopted. After binding, resume revalidates the recorded
Lane path, branch and Git lineage instead of treating its location as proof of
ownership.
No collision authorizes deletion, overwriting, renaming or resetting user resources.

Before confirmation, select capacity
from dependency readiness, scope conflicts, configured Lane capacity and available
supervised Executor capability. Omitting `max_parallel` defaults to 1, as does
explicitly passing 1; both run one Lane at a time. If no Executor can be supervised,
report the blocker rather than implementing in the coordinator checkout. The
new batch must supply a non-empty `final_verification` list (normally `bun test`
and `bun run typecheck` for this repository), or the Host refuses it with
`final_verification_required` before authorization or batch creation. Resuming an
existing batch may omit the field and keeps its recorded commands. The confirmed
batch records these commands; a legacy run without commands or derived checks
reports `final verification not run` at completion. See
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
Review interruptions follow [Decisions and Recovery](drive.md#decisions-and-recovery);
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
for the original goal, then start it through the [Single-Task Lane](#single-task-lane)
with its own `task_id` and native gate, without chat pre-confirmation. Settled Slices retain their evidence. Track only an observed
repair run and rerun final verification once it settles. Parent
Issue closure waits for this whole-plan proof; a tracker failure reports the local
proof and one synchronization recovery action.

A delivered-only Parent starts no batch and makes no commit, but
its first run of caller-supplied final commands executes outside Host permission.
Before any command runs, the current Host opens its native confirmation listing
those exact commands; a decline, cancellation or missing gate leaves no command
effect. A Parent whose final commands are already recorded needs no gate. Recorded commands rerun under that earlier
confirmation, and changed commands need a fresh explicit Parent entry.

After diagnostics pass, the Lane Executor advances Kernel QA and runs any
returned `review_command` once in the Lane's own tree, then submits the result
through `submit_review`. Review runs before integration: a PASS gates the
integration, and a REVISE returns the child to the Lane Executor. A missing
review profile fails that child closed with `review_profile_required` and one
recovery action; its QA settlement stays. The Parent never runs the Review in
its own conversation. An open Review reservation stays with that Host
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
checkout. No Host reports a trusted Executor exit, so the runtime never removes
or recreates a Lane it created: after integration the Lane, its branch and all
its files are kept, and `lane_refusals` reports `batch_lane_retained` for it,
also in a completed report. Delivery is complete; cleanup is the user's: stop
the Lane's Executor, keep the files needed, then remove the Lane. Reclaim a Lane
in this order: (1) stop the Lane's Executor; (2) keep the files still needed
from the Lane; (3) remove the Lane. Removing it
records `released` and never enables an automatic redo. Final verification runs in a
detached worktree at the Parent tip and removes that worktree afterwards; a
failure is reported without moving the Parent ref.
With `max_parallel` above 1 the reconcile tick keeps up to that many Lanes in
flight and reports one `executor` handoff per running child in `handoffs[]`
(`provision` remains only for legacy records).
Scope estimates may overlap: children run concurrently whatever their
`scope_hint`, and a child that changes other hunks of a file an integrated sibling
changed merges cleanly (ADR 0028). A child whose whole change is already on the
batch head parks with `batch_change_already_present`; a child sharing one identical
edit with a sibling still integrates when it carries another change. The merge
queue regenerates derived outputs whenever a child changes a
declared source or output; failed regeneration parks that child. Settled children
integrate serially, and a parked child ends only itself and its dependents while a
disjoint sibling keeps moving. A lost Lane parks as `batch_lane_lost`, and
`qa_failure_limit` counts each child separately. A completed settlement inside a
Lane changes Kernel state only and writes nothing to the tracker: the coordinator
closes the child's Issue after it integrates that child's commit, exactly once,
and reports the attempt in `tracker_observations`. A parked or lost child is
never integrated, so its Issue stays open; an explicit stop inside a Lane still
projects `not planned` at once.

A fresh literal-user Batch Authorization resumes recoverable parked owned runs.
In runtime-owned Parent Lanes, a stopped run, an unreadable or missing Lane, an
integration conflict or a durable redo grant is not exit evidence: the child
parks `needs_human` with `batch_lane_redo_retained`, its Lane is neither deleted
nor recreated, and no redo grant is spent. A child with an open user decision or
replan, an identity/contract conflict or dirty Lane data also remains parked with
its dependents; independent children resume. A repeated tick or a newer caller
timestamp without a fresh confirmation grants no recovery authority. Do not
retire the batch just because one child stays parked.

In the Immune-Brain plugin source repository, a child that integrates a change to
`plugins/immune-brain/dist/claude/mcp-server.mjs` leaves the Parent tip on a build
the coordinator and its Lane Executors have not loaded. The next admission then
creates no Lane: the batch parks `needs_human` with
`runtime_reload_required` naming that integrated commit, while in-flight
Executors keep running and their `executor` handoffs remain. Reload the Host
(Claude Code `/mcp` reconnect; Pi `/reload`), then resume with a fresh
literal-user confirmation. If the loaded build then equals the Parent tip bundle,
nothing is recorded; if it still differs, the admitted child and `final_report`
carry `runtime_skew_acknowledged`.

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

The Parent reads the layered config through `imm-kernel config --json` before
the first `start_unattended_batch` call for an Initiative. The resolver reports
values, their sources and diagnostics; the Parent overlays the literal request.
Instruction-file lane directives are not read.

| Field | Value | Effect | Without it |
| --- | --- | --- | --- |
| `max_parallel` | positive integer | The Parent passes it as `max_parallel` when it starts a batch. The native confirmation shows the Lane capacity. | No `max_parallel`: one Lane at a time |
| `executor_host` | `claude-code`, `pi` or `antigravity` | Every Lane's Executor Host is that Host. When the `lane-steward` did not report it available in a Lane, that Lane has no Executor Host; the Parent does not fall back to another one. | The Parent's own Host type, else another allowlisted Host the `lane-steward` reported available |
| `executor_model` | a model identifier of that Executor Host | Passed to the Executor Host as `--model <model>` | The Executor Host's own default |
| `executor_effort` | a level that Executor Host accepts | Passed as `--effort <level>` to `claude-code` and `antigravity`, and as `--thinking <level>` to `pi` | The Executor Host's own default |
| `review_host`, `review_model`, `review_effort` | the selected profile's Review fields | The Parent passes them as `review_host`, `review_model` and `review_effort` when it starts a batch. The batch records them as `review_profile`, the native confirmation shows them, and every CLI Review of the batch's Lanes runs on them; a resume keeps the recorded profile. A model or effort without `review_host` is refused. | Review resolves `lanes.active` when it is prepared |

Each field resolves on its own, in order: literal request, selected user Lane
profile, project `lanes` defaults, then the default above. Select the profile
named by the request, else `projects[<key>].lanes.active`, else `lanes.active`,
else none. Use `lanes.profiles.value` for the selected profile and
`lanes.project_defaults.value` for project values, even when the resolver's
active profile has shadowed them. Recompute the fields and host-pairing
warnings for the selected profile and request rather than reusing values or
`not_applied` warnings computed for a different active profile. A lane batch
records the Executor fields the Parent passes as `executor_preferences` when it
starts; every Executor generation of the batch, including one started after a
Lane decision, runs on them. When they name an `executor_host`, the runtime
does not consult `lanes.active`, so a model or effort of the active profile is
not reported as `not_applied`. A request naming an unknown profile is reported
and starts no batch. Project Lane values are defaults, not caps.

A model or effort applies only with an `executor_host` from the same layer. If
a higher layer overrides that host, report the model or effort as `not_applied`
and drop it; never attach it to a default-resolved Host. Report resolver
diagnostics, including legacy-source warnings. If the `lanes` section fails
validation (`lanes.valid: false`), start no batch on guessed or default values,
even when another section resolves successfully. Lane configuration grants no
permission or trust option.

After resolving, display one non-blocking line with each selected value and its
per-field source: `request`, `user`, `user:project`, `project`, `legacy:<path>`
or `default`, as reported by the resolver or supplied by the request. A
request-selected profile's fields retain the source of `lanes.profiles`, while
an active profile's fields retain the source of `lanes.active`. On a resume the
recorded `max_parallel` stands and nothing is passed again.

The `final_verification` commands of a new lane batch take plain commands
without shell syntax or quoting, at most 8, whatever their source. They are
shown in its native confirmation; the runner runs them on the batch branch once
every child is integrated and writes each command's exit status and timing into
the completion report as `final_verification`. A failing command reports the
batch as not passed; integrated commits are never rolled back. The Parent takes
them from:

1. commands the current request states literally; else
2. project `batch.final_verification`; else
3. the full test suite and type-check commands the repository instruction file
   names in prose (for example "uses `bun test`; type checking is
   `bun run typecheck`"); else
4. none, and the completion report says nothing was run.

The Parent never invents a command the repository does not name unless the
request or project config supplies it.

#### Lane Executor Supervision

This section and its supervised-session table describe Initiative batches and
single-task Lanes recorded with `executor_mode: "interactive"` inside Herdr.
Other single-task Lanes use runtime supervision under
[Single-Task Lane](#single-task-lane).

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
- It is given one explicit `drive` entry for that `task_id`, and nothing else.
- When it stops working — it exits, or it settles waiting for input — control
  returns to the Parent without the Parent polling or sleeping.
- The Parent can stop it.

The Parent Host and the Executor Host are chosen independently. The Executor
Host is any allowlisted Host (`claude-code`, `pi` or `antigravity`) that the
`lane-steward` reported available in that Lane. An `executor_host` resolved under
[Lane Preferences](#lane-preferences) decides it; without one, prefer the
Parent's own Host type, and use another available one when it is not available,
naming the Host chosen in the report. The child's QA and Review then run under that
Executor Host's own Assurance adapter in the Lane. The Executor Host loads the
same Immune-Brain plugin or package the Parent runs: a Parent started from a
local plugin directory passes that same directory to the Executor Host. A Pi
session loads one Immune-Brain only: when that directory and an installed Pi
package both load, the first loaded (the `-e` directory) is used and the other
registers nothing and shows a notice naming both. The
Parent adds no permission or trust option of its own; the Executor Host runs
under the user's own settings, with the model and effort of its own defaults
unless [Lane Preferences](#lane-preferences) resolve them. How the Parent obtains a supervised session
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
to the user with the Lane path, `task_id` and the `drive` entry to start
there, and calls `start_unattended_batch` again when the user says a Lane has
finished. Supervision is per Lane: Lanes that can be supervised are, and the
rest are reported.

##### Herdr Lane Tabs

This facility applies to Initiative batches and single-task Lanes inside Herdr.
For a single task, call `start_unattended_batch` with the same `task_id` on every
re-entry; keep `initiative_slug` absent. The runtime creates the Lane and returns
its `executor` handoff; the Parent opens and supervises its interactive tab below.
The recorded `executor_mode: "interactive"` survives re-entry outside Herdr: resume
it in Herdr instead of launching a non-interactive replacement. Existing tasks
with a runtime-owned Executor keep that process until settlement; never add a tab.
For a single-task user decision, follow [Parent decision relay](#single-task-lane)
and resume the existing tab after the native decision is applied.

The Parent coordinates; it never does a child's work. An `executor` handoff is
started in that child's Lane session as below, never implemented, edited or
tested in the Parent's own session or checkout. A refused or rejected report is
answered with its recovery action or reported to the user: the Parent never
resets, rebases or moves a Parent or Lane branch, and never removes or prunes a
worktree or a branch (`git reset`, `git branch -D`, `git worktree remove` and
`git worktree prune` are the user's). A child with no active claim is a Kernel
fact the report explains through its next obligation, not a missing TaskIntent:
the Parent does not search `.imm/` or ask the user for requirements because of
it.

Inside Herdr the Parent drives each Lane session through the
[Supervised Session Port](docs/reference/supervised-session-port.md) with
`imm-session --provider herdr`; the runtime and the `lane-steward` never do.
Resolve `../bin/imm-session` from this packaged contract; do not assume a bare
command is on `PATH`. Every call prints one JSON object; `ok: false` names a
refusal `code` and means nothing beyond its `reason` was done. Each Lane gets a
tab of its own, so its Executor Host has a full-size terminal the user can
read. For each `executor` handoff without a live session:

1. Take the Lane from the handoff's `lane_path`. Pick the Executor Host as above.
2. Create the session, which opens a tab rooted in the Lane in the Parent's own
   Herdr workspace without taking focus, starts the Host there and submits the
   entry and nothing else (later text follows only the instruction rule below):
   `imm-session create --provider herdr --cwd <lane_path> --label <name> --host <executor_host> --entry "<drive entry> <task_id>" -- <host arguments>`.
   `<name>` is a label of at most 32 characters such as the Slice ID; a
   `task_id` is usually too long. Host arguments are only those that load the
   Parent's plugin and those that [Lane Preferences](#lane-preferences)
   resolved for model and effort. The entry is the Executor Host's own `drive`
   invocation as that Host names it: a Claude Code Host that loaded the plugin
   from a directory names it `/immune-brain:drive`, Pi names it `/skill:drive`
   and Antigravity names it `/drive`. Keep `task_id → handle`
   from the result; the handle is opaque and is not authority.
3. Supervise with one `imm-session await <handle>... --provider herdr` over the
   handles of every live Lane session; it returns at the first transition and
   names that session's `handle`. How it runs depends on the Parent Host:
   - A Parent Host whose background command re-invokes it when the command ends
     (Claude Code) runs it as a Host background command, so its return
     re-invokes the Parent.
   - A Parent Host without that (Pi, whose bash tool is not woken when a
     background process ends, and any Host not known to re-invoke) runs it in
     the foreground with `--timeout-ms 600000`. A `timeout` return is no
     transition: the Parent calls `start_unattended_batch`, answers anything
     the user said meanwhile, and runs the wait again. It never polls
     `imm-session observe` instead.

   Start it only after the create reported `entry_submitted: true` and
   `state: "working"`: a wait attached to a session that is not working returns
   at once. Do not loop on `imm-session observe` or read the session's output to
   judge progress.

A create that reports `entry_submitted: false`, or a `blocked` state at any
time, means the tab shows a dialog only the user may answer: workspace trust,
sign-in, a permission request, a question, or a native confirmation such as an
Intent revision gate. A create may also report `entry_submitted: false` with
state `unknown` and an `attention` text: the Host reported nothing at startup,
which some Hosts do while they show a dialog; the Parent relays that text and
treats the session exactly like a blocked one. On `herdr` that text can also
mean Herdr typed the entry into a sign-in or selection dialog it did not see as
blocked, so after the user has answered, the Parent asks whether the Executor
Host took up the entry before resubmitting it. The Parent sends that tab no keys
and no prompt, and never answers such a dialog for the user. As soon as the
wait returns `blocked`, or the create returned `entry_submitted: false`, it
tells the user which tab and `task_id` is waiting and what the dialog asks,
without waiting to be asked, leaves the tab open, and continues the other Lanes;
once the user has answered, it resubmits the entry with the same create and
`--resume <handle>` if the entry was never submitted, otherwise it re-arms the
wait. `idle` or `done` is a session end for the rules below, although the tab
stays open: the Parent calls `start_unattended_batch`, and a relaunch submits the
entry again in the same tab instead of creating another, with
`--resume <handle>`. When the Executor Host has exited and its shell is back in
the tab, the same `--resume` starts the Host there again before submitting the
entry; when the tab's pane is gone, `--resume` is refused (`state_refused`) and
the Parent creates a new session for that `task_id`. When that report shows the child
neither settled nor waiting on a user decision, the Parent tells the user which
tab and `task_id` went idle and what the Kernel projection still requires.

The Parent may send one text instruction to a Lane session, and only while it is
`idle` or `done` (a finished turn not yet seen) and its child is still running in
the Lane: a correction to the
Executor's approach, never an answer to a dialog. It first calls
`start_unattended_batch` with `lane_instruction` (`task_id`, `text`, `kind`
`instruction` or `correction`, and the `session_state` it just observed with
`imm-session observe <handle> --provider herdr`). The runner records the text in the batch record and report
as `interventions` and answers `lane_instruction.accepted`; only when accepted
does the Parent submit it with `imm-session send <handle> --provider herdr --text "<text>"`
and re-arm step 3. `imm-session send` observes the session again first: a
`blocked` or `working` session is refused (`state_refused`) and receives nothing. Every instruction the
coordinator sent is therefore in the report, so Executor-initiated behavior and
coordinator intervention can be told apart afterwards. This never applies to the
authority Review: it runs as a separate CLI process the Lane Executor starts and
submits, so no Lane instruction reaches it.

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

Every live Lane session is covered by exactly one armed `imm-session await` (one
call covers several sessions), so `blocked` and idle-without-settlement wake the
Parent on their own. After a return the Parent handles that session and runs the
wait again over every session still live. A background-wait Parent that has
nothing else to do still ends its turn with the wait armed; a foreground-wait
Parent keeps waiting in bounded rounds instead. A wait that returns
`exited` means the Host process is gone, never that the child finished. A wait
that returns `unknown` ends nothing: the Parent calls `start_unattended_batch`
and re-arms the wait, and when the next wait returns `unknown` again it tells
the user which tab and `task_id` Herdr cannot classify. A
`provider_error` or `timeout` proves nothing about delivery; inspect the session
with `imm-session observe` before repeating a command.

The Parent closes a tab only under the Executor close rule, and only one it
created. At the tick that integrates a child whose audit pair is reachable from
the batch head, the runner records that session's close in the report's
`session_closes` (`task_id`, `at`); the record is there even when that tick
finishes the batch, so the Parent never re-enters a finished batch to ask.
Once the wait has returned that session `idle`, `done` or `exited`, the Parent
runs `imm-session close <handle> --provider herdr --batch <batch_id> --task <task_id> --recorded-at <at>`
from the coordinator checkout; `imm-session` reads the batch record and closes
only a session it lists. `start_unattended_batch` with `lane_session_close`
(`task_id`) still answers for a running batch: the same record if one exists,
a refusal otherwise. A refused close leaves the tab open. Every other tab (a parked, failed,
stopped or not yet integrated child's, and any tab the Parent did not create)
stays open for the user to read and close. Closing a session removes no Lane and
no branch. It splits no pane and creates no workspace. The Parent never invokes
`herdr` itself, and outside Herdr it never invokes `imm-session`.

Supervision is event-driven. Each session end is the cue to call
`start_unattended_batch` again with the same Initiative, and that report is the
only progress signal: a child's state and `next_obligation` come from its Lane's
Kernel projection, never from the session's output or exit status. When the
report still carries an `executor` handoff for a child whose session has ended,
the Parent starts it once more; after a second end without Kernel progress, or
when the report shows the child waiting on a user decision or an open Review
reservation, it stops relaunching and reports that child to the user while its
siblings continue. The Parent stops no session: when the report shows a child
parked, or settled without integration, while its session is still working, the
Parent tells the user which tab and `task_id` to close. A session that stays open changes no Kernel
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

### Single-Task Lane

Every new single-task `drive` entry, including a GitHub Initiative Child entry,
calls `start_unattended_batch` with `task_id` and no `initiative_slug` (both, or
neither, refuses `batch_entry_ambiguous`; an Initiative record and a
single-task record never match each other's entry, `batch_entry_kind_mismatch`).
The runtime turns the one validated standalone TaskIntent into a one-child Lane
batch (`plan_source: "single_task"`, slug equal to `task_id`, `max_parallel` 1)
under exactly one native gate on the current Host, bound to the TaskIntent
revision, content hash and preparation digest. It creates the Lane at the user's
HEAD, copies uncommitted planning input, and enrolls the child there; the
Parent enrolls nothing itself and implements nothing.
Spec drive-always-lanes D1 to D11 and ADR 0027 own the details below.

- **Inside Herdr (`HERDR_ENV=1`).** A new single-task entry records
  `executor_mode: "interactive"` and returns an `executor` handoff instead of
  spawning a child process. The Parent creates one Herdr tab in the admitted
  Lane, starts the selected interactive Executor with the resolved model and
  effort, submits its `drive` entry and arms `imm-session await` under
  [Herdr Lane Tabs](#herdr-lane-tabs). Re-entry uses the recorded mode and the
  existing tab, never a second Executor. `stop: true` reports
  `lane_executor_interactive` and asks the user to close that tab; it invents
  no process exit. The Lane and branches remain retained after delivery because
  Herdr session state is never exit proof.
- **Synchronous runtime supervision outside Herdr.** The
  runtime spawns one non-interactive Executor (`claude --print` or the
  antigravity print entry) with the Lane as working directory and
  `drive <task_id>` as its only prompt, and waits for it inside the Host tool
  call. A Pi Executor outside Herdr is never spawned: Pi writes to the Kernel
  only in its TUI, so the runtime reports reason `lane_executor_requires_tui`
  and hands the Lane to the user under the no-supervised-session rule above.
  The child stays enrolled, nothing is parked, and the report keeps its
  `executor` handoff with the Lane path and `task_id`; the user runs
  `/skill:drive <task_id>` in interactive pi in that Lane and calls
  `start_unattended_batch` again when it finishes. Arguments come only from the
  loaded plugin location and [Lane Preferences](#lane-preferences), which the
  runtime resolves itself; the Parent passes none. Existing runtime-owned tasks
  keep this supervision even when resumed inside Herdr. The report carries `lane_supervision` with `generation`, `state`
  (`running`, `exited`, `unobservable`, `stopped` or `unavailable`) and `exit`.
  When the wait window elapses the call returns `running` for the same
  generation; call the same entry again to re-attach, which never spawns a second
  Executor. `stop: true` on the same entry terminates the current generation;
  cancelling the call does the same and records `interrupted`. An exit is
  observed only from the runtime's own child-process exit event for that
  generation. The Executor's exit code and output, Claude Code background
  notices, Herdr state and elapsed time are never exit proof, and the Parent
  never launches, polls or closes a session for a runtime-supervised single task.
- **One native gate.** The entry opens one native gate and nothing after it asks
  for a second confirmation. A declined, cancelled or failed gate reports one
  same-Host recovery action and is never retried automatically.
- **Checkout delivery.** After the child settles and integrates onto
  `imm/<task_id>`, the runtime delivers into the user's checkout by the `Git
  integration` preference: `manual` stages the delivered delta, uncommitted, and
  moves no HEAD; `auto` fast-forwards the current branch when HEAD is an ancestor
  of the delivery. If any dirty entry in the checkout (staged, unstaged,
  untracked, deleted or renamed) overlaps a delivered path, the task parks
  `needs_human` with `checkout_delivery_overlap: <paths>` and writes nothing; a
  delivery that cannot apply parks as `checkout_delivery_conflict`. Unrelated
  user edits are never blocked and stay byte-identical.
- **Exit-proof cleanup.** Right after a successful delivery, in the same call,
  the runtime removes the Lane worktree, `imm-lane/<task_id>/<task_id>` and
  `imm/<task_id>` only when the current generation's exit was observed as a
  normal exit and `git status --porcelain --untracked-files=all` in the Lane is
  empty. In every other case (interrupted, unobserved or abnormal exit, a dirty
  Lane, a parked delivery) the Lane is kept and reported as
  `batch_lane_retained` with the failed condition; the Parent deletes nothing.
  Initiative batch Lanes are always retained as described above. A fresh
  `drive <task_id>` on a parked or retained Lane opens a fresh native gate and
  resumes in the same Lane with a new generation.
- **Parent decision relay.** When the Lane's Executor stops on a literal-user
  decision, the report carries `lane_decision_required` (task, run and record
  revision, authorization and pending decisions). A headless Executor has no
  native gate, so its `approve_breaking_intent_revision` call only leaves a
  request bound to the current record; the report then carries `requested`
  with the complete `next_intent`, which the Parent passes to its own
  `approve_breaking_intent_revision` gate. A request older than the current
  record is ignored, and an applied decision clears it. The
  Parent answers on its own Host with the native-gate tool the facts call for:
  `request_authorization`, `approve_breaking_intent_revision` with the complete
  next intent, or a stop request, each passing the Lane's `task_id` and the
  `record_revision` it read. The runtime applies the approved decision to the
  Lane store through the same Kernel operation and starts the next generation
  for runtime supervision. An interactive Lane keeps its existing Herdr tab and
  starts no runtime child; after the gate succeeds, re-enter the same `task_id`
  and resume the tab's `drive` entry once it is idle. A
  breaking revision approved this way also rebinds the single-task batch's
  approved identity, and a stop ends the Lane task. An interactive Lane waiting
  on a decision stays enrolled even when its artifacts are frozen; the batch
  skips another Assurance attempt and returns `lane_decision_required`. The
  same decision facts remain visible for an already parked child. An approved
  interactive stop records `lane_executor_stopped` in the batch immediately;
  `lane_relay.next_action` asks the user to close the tab while retaining the
  Lane and branches. A changed record is refused
  as `lane_decision_stale`, and a cancelled or failed gate applies nothing. The
  Parent never decides for the user, and a child of an Initiative batch keeps the
  batch behavior above.

An in-place TaskRecord enrolled before this change stays resumable through the
Execution Loop in [`drive.md`](drive.md#execution-loop) until terminal.
