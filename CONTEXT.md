# Project Context

Immune-Brain separates ordinary host work from an explicitly entered Managed Path whose scope, evidence, and completion are governed by the Assurance Kernel.

## Language

### Entry And Ownership

**Host-native Path**:
Ordinary host work that does not create or mutate Managed authority. It includes explanation, inspection, review-only work, plan-only discussion, and ordinary repository changes unless the user explicitly enters a Managed Skill.
_Avoid_: Direct Path, unmanaged fallback

**Managed Path**:
The authority-governed workflow entered only through `imm-brainstorm`, `imm-planner`, or `imm-loop`. Existing Managed ownership remains authoritative but resumes only through explicit `imm-loop` entry.
_Avoid_: automatic routing, default mutation path

**Brainstorm**:
A read-only framing activity that resolves material ambiguity before planning. It produces constraints and decisions, not execution authority.
_Avoid_: ideation, planning, implementation

**Planner**:
The owner of a candidate Spec and TaskIntent. Planner output remains non-authoritative until Enrollment succeeds.
_Avoid_: executor, task owner

**Loop**:
The user-facing continuation entry for an enrolled task. It projects the current owner to the next bounded internal role or Kernel operation without becoming a second authority source.
_Avoid_: workflow engine, checkpoint store

**Internal Role**:
A bounded, non-public responsibility dispatched by Loop, such as Executor, QA, Review, repair, architecture exploration, or Compounder. Internal roles cannot widen their own scope or grant themselves authority.
_Avoid_: public Skill, autonomous agent

### Planning And Authority

**Spec**:
The behavioral contract for a Managed change. It states accepted behavior and remains subordinate to the enrolled TaskIntent for execution authority.
_Avoid_: PRD, prose Plan, status document

**TaskIntent**:
The Git-tracked authority proposal for one Managed task: goal, acceptance descriptors, scope hint, risk, revision, and user ownership. Its canonical content hash binds Enrollment and later assurance.
_Avoid_: Plan, ticket, mutable checklist

**Acceptance Descriptor**:
One TaskIntent acceptance item combining an observable assertion with a focused verification command. Enrollment validates its structure; deterministic QA executes it after implementation.
_Avoid_: implementation step, enrollment rehearsal

**Enrollment**:
The single native user-authority gate that atomically turns a validated, Git-tracked TaskIntent into an active TaskRecord and workspace claim. It does not execute acceptance descriptors.
_Avoid_: task creation, planning confirmation, QA

**Task**:
One enrolled TaskIntent together with its TaskRecord, workspace claim, and Assurance projection. A candidate TaskIntent alone is not a Task.
_Avoid_: issue, Plan, session

**Scope Envelope**:
The files matched by an enrolled TaskIntent's `scope_hint`, evaluated against the task's index-backed snapshot. Expanding it requires an Intent revision rather than silent execution drift.
_Avoid_: suggested files, advisory scope

**Intent Revision**:
A replacement TaskIntent revision classified as unchanged, compatible, or breaking. Breaking revisions require literal-user authority before replacing the enrolled intent.
_Avoid_: scope patch, in-place Plan edit

### Kernel State

**TaskRecord**:
The worktree-local durable record of one Task's intent snapshot, lifecycle, artifact state, attestations, findings, and history. It is the workflow state source of truth.
_Avoid_: HANDOFF, conversation memory, State Ledger

**Lifecycle**:
The TaskRecord's terminality dimension: `active`, `done`, or `stopped`. It is independent of whether planning artifacts are active or frozen.
_Avoid_: phase, stage, status prose

**Artifact State**:
The planning-artifact mutability dimension: `active` or `frozen`. Freezing binds the assurance snapshot and relocates the scope-bound Spec and TaskIntent to their archive paths.
_Avoid_: review phase, lifecycle

**Workspace Claim**:
The worktree-local exclusive ownership binding between one active Managed task and the workspace. It persists through implementation, QA, and Review until terminal settlement.
_Avoid_: lock file, session ownership

**Backend Claim**:
The Kernel's active or draining ownership proof for the claimed Task identity. Terminal ownership is represented by an immutable task-scoped tombstone, not a terminal backend claim.
_Avoid_: workspace claim, completion marker

**Attestation**:
Fresh authority evidence bound to the TaskIntent revision, content hash, and scoped diff hash. QA attestations include all acceptance results atomically; Review and user attestations carry authority metadata.
_Avoid_: self-reported evidence, approval note

**Finding**:
A durable condition requiring resolution or explicit disposition, classified as blocking, advisory, unresolved user decision, or replan required.
_Avoid_: log message, review comment

**Assurance Projection**:
The host-neutral read-only view that combines claim, TaskRecord, workspace, freshness, findings, completion facts, and the next Kernel obligation. Hosts consume it instead of reconstructing authority state.
_Avoid_: UI status, cached workflow state

**Inspect Projection**:
The host-neutral read-only CLI view from `imm-kernel inspect --json`. It copies current layout, claim, workspace, Assurance Projection, and risk-floor facts and labels process-local Capability, rehearsal, and CAS holder state as unobservable. It is not authority.
_Avoid_: progress projection, second TaskRecord, live Capability dump

**Obligation**:
The single next Kernel-required action projected from current facts, such as submit assurance, run QA, run Review, authorize the user, resolve findings, revise intent, or complete.
_Avoid_: recommendation, workflow phase

**Assurance**:
The foreground progression from frozen artifacts through fresh QA, any required Review and user authority, to terminal settlement. Routine tasks require QA; material tasks require QA and Review; critical tasks also require final user authority.
_Avoid_: testing, generic review, background orchestration

**Settlement**:
The atomic terminal transition that writes the final TaskRecord and tombstone, clears active ownership, and leaves the Task `done` or `stopped`.
_Avoid_: chat completion, archive-only operation

### Supporting Concepts

**Learning**:
An evidence-backed reusable engineering pattern stored in `docs/solutions/` after task closure. Routine completion does not require one.
_Avoid_: note, finding, task summary

**Compounder**:
The post-settlement internal role that records a Learning only when closed work contains explicit reusable evidence.
_Avoid_: mandatory documentation phase, archivist

**ADR**:
A record in `docs/adr/` for a hard-to-reverse, surprising decision produced by a real trade-off.
_Avoid_: design note, RFC, implementation summary

**Initiative**:
An optional planning grouping for multiple future or authored TaskIntents. It may use one local Markdown carrier or one GitHub parent Issue, but never grants execution authority.
_Avoid_: Roadmap authority, parent Task

**Slice**:
One stable result within an Initiative that may later become its own TaskIntent. Until authored and enrolled, it is planning metadata only.
_Avoid_: active task, Phase, Step

**Fast-Track**:
A presentation-level compression of the Managed Path for small tasks. It may reduce ceremony but never bypasses TaskIntent scope, Enrollment, QA, Review, authorization, or settlement.
_Avoid_: bypass, reduced assurance

**Domain Mapper**:
A read-only bounded architecture probe that returns structural evidence for its host. It is an advisory Internal Role pattern, not an execution or planning authority.
_Avoid_: autonomous refactoring agent, Planner

### Historical Compatibility

**Plan boundary**:
Historical, read-only `plan_core.ts` metadata explaining why archived prose Plan Steps formed one coherent executable slice.
_Avoid_: current authority boundary, size cap

**Scope pressure**:
Historical, read-only `plan_core.ts` advisory evidence behind an archived Plan's semantic retain-or-split rationale.
_Avoid_: workflow gate, context cutoff

**Successor candidate**:
Zero or one stable Roadmap Phase retained as historical, read-only `plan_core.ts` metadata. It does not create or validate a Plan, approve work, or activate a Task.
_Avoid_: next Task, automatic continuation

**Roadmap**:
Historical, read-only `plan_core.ts` metadata describing deferred work across archived prose Plans.
_Avoid_: current Initiative, execution authority

**Phase**:
Historical, read-only `plan_core.ts` segment within an archived Roadmap. It is not a current Lifecycle, Artifact State, or Task.
_Avoid_: current workflow stage, lifecycle

**acceptance_criteria**:
Historical, read-only `plan_core.ts` per-Phase behavior assertions in archived Roadmaps. Current authority uses TaskIntent Acceptance Descriptors.
_Avoid_: current acceptance field, QA attestation

## Relationships

- A Planner authors a candidate Spec and TaskIntent; Enrollment creates the TaskRecord and claims the workspace.
- A TaskIntent owns acceptance, scope, risk, and revision; a TaskRecord owns lifecycle, artifact state, attestations, findings, and history.
- Freezing artifacts changes `artifact_state` from `active` to `frozen`; it does not change the Task lifecycle or release ownership.
- The Assurance Projection derives one next Obligation from Kernel facts.
- The Inspect Projection reads those same facts for authors; it never becomes a second authority.
- QA executes every Acceptance Descriptor and records one atomic QA Attestation.
- Risk determines further authority: `routine` stops at QA, `material` adds Review, and `critical` adds final user authority.
- Settlement changes lifecycle to `done` or `stopped`, clears active ownership, and creates terminal proof.
- Loop dispatches Internal Roles, but Kernel remains the mutation and completion authority.
- An Initiative may group Slices and TaskIntents, but it never replaces a Spec, TaskIntent, TaskRecord, or Assurance Projection.

## Architecture Map

- Public entries: `plugins/immune-brain/skills/imm-brainstorm/`, `imm-planner/`, and `imm-loop/` enter or continue the Managed Path; `imm-pr-fix/` is the standalone host-native PR repair Skill and `imm-doc-prune/` is the standalone host-native document maintenance Skill.
- Planning artifacts: `docs/specs/` stores active Specs; `docs/plans/*.intent.json` stores active TaskIntents despite the historical directory name. Frozen artifacts move under the corresponding `archive/` directories.
- Kernel authority: `plugins/immune-brain/runtime/kernel/` owns TaskIntent parsing, Enrollment, TaskRecord reduction/storage, claims, projections, and completion.
- Worktree state: `.imm/tasks/<task-id>.json` stores TaskRecord v3, `.imm/workspace.json` stores workspace ownership, and `.imm/tasks/` stores active-claim and task-tombstone proofs.
- Host integration: `plugins/immune-brain/.pi-extension/` owns native Enrollment, deterministic QA, foreground Review dispatch, authorization dialogs, and Task Rail presentation.
- Loop dispatch: `plugins/immune-brain/runtime/loop_contract.ts`, `role_prompt_bridge.ts`, and `runtime/prompts/` define internal role routing and bounded delegation contracts.
- CLI surface: `plugins/immune-brain/runtime/v4_runtime.ts` routes the stable wrappers in `plugins/immune-brain/bin/`; `imm-kernel` owns current Kernel commands, while `imm-plan` retains routing-policy and historical Plan validation surfaces.
- Initiative projection: `plugins/immune-brain/runtime/github_issue_tracker.ts` and `plugins/immune-brain/bin/imm-tracker` own the optional one-way GitHub Issues adapter without reading or writing Kernel authority.
- Packaging: root `package.json` is the Pi package manifest; `plugins/immune-brain/dist/` is checked-in generated output guarded by `bun scripts/sync-dist-docs.ts --check`.
- Durable knowledge: `docs/solutions/` stores Learnings and `docs/adr/` stores qualifying architecture decisions. `CONTEXT.md` is vocabulary and navigation only, never runtime state.

## Legacy Boundary

Roadmap, Phase, prose Plan, Plan boundary, Scope pressure, Successor candidate, and the v3 State Ledger are historical compatibility concepts, not current authority. `runtime/plan_core.ts`, `imm-plan`, archived planning documents, and bounded legacy audit paths may still parse or describe them; new Managed authority uses Spec + TaskIntent + TaskRecord + Assurance Projection.

## Flagged Ambiguities

- `docs/plans/` now stores TaskIntent sidecars and legacy planning artifacts; the directory name does not make a current TaskIntent a prose Plan.
- Runtime dispatch may use `step` as a bounded execution target; it is ephemeral coordination, not a durable planning or authority object.
- `Review` means the independent assurance authority required for material and critical risk; QA is the deterministic acceptance authority.
