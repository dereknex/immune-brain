# Planning Quality Gate

Use this checklist when `imm-planner` is preparing an elevated-risk plan. It is not mandatory ceremony for every plan: small, low-risk tasks should keep the normal concise Spec and Plan flow.

## Trigger Signals

Apply the gate when the task touches one or more of these surfaces:

- Runtime state, State Ledger behavior, resume behavior, or workflow coordination.
- Migration, compatibility, or persisted data shape.
- Runtime/package-boundary behavior, packaged plugin output, or compiled skill contracts.
- Reviewer, subagent, dispatch, or advisory contract behavior.
- Rollback-sensitive workflow behavior where partial execution could leave stale state.

## Required Checks

- **contract surface**: name the files, skills, runtime modules, generated outputs, or docs whose behavior is part of the promised result.
- **compatibility**: state whether existing plans, state files, Pi runtime contracts, or users need migration or backwards-compatible behavior.
- **interruption recovery**: describe what should remain true if execution stops midway and how the next `imm-loop` run should continue.
- **rollback path**: name the smallest coherent set of files or state entries to revert if the step fails.
- **verification strength**: prefer parser, contract-test, unit-test, or executable command evidence over simple file-existence checks.
- **design-depth classification**: for a change with a Technical Design concern, record why it is Low, Medium, or High risk. Every new or revised Spec records `**Design risk**: Low|Medium|High` with an adjacent rationale. Medium/High risk requires a Technical Design baseline in the Spec; Low risk may remain concise only when it has no contract, ownership, security, persistence, compatibility, or multi-component concern.
- **Technical Design baseline**: keep the Spec as the single design authority and make each Plan Step reference the applicable decision or invariant instead of duplicating design prose.
- **design-view selection**: for Medium/High risk, select every materially relevant technical-design view from architecture layers, service/component interfaces, data flow, state transitions, and temporal sequence. Record selected views and why omitted views cannot affect the design. Low risk remains concise.
- **TaskIntent decomposition**: use Technical Design boundaries as one retain/split criterion with outcome, Verification, dependency, risk, rollback, compatibility, and authority. Split a successor TaskIntent only when a service, state-machine owner, migration, independently promotable layer, or sequence dependency needs independent verification, rollback, authorization, or settlement. A TaskIntent should normally change one primary trust-boundary invariant, but traversing several boundaries or updating both sides of one authority chain does not itself require a split. Split independently verifiable, reversible, authorizable, migratable, or settleable trust invariants. Keep multiple trust-boundary changes together only for one atomic security outcome whose split would create an unsafe or unusable intermediate state, and record that rationale in the Spec. Treat this as Planner judgment rather than a schema field or Enrollment counting rule. Do not split merely because the design names several layers, files, or services, and do not revive prose Plan authority.
- **Mermaid intent**: use Mermaid only when it clarifies structure, sequence, data flow, or state transitions; it is not a universal gate or a second source of truth. Every new or revised Spec records `**Diagram decision**: required|not_required` and a non-empty `**Diagram reason**:`. A `required` decision must include Mermaid; `not_required` explains why prose is sufficient.
- **Design Conformance**: before final closure, require Spec-to-implementation evidence. A local implementation mismatch routes to `rework`; a structural or intended design change routes to `replan` through Planner. QA cannot silently approve a design change.
- **Brainstorm traceability**: ensure every `BR-*` item listed in `Brainstorm manifest` is mapped in `Brainstorm Trace`.
- **roadmap information preservation**: for large or multi-phase work, distinguish the Roadmap from the current executable slice, preserve deferred phase goals, open questions, promotion criteria, and candidate next Plans.
- **executable-slice discipline**: the Plan promises only the current executable slice — one coherent set of Steps sharing acceptance, review, rollback, and authority boundaries. Future-phase logic, speculative architecture, and unvalidated assumptions belong in the Roadmap or as explicitly Deferred items, never as active Steps. Do not enforce a fixed Step count: multiple Steps inside one shared boundary are fine, and a single Step that smuggles in unvalidated future architecture is still over-planning.
- **Plan boundary cohesion**: treat Plan granularity separately from Step and Roadmap Phase granularity. Confirm the current Plan contains one coherent executable slice and explain why its outcome, authority, risk, verification, review, and rollback boundaries belong together. Promote an independent boundary into a sequential Plan instead of hiding it inside a large Step. One Phase may therefore span multiple Plans.
- **same-Phase continuation**: when sequential `roadmap-slice/v1` Plans implement the same current Phase, keep the same Roadmap source and future `Successor candidate`; never use the current Phase as its own candidate or rewrite a finished predecessor. Each activation still requires a validated distinct Plan, a fresh Ledger revision, and literal-user approval. Final review is fresh and cumulative over the explicit same-Phase continuation chain; Phase advances, terminated replacements, and legacy transition records begin a fresh review scope.
- **scope-pressure reasoning**: record relevant file, domain, verification, dependency, or review breadth as advisory planning evidence. Do not turn file count, tokens, compactions, elapsed time, Step count, or review rounds into universal workflow gates; require a semantic retain-or-split rationale.
- **successor authority**: when a Plan declares a `Successor candidate`, keep it to zero or one stable future Roadmap Phase and record its preconditions. A declaration is static planning metadata, not Plan creation, validation, user approval, queueing, activation, or execution; it is never the current Phase or a pointer to the next Plan.
- **session neutrality**: preserve user ownership of session continuation. Spec, Plan, State Ledger, and handoff semantics must work whether the user continues in the current session or starts another one; no planning field may force session creation or closure.
- **acceptance scope discipline**: ensure current acceptance criteria prove only the executable slice; draft acceptance notes for deferred phases must be labeled non-executable until a later Plan promotes them.
- **risk-triggered exploration**: before freezing a Managed Plan, resolve unknowns that can change Scope, design, or Verification — CI environment, third-party APIs, database behavior, cross-module interfaces — using targeted read-only probes. Ask only the minimum blocking question for unclear framing, then reapply the BASELINE matrix. Read-only and Plan-only requests stay host-native without Enrollment; materially ambiguous mutations use `imm-brainstorm`; explicit Immune-Brain Skill entry starts Managed planning and literal-user Enrollment remains the authority boundary. Stop probing once Result, Scope, and Verification are concrete.
- **supersede observability**: every new `superseded` termination must record `--reason-code` (`exploration_gap` | `scope_pivot` | `boundary_error` | `contract_change` | `execution_failure`), `--stage`, `--invalidated-assumption`, and `--avoidable yes|no`; `cancelled` terminations may record the same classification but do not require it. Legacy terminal records without observability remain readable. Planning-quality metrics count only `avoidable: yes` terminations; `scope_pivot` must use `--avoidable no` because an external requirement change is never evidence of planner failure; `execution_failure` normally routes to `rework`/`follow_up` instead of supersede.

## Boundaries

- This gate does not replace `IMMUNE.md` or the `imm-brainstorm` `adversarial` high-pressure gate.
- `imm-plan` enforces declared design metadata, Medium/High Technical Design sections, and required Mermaid blocks. Untouched legacy Specs without metadata receive a compatibility warning instead of failing.
- Do not require all plans to cite this document; use it when the trigger signals are present.
