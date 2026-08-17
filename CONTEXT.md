# Immune-Brain

An agent skill system that decomposes work into validated plans, executes one step at a time through authority-separated roles, and compounds reusable learnings from completed work.

## Language

**Step**:
One independently closable outcome unit in a plan. A step has a single Result, a Verification path, and optional annotations. An executor may touch many files within a step.
_Avoid_: task, ticket, issue

**Plan**:
An ordered sequence of Steps decomposed from a spec by `imm-planner`. Lives under `docs/plans/`. Validated by `imm-plan.py`. A Plan covers one coherent executable slice; independent authority, risk, verification, promotion, review, or rollback boundaries normally belong in successor Plans rather than oversized Steps.
_Avoid_: roadmap, backlog

**Plan boundary**:
The semantic boundary that explains why one Plan's Steps belong in the same executable slice. The rationale considers outcome cohesion plus authority, risk, verification, review, and rollback boundaries; it is not a fixed file, token, Step, compaction, or session limit.
_Avoid_: size cap, session budget

**Scope pressure**:
Advisory evidence that a proposed Plan may cross independent boundaries, such as broad domain, dependency, verification, or review surfaces. Planner records the evidence and a semantic retain-or-split rationale. Scope pressure never creates an automatic workflow or session gate.
_Avoid_: hard file limit, context cutoff

**Successor candidate**:
Zero or one stable Roadmap Phase declared as the likely next planning target. It is non-authoritative metadata: declaration does not create or validate a Plan, record user approval, queue work, activate a Plan, or execute anything. Multiple sequential Plans may implement the same current Phase; each retains that Phase's same future `Successor candidate` until a later Plan advances to it.
_Avoid_: next active plan, automatic continuation, self-successor

**Roadmap**:
A durable phase map for large or multi-phase work that preserves future scope,
deferred decisions, open questions, and promotion criteria. A Roadmap is not an
executable Plan; each executable slice still needs its own Plan with
independently closable Steps.
_Avoid_: treating roadmap phases as completed Plan coverage

**Phase**:
A labeled segment within a Roadmap representing one promotable unit of future or current work. A Phase is not a Step; it carries its own goal, deferred scope, and gates. A Phase may require multiple sequential Plans when independent executable boundaries exist; only the currently promoted slice gets Steps, and final Phase review covers the explicit same-Phase continuation chain.
_Avoid_: one Plan per Phase, treating a Phase as a Step
_Avoid_: milestone, stage, iteration

**acceptance_criteria**:
The per-phase behavior assertions that let a developer judge whether a Roadmap phase is done, without reading implementation code. Each entry describes observable behavior (e.g., "the export button produces a CSV with all visible columns"), not internal signals. Independent of `promotion_criteria`. Validation depth: L1 errors on a missing/empty field, L2 warns on recognizable non-behavioral patterns. Dual-track: `observable` (visual/interactive) or `verifiable` (named command + output). Required for 3+ phase Roadmaps; optional for single-phase or 2-phase work.
_Avoid_: definition of done, checklist, test plan

**promotion_criteria**:
The conditions that must hold before a deferred Roadmap phase can be promoted to an executable Plan. May include "all acceptance_criteria passed human review" but is not limited to it — it also covers external dependencies such as API availability, environment readiness, or stakeholder approval. Distinct from `acceptance_criteria`, which answers "is this phase done?"; `promotion_criteria` answers "can we start the next phase?".
_Avoid_: exit criteria, gate, go/no-go

**Spec**:
A behavioral contract defining accepted behaviors for a feature or change. Lives under `docs/specs/`.
_Avoid_: requirements doc, PRD

**Assurance progression**:
The session-scoped coordination of an enrolled Task from fresh evidence through QA, Review, required user authority, and terminal settlement. It owns operation lifecycle, not Task facts or mutation authority.
_Avoid_: assurance orchestration, workflow engine

**Assurance projection**:
The host-neutral, read-only current facts that bind a Task's Intent, Record, workspace, evidence, approvals, findings, and backend claim. Hosts consume it without reconstructing freshness or authorization readiness.
_Avoid_: host status object, Pi projection

**Skill**:
One role-scoped SKILL.md file under `skills/`. Each skill has a boundary (allowed/blocked), output artifact, and next-action gate.
_Avoid_: plugin, module, tool

**Brainstorm**:
Problem-framing phase that clarifies constraints and produces a task framing for the planner. Read-only; does not write plans or implement.
_Avoid_: ideation, discovery

**Executor**:
The role that implements exactly one active step. Every changed line must map to the step's Result. Hands off to QA after recording evidence.
_Avoid_: implementer, coder, worker

**QA**:
The closure gate that judges pass vs rework vs replan based on recorded evidence. Does not implement.
_Avoid_: reviewer, tester

**Compounder**:
The role that extracts reusable learnings from completed work into `docs/solutions/` after closure.
_Avoid_: documenter, archivist

**Learning**:
A reusable pattern or insight stored in `docs/solutions/` with reusability tags. Evidence-backed only.
_Avoid_: note, finding

**ADR**:
An architecture decision record in `docs/adr/` capturing a hard-to-reverse decision with context and reasoning. Created only when all three criteria are met: hard to reverse, surprising without context, result of a real trade-off.
_Avoid_: design doc, RFC

**Activation Plan**:
A deterministic plan produced by `activation_plan.py` that decides which conditional reviewer subagents to dispatch based on changed paths and trigger keywords, and carries per-child `model_tiers` for optional host-side model resolution.
_Avoid_: routing table, dispatch config

**Delegation Packet**:
The structured context bundle sent to a subagent: `shared_context_summary`, `focus_delta` (optionally containing context-sharded fragments in `specific_changes`), `tool_policy`, `fallback_reasons`.
_Avoid_: prompt, brief

**Domain Mapper**:
A read-only `generalPurpose` subagent mode used by `imm-arch-explorer` to map one bounded directory or domain shard during a Parallel Domain Survey. It returns structural evidence for the explorer host; it does not write code, plans, or workflow state.
_Avoid_: autonomous refactoring agent, architecture executor

**Fast-Track**:
A compressed ceremony mode for plans with two or fewer steps where plan-execute-QA can complete within a single interaction.
_Avoid_: shortcut, bypass

**HANDOFF.md**:
A human-readable convenience document at the repo root summarizing current plan progress for cross-session continuity. Not the source of truth (`.imm/memory/` is).
_Avoid_: status file, state dump

**State Ledger**:
The per-step state map in `current_iteration.json` (schema v2) that tracks each step's lifecycle independently via explicit state transitions. Replaces the v1 single-slot `active_step` + flat `completed_steps` model. Each step entry holds its own state (`pending`, `active`, `probing`, `executing`, `ready_for_review`, `closed`, `rework_needed`, `replanning`), evidence, timestamps, and `child_evidence` (durable structured output from subagents). Enables future parallel step execution.
_Avoid_: step tracker, task board

## Relationships

- A **Plan** contains one or more **Steps**
- A **Plan boundary** explains why those Steps share one executable authority, risk, verification, review, and rollback boundary
- **Scope pressure** informs Planner's semantic retain-or-split decision but never forces a workflow or session transition
- A Roadmap-backed **Plan** may declare zero or one **Successor candidate** without creating, approving, or activating it
- Multiple sequential **Plans** may implement one **Phase** when each has an independent executable boundary; approved same-Phase transitions retain the same future **Successor candidate** and accumulate closed changed-file evidence for fresh final review
- A **Spec** is the behavioral source for one **Plan**
- An **Executor** implements exactly one active **Step** at a time
- **QA** judges closure of one **Step** based on evidence
- A **Compounder** produces **Learnings** from closed **Steps**
- An **Activation Plan** selects subagents for a review host **Skill**
- A **Delegation Packet** is sent from a host **Skill** to one subagent
- A **Roadmap** contains one or more **Phases**, each carrying `acceptance_criteria` and `promotion_criteria`
- A **Phase** is promoted to a **Plan** when its `promotion_criteria` are met; its `acceptance_criteria` survive as executable acceptance criteria in the Plan

## Architecture Map

- Workflow runtime: `plugins/immune-brain/` is packaged exclusively for Pi through the root `package.json`; `plugins/immune-brain/.pi-extension/` owns TUI enrollment, automated assurance coordination, native subagent Review dispatch, and literal-user confirmation. `plugins/immune-brain/runtime/v4_runtime.ts` is the only shipped Bun + TypeScript CLI router, `plugins/immune-brain/runtime/kernel/` owns TaskIntent/TaskRecord reducers and storage, and `plugins/immune-brain/runtime/advisory_dispatch.ts` plus `work_probes.ts` build Pi `Agent` dispatch envelopes. `plugins/immune-brain/bin/imm-*` remains the stable wrapper surface; legacy v3 mutation routes are retired while explicit audit/validation projections remain read-only.
- Assurance Kernel: Git-tracked TaskIntent sidecars define task authority, worktree-local TaskRecords hold execution state, and the Pi canary extension owns enrollment, evidence progression, QA/Review orchestration, confirmation, and completion. `plugins/immune-brain/runtime/commands/kernel.ts` is registered by `v4_runtime.ts` for intent author/validate, status, and explicit bounded legacy audit; `status`/`audit` are strictly read-only (zero journal writes) and the retired `migrate`/`readiness`/`journal` subcommands are rejected with zero writes.
- Kernel mutation authority: `kernel/reducer_v2.ts`, `kernel/authority_port.ts`, `kernel/intent_token_registry.ts`, `kernel/application_v2.ts`, and `kernel/storage.ts` enforce the closed action vocabulary, opaque single-use authority, same-lock Intent reread, content-hash CAS, and recoverable transactions used by the Pi host integration.
- Project format migration: historical State Ledger migration modules remain inside the separately bounded legacy runtime closure. The shipped v4 CLI rejects `imm-migrate`; current operation uses TaskIntent/TaskRecord storage and exposes historical state only through explicit bounded `imm-kernel audit --legacy`.
- Plan validation: `plugins/immune-brain/bin/imm-plan` routes through `v4_runtime.ts`; `--routing-status --json` returns the strict Git-owned routing-policy projection, while `<plan-path> [--json]` parses and semantically validates that explicit Plan with dynamic origin coverage. Both paths are read-only and advisory: Managed authority still requires a Git-tracked TaskIntent that passes `imm-kernel intent validate` plus Pi TUI enrollment. v3 Plan mutation remains retired.
- Package ownership: root `package.json` is the sole Pi package/version manifest; repository docs are authoring sources while checked-in `plugins/immune-brain/dist/` is self-contained packaged output guarded by deterministic sync checks.
- Skill contracts: `plugins/immune-brain/skills/*/SKILL.md` provides host-discoverable entries; `plugins/immune-brain/dist/*.md` provides detailed packaged instructions; the root `skills` symlink, `plugins/immune-brain/skills/registry.yaml`, `plugins/immune-brain/tests/skill-registry-consistency.test.ts`, and `docs/reference/planning-quality-gate.md` preserve role boundaries, registry metadata, and contract regression coverage.
- Bootstrap templates: `skills/imm-init/scripts/init_project.ts`, `skills/imm-init/templates/` (new project scaffolding for Immune-Brain files and navigation pointers)
- Durable learnings: `docs/solutions/`, `.imm/memory/MEMORY.md` (reusable patterns, `key_files`, and memory index)
- Upstream references: `upstreams/` retains borrowed context-engineering sources as provenance; current Pi workflow guidance lives in `docs/reference/HANDOFF-template.md` and `docs/reference/upstream-pro-workflow-borrow-map.md`.

## Flagged ambiguities

- "step" was previously used informally for both a plan unit and a workflow phase — resolved: **Step** means a plan outcome unit only; workflow phases are named by skill role (brainstorm, plan, execute, QA, compound).
- "review" is overloaded between QA closure review (`imm-qa`) and code review (`imm-code-review`) — context disambiguates; prefer the skill name when precision matters.
