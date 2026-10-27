---
status: accepted
---

# Parent Branch and Merge Queue

Accepted by the repository owner with Slice S1 of Initiative `branch-boundary-r2`
(`batch-parent-branch`): Parent-branch Lane lifecycle and final verification
(decisions D11–D14 in `docs/specs/branch-boundary-r2.spec.md`). Merge redo,
derived regeneration and serial retirement remain the later Slices defined by
that Spec (D15–D18), not S1 delivery claims. Slice S9 (`final-report-return`)
delivers D24's final report and preference-controlled coordinator return. It delivers
[ADR 0026](0026-branch-boundary-frozen-acceptance.md) item 5. It supersedes
[ADR 0005](0005-unattended-initiative-batch-run.md) §6 and
[ADR 0013](0013-optional-parallel-batch-lanes.md) §3 for worktree management,
and amends [ADR 0024](0024-git-integration-preference.md) §5 for batches.

## Context

A batch keeps its progress on a hidden ref and copies each integrated child's
files into the user's working tree. The runtime may not create a worktree, so
every Lane needs an offered path, and a serial batch runs inside the user's
checkout. A conflict parks the child with no retry, nothing regenerates
derived files, final verification runs on the user's tree instead of the batch
result, and nothing returns the work to main.

## Decision

1. **Parent branch.** A new batch's progress ref is the real branch
   `imm/<slug>`, written with `update-ref` at `base_head` and never checked out
   by the runtime. Hidden-ref and legacy branch records keep their mode.
2. **Runtime-owned worktrees.** The runtime creates each child's worktree on
   `imm-lane/<slug>/<task_id>` at the Parent tip under the Git common directory.
   It never removes or recreates that Lane without trusted Executor exit
   evidence, which no Host supplies yet (amendment below). Offered Lanes are
   retired for new batches. Serial is a Lane batch
   with `max_parallel` 1.
3. **Merge queue.** Settled children integrate one at a time as one rebuilt
   commit each; ADR 0013's rejection of merge commits stands. The child's
   frozen acceptance reruns on the rebuilt commit and a failure counts as a
   conflict. Declared derived files are regenerated and checked instead of
   conflicting. A conflict restarts the child at the new Parent tip under the
   same authorization; the third conflict parks only that child.
4. **Verification on the result.** Final verification runs in a detached
   worktree at the Parent tip.
5. **Return to main.** Batches follow the Git integration preference: `manual`
   stops with a final report and leaves the Parent branch; `auto`
   fast-forwards the coordinator's existing branch only after final verification
   passes on the Parent tip, with a clean working tree and an ancestor HEAD.
   Dirty, diverged or detached checkouts, failed verification and Git failures
   stop with an explicit reason; the Parent branch remains. The report records
   each child's approved acceptance ids against QA results, files beyond the
   estimate, declared and projected risk, redo count and parked reason. Missing
   evidence is unknown, never a pass. Terminal replay returns the recorded
   observation without repeating the return step.

## Consequences

- The user's checkout is never written by a new batch until the return step.
- The runtime now owns worktree creation; a crash can leave a worktree under
  the Git common directory, which `retire_stale_batch` reports.
- An integration conflict parks only that child (see amendment) instead of
  stopping the batch.

## Amendment: retained Lanes (batch-resource-safety S2)

Neither supported Host reports a trusted Executor exit, and Git cleanliness,
Kernel-terminal proof, a missing claim, a missing directory or a UI `idle`/`done`
do not prove one. Until such evidence exists the runtime keeps every Lane it
created: an integrated Lane keeps its directory, branch and all tracked,
untracked and ignored files, and the report carries a `batch_lane_retained`
`lane_refusals` notice that delivery completed but cleanup was not performed.
A conflict redo, a durable redo grant, parked revival and missing-path recovery
park the child `needs_human` with `batch_lane_redo_retained` and spend no grant;
independent children keep integrating. Detached Parent verification worktrees
keep their own cleanup. `released` remains only the observation that the user
removed the Lane, never exit proof and never permission for a redo.

Restoring automatic cleanup is a separate proposal owned by the runtime/Host
lifecycle maintainer (prioritized by the project owner). It is revisited only
when a Host-owned Executor identity/exit observation exists that binds to the
repository, Lane and execution generation, invalidates on relaunch, fails
closed on interruption and timeout, is tested for live/exited/unknown processes
in every provider, and keeps unknown-file protection. There is no time-based
relaxation. The redo re-issue path that spent a grant is retired, so that
proposal must reintroduce a grant-spending redo alongside Lane recreation;
durable `redo_grants` are only restored to bound a parked child.
