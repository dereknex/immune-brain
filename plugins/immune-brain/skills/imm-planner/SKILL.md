---
name: imm-planner
description: Use to create or revise a spec and iteration plan from requirements; owns scope and plan decomposition, not implementation or step activation.
---

# Immune-Brain: Planner

Load [`../../dist/imm-planner.md`](../../dist/imm-planner.md), then create or revise
the executable plan. `mode: page_design` is the canonical pre-implementation
design-contract mode formerly exposed as `imm-page-design`. Keep scope
explicit, including the Devil's Advocate preplan audit and `Devil's Advocate Audit` output. Return plan path, decisions,
first step, verification approach, and Next Action.

Settlement-class intents (terminal settlement, cancellation, timeout, race, or
authority-lifecycle semantics) must embed the `Settlement-Design Contract`
enumeration required by the loaded contract before they are execution-ready.

## Kernel TaskIntent Routing

Before producing a new managed planning artifact, read the Pi runtime
routing-status projection with `imm-plan --routing-status --json` and route
deterministically:

- an active Kernel claim routes to `imm-canary-work`, not new planning;
- an active or otherwise nonterminal v3 Plan remains on its existing v3 route;
- no routing policy preserves the legacy v3 Planner behavior;
- a valid `kernel_task_intent` retirement policy produces one TaskIntent draft
  through Pi `imm-planner`;
- an invalid, unreadable, untracked, or tracked-deleted policy rejects new
  planning authority with `routing_policy_invalid`;
- no Planner path enrolls a task or falls back to v3 after retirement.

Pi host identity is implicit and never a planning input. The production boundary
that turns a Git-tracked TaskIntent draft into managed execution authority is Pi
TUI: `/imm-canary-new` (default, no waiver) or `/imm-canary-enroll` (explicit
literal-user-confirmed waiver).

The Planner never writes the `docs/plans/<task-id>.intent.json` artifact
directly and never overwrites an existing TaskIntent. Under an active
`kernel_task_intent` policy it supplies one complete candidate to the canonical
`imm-kernel intent author <path> --stdin --json` command, which owns strict
parsing, verification-descriptor canonicalization, path binding, and exclusive
file creation; then it validates the created artifact with
`imm-kernel intent validate <path> --json`. Revisions of an enrolled intent
continue through Kernel `revise_intent` authority and are not a Planner
overwrite path.

planner ensemble is advisory-only and derives candidates from
`workflow_models.planner_ensemble`; final Spec and Plan authority stays here.
Agreement becomes evidence, Disagreement becomes decision criteria, and
strong-model blockers become risks or verification requirements.
