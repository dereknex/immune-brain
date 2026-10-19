---
status: proposed
---

# Parent Branch and Merge Queue

Proposed on 2026-10-19 by the repository owner (decisions D11–D18 and D24 in
`docs/specs/branch-boundary-r2.spec.md`), to be accepted when Slice S1 of
Initiative `branch-boundary-r2` (`batch-parent-branch`) lands. It delivers
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
   `imm-lane/<slug>/<task_id>` at the Parent tip under the Git common directory,
   resets it for a redo, and removes it with its branch once integrated and
   clean. Offered Lanes are retired for new batches. Serial is a Lane batch
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
   fast-forwards the user's branch when possible and otherwise stops with the
   report.

## Consequences

- The user's checkout is never written by a new batch until the return step.
- The runtime now owns worktree lifecycle; a crash can leave a worktree under
  the Git common directory, which `retire_stale_batch` reports.
- Integration conflicts cost redo runs instead of an immediate stop.
