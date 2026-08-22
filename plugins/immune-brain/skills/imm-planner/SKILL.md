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
can change Result, Scope, behavior, Verification, or risk treatment. Direct
Planner entry and Medium/High Design Risk work must inspect relevant ADRs and
rejected Learnings. Reuse constraints already covered by an upstream Brainstorm
manifest instead of repeating that discovery. Scan design decisions, component
boundaries, failure behavior, compatibility, migration, recovery and rollback,
verification, execution slices, dependencies, and delivery risks.

Ask the complete currently unblocked frontier in dependency-aware rounds. Number
each question, include a recommended answer, and accept bulk approval of all
recommendations with explicit exceptions. A zero-question fast path is valid
when the frontier is already empty. Product-level uncertainty is outside Planner
ownership: stop and return to `imm-brainstorm`. Treat the user's direct
requirements, answers to numbered questions, and bulk approval of
recommendations as confirmation of those decisions. Once the frontier is empty,
present a result-only summary as a non-blocking correction window before
finalizing a candidate Spec, Plan, or TaskIntent; retain final decisions in the
planning artifacts rather than copying the question transcript. Do not ask the
user to reconfirm decisions reflected without material change. If the summary
introduces or changes a material decision affecting Result, Scope, behavior,
Verification, or risk treatment, ask for explicit confirmation of only that
decision delta and block finalization until it is answered.

Settlement-class intents (terminal settlement, cancellation, timeout, race, or
authority-lifecycle semantics) must embed the `Settlement-Design Contract`
enumeration required by the loaded contract before they are execution-ready.

## Reference Closure Preflight

Before authoring a TaskIntent, trace each expected behavior from its public or
runtime entry point through existing imports and callers to the highest focused
behavioral tests. Include generated or packaged mirrors and every owner of the
same state machine. Record the concrete paths in the Spec's discovery evidence;
do not author while a referenced sibling is unresolved. Use the smallest
coherent module directory for ordinary implementation scope. Keep Kernel,
authority, migration, secret, and security-sensitive scope exact to the files
proved necessary by the trace. Scope is closed by reference evidence, not by an
exhaustive filename guess.

## Managed Request Routing

`imm-planner` is entered explicitly by the user for a clear repository mutation.
Ordinary host input does not invoke this Skill through natural-language routing.
An active Assurance projection resumes through `imm-loop`; explicit Planner entry
owns bootstrap, planning, and the later native Enrollment gate:
- an active Assurance projection resumes through `imm-loop`;
- read-only, explanation, review-only, Plan-only, and explicit no-modification
  requests do not enroll;
- materially ambiguous mutations go to `imm-brainstorm` before planning; and
- clear new mutations reach this Planner phase.

Plan-only output remains non-authoritative. Planner creates or validates a
candidate Spec/TaskIntent, but it never enrolls a task or enrolls generated
artifacts unconditionally. Explicit Plan-only requests stop after returning the
planning artifacts. A later literal-user request to start Enrollment is a non-authoritative
execution trigger: invoke the native Enrollment gate directly, without asking
for chat pre-confirmation. For a clear mutation request that already includes
execution, invoke that gate as soon as the candidate is validated and Git-tracked.
Literal-user confirmation in the native gate remains the authority boundary.
Fast-Track may compress the same phases but cannot bypass that boundary, QA,
Review, authorization, or completion.

## Kernel TaskIntent Routing

Before producing a new managed planning artifact, resolve the canonical wrappers
from the declared Skill location: `../../bin/imm-plan` and
`../../bin/imm-kernel`. Invoke `imm-plan --routing-status --json` through that
resolved wrapper and use the resolved `imm-kernel` wrapper for every Kernel
command below. Do not assume either bare command is available on shell `PATH`.
Then route deterministically:

- an active Kernel claim routes to `imm-loop` for foreground Kernel Tool
  coordination, not new planning;
- an active or otherwise nonterminal v3 Plan remains on its existing v3 route;
- no routing policy preserves the legacy v3 Planner behavior;
- a valid `kernel_task_intent` retirement policy produces one TaskIntent draft
  through Pi `imm-planner`;
- an invalid, unreadable, untracked, or tracked-deleted policy rejects new
  planning authority with `routing_policy_invalid`;
- no Planner path enrolls a task or falls back to v3 after retirement.

Current owner, phase, completion, and authority facts are authoritative only
when read from the Assurance projection and TaskRecord. `CONTEXT.md` is
non-authoritative vocabulary and architecture navigation, not a workflow-status
source. If its prose conflicts with those authority facts, report stale
documentation, preserve projection-based routing, and do not automatically
synchronize either representation.

Pi host identity is implicit and never a planning input. The production boundary
that turns a Git-tracked TaskIntent draft into managed execution authority is the
native host TUI: the Planner's final `ctx.ui.custom` gate (via the
`imm_canary_enrollment` foreground Tool) provides one literal-user confirmation
bound to the TaskIntent content hash. Invoke the Tool directly when the route is
ready; do not ask for a chat pre-confirmation. Descriptor rehearsal is reordered
after that confirmation; a post-confirmation rehearsal failure invalidates the
authorization with zero authority writes, and a routine task proceeds through
enrollment, execution and QA without a second human stop. Optional descriptor
waiver remains a separate explicit route.

The Planner never writes the `docs/plans/<task-id>.intent.json` artifact
directly and never overwrites an existing TaskIntent. Under an active
`kernel_task_intent` policy it supplies one complete candidate to the canonical
`imm-kernel intent author <path> --stdin --json` command, which owns strict
parsing, verification-descriptor canonicalization, path binding, and exclusive
file creation; then it validates the created artifact with
`imm-kernel intent validate <path> --json`. Revisions of an enrolled intent
continue through Kernel `revise_intent` authority and are not a Planner
overwrite path.

### Opt-in GitHub Initiative Projection

For a large proposal split across multiple TaskIntents, GitHub Issues may provide
one-way visibility only when the literal user explicitly opts a named Initiative
in and confirms its immutable slug. Resolve `../../bin/imm-tracker` from this
Skill location; do not assume a bare command is on `PATH`. After the first
TaskIntent has been authored, staged, and validated with `valid: true` and
`enrollment_ready: true`, call `imm-tracker upsert-initiative --stdin --json`
with only the confirmed Initiative goal and known stable Slice ID/goal summaries,
then call `imm-tracker upsert-task --initiative-id <slug> --intent <path> --json`.
A future Slice remains a parent checklist item until its own TaskIntent is
canonically authored and validated.

Tracker output is observation, never authority. Report `retryable_failure`,
`permanent_failure`, or `ambiguous_remote_state` and the exact retry action, but
do not block planning, Enrollment, execution, QA, Review, settlement, or another
association. Do not infer opt-in, auto-close the parent, import Issue state,
create a TaskIntent from an Issue, or store Issue identity in TaskIntent or
TaskRecord. Existing Issue markers grant permission only for later one-way
projection updates to that same Initiative; they never grant execution authority.

### Descriptor Rehearsal Discipline

Every acceptance verification descriptor must be a focused, deterministic,
repository-local check that exercises only its acceptance assertion. Prefer one
small `bun test <focused-file>` or `bun run <focused-script>` per acceptance;
never use the full test suite, a build, package installation, network access, or
redundant heavyweight checks as rehearsal descriptors. Prefer the highest
existing observable behavioral test seam and the fewest sufficient seams. Cite
relevant test prior art and explain how the selected seam catches the intended
regression. This is a planning heuristic: it must not weaken acceptance-specific
focused verification descriptors or add a mandatory user confirmation. Use the
smallest `timeout_ms` and `max_output_bytes` that cover the check so isolated
descriptor rehearsal stays within host setup and execution ceilings.

planner ensemble is advisory-only and derives candidates from
`workflow_models.planner_ensemble`; final Spec and Plan authority stays here.

## Retirement Completion Contract

For retirement-class work, deletion of source and contract text is a completion condition. A retirement that routes the command to a retirement wall, pins the absence with test assertions, and leaves the source in the tree is not complete. A retirement is not complete until the source and its contract text are deleted.

An absence test is transitional scaffolding proving an in-progress deletion rather than a substitute for one. An absence test is transitional evidence of an in-progress deletion and may not stand in place of one. It proves a deletion in progress, not a completed result. Distinguish an absence assertion that guards something already gone, which is durable and correct, from one that stands in for a deletion still owed, which is a promise recorded as if it were a result.
Architecture exploration and advisory review use the internal Loop bridge's
read-only `arch-explorer` and `advisory-reviewer` roles. They can supply
candidates, evidence, and decision criteria, but cannot write this Spec/Plan or
activate execution.
Agreement becomes evidence, Disagreement becomes decision criteria, and
strong-model blockers become risks or verification requirements.
