---
name: imm-planner
description: Use to create or revise a spec and TaskIntent from requirements; owns scope and decomposition, not implementation or Enrollment.
---

# Immune-Brain: Planner

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Managed Request Routing

`imm-planner` is entered explicitly by the user for a clear repository mutation.
Ordinary host input does not invoke this Skill through natural-language routing.
An active Assurance projection remains authoritative and is resumed only through
an explicit `imm-loop` entry; explicit Planner entry owns planning and the later
native Enrollment gate.

Plan-only output remains non-authoritative. Planner creates or validates a
candidate Spec/TaskIntent, but it never enrolls a task or enrolls generated
artifacts unconditionally. Explicit Plan-only requests stop after returning the
planning artifacts. A later literal-user request to start Enrollment is a
non-authoritative execution trigger: invoke the native Enrollment gate directly,
without asking for chat pre-confirmation. For a clear mutation request that
already includes execution, invoke that gate as soon as the candidate is
validated and Git-tracked. Literal-user confirmation in the current Host's
native gate remains the authority boundary. A gate failure preserves candidate
artifacts and reports its reason plus exactly one same-Host recovery action; it
must never recommend another Host, worktree, Direct Path, unmanaged
implementation, or automatic retry. Fast-Track may compress the same phases but
cannot bypass that boundary, QA, Review, authorization, or completion.

## Clarification supplement

Planner consumes an upstream Brainstorm manifest as closed-world framing and
must not repeat, reopen, or rewrite confirmed decisions. Direct Planner entry
and Medium/High Design Risk work must inspect relevant ADRs and rejected
Learnings. It resolves repository facts, performs reference closure, and owns
ordinary technical choices:
component boundaries, internal interfaces, failure behavior, compatibility,
migration, recovery and rollback, Verification, execution slices, dependencies,
scope, and delivery risk. Persist that design in the candidate Spec and
TaskIntent rather than copying the question transcript.

Planner may ask only when concrete new evidence exposes an omission, repository
conflict, or invalidated assumption. Ask the focused decision delta, cite the
upstream `BR-*` item and new evidence when available, and preserve all unaffected
decisions. Resolve a local delta here. If the answer reopens multiple product
branches or changes the overall goal or Scope, stop and return to
`imm-brainstorm`.

Direct Planner entry remains valid for a clear request and does not require a
Brainstorm pass. Resolve facts and derive technical design; if an unresolved
user-owned product decision appears, return to `imm-brainstorm` rather than
silently choosing it or starting a second exhaustive interview. A zero-question
fast path is valid when no clarification supplement is required. Present an
unchanged result summary as a non-blocking correction window and do not ask the
user to reconfirm existing decisions. If the summary itself introduces or
changes a user decision, confirm only that decision delta before finalizing.

## Kernel TaskIntent Routing

The following Kernel contract applies after this route selects Planner. Eligible
read-only work remains host-native; file count and local verifier count do not
create Managed authority. Do not create a planning artifact merely to record
that a non-mutating request was classified outside Managed.

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
  through the current Host's explicit `imm-planner`;
- an invalid, unreadable, untracked, or tracked-deleted policy rejects new
  planning authority with `routing_policy_invalid`;
- no Planner path enrolls a task or falls back to v3 after retirement.

Current owner, phase, completion, and authority facts are authoritative only
when read from the Assurance projection and TaskRecord. `CONTEXT.md` is
non-authoritative vocabulary and architecture navigation, not a workflow-status
source. If its prose conflicts with those authority facts, report stale
documentation, preserve projection-based routing, and do not automatically
synchronize either representation.

Historical prose Plans are read-only artifacts. Their validation never proves
Managed authority and is not a prerequisite for new TaskIntent planning. New
execution requires a Git-tracked TaskIntent whose
`imm-kernel intent validate <path> --json` projection is
`valid: true` and `enrollment_ready: true`, followed by current-Host native
Enrollment.

Host identity is implicit and never a planning input. The production boundary
that turns a Git-tracked TaskIntent draft into managed execution authority is
the current Host's native Enrollment gate. Invoke that Host integration
directly when the route is ready; do not ask for chat pre-confirmation. The
single literal-user decision is bound to the TaskIntent revision, content hash,
and preparation digest. Enrollment validates the intent, Git ownership, scope,
workspace claim, and final authority preconditions without executing acceptance
descriptors. A routine task proceeds from that single confirmation through
enrollment, execution and QA without a second human stop.

Before authoring a TaskIntent, trace each expected behavior from its public or
runtime entry point through existing imports and callers to the highest focused
behavioral tests. Include generated or packaged mirrors and every owner of the
same state machine. Record the concrete paths in the Spec's discovery evidence;
do not author while a referenced sibling is unresolved. Use the smallest
coherent module directory for ordinary implementation scope. Keep Kernel,
authority, migration, secret, and security-sensitive scope exact to the files
proved necessary by the trace. Scope is closed by reference evidence, not by an
exhaustive filename guess.

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
the named Initiative, its immutable slug, and the complete Parent/Child
decomposition before the first remote mutation. A prior bulk approval cannot
confirm a name, slug, Child, or dependency that had not yet been shown.

Once decomposition is complete, present one review table containing the Parent
result and every Child's stable Slice ID, result, scope boundary, risk, blockers,
and proposed execution order. Ask one focused question: whether the coverage,
granularity, and dependencies are correct. Recommend the complete current
frontier so the user can approve it in one response. Before that approval,
perform zero GitHub mutations. A partial or progressively disclosed issue set is
not eligible for publication.

After approval, author, stage, and validate every TaskIntent in the decomposition
with `valid: true` and `enrollment_ready: true`. Resolve `../bin/imm-tracker` from this packaged contract; do not assume a bare command is on `PATH`. Submit the entire approved set once through
`imm-tracker publish-initiative --stdin --json`. Its input contains the confirmed
Initiative slug and goal, Parent projection, and every Child's `slice_id`,
canonical TaskIntent path, and public projection. The Parent projection requires
`problem`, `result`, and `design`, and may include `decisions`,
`testing_strategy`, and `out_of_scope`. `design` records Initiative-level
invariants, Slice boundaries and ordering, shared interfaces or state flow, and
material compatibility decisions. Every Parent Slice must correspond to one
published Child; future checklist-only Slices are not allowed in the batch.

Each Child projection may contain `result`, `current_behavior`,
`desired_behavior`, `key_interfaces`, `verification`, `blocked_by` Task IDs,
`out_of_scope`, and `agent_handoff`. The tracker rereads every canonical
TaskIntent for identity, risk, and acceptance; projection fields never widen
TaskIntent scope or authority. It validates the complete dependency graph before
remote writes, creates the Parent once, creates all Children, attaches every
Child as a native Sub-issue, creates native `blocked_by` relations, and rereads
the complete topology. The Child Agent Brief includes a direct Parent Issue link.
Internal role prompts, tool policies, review gates, model reservations, and
prompt digests never belong in this external handoff. If
`docs/initiatives/<slug>.md` exists, publication fails with a carrier conflict;
Local mode performs zero GitHub operations.

The batch result includes an execution recommendation: the first unblocked Task,
a stable dependency order, and parallel groups. For a plan-only request, report
that recommendation and stop. For a request that includes execution, invoke the
native Enrollment gate for the recommended first TaskIntent after successful
publication; do not ask for another chat confirmation. GitHub selection never
bypasses Enrollment.

Tracker output is observation, never authority. Before the Planner returns, its
GitHub carrier outcome must be exactly one of: `tracker_associated` after the
complete batch returns `created`, `updated`, or `already_current`;
`awaiting_user_initiative_confirmation` with the single pending name, slug, and
complete-decomposition decision; or `tracker_projection_failed` with the returned
failure and exact retry action. A candidate Initiative or partial Issue set
recorded only in the Spec or final summary is neither user confirmation nor a
completed carrier outcome. Report `retryable_failure`, `permanent_failure`, or
`ambiguous_remote_state` and the exact batch retry action. This does not invalidate
already-authored planning files, but it blocks `tracker_associated` and every
Enrollment or execution handoff for that Initiative until the same complete
batch succeeds. Do not infer opt-in from tracker output or Issue state, auto-close the Parent,
import Issue state, create a TaskIntent from an Issue, or store Issue identity in
TaskIntent or TaskRecord. Existing Issue markers grant permission only for
idempotent retry of that same approved Initiative; they never grant execution
authority.

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

## Core Responsibilities

- **Decomposition**: Convert requirements into a concrete spec under `docs/specs/` and one or more TaskIntents. Treat Technical Design as one TaskIntent decomposition dimension alongside outcome, Verification, dependency, risk, rollback, compatibility, and authority.
- **Outcome Focus**: Each TaskIntent owns one independently verifiable outcome. Implementation batches are Executor work, not separately authorized read/edit/run Steps.
- **Planning granularity**: Keep a coherent outcome together when acceptance, risk, rollback, and authority can settle together. Use the TaskIntent decomposition rules below for independent outcomes. File count, tokens, compactions, elapsed time, and review rounds are evidence for judgment, not universal gates.
- **Historical artifacts**: v3 prose Plan mutation is retired. `imm-plan` is a read-only validator for archived Plans; create no new Roadmap, Phase, successor Plan, or State Ledger.
- **Risk-Triggered Exploration**: Before authoring a TaskIntent, resolve only unknowns that could change scope, design, or verification using targeted read-only probes. Internal `arch-explorer` and explicit-lens `advisory-reviewer` roles return evidence without writing the Spec, TaskIntent, or workflow state. Stop probing when outcome, scope, and verification are concrete. Do not use retired Plan termination flags to classify discovery failures.
- **Simplicity**: Apply the BASELINE Workflow Activation gate first. Non-mutating host-native work creates no Planner artifact. Explicit Immune-Brain Skill entry starts this Planner phase; ordinary host input does not invoke it through natural-language routing. Create one coherent outcome instead of expanding ceremony.
- **Design-Depth Classification**: Classify change design risk with the smallest sufficient tier: **Low risk** (copy, configuration, trivial rename, or contained local fix) may omit a separate Technical Design; **Medium risk** (non-trivial single-module behavior or internal contract) records affected components, decisions, invariants, failure behavior, and verification implications; **High risk** (cross-module/API/data-flow/state-machine, security, migration, concurrency, architecture ownership, cross-runtime/package-contract, or persisted-state work) records boundaries, interfaces or flow, alternatives, invariants, rollback/compatibility, and verification implications. Medium and High risk require Technical Design in the Spec. Do not classify a change as Low risk when it has a contract, ownership, security, persistence, compatibility, or multi-component concern. Every new or revised Spec records `**Design risk**: Low|Medium|High` with an adjacent rationale.
- **Design-view selection**: For Medium and High risk, select every materially relevant technical-design view from architecture layers, service/component interfaces, data flow, state transitions, and temporal sequence. Record a short `Design views` statement naming the selected views and why any omitted view cannot affect the design. Do not write empty architecture, interface, data-flow, state, or sequence sections. Low risk remains concise and may omit Technical Design. When a selected view is recorded, also record its required decision content: architecture layers need layer responsibilities, dependency direction, ownership, and prohibited coupling; service/component interfaces need inputs, outputs, errors, compatibility/versioning, and caller/callee ownership; data flow needs source, transformations, validation, destination, and failure handling; state transitions need states, legal transitions, trigger, invariant, terminal ownership, and recovery; temporal sequence needs ordered interactions, authority at each point, interruption behavior, and idempotency.
- **Technical Design Authority**: The Spec is the single Technical Design baseline. TaskIntent acceptance and scope reference the applicable design decisions or invariants without copying Technical Design prose. If discovery invalidates the baseline, stop execution and return to Planner to update the Spec and decide whether `replan` is required. TaskIntent and Initiative text do not duplicate Technical Design prose or become a prose Plan substitute.
- **TaskIntent decomposition**: Use the selected design boundaries as one retain/split criterion for TaskIntent slices. Keep work in one TaskIntent when the selected views describe one coherent executable slice with shared acceptance, risk treatment, rollback, and authority. Split a successor TaskIntent when a service boundary, state-machine owner, migration/compatibility boundary, independently promotable layer, or sequence dependency needs independent verification, rollback, authorization, or settlement. Do not split merely because the design names several layers, files, or services. Treat trust-boundary changes as the same kind of decomposition evidence: a TaskIntent should normally change one primary trust-boundary invariant, while merely traversing several boundaries or updating both sides of one end-to-end authority chain does not require a split. Split separate trust invariants when they can be independently verified, rolled back, authorized, migrated, or settled. Keep multiple trust-boundary changes together only when they form one atomic security outcome and splitting would create an unsafe or unusable intermediate state; record that reason in the Spec. This is Planner judgment, not a TaskIntent schema field or an Enrollment counting rule. This does not revive prose Plan, Roadmap, or Phase authority.
- **Mermaid Use**: Mermaid is required only when a medium/high-risk design contains structure, sequence, data flow, or state transition relationships that a diagram materially clarifies. Mermaid is not a universal gate; a diagram supplements adjacent prose and never becomes a second design authority. Every new or revised Spec records `**Diagram decision**: required|not_required` and a non-empty `**Diagram reason**:`. A `required` decision must have a Mermaid block; `not_required` explains why prose is sufficient.
- **Verification**: Every acceptance assertion has a concrete focused descriptor that can fail on the intended regression. Hypothetical evidence is not execution-ready.
- **Executable Scope**: `scope_hint` is the mutation envelope, not discovery context. Close references across callers, tests, generated mirrors, and state-machine owners before authoring. Include bound active and archive Spec paths needed for `freeze_artifacts`. Collect all known scope gaps in one revision request; ask again only when new evidence changes the boundary.
- **Devil's Advocate Preplan Audit**: Record a `Devil's Advocate Audit` in the Spec covering rollback resilience, verification vanity, and spec dilution detection. Explain recovery from partial implementation, why verification detects the regression, and how accepted requirements remain covered.
- **Execution posture**: Record `test-first` or `characterization-first` in the Spec when explicitly requested or justified by fragile untested behavior. The Executor owns the local choreography; do not create prototype or RED/GREEN/REFACTOR authority Steps. Throwaway probes must have a cleanup condition and a durable decision output.

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

## Retirement Completion Contract

For retirement-class work, deletion of source and contract text is a completion condition. A retirement that routes the command to a retirement wall, pins the absence with test assertions, and leaves the source in the tree is not complete. A retirement is not complete until the source and its contract text are deleted.

An absence test is transitional scaffolding proving an in-progress deletion rather than a substitute for one. An absence test is transitional evidence of an in-progress deletion and may not stand in place of one. It proves a deletion in progress, not a completed result. Distinguish an absence assertion that guards something already gone, which is durable and correct, from one that stands in for a deletion still owed, which is a promise recorded as if it were a result.

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

- **Entry Contract**: Use when Spec/TaskIntent planning is needed. An already enrolled owner remains on its current Kernel authority and resumes only through explicit `imm-loop`; a validated candidate still needs native Enrollment.
- **Output Language Gate**: Before writing or revising any Spec or Plan, read the project output language policy from `AGENTS.md`, `IMMUNE.md`, or Immune-Brain plugin config. Default Spec and Plan prose to English unless the current user request, project instructions, or host/user preference contains an explicit document-language instruction. A reply-language instruction does not change document language. Keep schema fields, CLI commands, file paths, code identifiers, enum values, JSON keys, and canonical terms such as `Step`, `Plan`, `Spec`, `Verification`, `Discovery cache`, and `Devil's Advocate Audit` literal.
- **Clarification Supplement**: If an upstream `imm-brainstorm` manifest exists, verify that every `BR-Q-*` item is resolved and every confirmed framing decision is represented; must not repeat, reopen, or rewrite confirmed decisions. Ask only a focused omission, repository-conflict, or invalidated-assumption delta tied to concrete evidence. Resolve a local delta here; return to `imm-brainstorm` when it reopens multiple product branches or changes the overall goal or Scope. Finalization requires no unresolved supplement and no unconfirmed decision introduced by Planner.
- **Planning Bootstrap**: When no upstream `imm-brainstorm` manifest exists, preserve Direct Planner entry by resolving repository facts and deriving ordinary technical choices. An already-clear request takes the zero-question fast path to a non-blocking correction summary. Discovery of an unresolved user-owned goal, user, scope, behavior, compatibility preference, risk acceptance, or success criterion returns to `imm-brainstorm`; Planner does not convert product uncertainty into a silent assumption or duplicate Brainstorm's interview.
- **Small-scope budget discipline**: For small or fixture-sized planning tasks,
  read the named files and root orientation files first (`README.md`,
  `CONTEXT.md`, `IMMUNE.md`, `HANDOFF.md`, active tests/docs). Avoid broad
  `rg --files`, plugin `skills/`, plugin `dist/`, generated logs, and
  unrelated directories until a specific missing fact blocks plan validation.
- **Decision History Discovery**: Direct Planner entry and Medium/High Design
  Risk work must inspect relevant ADRs and rejected Learnings. Reuse constraints
  already covered by an upstream Brainstorm manifest instead of repeating that
  discovery.
- **Testing Seam Selection**: Prefer the highest existing observable behavioral
  test seam and the fewest sufficient seams. Cite relevant test prior art and
  explain how the selected seam catches the intended regression. This is a
  planning heuristic: it must not weaken acceptance-specific focused
  verification descriptors or add a mandatory user confirmation.
- **Review Mapping**: In-scope rework stays with the enrolled TaskIntent and explicit `imm-loop` entry. Cross-scope findings become a Planner decision delta with concrete missing paths and verification evidence; do not create a successor prose Plan.
- **Brainstorm Manifest Mapping**: Record every upstream `BR-*` item in a Spec `Brainstorm Trace`, mapped to TaskIntent acceptance, a captured decision, or an explicit reason for deferral or exclusion. Resolve every `BR-Q-*` item before handoff. Do not silently narrow confirmed framing.
- **Session Lifecycle Ownership**: The user chooses the current or a new session. Tokens, compactions, tool counts, elapsed time, and review rounds never trigger automatic session creation or termination. Recovery uses TaskRecord and the fresh Kernel projection.
- **Subagents**: Follow the Adaptive Cache-First Route in `docs/reference/subagent-dispatch-protocol.md`: classify the task, use cache-first discovery evidence, and add subagent participation only when the Cost-Based Subagent Gate says the slice is multi-domain, high-risk, explicitly requested, or has concrete `parallel_probes`. Plan conditional reviewers such as `security-reviewer` only if their trigger surfaces are explicit; do not manufacture them.
- **Enrolled Intent**: Planner never overwrites an enrolled TaskIntent. Scope or acceptance changes use Kernel revision authority; breaking revisions invoke the native gate directly with the complete next intent. Preserve the prior on-disk sidecars until Kernel applies the revision.
- **CONTEXT.md Vocabulary**: Read `CONTEXT.md` at the repo root. Use canonical terms in Spec, acceptance, and scope descriptions. `CONTEXT.md` is vocabulary and architecture navigation, not execution state.
- **Discovery Protocol**: Read `CONTEXT.md` `## Architecture Map` before broad searching and relevant `docs/solutions/` evidence. Record concrete file pointers and reasons in the Spec. Do not read or write a legacy Step discovery cache.
- **Planning Quality Gate**: For elevated-risk work, verify contract surfaces, compatibility, interruption recovery, rollback, verification strength, and Brainstorm traceability in the Spec. Do not invoke retired Plan mutation or State Ledger synchronization.
- **Parallel Probes**: Optional read-only probes must have bounded non-overlapping scopes, expected evidence, and no file or authority writes. They are advisory discovery, not persisted Step annotations. Probe failure falls back to inline investigation with a recorded reason.

## Research Dispatch

Follow [`docs/reference/subagent-dispatch-protocol.md`](docs/reference/subagent-dispatch-protocol.md) for the full dispatch lifecycle. This section defines planner-specific optional research dispatch.

Use `imm_loop_action` for bounded `arch-explorer` and explicit-lens
`advisory-reviewer` routing. Invoke the returned foreground Agent envelope
exactly. The Parent owns Spec/TaskIntent synthesis, Brainstorm traceability,
acceptance, and scope; children return evidence only. On Pi the `arch-explorer` envelope
uses `subagent_type: "Explore"`; invoke the returned envelope rather than
constructing another Agent call. Do not invoke retired Planner runtime helpers
or write child-owned planning artifacts.

An optional planner ensemble is advisory-only; the Parent owns the final Spec and TaskIntent.
Agreement becomes evidence, not authority. Disagreement becomes decision criteria,
not a new confirmation gate. Do not treat strong-model blockers as authority
without concrete evidence for the requested outcome.

Stop discovery once concrete interfaces, paths, constraints, and verification
are known. Additional reviewers are not required to improve wording. If an
optional advisory dispatch fails, continue inline and record the reason.

## Boundary

- **Allowed**: Write candidate Specs and TaskIntents, Initiative planning carriers, and necessary domain vocabulary.
- **Blocked**: Implementation edits, direct Kernel-store writes, enrolled intent overwrites, and QA/Review decisions.
- **Workflow guard**: Execution continues through native Enrollment and explicit `imm-loop`. Planner owns design and decomposition, not execution authority.

## Output artifact

Spec under `docs/specs/` plus canonical candidate
`docs/plans/<task-id>.intent.json`. The Spec records outcome, discovery evidence,
decisions, assumptions, Technical Design when required, output language,
`Devil's Advocate Audit`, and acceptance/test mapping. Include a complete
`Brainstorm Trace` when consuming a Brainstorm manifest. TaskIntent is authored
and validated through `imm-kernel`; do not write a prose iteration Plan or sync
a State Ledger. Keep historical Plan validation strictly read-only.

## Output style

- **Terse Default**: Default user-facing shape: `Conclusion -> Plan summary -> Next Action`. Summarize the plan simply; do not dump the full step schema or normalized JSON unless requested.

## Rationalizations

| Excuse | Rebuttal |
| -------- | ---------- |
| Skip TaskIntent validation | Author, stage, and validate the canonical candidate before native Enrollment. |
| Split one outcome into read/edit/run micro-steps | One TaskIntent owns one closable outcome; Executor owns implementation batches. |
| Append repair outside scope | Return the complete known scope delta for Kernel revision; do not widen execution. |
| Drop a brainstorm-confirmed item as "out of scope" without saying so | Closed-world handoff: every `BR-*` ID must be covered, decisioned, deferred, scoped out with reason, or resolved as an assumption. |
| Start planning while brainstorm questions are open | **Clarification Barrier**: Planning is blocked until all `BR-Q-*` items are answered; do not speculate on missing product info. |
| Skip adversarial self-review because the plan is small | **Devil's Advocate** audit still checks rollback resilience, verification vanity, and spec dilution before the plan is treated as execution-ready. |

## Red Flags

- Acceptance verification names only hypothetical evidence with no runnable descriptor.
- New work depends on a prose Plan validator, Step activation, or State Ledger.
- A Brainstorm manifest lacks a complete Spec `Brainstorm Trace`.
- A Spec lacks a `Devil's Advocate Audit` covering rollback resilience, verification vanity, and spec dilution detection.
- New Spec prose ignores the document-language policy.
- Candidate artifacts escape the approved planning scope.

## Verification

- Validate every candidate through `imm-kernel intent validate <path> --json` after authoring and staging. Require `valid: true` and `enrollment_ready: true` before Enrollment.
- Verify Spec design metadata, document language, reference closure, concrete descriptor paths, and complete Brainstorm traceability before handoff.
- Enrollment validates descriptor structure only. Deterministic QA owns descriptor execution after implementation; planning does not run the acceptance suite.
- Managed execution handoff is Git-tracked TaskIntent author/validate plus current-Host native Enrollment. Do not sync a v3 State Ledger or invoke a missing dispatcher.

## Next Action

- Gate: Reference closure and clarification are complete; every upstream `BR-*` item is represented; no unresolved user decision remains; Planner-introduced decision deltas are confirmed; the candidate is Git-tracked and validates with `valid: true` and `enrollment_ready: true`; each acceptance has concrete focused verification. Plan-only requests stop here.
- If gates pass: for Kernel-managed work, invoke the current Host's native Enrollment Tool directly without chat pre-confirmation. Its single literal-user gate binds the TaskIntent revision, content hash, and preparation digest, validates Enrollment preconditions without executing acceptance descriptors, and enrolls the task to continue through `imm-loop`.
- If the native gate fails: preserve candidate artifacts and report the stable reason plus exactly one same-Host recovery action. Do not suggest another Host, worktree, Direct Path, unmanaged implementation, or automatic retry.
- If gates are not met: state which validation failures, unresolved verification paths, or material decision deltas remain; do not name a next skill.
