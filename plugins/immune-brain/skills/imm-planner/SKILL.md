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

## Default exhaustive decision tree

Exhaustive clarification is the default protocol, not a separate mode. Direct
Planner entry remains valid for clear requests. Resolve repository facts through
read-only investigation, then exhaust every real execution-design decision that
can change Result, Scope, behavior, Verification, or risk treatment. Scan design
decisions, component boundaries, failure behavior, compatibility, migration,
recovery and rollback, verification, execution slices, dependencies, and
delivery risks.

Ask the complete currently unblocked frontier in dependency-aware rounds. Number
each question, include a recommended answer, and accept bulk approval of all
recommendations with explicit exceptions. A zero-question fast path is valid
when the frontier is already empty. Product-level uncertainty is outside Planner
ownership: stop and return to `imm-brainstorm`. Once the frontier is empty, present a
result-only summary for explicit confirmation before finalizing a candidate
Spec, Plan, or TaskIntent; retain final decisions in the planning artifacts
rather than copying the question transcript.

Settlement-class intents (terminal settlement, cancellation, timeout, race, or
authority-lifecycle semantics) must embed the `Settlement-Design Contract`
enumeration required by the loaded contract before they are execution-ready.

## Managed Request Routing

`imm-planner` is the default planning phase for a clear repository mutation; the
user does not need to name Managed Path. The host applies the routing contract
before selecting a Skill:

- an active Assurance projection resumes through `imm-loop`;
- read-only, explanation, review-only, Plan-only, and explicit no-modification
  requests do not enroll;
- materially ambiguous mutations go to `imm-brainstorm` before planning; and
- clear new mutations reach this Planner phase.

Plan-only output remains non-authoritative. Planner creates or validates a
candidate Spec/TaskIntent, but it never enrolls a task or enrolls generated
artifacts unconditionally. Literal-user Enrollment remains the authority
boundary. Fast-Track may compress the same phases but cannot bypass that
boundary, QA, Review, authorization, or completion.

## Kernel TaskIntent Routing

Before producing a new managed planning artifact, read the Pi runtime
routing-status projection with `imm-plan --routing-status --json` and route
deterministically:

- an active Kernel claim routes to `imm-loop` for foreground Kernel Tool
  coordination, not new planning;
- an active or otherwise nonterminal v3 Plan remains on its existing v3 route;
- no routing policy preserves the legacy v3 Planner behavior;
- a valid `kernel_task_intent` retirement policy produces one TaskIntent draft
  through Pi `imm-planner`;
- an invalid, unreadable, untracked, or tracked-deleted policy rejects new
  planning authority with `routing_policy_invalid`;
- no Planner path enrolls a task or falls back to v3 after retirement.

Pi host identity is implicit and never a planning input. The production boundary
that turns a Git-tracked TaskIntent draft into managed execution authority is the
native host TUI: Parent invokes the `imm_canary_enrollment` foreground Tool for
literal-user confirmation and optional descriptor waiver.

The Planner never writes the `docs/plans/<task-id>.intent.json` artifact
directly and never overwrites an existing TaskIntent. Under an active
`kernel_task_intent` policy it supplies one complete candidate to the canonical
`imm-kernel intent author <path> --stdin --json` command, which owns strict
parsing, verification-descriptor canonicalization, path binding, and exclusive
file creation; then it validates the created artifact with
`imm-kernel intent validate <path> --json`. Revisions of an enrolled intent
continue through Kernel `revise_intent` authority and are not a Planner
overwrite path.

### Descriptor Rehearsal Discipline

Every acceptance verification descriptor must be a focused, deterministic,
repository-local check that exercises only its acceptance assertion. Prefer one
small `bun test <focused-file>` or `bun run <focused-script>` per acceptance;
never use the full test suite, a build, package installation, network access, or
redundant heavyweight checks as rehearsal descriptors. Use the smallest
`timeout_ms` and `max_output_bytes` that cover the check so isolated descriptor
rehearsal stays within host setup and execution ceilings.

planner ensemble is advisory-only and derives candidates from
`workflow_models.planner_ensemble`; final Spec and Plan authority stays here.
Architecture exploration and advisory review use the internal Loop bridge's
read-only `arch-explorer` and `advisory-reviewer` roles. They can supply
candidates, evidence, and decision criteria, but cannot write this Spec/Plan or
activate execution.
Agreement becomes evidence, Disagreement becomes decision criteria, and
strong-model blockers become risks or verification requirements.
