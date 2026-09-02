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

## Clarification supplement

Planner consumes an upstream Brainstorm manifest as a closed-world input and
must not repeat, reopen, or rewrite confirmed decisions. Direct Planner entry
and Medium/High Design Risk work must inspect relevant ADRs and rejected
Learnings. It resolves repository facts and owns ordinary technical choices: design and component boundaries, failure behavior, compatibility, migration, recovery and
rollback, Verification, execution slices, dependencies, scope, and delivery
risk. It then authors the candidate Spec, Plan, or TaskIntent.

Planner may ask only when concrete new evidence exposes an omission, repository
conflict, or invalidated assumption. Ask the focused decision delta, cite the
upstream `BR-*` item and new evidence when available, and preserve every
unaffected decision. Resolve a local delta here; if its answer reopens multiple
product branches or changes the overall goal or Scope, stop and return to
`imm-brainstorm`.

Direct Planner entry remains valid for clear requests. Resolve facts and derive
technical design without a Brainstorm pass; if an unresolved user-owned product
decision appears, return to `imm-brainstorm` instead of silently choosing it or
starting a second exhaustive interview. A zero-question fast path is valid when
no supplement is required. Present an unchanged result summary as a
non-blocking correction window and do not ask the user to reconfirm existing
decisions. If the summary itself introduces or changes a user decision, confirm
only that decision delta before finalizing.

Settlement-class intents (terminal settlement, cancellation, timeout, race, or
authority-lifecycle semantics) must embed the `Settlement-Design Contract`
enumeration required by the loaded contract before they are execution-ready.

## Technical Design Views And Decomposition

For Medium and High Design Risk, select every materially relevant technical-design view from architecture layers, service/component interfaces, data flow, state transitions, and temporal sequence. Record a short `Design views` statement naming the selected views and why any omitted view cannot affect the design. The Spec is the single Technical Design baseline. Persist those decisions there; do not copy them into a TaskIntent or revive prose Plan authority. Low risk remains concise and is not forced to produce empty architecture, interface, data-flow, state, or sequence sections.

Use the selected design boundaries as one TaskIntent decomposition dimension alongside outcome, Verification, dependency, risk, rollback, compatibility, and authority. Keep one TaskIntent when the selected views describe one coherent executable slice with shared acceptance, risk treatment, rollback, and authority. Split a successor TaskIntent only when a service, state-machine owner, migration, independently promotable layer, or sequence dependency needs independent verification, rollback, authorization, or settlement. Do not split merely because the design names several layers, files, or services.

Treat trust-boundary changes as the same kind of decomposition evidence. A TaskIntent should normally change one primary trust-boundary invariant; merely traversing several boundaries or updating both sides of one end-to-end authority chain does not require a split. Split separate trust invariants when they can be independently verified, rolled back, authorized, migrated, or settled. Keep multiple trust-boundary changes together only when they form one atomic security outcome and splitting would create an unsafe or unusable intermediate state; record that reason in the Spec. This is Planner judgment, not a TaskIntent schema field or an Enrollment counting rule.

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
An active Assurance projection remains authoritative and is resumed only through an explicit `imm-loop` entry; explicit Planner entry owns planning and the later native Enrollment gate:
- an active Assurance projection remains on its current owner until the user explicitly enters `imm-loop`;
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
ready; do not ask for a chat pre-confirmation. Enrollment validates the intent,
Git ownership, scope, workspace claim, and final authority preconditions without
executing acceptance descriptors. A routine task proceeds from that single
confirmation through enrollment, execution and QA without a second human stop.

The Planner never writes the `docs/plans/<task-id>.intent.json` artifact
directly and never overwrites an existing TaskIntent. Under an active
`kernel_task_intent` policy it supplies one complete candidate to the canonical
`imm-kernel intent author <path> --stdin --json` command, which owns strict
parsing, verification-descriptor canonicalization, path binding, and exclusive
file creation; then it validates the created artifact with
`imm-kernel intent validate <path> --json`. Revisions of an enrolled intent
continue through Kernel `revise_intent` authority and are not a Planner
overwrite path.

### Initiative Carrier Preference

For a large proposal split across multiple TaskIntents, exactly one planning
carrier is chosen per Initiative: a Local Markdown file at
`docs/initiatives/<slug>.md` or one GitHub Parent Issue. This preference applies
only to Initiatives; ordinary TaskIntents remain tracked by Kernel TaskRecords.
Resolve the carrier in this order:

1. a literal user instruction for the current request;
2. `Initiative carrier default: local` or `Initiative carrier default: github`
   in the repository root `AGENTS.md`;
3. the same directive in `~/.pi/agent/AGENTS.md`; or
4. ask the user when no valid directive exists.

A repository directive overrides the global directive. Report an invalid value
and ask instead of guessing. After resolving it, display one non-blocking line
with the selected carrier and its source. A configured `github` default is
standing opt-in for GitHub projection, but the literal user must still confirm
the named Initiative and its immutable slug before the first remote mutation.
Surface that name, slug, and the proposed Parent/Child creation together as soon
as decomposition establishes multiple TaskIntents. Recommend one answer so the
user may adopt the complete current decision frontier in bulk. A prior bulk
approval cannot confirm a name or slug that had not yet been shown.
Resolve `../../bin/imm-tracker` from this Skill location; do not assume a bare
command is on `PATH`. After the first TaskIntent has been authored, staged, and
validated with `valid: true` and `enrollment_ready: true`, and both the named
Initiative and its immutable slug are confirmed, attempt the GitHub projection
before returning the final Planner result or invoking Enrollment: call
`imm-tracker create-initiative --stdin --json` once with the confirmed goal,
stable Slice summaries, and the public Parent projection fields. `create-initiative`
receives the stable Initiative goal and Slice summaries plus the
public Parent projection fields `problem`, `result`, `decisions`,
`testing_strategy`, and `out_of_scope`. It creates a result-oriented Parent title
`[<initiative>] <result>` and never rewrites an existing Parent.

Then call
`imm-tracker upsert-task --initiative-id <slug> --slice-id <id> --intent <path> --projection-json <json> --json`
to create one neutral open Child Issue and attach it to the Parent as a native
Sub-issue. The projection JSON is public planning context only and may contain
`result`, `current_behavior`, `desired_behavior`, `key_interfaces`,
`verification`, `blocked_by` Task IDs, `out_of_scope`, and `agent_handoff`.
The tracker rereads the canonical TaskIntent for identity, risk, and acceptance;
projection fields never widen TaskIntent scope or authority. The Child title is
`[<initiative>/<slice>] <result>` with no `IB:` prefix or Task ID. Its body is an
Agent Brief with Parent, What to build, Current behavior, Desired behavior, Key
interfaces, Acceptance criteria, Verification, Blocked by, Out of scope, Agent
handoff, and Authority boundary sections. Native `blocked_by` relations are
created only for exact marker-owned Task Issues and are idempotently observed.
Internal role prompts, tool policies, review gates, model reservations, and
prompt digests never belong in this external handoff.
If `docs/initiatives/<slug>.md` exists, the tracker fails with a
carrier conflict; Local mode performs zero GitHub operations. A future Slice remains a parent checklist entry until its own TaskIntent is
canonically authored and validated.

Tracker output is observation, never authority. Before the Planner returns, its
GitHub carrier outcome must be exactly one of: `tracker_associated` after both
operations return `created`, `updated`, or `already_current`;
`awaiting_user_initiative_confirmation` with the single pending Initiative
name-and-slug decision; or `tracker_projection_failed` with the returned failure
and exact retry action.
A candidate Initiative name or slug recorded only in the Spec or final summary
is neither user confirmation nor a completed carrier outcome. Report `retryable_failure`,
`permanent_failure`, or `ambiguous_remote_state` and the exact retry action, but
do not block planning, Enrollment, execution, QA, Review, settlement, or another
association. Do not infer opt-in from tracker output or Issue state,
auto-close the parent, import Issue state, create a TaskIntent from an Issue, or store Issue identity in TaskIntent or
TaskRecord. Existing Issue markers grant permission only for later one-way
projection updates to that same Initiative; they never grant execution authority.

### Verification Descriptor Discipline

Every acceptance verification descriptor must be a focused, deterministic,
repository-local check that exercises only its acceptance assertion. Prefer one
small `bun test <focused-file>` or `bun run <focused-script>` per acceptance;
never use the full test suite, a build, package installation, network access, or
redundant heavyweight checks. Prefer the highest existing observable behavioral
test seam and the fewest sufficient seams. Cite relevant test prior art and
explain how the selected seam catches the intended regression. This is a
planning heuristic: it must not weaken acceptance-specific focused verification
descriptors or add a mandatory user confirmation. Use the smallest `timeout_ms` and
`max_output_bytes` that cover deterministic post-implementation QA.

## Retirement Completion Contract

For retirement-class work, deletion of source and contract text is a completion condition. A retirement that routes the command to a retirement wall, pins the absence with test assertions, and leaves the source in the tree is not complete. A retirement is not complete until the source and its contract text are deleted.

An absence test is transitional scaffolding proving an in-progress deletion rather than a substitute for one. An absence test is transitional evidence of an in-progress deletion and may not stand in place of one. It proves a deletion in progress, not a completed result. Distinguish an absence assertion that guards something already gone, which is durable and correct, from one that stands in for a deletion still owed, which is a promise recorded as if it were a result.
Architecture exploration and advisory review use the internal Loop bridge's
read-only `arch-explorer` and `advisory-reviewer` roles. They can supply
candidates, evidence, and decision criteria, but cannot write this Spec/Plan or
activate execution.
Agreement becomes evidence, Disagreement becomes decision criteria, and
strong-model blockers become risks or verification requirements.
