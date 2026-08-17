---
rejected: true
rejection_reason: >
  Introducing suspended Plans, repair insertion, a Plan queue, or parallel
  scheduler/worktree execution before the runtime has independently proven
  Plan identity, workspace isolation, ownership, integration, conflict, and
  recovery semantics would add orchestration state without removing the
  boundary ambiguity that caused the incident.
reusability: medium
key_files:
  - plugins/immune-brain/runtime/state_ledger.ts
  - plugins/immune-brain/runtime/workspace_scope.ts
  - plugins/immune-brain/runtime/commands/plan.ts
  - tests/plan-execution-boundary-runtime.test.ts
  - docs/solutions/plan-switch-state-isolation.md
next_reuse_scenarios:
  - A future design proposes suspended or repair Plans for a blocked current Plan.
  - A Plan queue or automatic successor activation is proposed before ownership and approval are persisted.
  - Parallel worktrees are proposed without an integration and conflict authority.
  - A failure-recovery change wants to preserve a blocked Plan while another Plan changes the same workspace.
---

# Rejected: Parallel Plan Scheduling Before Boundary Safety

## Rejected approach

Keep a blocked current Plan suspended while a repair Plan is inserted, or add a
Plan queue, scheduler lease, resource claim, or parallel worktree execution
model before the single-Plan boundary rules are complete.

## Rejection reason

The incident showed that a technically single-active Plan can still accumulate
intent from several Plans in one workspace. Adding scheduler concepts before
solving Plan identity, workspace ownership, actual changed-file provenance,
immutable semantic fields, and terminal transition authority would multiply
states without isolating the source of drift. A blocked Plan is therefore
non-terminal: it must be explicitly marked `cancelled` or `superseded` by the
user before a new Plan can become current. The terminated Plan is archived and
cannot resume.

## Preferred current model

Use strict sequential execution:

1. Exactly one Plan is current.
2. A Plan may switch only after `completed`, `cancelled`, or `superseded`.
3. Cross-boundary repairs use a new Plan path.
4. Execution evidence is append-only and checked against the actual Git delta
   and the active Step/follow-up `Scope`.
5. An activated Plan's semantic contract is immutable.

This does not claim that every future queue, scheduler, or DAG is invalid. It
records that those designs require a new, independently specified authority
model rather than being added as a recovery shortcut.

## Evidence

- The session replay identified intent drift across Plans 003, 004, and 005,
  including a repair attempt that expanded from two Step files to twelve
  cross-domain files.
- `plugins/immune-brain/runtime/workspace_scope.ts` now derives workspace
  changes from an activation baseline and enforces the declared Scope.
- `plugins/immune-brain/runtime/state_ledger.ts` now preserves attempt history
  and records explicit terminal Plan termination without allowing resume.
- `plugins/immune-brain/runtime/commands/plan.ts` blocks semantic rewrites once
  execution has started.
- `tests/plan-execution-boundary-runtime.test.ts` covers boundary drift,
  termination, and post-termination non-resumption.
- The project test run excluding `upstreams/` passed `441 tests across 56 files`.

## reusability_critique_notes

- **Falsifiability**: If a future implementation supplies per-Plan workspace
  isolation, lock-time ownership/CAS, explicit integration and conflict
  authority, recovery semantics, and user-approved transitions, this rejection
  no longer decides that design. It only rejects adding those states without
  those contracts.
- **Evidence trail audit**: The session replay and boundary regression tests
  support the current sequential choice, but do not benchmark parallel
  execution or prove that a scheduler can never be safe. No performance claim
  is made.
- **Architecture entropy resistance**: This is kept as a separate rejected
  decision because it prevents the old multi-Plan proposal from being mistaken
  for current architecture, while the positive boundary contract remains in
  `docs/solutions/contracts.md`. No ADR is created here: the decision is
  intentionally a current-scope rejection and its future replacement requires
  a new design with its own authority model.

---
Captured date: 2026-07-31 | Source: Plan execution boundary incident replay and runtime closure regression
