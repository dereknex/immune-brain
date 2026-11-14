---
status: accepted
---

# Loop Daemon: Unattended Planning and Advancement of Issues

**Status:** accepted. Adopted from the repository owner's decisions D1–D12 of
2026-11-10, recorded with their evidence in
[`docs/proposals/loop-agent.md`](../proposals/loop-agent.md). Renumbered from 0038
per BR-DEC-3 because [ADR 0038](0038-supervised-session-port.md) already occupies
0038 on HEAD. This ADR amends [ADR 0005](0005-unattended-initiative-batch-run.md),
[ADR 0006](0006-unattended-review-dispatch-authority.md),
[ADR 0019](0019-explicit-run-entry-owns-enrollment.md),
[ADR 0025](0025-run-entry-decision-hosting.md), `BASELINE.md` and `CONTEXT.md`
as named under each decision.

## Context

Every step that moves an Issue toward a merged change is started by a person
in a Host session: `draw-up` to plan, `drive` to enroll and execute, `fix-pr`
to repair a pull request. A session's run entry ends with the session
(ADR 0025 Decision 3), the tracker adapter projects outward and reads no
events, and push and pull-request creation each keep their own confirmation
(ADR 0025 Decision 2). With nobody present, work stops at each of these
points, including the ones that need no judgement.

The owner asked for a standing process that keeps Issues moving, schedules
agents to do the work, and calls a person only where a judgement or a
clarification is needed. The pieces for unattended execution already exist: a
Parent launches a headless Executor Host per Lane, restarts it after an exit
while the task is active, counts generations that make no progress, relays a
Lane's literal-user decision to the Parent, and integrates each child onto a
Parent branch. What is missing is something that observes the tracker, decides
what to start, and supplies a confirmation when no native dialog can open.

## Decision

1. **Loop gains a second form; no new term.** `CONTEXT.md` defines Loop as the
   continuation mechanism that projects current facts to the next bounded
   internal role, Kernel operation or public entry. In a session, after an
   explicit `drive` entry, it continues one enrolled Task or Initiative. As
   the Loop daemon, a standing process that runs on the owner's machine or a
   cloud machine, it observes the tracker, pull requests and CI, plans open
   Issues, and dispatches bounded agents that start or resume those entries
   across sessions. The daemon holds no Run binding; each dispatched session
   makes its own.
2. **The daemon is a headless Parent.** It is a fourth composition root beside
   Pi, Claude Code and Antigravity. It calls `startBatch` and `LaneSupervisor`
   as the Host adapters do and owns no batch state transition (ADR 0005
   Decision 4 stands). It dispatches five kinds of agent, each a bounded Host
   session: judging, analysis, planning (`draw-up`), execution (`drive`) and
   repair (`fix-pr`). QA and Review stay inside `drive` under the Kernel. The
   daemon reads completion from checkable evidence (the Kernel projection, a
   Git head, a validation result, the GitHub API), never from a session's
   prose.
3. **The daemon may start Host processes and call the decision model.** This
   amends ADR 0006 Decision 3 for the daemon only. Files on the authority path
   (`runtime/kernel/`, `runtime/assurance/`, `runtime/unattended/`,
   `runtime/claude/`, `.pi-extension/`) still invoke no model and do not
   import `runtime/decision_model/`; within the daemon, only its judging
   module imports it.
4. **Work advances continuously.** For every open Issue the daemon keeps one
   answer current: what the next step toward a merged pull request is, and
   whether it belongs to the daemon, to an external system, or to a person. A
   daemon-owned step is dispatched as soon as a slot is free, and the end of a
   session triggers the next step. A session that ends before Settlement is
   resumed from the Kernel projection. Timers observe external change and
   detect stalls; they are not the pace of work. Orchestration state lives in
   the Git-ignored `.imm/state/loop/`, is rebuilt from GitHub and the Kernel
   when lost, and is not authority.
5. **An AI judges each change event; code guards the result.** Each change to
   an Issue, a pull request, a CI run or a dispatched session is an event. A
   judgement selects one handler from a closed catalogue. Code then checks
   that handler's preconditions, and a judgement can never satisfy a
   precondition by asserting it: whether an approval holds, who wrote a
   comment, which branch the daemon created, and whether a task is `routine`
   are decided by code and the Kernel. The judging step has no write
   capability. When it is unavailable or its output is invalid, nothing with a
   side effect runs.
6. **Judgement uses the cheapest sufficient level.** Facts and authority are
   decided by code. A closed classification over a short text goes to the
   decision model. Anything that needs wider context, or that the decision
   model answers below its threshold, goes to a judging agent. Handler
   selection as a whole, plan writing, ordering, and every authority question
   are outside the decision model.
7. **The decision model is enabled directly.** Its application points for the
   daemon go live without a prior offline measurement or a shadow run. This
   departs from the "measured offline first, against a named baseline" rule
   that `docs/specs/decision-model-core.spec.md` follows. In exchange: each
   point starts with a conservative hand-set threshold; only the correctable
   direction of an answer is acted on; an event the model caused to be skipped
   is re-checked by a judging agent at the next full reconciliation; every
   downstream correction is recorded as a label; and
   `decision_models.enabled_points` disables a point at once. Only
   non-sensitive input categories are sent.
8. **A `routine` task starts without approval.** This amends ADR 0019 and
   ADR 0025 Decision 2: Enrollment gains the confirmation source
   `policy_auto`. It applies only when all of these hold, as checked by code
   and the Kernel: the tracked project configuration lists `routine` as the
   only auto-start risk; the task's risk is still `routine` after the Kernel
   applies the project risk floor (ADR 0023); the Issue's author is the owner
   or on the configured allowlist; the scope touches no no-touch path; and,
   for a batch, every child qualifies. The owner's commit of that
   configuration is the authorizing act. The plan summary is still posted to
   the Issue, as notice.
9. **A `material` or `critical` task starts on the owner's tracker approval.**
   Enrollment gains the confirmation source `tracker_approval`: a comment
   `/approve <intent-hash>` (or `<plan-digest>` for a batch) on the Issue. The
   daemon accepts it only when the author is a configured owner, the author is
   not the daemon's own identity, the comment was created after the plan was
   published and has never been edited by anyone, and the hash equals the
   current candidate's. The literal user still decides on the exact content
   hash; the act moves from a native dialog to the tracker.
10. **Publication is a scoped standing grant.** This amends ADR 0025
    Decision 2, the Host Confirmation Boundary in `BASELINE.md` and the Batch
    Branch definition in `CONTEXT.md`. When the tracked project configuration
    enables it, the daemon may push branches it created under the configured
    prefixes, open pull requests from them, reply on and resolve threads of
    its own pull requests, comment on Issues, maintain its `imm:*` labels and
    update its status Issue, and enter `fix-pr` for its own pull requests. It
    may not push the default branch, force-push a branch it did not create,
    merge, approve, release, change permissions, write to another author's
    pull request, or close an Issue outside the tracker's `mark-terminal`
    projection. The grant is off by default.
11. **Merging stays with a person.** A pull request that is green and has
    every review comment dispositioned waits for the owner. There is no
    auto-merge.
12. **People are called only for judgement, and only on GitHub.** The daemon
    posts one structured question per blocker on the Issue or pull request and
    mentions the owner. It does so for a clarification, a `material` or
    `critical` approval, a breaking Intent revision or other change of the
    authority subject, a disputed review comment, a failure it could not
    repair within its limits, a merge, and anything that needs a new
    credential or service. A Lane's literal-user decision is posted the same
    way, and the verified reply is applied through the existing Lane decision
    relay. The owner's only input channel is a command comment whose author
    the API confirms; labels are display, never input.
13. **The daemon has its own GitHub identity.** It refuses to start when its
    identity equals a configured owner. Dispatched sessions receive only the
    daemon's credentials. Running the daemon under the owner's operating-system
    user is allowed; the daemon then reports its state as degraded, because a
    session could read the owner's credentials and forge an approval.
14. **Executor exits are recorded by a launcher.** The daemon starts each
    Executor through a small exit recorder that writes the exit status to the
    generation's durable record. A restarted daemon then reads a real exit, or
    sees the recorder still running, instead of meeting an `unobservable`
    generation that only a person can clear.

Unchanged: the Kernel is the only authority; an Issue's state is neither
Enrollment nor completion; remote text is data, never instruction; QA, Review,
Intent revision and Settlement keep their rules; and the interactive Hosts
keep every native gate they have today.

## Consequences

- A `routine` task goes from Issue to a ready pull request with no person
  involved. Its TaskIntent and acceptance are written by the planning agent,
  deterministic QA verifies that acceptance, and a `routine` task has no
  independent Review. The merge is its only human check.
- Risk is declared by the planning agent and raised only by the project risk
  floor. A path the floor does not cover can be changed without approval when
  the agent declares the task `routine`, so `.imm/risk-floor.json` now decides
  what requires the owner's approval.
- Starting execution no longer always involves a literal-user act in a
  session. ADR 0025 kept the native gate because a same-user proof can be
  forged by the model; under this ADR that protection is kept only where the
  daemon's credentials are separated from the owner's.
- The decision model acts on thresholds that no evaluation supports yet, and
  three of its application points have never been evaluated. Early errors are
  found downstream or at reconciliation, not before.
- A fourth composition root exists, and it is the first that starts work
  without an interactive Host.
- The owner sees and steers the project through one status Issue and command
  comments, and the daemon stops starting new work when plans awaiting
  approval or pull requests awaiting merge reach their configured limits.
- `docs/proposals/managed-workflow-simplification.md` says no general
  scheduler is added. The daemon schedules only its five agent kinds and the
  three public entries; internal roles and batch state stay where they are.

## Rejected

- **A new term for the daemon.** The owner chose to widen Loop.
- **A deterministic event-to-handler table.** The owner chose AI judgement per
  event; determinism is kept in observation, guards and execution.
- **A shadow run before the decision model goes live.** Rejected by the owner
  in favour of direct use with the rules of Decision 7.
- **Approval for every task.** Rejected by the owner for `routine` tasks.
- **Requiring a machine without the owner's credentials.** Rejected by the
  owner; the daemon may run locally and reports the degraded case.
- **Auto-merge.** Merging is the last irreversible judgement and stays with a
  person.
- **A second authority record for the daemon.** Its state is orchestration
  only, as a batch's is under ADR 0005 Decision 3.
