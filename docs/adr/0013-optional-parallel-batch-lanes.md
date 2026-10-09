---
status: accepted
---

# Optional Parallel Batch Lanes

Accepted when Slice S2 of `docs/specs/parallel-batch-lanes.spec.md` settled.
It is opt-in: a batch started without `max_parallel` is the serial run ADR 0005
describes. Where this ADR changes ADR 0005 or ADR 0007 it is stated there.

## Context

ADR 0005 made an unattended batch strictly serial and rejected "parallel child
execution, or a generic scheduler framework". ADR 0007 then accepted the cost:
a parked child keeps the single workspace claim, so independent siblings wait.
Its revisit condition — wall-clock bounded by parked or merely sequential
children rather than by the work — now holds for Initiatives whose ready
children touch disjoint files.

Three facts shape the decision:

- The Authority Store is worktree-local (ADR 0010) and every Kernel operation
  takes a `root`. One active run per store is what keeps a QA delivery digest
  stable; concurrent writers in one working tree would break it regardless of
  how claims are modelled.
- The delivery digest hashes `repository_root`, `base_head`, and `base_tree`
  (`runtime/workspace_scope.ts`, `taskRevisionSnapshotOnce`). A digest computed
  in one worktree can never be recomputed equal in another, so integration
  cannot be proved by re-deriving `diff_hash` on the batch branch.
- Claim ownership is derived from the store, not from a Host session
  (`isOwnBatchClaim` in `runtime/unattended/batch_preflight.ts`), and a batch
  capability already tracks consumed children as a set
  (`runtime/kernel/batch_authority.ts`). Enrolling from one process and
  executing from another Host session in the same worktree is consistent with
  both.

## Decision

1. **Lane mode is opt-in.** `start_unattended_batch` gains one optional
   parameter, `max_parallel`. Absent, the batch is the serial in-place run of
   ADR 0005 with byte-identical state, report, and Git effects. Present, the
   native confirmation additionally shows `max_parallel` and the parallel
   groups; both derive from intent content already covered by `plan_digest`.
   There is no second batch entry and no second Batch Authorization path.
2. **One active run per Authority Store stays.** What is relaxed is the batch
   rule that at most one child is enrolled at a time. Each concurrently enrolled
   child lives in its own **Lane**: a separate Git worktree of the same
   repository, on its own lane branch `imm-lane/<initiative-slug>/<task_id>`,
   with its own Authority Store. Inside a Lane the child is ordinary single-task
   Managed work.
3. **The runtime adopts Lanes; it does not manage worktrees.** ADR 0005 §6
   stands: the runner never creates, switches, or deletes a Git worktree. A
   Lane is offered to the runtime as a path. The runtime names the lane branch
   and base commit in its handoff and admits an offered path only when all of
   these hold, read from Git and the Kernel alone: the path shares the
   coordinator's Git common directory and is not the coordinator worktree; HEAD
   is on the named lane branch at the named base commit; the tree is clean; the
   store has no active run. A failed check refuses the offer and repairs
   nothing.
4. **Lane supply is an Internal Role, not runtime code.** The `lane-steward`
   role provisions a Lane, prepares its environment by the project's own
   conventions (no language or package manager is assumed), and releases it
   when asked. It starts no Host session (revised 2026-10-09, see Revision). It
   learns how
   from the workspace tool present in its environment. Immune-Brain's runtime,
   contracts, and prompts name no such tool, command, path, or agent kind, and
   the runtime inspects no such tool's environment variables. When no Lane can
   be supplied, the batch stops with a stated reason; it never silently
   continues serially under a confirmation that showed a parallel plan.
5. **Scheduling is a rolling ready set.** A pending child may start when every
   `blocked_by` child is integrated, its `scope_hint` is provably disjoint from
   every in-flight Lane's, and fewer than `max_parallel` Lanes are in flight.
   Scopes that cannot be proved disjoint are treated as overlapping.
6. **The coordinator is a reentrant reconciler.** Each `start_unattended_batch`
   call observes every Lane through its Kernel projection, integrates settled
   children, admits offered Lanes and enrolls their children with the batch
   capability held in the coordinator process (ADR 0008 unchanged), and returns
   `handoffs[]`. The runtime still invokes no model and polls nothing; the exit
   of an Executor Host session the Parent launched is the Parent's cue to call
   again (revised 2026-10-09, see Revision).
7. **Integration is serial and identity-checked.** The coordinator verifies the
   lane delivery against the lane's QA digest in the Lane itself, commits it on
   the lane branch, and builds one candidate commit for the batch branch without
   moving any ref. It accepts the candidate only when the candidate changes
   exactly the lane commit's path set with identical blob and mode per path, and
   the deterministic QA descriptors of that child and of every sibling
   integrated since the lane's base pass on the candidate. Then the batch branch
   fast-forwards. HEAD Lineage and one commit per child are unchanged on the
   batch branch. A failed check moves nothing: the child becomes `needs_human`
   and its dependents `skipped_blocked`. The descriptor rerun is an
   orchestration guard; it is not a Kernel attestation and creates no finding.
8. **Release follows integration.** After a child is integrated and its Lane is
   clean, the report carries a release handoff for the `lane-steward`. The
   runtime records the Lane as released when it observes the path gone. Parked,
   failed, and unintegrated Lanes are never offered for release.
9. **Executor Hosts are allowlisted by Immune-Brain.** Only Hosts with an
   Assurance adapter (Claude Code, Pi) may execute a Lane. Which of them is
   available is an environment fact the steward reports and the Parent acts on.

## Revision 2026-10-09: the Parent launches and supervises Executor Hosts

As first accepted, the `lane-steward` started the Executor Host and returned.
That session had no owner: the Parent held no handle, could not stop it, and
learned that it had ended only by calling the batch again on its own initiative.

The Parent now launches each Lane's Executor Host as a Host-native background
session it can stop and is notified about, one per Lane, and re-enters the batch
on every session exit. The steward supplies and releases Lanes and starts
nothing. This is a Host Loop contract (`dist/imm-run.md`, the `lane-steward`
prompt); the runtime, the batch record and the handoff shapes are unchanged, and
a session handle is never authority: Kernel projections in the returned report
remain the only progress signal.

The contract is stated as capabilities, because the Parent may be either
supported Host and the two differ: a supervised session is a separate Host
process rooted in the Lane (so its Kernel root is the Lane's store; an
in-process subagent shares the Parent's root and does not qualify), started
non-interactively, whose exit notifies the Parent and which the Parent can stop.
Parent Host and Executor Host are chosen independently from the allowlist. A
Parent Host that cannot offer such a session launches nothing and reports the
handoff to the user, which is the behavior before this revision; it never
substitutes a detached job or serial in-place work. `dist/imm-run.md` carries
the per-Host mapping.

When the Parent itself runs inside Herdr it obtains the session there
without asking: one tab per Lane holding an interactive Executor Host, started
and awaited through the `herdr` CLI. A tab, not a split pane, so that every
Lane keeps a full-size terminal however many run at once. This narrows the earlier boundary that no
Immune-Brain surface names a workspace tool. The runtime, both Host adapters and
the steward prompt still do not; only the Parent's Loop contract does, because
the Parent is the one actor that owns the session. Two consequences follow. An
interactive session settles instead of exiting, so "session end" means it
stopped working, and the tab is reused for a relaunch. And it can stop at a
dialog (workspace trust, sign-in, permission), which the Parent reports and
never answers: launching with the user's own settings is not consent to widen
them. The `executor` handoff gains `lane_path`, an observation of where the
admitted Lane is, so the launch does not depend on what the Parent remembers.

Rejected for this revision: persisting session identity or heartbeats in the
batch record (it would add the execution lifecycle ADR 0005 keeps out of the
runtime, and a recorded session can be stale where a Kernel claim cannot), and
having the runtime spawn Hosts (§3 and ADR 0005 §6 stand).

## Rejected Alternatives

- **Several active runs in one Authority Store.** It would touch every
  task-keyed read in `runtime/kernel/storage.ts` and still leave concurrent
  writers invalidating each other's delivery digest.
- **Runtime-owned `git worktree` management.** Worktree location, environment
  preparation, and Host launch are environment policy; hard-coding them would
  bind the Kernel to one machine layout and one ecosystem.
- **A second batch tool or a `imm-run-parallel` skill.** Two entries would give
  Batch Authorization two issuing paths and two coordinator contracts to drift.
- **Recomputing `diff_hash` on the batch branch.** Impossible by construction;
  see Context.
- **Merging lane branches.** A merge commit breaks "one scope-bounded commit per
  child" and the linear HEAD Lineage.
- **Silent serial fallback.** The user confirmed a parallel plan.

## Consequences

- ADR 0005's rejection of parallel child execution is superseded for lane mode
  only; its "generic scheduler framework" rejection stands — the scheduler is
  one pure function over one batch record. ADR 0005 §6 is unchanged.
- ADR 0007's decision stands inside each store. Its consequence "progress is
  bounded by the slowest parked child" no longer holds in lane mode: a parked
  child holds only its own Lane's claim.
- A lane child's TaskRecord and tombstone live in the Lane's store. After
  release, the tracked `.imm/audit/<task_id>/` pair carried by the child's
  commit is the surviving terminal evidence; the coordinator store never holds
  that child's run.
- `consecutive_qa_failures` has no defined order across concurrent children, so
  lane mode counts QA failures per child against `qa_failure_limit`.
- Real parallelism is bounded by scope overlap. Children that share a generated
  mirror or a contract file serialize exactly as today.
- `CONTEXT.md` gains **Lane** and revises **HEAD Lineage**; `IMMUNE.md` and
  `dist/imm-run.md` state the opt-in and the unchanged worktree rule.
