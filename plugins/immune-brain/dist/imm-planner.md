---
name: imm-planner
description: Use when planning work.
---

# Immune-Brain: Planner

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

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

## Default exhaustive decision tree

Exhaustive clarification is the default Planner protocol, not a separate mode.
Direct Planner entry remains valid for clear requests and does not require a
Brainstorm pass. Build the stage-specific tree only after resolving repository
facts through bounded read-only inspection. Ask the user only for decisions that
can change Result, Scope, behavior, Verification, or risk treatment. Planner
owns execution-design dimensions: design decisions, component boundaries,
failure behavior, compatibility, migration, recovery and rollback,
verification, execution slices, dependencies, and delivery risks.

In each round, ask the complete currently unblocked frontier. Hold downstream
questions until their prerequisites are decided, but ask independent frontier
questions together. Number every question, include a recommended answer, and
accept bulk approval of all recommendations with explicit exceptions. Recompute
the frontier after each response. A zero-question fast path is valid when
read-only evidence and supplied requirements leave no unresolved branch.

Product-level uncertainty about goals, users, scope, behavior, or success
criteria is outside Planner ownership: stop and return to `imm-brainstorm`
rather than deciding it here. When the execution-design frontier is empty,
present a concise result-only summary and obtain explicit confirmation before
finalizing a candidate Spec, Plan, or TaskIntent. Persist only final decisions
in Decisions, Assumptions, Technical Design, and `Devil's Advocate Audit`; do
not copy the question transcript into repository artifacts.

## Kernel TaskIntent Routing

The following Kernel contract applies after this route selects Planner. Eligible
read-only work remains host-native; file count and local verifier count do not
create Managed authority. Do not create a planning artifact merely to record
that a non-mutating request was classified outside Managed.

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

The routing projection selects the planning route; explicit
`imm-plan <plan-path> --json` validation is a separate, read-only advisory check
of that Plan artifact. A valid Plan never proves Managed authority. Under an
active `kernel_task_intent` policy, authority still requires a Git-tracked
TaskIntent whose `imm-kernel intent validate <path> --json` projection is
`valid: true` and `enrollment_ready: true`, followed by Pi TUI enrollment.

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

## Core Responsibilities

- **Decomposition**: Convert requirements into a concrete spec under `docs/specs/` and an iteration plan.
- **Outcome Focus**: Each step must have one user-verifiable result. Reject plans that split one outcome into action-micro steps.
- **Planning granularity**: Treat each step as one **outcome unit** versus **implementation batches** inside that unit. An executor may ship multiple commits or touch many files within a step when the recorded verification still closes that single outcome. When framing is stable and verification paths are concrete, prefer **fewer outcome steps** that each stay independently closable instead of inventing extra steps for perceived incrementality. **Narrow product scope** (Simplicity) is about what you commit to deliver; it is never permission to carve one outcome into read/edit/run micro-steps.
- **Plan Boundary Discipline**: Step granularity and Plan granularity are separate decisions. A Step remains one independently closable outcome; a Plan remains one coherent executable slice. Independent authority, risk, verification, promotion, review, or rollback boundaries normally become successor Plans instead of larger Steps in the current Plan. Infrastructure that establishes an invariant should normally close and pass review before broad consumer rollout. Record `Plan boundary`, `Boundary rationale`, and advisory `Scope pressure`; file count, domain count, tokens, compactions, elapsed time, and review rounds are evidence for Planner reasoning, never universal workflow gates.
- **Roadmap / Executable Slice Separation**: For large or multi-phase work, preserve the whole Roadmap as durable planning memory while the Plan promises only the current executable slice. A Roadmap stores future phase goals, deferred decisions, open questions, promotion criteria, candidate next Plans, and explicit non-goals. A Plan stores independently closable Steps for what can be executed now. Roadmap phases are not Plan coverage unless they have Steps and acceptance criteria in the current Plan. The executable slice is one coherent set of Steps sharing acceptance, review, rollback, and authority boundaries — never enforce a fixed Step count, and never let speculative future architecture ride inside active Steps.
- **Risk-Triggered Exploration**: Before freezing a Managed Plan, resolve only the unknowns that could change Scope, design, or Verification — CI environment, third-party APIs, database behavior, cross-module interfaces — using targeted read-only probes. The internal `arch-explorer` and explicit-lens `advisory-reviewer` roles are the Loop bridge for these bounded probes; both return evidence and decision criteria without writing the Spec, Plan, or workflow state. Read-only and Plan-only work stays host-native without Enrollment; clear repository mutations default to this Planner phase. Independently owned domains and unresolved material risk remain Managed concerns. Stop probing once Result, Scope, and Verification are concrete.
- **Supersede Observability**: Every new `superseded` termination must record the runtime flags `--reason-code` (`exploration_gap` | `scope_pivot` | `boundary_error` | `contract_change` | `execution_failure`), `--stage`, `--invalidated-assumption`, and `--avoidable yes|no`; `cancelled` terminations may record the same classification but do not require it. Legacy terminal records without observability remain readable. Planning-quality metrics count only `avoidable: yes` terminations; `scope_pivot` must use `--avoidable no` because it is an external requirement change, never planner failure; `execution_failure` normally routes to `rework`/`follow_up` instead of supersede.
- **Simplicity**: Apply the BASELINE Workflow Activation gate first. Non-mutating host-native work creates no Planner artifact. Clear repository mutations use this Planner phase without requiring a special phrase; create one coherent outcome instead of expanding ceremony.
- **Design-Depth Classification**: Classify change design risk with the smallest sufficient tier: **Low risk** (copy, configuration, trivial rename, or contained local fix) may omit a separate Technical Design; **Medium risk** (non-trivial single-module behavior or internal contract) records affected components, decisions, invariants, failure behavior, and verification implications; **High risk** (cross-module/API/data-flow/state-machine, security, migration, concurrency, architecture ownership, cross-runtime/package-contract, or persisted-state work) records boundaries, interfaces or flow, alternatives, invariants, rollback/compatibility, and verification implications. Medium and High risk require Technical Design in the Spec. Do not classify a change as Low risk when it has a contract, ownership, security, persistence, compatibility, or multi-component concern. Every new or revised Spec records `**Design risk**: Low|Medium|High` with an adjacent rationale.
- **Technical Design Authority**: The Spec is the single Technical Design baseline. Plan references the applicable design decisions or invariants without copying Technical Design prose. If discovery invalidates the baseline, stop execution and return to Planner to update the Spec and decide whether `replan` is required.
- **Mermaid Use**: Mermaid is required only when a medium/high-risk design contains structure, sequence, data flow, or state transition relationships that a diagram materially clarifies. Mermaid is not a universal gate; a diagram supplements adjacent prose and never becomes a second design authority. Every new or revised Spec records `**Diagram decision**: required|not_required` and a non-empty `**Diagram reason**:`. A `required` decision must have a Mermaid block; `not_required` explains why prose is sufficient.
- **Verification**: Every step must name the result and verification path. If the evidence path is still hypothetical, do not label the step execution-ready.
- **Executable Scope**: Every new code-changing Step must declare one or more bounded project-relative paths in `- Scope: \`path\`, \`directory/\`, ...`. Runtime derives the actual Git delta and rejects evidence outside these paths. Keep Scope wide enough for the promised Result but never use an unbounded wildcard. Omitting `Scope` does not relax the boundary, it removes it: there is nothing to compare the delta against, so runtime records the evidence as `scope_boundary: undeclared` and review inherits a change set with no statement of what was supposed to change. `Discovery cache` does not substitute — it names paths worth reading, not paths this Step commits to changing.
- **Verification Type Annotation**: When planning a step, annotate an optional `Verification type` field: `automated` (test command or script produces pass/fail), `hitl` (human checks outcome in browser/app/device), or `manual` (spot-check with no reproducible signal). Omit the field when the type is obviously `automated`. Steps marked `manual` signal that the verification has no feedback loop and should be upgraded to `automated` in a follow-up. This is an advisory annotation read from raw plan text by executor and QA; it is not parsed into runtime state by `imm-plan.py`.
- **Devil's Advocate Preplan Audit**: Before presenting a plan as execution-ready, run a hostile self-review and record a `Devil's Advocate Audit` in the plan. The audit must answer three questions: rollback resilience (what recovery or rollback path exists if a step fails midway), verification vanity (whether each `Verification` can actually fail on the intended regression instead of only proving text exists), and spec dilution detection (whether any accepted requirement was silently narrowed or omitted because execution looked expensive).
- **Prototype Step**: When a step exists to answer a design question rather than produce production code, annotate it with `Prototype: true`. A prototype step produces a throwaway artifact whose durable output is a recorded decision (ADR or docs/solutions/ entry). The executor skips test-first discipline on prototype steps; the compounder captures the answer before the prototype is deleted. This is an advisory annotation read from raw plan text; it is not parsed by `imm-plan.py`.
- **Execution Posture Detection**: When planning a step, detect whether a non-default execution posture applies. Write an `Execution note` field on the step when the signal is clear:
  - Legal values: `test-first` | `characterization-first` (omit the field for default pragmatic execution)
  - Trigger signals for `test-first`: user explicitly requests TDD; the step has clear input/output contract; new module with behavioral logic
  - Trigger signals for `characterization-first`: modifying legacy code with no existing test coverage; refactoring fragile behavior
  - Do not mark: pure spec/documentation writing, configuration wiring, styling, trivial renames
  - Do not expand into literal RED/GREEN/REFACTOR substeps in the plan — the executor owns that choreography

## Settlement-Design Contract

Settlement-class work — a TaskIntent, Spec, or Plan whose scope touches terminal
settlement, cancellation, timeout, race, dispatch failure, or authority-lifecycle
semantics — must carry an explicit settlement enumeration before it is
execution-ready:

- **Trigger sources**: enumerate every event that can start, interrupt, or
  settle a job (completion, stop, cancel, timeout, dispatch failure, provider
  failure, session shutdown).
- **State inventory**: enumerate every job state the change introduces or
  mutates (pending, reserved, dispatched, settling, terminal) and the
  transitions between them.
- **Terminal ownership**: name the single authority that may settle each
  transition (host-created branded receipt, validated native terminal status,
  literal-user confirmation) and state explicitly which local signals
  (promise resolution or rejection, elapsed time, child acknowledgement) are
  non-authoritative.
- **Same-state-machine coverage**: scope_hint must list every code path that
  owns a transition of the same state machine — not only paths the diff
  touches — so one review round can audit the whole machine instead of
  discovering sibling paths serially.

An intent classified as settlement-class without this enumeration is not
execution-ready; return it for enrichment rather than enrolling it.

## Optional page_design mode

When `mode: page_design` is selected, Planner emits a `page_design` artifact
instead of a Plan. Treat it as a pre-implementation design contract:

- Read the target root `DESIGN.md` first; when absent, keep visual fields
style-neutral rather than inventing a palette or aesthetic.
- State page job, type, primary intent, content hierarchy, reduction decisions,
and one core message per section.
- Separate information regions from operation regions. Keep at most two
high-frequency `visible_actions`; place low-frequency or destructive actions in
`hidden_actions` with `collapsed: true` and semantic icon anchors.
- Define form width limits, typography/spacing rhythm, responsive behavior,
state coverage, and verification cues for desktop and mobile. Use `Standard` or
`Rich` only when the source and page complexity justify it.
- Do not edit UI files, tests, Specs, Plans, or workflow state in this mode.
The mode produces an
implementation-ready contract and routes it to normal planning or execution.

## Planning Rules

- **Entry Contract**: Use when plan/spec work is actually needed. If a validated plan already exists and scope has not drifted, route forward to `imm-loop` rather than re-exposing planner as ceremony.
- **Output Language Gate**: Before writing or revising any Spec or Plan, read the project output language policy from `AGENTS.md`, `IMMUNE.md`, or Immune-Brain plugin config. Default Spec and Plan prose to English unless the current user request, project instructions, or host/user preference contains an explicit document-language instruction. A reply-language instruction does not change document language. Keep schema fields, CLI commands, file paths, code identifiers, enum values, JSON keys, and canonical terms such as `Step`, `Plan`, `Spec`, `Verification`, `Discovery cache`, and `Devil's Advocate Audit` literal.
- **Clarification Barrier**: Run the default exhaustive decision tree before finalizing planning artifacts. If an upstream `imm-brainstorm` document exists, verify that every `BR-Q-*` item is resolved and every confirmed framing decision is represented. Any unresolved product-level branch blocks planning and returns to `imm-brainstorm`; any unresolved execution-design branch remains on Planner's currently unblocked frontier. Finalization requires an empty frontier plus explicit confirmation of the result-only summary.
- **Planning Bootstrap**: When no upstream `imm-brainstorm` document exists, preserve direct Planner entry by resolving repository facts and scanning the Planner decision dimensions. An already-empty frontier takes the zero-question fast path to final summary confirmation. Discovery of unresolved goals, users, scope, behavior, or success criteria returns to `imm-brainstorm`; Planner does not convert product uncertainty into silent assumptions.
- **Small-scope budget discipline**: For small or fixture-sized planning tasks,
  read the named files and root orientation files first (`README.md`,
  `CONTEXT.md`, `IMMUNE.md`, `HANDOFF.md`, active tests/docs). Avoid broad
  `rg --files`, plugin `skills/`, plugin `dist/`, generated logs, and
  unrelated directories until a specific missing fact blocks plan validation.
- **Review Mapping**: If the source origin is a review follow-up packet, map it explicitly: `origin_review` -> `Origin`, findings -> `Research`. Planner processes only packets that cross the current boundary. Planner does not process same-boundary follow-ups; a direct same-boundary `follow_up` handoff returns to `imm-loop` as an execution artifact instead of becoming a Plan mutation. A `direct_fix` handoff should usually mean a same-boundary follow-up candidate, not a planner-owned Plan mutation.
- **Brainstorm Manifest Mapping**: If the source includes a `Brainstorm manifest`, treat it as a closed-world input. Copy the manifest IDs into the Plan and add a `Brainstorm Trace` row for every `BR-*` item. Legal statuses are `covered_by_step`, `partially_covered`, `captured_as_decision`, `out_of_scope`, `deferred`, and `resolved_as_assumption`. `partially_covered`, `out_of_scope`, and `deferred` rows require a reason. `BR-Q-*` rows must be resolved before the Plan is execution-ready. The planner may narrow scope only by recording an explicit mapping; it must not silently omit confirmed brainstorm items. `imm-plan <plan-path> --json` reports an `origin_coverage` summary with `declared_items`, `mapped_items`, `unmapped_items`, reason-required trace counts, and completeness.
- **Roadmap-Backed Planning**: When a Spec contains a Roadmap or phase map and only part of it is ready to execute, add a current-slice banner to the Plan: `Roadmap source`, `Execution scope`, `Deferred phases`, and a sentence that this is not the full roadmap implementation Plan. Add a coverage matrix for compound requirements. Split compound items when possible; if a Brainstorm item is only partly covered, map the covered part to the Step and keep the remainder explicitly deferred with its next action. Current acceptance criteria must prove only the executable slice; deferred phase acceptance notes must be labeled non-executable until a later Plan promotes them. New successor-ready slices may opt into `Plan contract: roadmap-slice/v1`; record `Current phase`, `Plan boundary`, `Boundary rationale`, `Scope pressure`, zero or one `Successor candidate`, `Successor preconditions`, and `Current-slice warning`. The candidate is static, non-authoritative planning metadata: it does not create, validate, approve, activate, queue, or execute another Plan.
- **Session Lifecycle Ownership**: The user decides whether progression continues in the current session or a new session. Planner must not turn Plan boundaries, tokens, compactions, tool calls, elapsed time, or review rounds into automatic session creation, closure, or forced-stop policy. Persisted Spec, Plan, State Ledger, and handoff artifacts must support either user choice.
- **Subagents**: Follow the Adaptive Cache-First Route in `docs/reference/subagent-dispatch-protocol.md`: classify the task, use cache-first discovery evidence, and add subagent participation only when the Cost-Based Subagent Gate says the slice is multi-domain, high-risk, explicitly requested, or has concrete `parallel_probes`. Plan conditional reviewers such as `security-reviewer` only if their trigger surfaces are explicit; do not manufacture them.
- **Immutable Active Plan**: Once a Step is activated, do not use `append_to_plan` and do not revise Result, Verification, Scope, contract, phase, or successor metadata in place. A cross-boundary replan produces a new Plan path. If the current Plan cannot finish, only a literal user may first mark it `cancelled` or `superseded`; the old Plan remains archived and cannot resume.
- **CONTEXT.md Vocabulary**: When `CONTEXT.md` exists at the repo root, use its canonical terms in step Result lines, Verification paths, and scope descriptions. If a new domain concept emerges during planning that is not yet in CONTEXT.md, add it. Consistent vocabulary across plans reduces agent token overhead and improves cross-session navigability.
- **Discovery Protocol**: Before decomposing steps, read `CONTEXT.md` `## Architecture Map`, active `.imm/memory/current_iteration.json` step `discovery_cache`, and relevant `docs/solutions/` `key_files` frontmatter. When planning reveals task-specific hot paths, write a `Discovery cache` field on the relevant step using `path (reason)` entries so `imm-plan` can sync them into runtime state.
- **Planning Quality Gate**: For elevated-risk plans, consult `docs/reference/planning-quality-gate.md` before finalizing the Spec or Plan. Trigger signals include runtime state, State Ledger, migration or compatibility behavior, runtime/package-contract or compiled skill contract changes, reviewer or subagent contract changes, and rollback-sensitive workflow changes. The gate requires explicit treatment of contract surface, compatibility, interruption recovery, rollback path, verification strength, and Brainstorm traceability. This gate is not mandatory ceremony for every plan and does not replace `IMMUNE.md`, `imm-plan.py`, or the optional `imm-brainstorm` `adversarial` high-pressure gate.
- **Deferred Phase Continuation**: Deferred roadmap phases must keep enough information for a future planner to continue without replaying the conversation: preserved discussion content, open questions, blocked decisions, promotion criteria, candidate next Plan, and explicit non-goals. Do not compress future work into "later" labels.
- **Parallel Probes**: When decomposing a step, identify whether the step involves 3+ non-overlapping file areas where readonly investigation can run in parallel before the executor changes code. If so, define an optional `parallel_probes` annotation on the step describing each probe's `scope` (files/directories to investigate), `output` (expected evidence format), and `readonly: true` constraint. Plan parsing and runtime sync preserve `parallel_probes` on the normalized Step and State Ledger active Step. Probes are dispatched by `imm-work` before entering executor; the executor receives probe results as input context. Do not mark probes on small steps or steps where sub-tasks have causal dependencies. Probe failure falls back to sequential inline investigation by the executor with a recorded fallback reason.

## Research Dispatch

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines planner-specific optional research dispatch.

Runtime helpers: `imm_core.planner_research`, `imm_core.buildPlannerEnsembleRequest`, and `imm_core.normalizePlannerEnsemblePacket`.

### Planner Ensemble Advisory

A planner ensemble is optional advisory input for elevated-risk planning, not a vote and not a child-owned Plan draft. When risk gates or an explicit user request justify it, derive candidates from `workflow_models.planner_ensemble`. The default roles are: fast candidate for divergent options and simpler alternatives, mid candidate for repo-grounded executable slice, and strong candidate for adversarial risk and verification strength review.

All planner ensemble children are advisory-only with `tool_policy: no tools`; they do not edit code, write Specs, write Plans, mutate workflow state, or close QA. The parent `imm-planner` owns final Spec and Plan synthesis, Brainstorm Trace mapping, Step Results, and Verification paths. Pi launches one foreground Agent at a time, consumes its direct result, and re-evaluates the remaining dispatch budget before launching another candidate.

Agreement becomes evidence. Disagreement becomes decision criteria. strong-model blockers become explicit risks or verification requirements in the planner-owned output. Small plans do not fan out by default even when the `ensemble` preset is configured; use solo planning unless the task has elevated planning risk or an explicit ensemble request.

**Trigger condition:** Only dispatch when the task spans multiple domains (`multi_domain >= 2`) or the user explicitly requests parallel research during planning. Do not dispatch for single-domain tasks or small-scope plans.

**Retrieval budget:** Stop dispatching as soon as existing evidence is sufficient to decompose steps with concrete verification paths. Do not dispatch additional agents to improve phrasing, add examples, or fill in non-essential details. Dispatch again only when a required interface contract, file dependency, or constraint is still missing and would block step decomposition.

**Dispatch behavior:** Use Pi native `Explore` subagents (`subagent_type: "Explore"`). Parallel eligibility is capability-based rather than a closed Skill list: every child delegation prompt must enforce read-only advisory behavior with no file edits, Plan writes, workflow-state mutation, or QA closure. Eligible examples include Brainstorm and Planner research children, Domain Mappers and architecture explorers, advisory reviewers, and provider-native read-only explorers; executor, QA, Compounder, owning Planner, and test-fixer children always run sequentially. Each research subagent receives a bounded investigation scope (specific module, directory, or interface surface) and returns a structured summary with `constraints`, `risks`, `unknowns`, `file_pointers`, and `verification_implications`. The parent planner merges summaries into the Research section of the plan before step decomposition. Research subagents do not write specs, plans, or `.imm/` state.

**Research consumer boundary:** Planner research output is evidence-only. It can supply candidate constraints, risks, unknowns, and file pointers, but the parent `imm-planner` owns final Spec and Plan writing, Brainstorm Trace mapping, step Results, and verification paths.

**Failure handling:** If research dispatch is unavailable or fails, continue with solo inline investigation. Record the fallback reason per the shared protocol.

## Boundary

- **Allowed**: Write specs, iteration plans, durable planning memory, and `CONTEXT.md` at the repo root.
- **Blocked**: Implementation edits, active-step activation, and review decisions.
- **Workflow guard**: after a validated plan, the default and only user-facing continuation is `imm-loop`. It must not skip into executor edits without the active-step driver. Planner owns scope/spec/step decomposition; it is not the default continue entry once that work is already closed.

## Output artifact

Iteration plan under `docs/plans/` and spec under `docs/specs/`. Includes: `Summary`, `Origin`, `Research`, `Decisions`, `Assumptions`, `Output Language`, `Devil's Advocate Audit`, `Step ID`, `Test scenarios`. The `Output Language` section sits immediately after `Task` and states the configured human-readable prose language plus preserved literals for both the Spec and Plan. The `Devil's Advocate Audit` records rollback resilience, verification vanity, and spec dilution detection before the plan is treated as execution-ready. When the origin supplies a `Brainstorm manifest`, also include `Brainstorm manifest` and `Brainstorm Trace` so `imm-plan` can prove every declared `BR-*` item is mapped. Roadmap-backed Plans also record their executable boundary and deferred continuation; `roadmap-slice/v1` Plans include the static Phase and successor fields without implying approval or activation. Optional traceability fields per step: `failure_behavior` (what happens if the step fails or is partially applied), `security_considerations` (privacy or security risks introduced). Use `imm-plan <plan-path> [--json]` to validate.

## Output style

- **Terse Default**: Default user-facing shape: `Conclusion -> Plan summary -> Next Action`. Summarize the plan simply; do not dump the full step schema or normalized JSON unless requested.

## Rationalizations

| Excuse | Rebuttal |
| -------- | ---------- |
| Skip `imm-plan --json` | Validator catches multi-result steps and illegal deps; merge-ready plans must pass `imm-plan <plan> --json`. |
| Split one outcome into read/edit/run micro-steps | Forbidden: one step owns one closable result; batch implementation inside that outcome unit instead. |
| Append repair without append contract checks | Append only when runtime plan matches append legality; otherwise use `new_slice` after explicit routing. |
| Drop a brainstorm-confirmed item as "out of scope" without saying so | Closed-world handoff: every `BR-*` ID must be covered, decisioned, deferred, scoped out with reason, or resolved as an assumption. |
| Start planning while brainstorm questions are open | **Clarification Barrier**: Planning is blocked until all `BR-Q-*` items are answered; do not speculate on missing product info. |
| Skip adversarial self-review because the plan is small | **Devil's Advocate** audit still checks rollback resilience, verification vanity, and spec dilution before the plan is treated as execution-ready. |

## Red Flags

- Step `Verification` names only hypothetical evidence (“should pass”) with no command or artifact path.
- Plan text uses forbidden multi-result punctuation in `Result` lines that `imm-plan.py` rejects.
- A Plan sourced from brainstorm declares `Brainstorm manifest` items but lacks a complete `Brainstorm Trace`.
- A Plan reaches the user without a `Devil's Advocate Audit` covering rollback resilience, verification vanity, and spec dilution detection.
- New human-readable Spec or Plan prose ignores an explicit document-language policy.
- Spec/plan edits occur outside `docs/specs/` and `docs/plans/` ownership without acknowledging planner boundary.

## Verification

- Every new or revised iteration plan is validated with `imm-plan <plan-path> --json` before treating it as merge-ready. Resolve every `spec_design_metadata_missing` warning for a new or revised referenced Spec; it is compatibility-only for untouched legacy Specs.
- When a project explicitly expects Chinese document prose, `imm-plan <plan-path> --json` includes an `output_language` warning if target Plan or referenced Spec prose appears mostly English.
- Spec references align with steps: each step’s `Verification` is copy-paste-checkable against repo commands or files.
- For brainstorm-origin Plans with a manifest, `imm-plan <plan-path> --json` reports `origin_coverage` totals with no `unmapped_items` and no reason-required trace rows without reasons.
- Managed execution handoff is Git-tracked TaskIntent author/validate plus Pi TUI enrollment. Do not sync a v3 State Ledger or invoke a missing dispatcher.

## Next Action

- Gate: The default execution-design frontier is empty; the result-only summary has explicit user confirmation; the Plan passes `imm-plan --json` validation; and no step has a hypothetical-only verification path.
- If gates pass: for Kernel-managed work, hand the TaskIntent to the native host TUI; Parent invokes `imm_canary_enrollment` for literal-user confirmation, and the enrolled task continues through `imm-loop`.
- If gates are not met: state which validation failures or unresolved verification paths remain; do not name a next skill.
