# Iteration Plan

## Task

- Summary: Add an append-only, revision-bound State Ledger transition between two locally linked `roadmap-slice/v1` Plans with explicit user approval and unchanged legacy single-Plan behavior.
- Origin: User-invoked `imm-planner` continuation after Phase P1 closed, compounded, and named P2 as the non-authoritative candidate successor. The confirmed Brainstorm scope remains linear, filesystem-backed, session-neutral, and user-approved.
- Spec: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md`
- Research: Phase P1 established `roadmap-slice/v1` static metadata and closed with 37 tests, independent QA, final code review, and `imm-finish`. Current `imm-plan --sync` already uses lock-time compare-and-swap and atomically isolates cross-Plan completion/review state, but any different Plan path can replace the current Plan without successor approval and old closed Step evidence is not archived as an immutable Plan-scoped record. `state_ledger.ts` exposes atomic write/CAS primitives and forwards unknown fields through normalization; `runPlanCommand` owns Plan validation and cross-Plan sync; existing cross-plan, follow-up, finish, and plugin runtime tests provide isolated-root concurrency and compatibility fixtures. `docs/solutions/plan-switch-state-isolation.md`, the workflow cross-Plan reset patterns, and the file-backed CAS pattern require validate-after-isolation, failure no-write, lock-time revision checks, and append-only correction. Direct repository evidence was sufficient for decomposition, so optional Planner ensemble research was not dispatched. Independent High-risk `imm-preplan-review` selected `Hold Scope / revise` and identified three blocking ambiguities: any-side contracted sync bypass, non-canonical Plan/flag identity, and underspecified schema/revision/archive boundaries. The Planner adopted all findings into Spec 5.5, the Devil's Advocate audit, and U1/U2 negative-path verification without expanding into P3/P4.
- Decisions: D1 lazily upgrade to State Ledger schema v3 only on an approved transition while preserving valid schema v2 for ordinary writes. D2 strictly validate v3 transition collections and fail closed on conflicting v2 fields or unknown future versions. D3 store a whitelisted `closed_plan_history` separately from append-only `plan_transition_history` inside the existing Ledger. D4 persist declaration, lock-time validation, revision-bound literal-user approval, and activation as separate fields in one atomic event, never a queue. D5 require explicit `--approve-successor`, canonical expected predecessor identity, and an opaque expected ledger revision. D6 guard ordinary cross-Plan sync whenever either predecessor or target declares a Plan contract; the approved path requires both sides to use `roadmap-slice/v1`. D7 define one project-root-bounded, non-symlink canonical Plan identity and reject ambiguous/duplicate CLI options. D8 compute revision from domain-separated stable serialization of the complete normalized Ledger and reread target bytes under the Ledger lock. D9 reuse the existing write lock, lock-time CAS, and atomic rename without another persistence or lock protocol. D10 reject duplicate transition IDs, historical successor reuse, same-signature aliases, and non-linear predecessor history. D11 validate only local candidate/Phase/identity/Roadmap-source consistency and never claim Roadmap membership or workflow readiness. D12 archive only current-Plan-scoped normalized evidence and prove linear growth without nested history. D13 keep P3 host messaging, HANDOFF projection, role routing, and session-neutral UAT outside this Plan.
- Assumptions: Phase P1 metadata names are sufficient for local P1-to-P2 linkage but do not prove Roadmap membership. The current P1 Ledger remains closed, reviewed, and intentionally reset until the user separately approves P2 sync. The existing follow-up review marker identifies the predecessor's current-Plan follow-up slice. Stable recursive serialization and SHA-256 are available in the TypeScript runtime. Existing schema v2 fixtures can remain v2 until an approved transition; every v3 writer must preserve strict transition collections. No open `BR-Q-*` item remains.
- Plan contract: roadmap-slice/v1
- Roadmap source: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md` Roadmap
- Current phase: P2
- Plan boundary: State Ledger schema, immutable predecessor archive, append-only transition record, and one explicit revision-bound successor activation path.
- Boundary rationale: U1 establishes the persisted transition invariant and compatibility model before U2 exposes the only command that may consume it. Both Steps share one authority outcome, one atomic commit boundary, and one rollback strategy. P3 workflow messaging/HANDOFF projection and P4 cross-host/end-to-end topology validation have independent review and promotion boundaries and remain successor Plans.
- Scope pressure: High but cohesive: persisted schema evolution, State Ledger mutation invariants, one CLI command surface, lock-time concurrency, compatibility fixtures, and negative-path tests across state/runtime boundaries; no host adapters, session policy, Roadmap parser, queue, scheduler, or UI.
- Execution scope: Phase P2 only: append-only State Ledger successor transition contract.
- Deferred phases: P3 workflow progression and handoff; P4 compatibility and end-to-end acceptance.
- Successor candidate: P3
- Successor preconditions: Phase P2 acceptance criteria pass; schema v2 compatibility, archive immutability, stale-writer rejection, duplicate rejection, and explicit approval behavior are verified; P1-to-P2 transition fixtures pass; required QA and code review close with no unresolved State Ledger finding.
- Current-slice warning: This Plan does not implement P3 role routing, HANDOFF projection, host messaging, session management, automatic successor selection, full Roadmap membership or cycle validation, historical bulk migration, DAGs, parallel active Plans, queues, or scheduling.

## Output Language

- Human-readable prose: English for this Spec and Plan.
- Preserved literals: file paths, commands, schema fields, enum values, JSON keys, Skill names, and `CONTEXT.md` canonical terms such as `Roadmap`, `Phase`, `Plan`, `Step`, `Spec`, `State Ledger`, `Plan boundary`, `Successor candidate`, and `Scope pressure`.

## Brainstorm Manifest

- BR-REQ-001: Large initiatives progress through multiple reasonably sized Plans rather than one oversized Plan.
- BR-REQ-002: Plan boundaries follow business outcome, authority, risk, verification, review, and rollback semantics.
- BR-REQ-003: Plans preserve a durable, recoverable, auditable successor handoff.
- BR-REQ-004: Only one Plan may be active at a time.
- BR-REQ-005: Planner creates and validates a successor Plan, and the user explicitly approves activation.
- BR-DEC-001: Version 1 progression is strictly linear with zero or one direct successor.
- BR-DEC-002: Session creation, continuation, and closure remain entirely user-controlled.
- BR-DEC-003: File count, tokens, compactions, and follow-up rounds are diagnostic evidence, not workflow gates.
- BR-OUT-001: Do not automatically create or switch sessions.
- BR-OUT-002: Do not build DAG or multi-branch orchestration in version 1.
- BR-OUT-003: Do not introduce SQLite, a Plan queue, or a generic orchestrator.
- BR-DEFER-001: Branching, merging, parallel Plans, and automatic scheduling are deferred.

## Brainstorm Trace

| Brainstorm ID | Status | Plan mapping | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | partially_covered | U1, U2 | P2 enables the first persisted linear Plan transition; P3/P4 still own workflow progression and end-to-end adoption. |
| BR-REQ-002 | captured_as_decision | D1-D13 | P2 remains one cohesive persisted-state/activation boundary and excludes host workflow rollout. |
| BR-REQ-003 | partially_covered | U1, U2 | P2 archives predecessor evidence and transition authority; P3 still owns human HANDOFF projection. |
| BR-REQ-004 | covered_by_step | U1, U2 | Transition preconditions reject an active Step and install exactly one successor as current. |
| BR-REQ-005 | covered_by_step | U2 | Planner validates the P2 Plan; runtime requires explicit revision-bound user approval before activation. |
| BR-DEC-001 | captured_as_decision | D4, D6, D10, D11 | One predecessor candidate may match one direct locally linked successor; no queue or topology engine is added. |
| BR-DEC-002 | captured_as_decision | D13 | Transition state and commands remain independent of session selection or lifecycle. |
| BR-DEC-003 | out_of_scope | Scope | P2 uses semantic closure and revision preconditions, not size or context-pressure gates. |
| BR-OUT-001 | out_of_scope | Scope | No command creates, closes, or switches a host session. |
| BR-OUT-002 | out_of_scope | Scope | P2 supports one direct successor only. |
| BR-OUT-003 | out_of_scope | Scope | State stays in the existing file-backed Ledger; no queue, database, or generic orchestrator is introduced. |
| BR-DEFER-001 | deferred | Roadmap P4 | DAGs, branching, parallel active Plans, and scheduling remain deferred without current promotion criteria. |

## Coverage Matrix

| Requirement | Current P2 coverage | Deferred continuation |
| --- | --- | --- |
| R1 Plan-level boundary discipline | Decisions and boundary rationale keep P2 state transition separate from P3 workflow rollout | P3/P4 execute later boundaries |
| R2 Opt-in static Plan contract | U2 consumes validated `roadmap-slice/v1` metadata without changing parser authority | P4 validates broader Roadmap membership |
| R3 Linear successor declaration | U2 requires predecessor candidate to match one successor Phase | P4 adds topology/cycle scenarios |
| R4 Compatibility | U1 defines lazy schema v3 and schema v2 read compatibility; U2 preserves legacy/same-Plan sync | P4 expands historical and cross-host compatibility |
| R5 Authority separation | U1 stores separate facts; U2 requires explicit user approval and atomic runtime activation | P3 exposes role-specific handoff wording |
| R6 User-owned session lifecycle | U2 asserts no session or HANDOFF writes | P3/P4 prove cross-host session neutrality |
| R7 Successor handoff | U1 archives predecessor evidence; U2 records transition authority | P3 projects the authoritative record into HANDOFF and role outputs |
| R8 Failure and correction semantics | U1/U2 make records append-only and failures no-write | P4 covers supersede/reverse/correction sequences end to end |

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 adds pure normalization/archive/transition primitives and isolated tests before any command can write schema v3. If U1 fails, schema v2 production behavior remains unchanged and U2 must not start.
- U2 performs archive append, transition append, the in-Ledger audit event, and successor installation in one existing lock-time CAS plus atomic rename. Every grammar, identity, schema, stale, duplicate, lock, or injected-interruption failure must leave authority state byte-identical and no stale temp/lock or external audit artifact.
- A successful transition is never rolled back by deleting history. A defective successor uses existing replan/correction semantics; a future reverse move would require a new explicit append-only transition.
- Planner validation does not sync this P2 Plan. The closed P1 Ledger remains authoritative until the user explicitly approves the transition/sync command.

### 2. Verification Vanity

- U1 tests compare whitelisted Plan-scoped archives after later mutation attempts, schema/version matrices, stable revision serialization, unknown-field behavior, and three-transition linear growth; file existence or field-name grep is insufficient.
- U2 tests drive isolated-root CLI transitions and assert byte-identical failures for both one-sided contract bypasses, legacy wash-through, ambiguous flags, path aliases/symlinks/outside-root targets, stale revision, lock-time target replacement, malformed eligibility combinations, duplicate/history-chain conflicts, and injected concurrent writes.
- The success fixture must prove separate declaration/validation/approval/activation facts, one deterministic transition ID, one predecessor archive, successor-only pending Steps, cleared current review gates, retained historical collections, and no HANDOFF/session write.
- Legacy-to-legacy cross-Plan and same-Plan controls must remain green, while any cross-Plan request with a contracted predecessor or target must fail without the approved transition command.

### 3. Spec Dilution Detection

- P2 does not reinterpret parser success or a path alias as approval: the user must provide the explicit flag, canonical expected predecessor identity, target identity, and opaque revision; runtime rereads target bytes under lock.
- Closed evidence remains immutable and traceable instead of being summarized only in generic audit history.
- P2 does not claim full Roadmap membership, cycle validation, cross-host behavior, workflow messaging, HANDOFF authority, or session management; those remain visibly deferred to P3/P4.
- One active Plan, linear progression, filesystem-as-brain, no queue/orchestrator, and user-owned session lifecycle remain binding invariants despite implementation convenience.

## Planning Quality Gate

- contract surface: `docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md`, `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/imm_core.ts` only if export parity requires it, command manifest/help output, and focused State Ledger/runtime tests.
- compatibility: valid schema v2 remains v2 on ordinary writes; transition is the only v3 upgrade; strict v3 collections survive every writer; future/malformed versions fail closed; only legacy-to-legacy cross-Plan and same-Plan revision sync retain current behavior.
- interruption recovery: U1 has no production writer. U2 validates grammar and canonical identity before state access, then performs target reread, revision check, archive append, transition append, audit append, and successor install inside the existing lock/atomic-write boundary; all failures preserve authority bytes.
- rollback path: revert the P2 state/runtime helpers and tests together before any deployed transition. After a committed transition, preserve records and use correction/replan rather than historical rewrite.
- verification strength: isolated-root state-machine and CLI tests assert exact whitelisted structures, stable opaque revisions, canonical identity/grammar rejection, any-side contract guards, byte-identical failure, Plan-scoped archive immutability, linear history growth, stale/target-replacement interleavings, command help/manifest parity, and legacy controls.
- design-depth classification: High risk because this slice evolves persisted authority state, active Plan identity, user approval, schema compatibility, and concurrency behavior.
- Technical Design baseline: Spec sections 5.1, 5.2, 5.4, and 5.5 are the sole authority for transition state, command semantics, invariants, compatibility, and rollback.
- Mermaid intent: required because the declaration-to-activation state model and atomic approval sequence materially clarify authority and failure boundaries.
- Design Conformance: final QA must compare the implemented schema, transition facts, eligibility checks, write sequence, compatibility behavior, and deferred boundaries against Spec 5.5. Structural changes require `replan`; local defects require `rework`.
- Brainstorm traceability: all 12 confirmed IDs are mapped; no `BR-Q-*` item remains.
- roadmap information preservation: P3/P4 goals, acceptance criteria, promotion criteria, candidate next Plans, deferred decisions, and non-goals remain in the Spec.
- Plan boundary cohesion: U1 establishes the invariant before U2 exposes its one consumer; host workflow integration is held for P3.
- scope-pressure reasoning: persisted schema, command API, concurrency, evidence immutability, and compatibility broaden verification, but they share one atomic transition outcome; file/test counts are not Plan gates.
- successor authority: P3 remains static metadata until a future Planner creates its Plan and the user explicitly approves activation.
- session neutrality: no P2 field or command controls session creation, continuation, closure, or selection.
- acceptance scope discipline: P2 verifies State Ledger transition semantics only; P3/P4 acceptance criteria remain non-executable.
- High-risk preplan review: initial `Hold Scope / revise`; all blocker/high findings were adopted into Spec 5.5 and U1/U2 verification. Focused follow-up returned `Hold Scope / pass` with zero remaining findings and zero blockers.

## Steps

### Step 1

- Step ID: U1
- Result: State Ledger records a versioned append-only successor transition substrate
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (schema normalization, state revision, lock-time CAS, atomic writes, review evidence, and validated Plan snapshots); docs/specs/archive/2026-07-28-roadmap-plan-boundary-successor.spec.md (Technical Design authority for schema v3 and append-only records); docs/solutions/architecture.md (file-backed authority CAS and append-only correction patterns); docs/solutions/plan-switch-state-isolation.md (cross-Plan state isolation invariant); tests/runtime-state.test.ts (schema normalization compatibility fixtures); tests/imm-follow-up-runtime.test.ts (deterministic concurrent-write and interruption seams)
- Files: `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/imm_core.ts` only if export parity requires it, `tests/roadmap-plan-transition-state.test.ts`, `tests/runtime-state.test.ts`
- Verification: `bun test tests/roadmap-plan-transition-state.test.ts tests/runtime-state.test.ts && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers valid schema v2 remains readable and stays v2 across ordinary writers; Covers transition is the only v3 upgrade; Covers v2 transition-field conflicts, malformed v3 collections, and unknown future versions fail closed; Covers all v3 writers preserve archive/transition collections; Covers domain-separated stable revision ignores JSON key order/whitespace but changes for every persisted unknown-field mutation; Covers status exposes only opaque revision and canonical current Plan identity; Covers deterministic archive/transition IDs; Covers archive whitelist includes only normalized predecessor snapshot, closed Steps/evidence, current-Plan follow-up slice, QA/gate evidence, and matching finish timestamp; Covers arbitrary extensions, prior archives/transitions/history, pre-marker follow-ups, environment-like values, and raw transcript/stdin fields are excluded or rejected; Covers deep-copy immutability; Covers three transitions grow by exactly one archive and record each without nesting; Covers duplicate and non-linear history identities reject.
- failure_behavior: If strict version normalization, stable revision, Plan-scoped whitelist archive, and transition facts cannot be represented without changing ordinary schema v2 behavior or nesting prior history, stop before adding a writer and return to Planner. Do not silently repair malformed/future schemas, alias archived objects, copy arbitrary evidence extensions, or move history to a second store.
- security_considerations: Archive only normalized whitelisted evidence. Reject or omit raw session transcripts, stdin payloads, environment values, credentials, secrets, arbitrary extensions, and approval identity beyond literal `user`; do not leak archived payloads through revision/status/error output; keep existing restrictive state-file permissions.
- Depends on: none

### Step 2

- Step ID: U2
- Result: Revision-bound user approval atomically activates one direct successor
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (Plan validate/sync command, command manifest/help, status derivation, and cross-Plan installation); plugins/immune-brain/runtime/state_ledger.ts (U1 transition primitive and commit expectation); tests/cross-plan-sync-reset.test.ts (legacy and same-Plan compatibility controls); tests/imm-follow-up-runtime.test.ts (lock-time CAS and injected-interruption patterns); tests/plugin-package-runtime.test.ts (wrapper, help, manifest, and isolated CLI behavior); tests/finish-dehydrate-runtime.test.ts (closed/intentional-reset predecessor fixture)
- Files: `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/runtime/state_ledger.ts`, `plugins/immune-brain/runtime/imm_core.ts` only if export parity requires it, `tests/roadmap-plan-transition-runtime.test.ts`, `tests/cross-plan-sync-reset.test.ts`, `tests/imm-follow-up-runtime.test.ts`, `tests/plugin-package-runtime.test.ts`, `tests/finish-dehydrate-runtime.test.ts`
- Verification: `bun test tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/plugin-package-runtime.test.ts tests/finish-dehydrate-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-003-feat-roadmap-plan-boundary-successor-phase2-plan.md --json && git diff --check`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers successful locally linked P1-to-P2 transition with explicit approval, canonical expected predecessor, and opaque revision; Covers ordinary cross-Plan guard matrix for contracted-to-legacy, legacy-to-contracted, contracted-to-contracted, and multi-hop legacy wash-through; Covers legacy-to-legacy and same-Plan controls; Covers `--name value` and `--name=value`, duplicate/missing/option-looking values, extra positionals, and approval flags on validate-only/same-Plan requests; Covers relative/absolute/dot aliases canonicalize identically while outside-root and symlink targets reject; Covers lock-time target reread rejects replacement; Covers stale revision, wrong predecessor, active-like Step, nonempty next action, pending/malformed follow-up, `requires_replan`, incomplete/replanning state, mismatched validated snapshot, missing/mismatched `finish_reset`, stale/missing required review signature, terminal candidate, candidate/Phase mismatch, Roadmap-source mismatch, unsupported contract, same identity/signature, duplicate activation, historical successor reuse, and non-tail predecessor fail; Covers failures preserve Ledger/HANDOFF/session/inbox bytes, emit no approval success, and leave no new stale temp/lock; Covers success appends exactly one Plan-scoped archive, transition, and in-Ledger audit event, installs successor pending Steps, resets current review scope, retains historical collections, and clears `intentional_reset`; Covers no output claims Roadmap membership or workflow readiness; Covers command help/manifest and plugin-local wrapper parity.
- failure_behavior: Any ambiguous option, non-canonical identity, one-sided contract, missing authority fact, closure/gate mismatch, target replacement, revision mismatch, duplicate/history conflict, or CAS failure must reject without persistence or approval output. If implementation needs a pending queue, automatic retry, host prompt, Roadmap graph parser, session behavior, symlink identity, or evidence-wide arbitrary-field archive, stop and return to Planner because that crosses or weakens P2.
- security_considerations: Treat Plan Markdown and CLI values as untrusted. Require one project-root-bounded non-symlink canonical identity, strict option grammar, lock-time target validation, opaque revision/status output, and error messages free of archived evidence. Never infer approval from parser success, legacy sync, stale HANDOFF prose, raw paths, or reusable config.
- Depends on: 1

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-003-feat-roadmap-plan-boundary-successor-phase2-plan.md --json`
- Origin coverage: all 12 Brainstorm Manifest IDs must map with no missing reason-required rows; direct parser validation is authoritative if the current CLI projection still reports `origin_coverage.applicable: false`.
- Spec design metadata: High risk, required diagram, and Technical Design sections 5.1-5.5 must validate without design warnings.
- State contract verification: `bun test tests/roadmap-plan-transition-state.test.ts tests/runtime-state.test.ts`
- Runtime transition verification: `bun test tests/roadmap-plan-transition-runtime.test.ts tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/plugin-package-runtime.test.ts tests/finish-dehydrate-runtime.test.ts`
- Existing P1 compatibility: `bun test tests/roadmap-plan-boundary-contract.test.ts tests/plan-validation.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check`
- Full planned verification: `bun test tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/runtime-state.test.ts tests/cross-plan-sync-reset.test.ts tests/imm-follow-up-runtime.test.ts tests/plugin-package-runtime.test.ts tests/finish-dehydrate-runtime.test.ts tests/roadmap-plan-boundary-contract.test.ts tests/plan-validation.test.ts tests/dist-docs-sync-contract.test.ts && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-28-003-feat-roadmap-plan-boundary-successor-phase2-plan.md --json && git diff --check`
- High-risk preplan evidence: independent `imm-preplan-review` first returned `Hold Scope / revise`; Planner adopted all authority-bypass, canonical identity, revision, version-matrix, archive-boundary, eligibility, duplicate, and no-write findings into Spec 5.5 and this Plan. Focused follow-up returned `Hold Scope / pass`, `remaining_findings: []`, and `blocked_by: []`.
- Planner sync gate: validation only during planning. Do not run ordinary `--sync`; after explicit user approval, use the revision-bound successor transition path once implemented. Until then P1 remains the current Ledger authority.

## Roadmap Continuation

- Completed predecessor: P1 successor-ready planning contract is closed, reviewed, compounded, and intentionally reset; its Plan, Spec, Step evidence, and review gate remain the current State Ledger authority until explicit P2 transition.
- Preserved deferred content: P3 owns role routing, closed-Plan successor checkpoint wording, HANDOFF projection, rehydration, and session-neutral continuation. P4 owns legacy/historical migration, cross-host behavior, Roadmap membership/cycle checks, recovery sequences, and two-Plan end-to-end acceptance.
- Candidate next Plan: P3 workflow role and successor handoff integration after P2 promotion criteria pass.
- Promotion evidence required: schema v2 compatibility; immutable closed evidence; separate transition facts; explicit approval; stale/double/unauthorized/active conflict rejection; byte-identical failure; successful lazy schema v3 transition; final QA and code review.
- Open questions: Whether P3 should expose approval through `imm-loop`, `imm-work`, or a dedicated host prompt remains deferred; P2 defines only the low-level authority command and record.
- Explicit non-goals: host messaging, HANDOFF writes, session automation, Roadmap graph parsing, historical bulk migration, queues, schedulers, DAGs, parallel active Plans, and automatic successor activation.

## Notes

- This Plan is validation-only during planning and must not be synced or activated by Planner. Preplan follow-up passed, but the user must still explicitly approve the revision-bound, locally linked P1-to-P2 transition.
- `--approve-successor` is an explicit authority input for one expected Ledger revision, not a reusable permission or config setting.
- A transition archive is evidence retention inside the existing State Ledger, not a second workflow authority.
