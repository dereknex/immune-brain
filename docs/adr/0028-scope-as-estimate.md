---
status: accepted
---

# Scope as Estimate

Accepted on 2026-10-19 by the repository owner (decisions D19–D23 in
`docs/specs/branch-boundary-r2.spec.md`), implemented by Slice S6 of
Initiative `branch-boundary-r2` (`delegated-reseal-removal`). It
supersedes [ADR 0018](0018-delegated-in-lane-intent-revision.md) and
[ADR 0021](0021-same-directory-scope-extension.md), as
[ADR 0026](0026-branch-boundary-frozen-acceptance.md) named.

## Context

`scope_hint` was a delivery boundary, a diff filter, a commit boundary, a
scheduling key, a risk input and the subject of delegated revisions. ADR 0026
moved it out of the authority subject; each of its other roles still turns a
Planner estimate into a stop.

## Decision

1. **Scope is an estimate.** A delivery outside `scope_hint` is disclosed in
   Review evidence as `beyond_estimate`, not refused; discovering another file
   needed for the accepted outcome does not require a scope revision. A batch child's diff,
   commit and QA drift are its branch's `base..HEAD`; a single task's diff is
   taken from its Enrollment HEAD on a clean workspace.
2. **Scheduling is optimistic.** Overlapping estimates run concurrently; the
   merge queue resolves real conflicts.
3. **Risk follows the diff.** Projected risk is the highest of declared risk,
   the scope floor and the floor of the actual changed paths; a raise
   strengthens Review and opens no gate.
4. **Hard no-touch paths.** Authority state, credential-type files, CI and
   release config, and repository-declared additions are refused at settlement
   and integration.
5. **No delegated revision.** Delegated in-Lane revision and reseal are
   removed. Any `scope_hint` change that keeps the bound Spec path is a
   compatible revision, whether it adds, removes or replaces files, directories
   or globs. There is no same-directory exception or `scope_added:` history.
   Frozen acceptance remains the authority subject (ADR 0026); acceptance
   changes stay breaking and user-gated, including in a Lane. The coordinator
   cannot approve them or reseal the batch.

## Consequences

- Planner estimates stop costing stops; Review sees every file beyond them.
- A Lane whose acceptance must change now always waits for the user.
- Existing records that carry delegation fields remain readable and
  retireable.
