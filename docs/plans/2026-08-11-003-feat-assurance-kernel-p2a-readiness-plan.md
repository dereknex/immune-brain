# Iteration Plan

## Task

- Summary: Establish Assurance Kernel P2 production-readiness evidence and freeze the production intent, acceptance, mutation, and authority-consumption contracts while v3 remains the sole workflow authority.
- Origin: The user explicitly requested P2 planning after P1 foundation, P1 hardening, finished-shadow repair, and a clean 611-test repository baseline. Current P1 journal evidence spans only about five hours and 48 manual queries, so the parent two-week production-promotion gate is not met.
- Spec: `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md`
- Research: P1 code and Specs confirm that TaskRecord lifecycle/storage, complete legacy projection, canonical shadow CLI, and privilege separation exist, but automatic post-v3 observation, readiness qualification, TaskIntent sidecar loading, acceptance-complete evidence, production factual actions, and a host authority port do not. Pi Extension documentation confirms command invocation is not user authentication while `ctx.ui.confirm` is an independent interactive confirmation boundary. A fast/mid/strong Planner ensemble unanimously rejected immediate canary routing, OpenCode privilege, dual write, and terminal import in P2A.
- Decisions: D1 divide P2 into P2A readiness/contracts, P2B Pi-only canary, P2C supported-host default, and P3 legacy retirement. D2 keep every P2A production command on v3. D3 observe immutable committed v3 snapshots only after commit. D4 qualify promotion from automatic commit coverage rather than manual query volume. D5 introduce TaskIntent v1 and production TaskRecord v2 with stable acceptance IDs. D6 require fresh accepted evidence for every current acceptance ID. D7 freeze a closed reducer action vocabulary and host authority consumption port without exposing a production issuer. D8 keep terminal import outside P2 and reject it permanently unless P3 proves concrete value.
- Assumptions: `current_iteration_history.jsonl` or an equivalent canonical v3 commit receipt can provide a durable denominator for observation-gap detection; if implementation cannot establish that denominator without making telemetry authoritative, U1 must replan. P1 TaskRecord v1 has no approved production records and remains compatibility-read-only. The current root suite remains green before P2A execution. The trusted Pi process and its UI callback are inside the orchestration trust boundary; a malicious same-user process or workspace agent is outside it.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: One non-routing production-readiness slice covering automatic observation, deterministic promotion evidence, production intent identity, and the closed reducer/authority contract.
- Boundary rationale: These four outcomes establish the evidence and data contracts that P2B must consume before the first Kernel-owned task. They are reversible while v3 remains sole authority. Pi authority issuance, TaskRecord enrollment, Skill routing, and backend pinning create a separate production and rollback boundary owned by P2B.
- Scope pressure: Four runtime domains and four focused test surfaces. Retained as one Plan because all outputs remain unreachable from production mutation, require no TaskRecord migration, and share one rollback: remove P2A observation/contracts while v3 continues unchanged.
- Execution scope: P2A only: production-readiness observation plus Kernel intent/mutation contracts with no production route.
- Deferred phases: P2B Pi-only per-task canary; P2C supported-host default; P3 legacy retirement and any separately justified terminal import.
- Successor candidate: P2B, advisory only because this Plan does not opt into `roadmap-slice/v1` and does not approve or activate a successor.
- Successor preconditions: P2A is terminal and reviewed; `imm-kernel readiness` reports `candidate` for one unchanged observer version after 14 consecutive days, three complete real v3 lifecycles, complete commit coverage, and zero divergence/ambiguity/gaps; the current migration dry-run digest is displayed; Pi rollback/drain rehearsal passes; the literal user separately approves P2B.
- Current-slice warning: This Plan does not create production TaskRecords, mint production authority, add a privileged CLI/tool, change Skill routing, enable a canary, change the default backend, support OpenCode/RPC privilege, or write terminal migration data.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, contract names, schema keys, enum values, API names, and runtime identifiers

## Brainstorm Trace

The current session is the authoritative framing source; no standalone brainstorm artifact was created.

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | partially_covered | U1-U4 | Design P2 production routing; P2A closes readiness/contracts while P2B/P2C retain actual routing. |
| BR-REQ-002 | covered_by_step | U1, U2 | Promotion must be evidence-based and cannot use the current five-hour manual journal. |
| BR-REQ-003 | partially_covered | U4, P2B | Authenticated authority is defined as a host capability contract; Pi issuance remains P2B. |
| BR-REQ-004 | captured_as_decision | D8 | Terminal import is not required for production routing and remains outside P2. |
| BR-DEC-001 | captured_as_decision | D1 | Cutover is phased by authority and rollback boundary. |
| BR-DEC-002 | covered_by_step | U3 | Acceptance criteria receive stable identities and complete evidence coverage. |
| BR-OUT-001 | out_of_scope | Scope | No v3/Kernel dual write or active-task backend switch. |
| BR-OUT-002 | out_of_scope | Scope | No generic workflow engine, scheduler, event sourcing platform, or policy DSL. |
| BR-OUT-003 | out_of_scope | Scope | No session state, automatic session control, or session-bound authority. |
| BR-DEFER-001 | deferred | P2B | Pi `ctx.ui.confirm` issuer and exact-task enrollment. |
| BR-DEFER-002 | deferred | P2C | Default Kernel route and additional host qualification. |
| BR-DEFER-003 | deferred | P3 | Legacy retirement and optional migration value decision. |

## Planner Ensemble Synthesis

- Agreement: P2A is executable now; P2B/P2C are no-go; v3 remains the sole production authority; automatic observations must be post-commit; manual status calls do not count; Pi is the first possible canary host; OpenCode privilege and terminal import are rejected.
- Agreement: routing ownership is chosen before first mutation and never changes for an in-flight task; rollback disables enrollment and drains or explicitly stops Kernel tasks.
- Disagreement resolved: the mid candidate proposed ten narrow P2A Steps. The final Plan groups them into four closeable system invariants to avoid recreating process rigidity while retaining separate QA evidence for observation, readiness, intent/acceptance, and reducer authority.
- Disagreement resolved: the strong candidate proposed a fixed 200-mutation floor. The final promotion predicate uses 14 consecutive days, three completed real lifecycles, required mutation-family coverage, exact commit/observation reconciliation, and automated negative-path tests. This prevents idle/manual-query promotion without introducing an arbitrary activity quota.
- Strong-model blocker converted to design: orchestration authority is not a hostile-local-code security boundary; the Spec states this explicitly and forbids non-repudiation claims.
- Strong-model blocker converted to verification: observer failure must be injected after an already committed v3 mutation and cannot alter command result or authority bytes.
- Strong-model blocker converted to failure behavior: if a durable expected-commit denominator cannot be derived, U1 replans instead of weakening readiness to journal-only counting.

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 adds a post-commit observer only. Reverting it stops new observations without changing or repairing v3 state; existing journal entries remain non-authoritative.
- U2 is a pure report and read-only CLI subcommand. It can be removed without any authority-state migration.
- U3 adds a secure reader and a production-only schema contract that is not yet enrolled. P1 v1 remains readable; no production record requires conversion.
- U4 adds unreachable reducer/application contracts. Before P2B they can be reverted without draining tasks because no production route exists.
- If any Step creates a TaskRecord from a normal command or makes v3 success depend on observation, that is structural drift and requires replan rather than rollback documentation.

### 2. Verification Vanity

- U1 does not close from a journal line count. It must correlate stable post-commit observations with authoritative commit receipts and fault-inject observer failure, process interruption, lock conflict, and rapid subsequent mutation.
- U2 synthetic 14-day fixtures prove predicate logic but do not satisfy the real promotion gate. The live report must remain `collecting` at Plan closure.
- U3 cannot close from schema parsing alone. It must prove acceptance-ID uniqueness, path identity, no-symlink/TOCTOU handling, hash binding, and all-acceptance completion.
- U4 cannot close from reducer unit success alone. It must prove public storage cannot mutate factual arrays directly, privileged descriptors are not authority, replay binds authority, and no production issuer or mutation CLI exists.
- Full repository tests are closure evidence, not a replacement for focused negative and recovery paths.

### 3. Spec Dilution Detection

- Counting manual `status`, `journal`, or migration calls as automatic observations violates D4.
- Running projection before v3 commit or making journal failure affect v3 violates D3.
- Keeping `acceptance: string[]` while evidence remains unbound to criteria violates D5-D6.
- Adding a generic `patch_record`, `hydrate`, `import`, or arbitrary serialized action command violates D7-D8.
- Exporting a production authority factory, accepting `--user-confirmed`, or persisting a reusable capability violates D7.
- Persisting route recommendation, eligibility, blocked, next action, or Skill checkpoint violates the four-phase Kernel boundary.
- Implementing Pi commands, TaskRecord enrollment, backend switching, OpenCode privilege, or migration writes is P2B/P3 scope drift.

## Planning Quality Gate

- contract surface: `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md`, v3 central mutation/commit receipts, `runtime/kernel` contracts, canonical `imm-kernel` CLI, worktree-local journal, and focused P2A tests.
- compatibility: P2A leaves all production routing on v3. TaskRecord v1 remains compatibility-readable but is not production-enrollable; no existing v3 Ledger or TaskRecord is rewritten.
- interruption recovery: each closed Step is independently usable or removable. No Step can strand a Kernel-owned production task.
- rollback path: disable observer, remove pure readiness/intent surfaces, or revert unreachable reducer contracts; no migration cleanup or cross-backend reconstruction.
- verification strength: deterministic fixtures, property/table tests, fault injection, CAS/restart checks, byte snapshots, real read-only smoke, full repository tests, strict QA, final code review, and Compounder.
- design-depth classification: High risk because the resulting contracts gate future production authority, persistence, and host integration even though P2A itself does not route production tasks.
- Technical Design baseline: the referenced P2 Spec is the sole authority for phase boundaries, threat boundary, TaskIntent/TaskRecord v2, promotion predicate, and P2B/P3 exclusions.
- Mermaid intent: distinguish post-commit observation, readiness, TaskIntent, host authority, Kernel mutation, and per-task routing ownership.
- Design Conformance: QA must verify each Step preserves `v3-only` production routing and does not add issuer, enrollment, Skill routing, or import behavior.
- Brainstorm traceability: all session-grounded requirements, decisions, non-goals, and deferrals are mapped above.
- roadmap information preservation: P2B, P2C, and P3 retain explicit entry gates, backend affinity, rollback, host limitations, and import rejection criteria in the Spec.
- acceptance scope discipline: P2A may finish while the live readiness report is `collecting`; it proves the evidence system and contracts, not promotion eligibility.

## Steps

### Step 1

- Step ID: U1
- Result: Every successful v3 authority commit has one post-commit shadow observation.
- Scope: `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/kernel/observation.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/types.ts`; `tests/kernel-shadow-observation.test.ts`; focused v3 mutation/recovery fixtures.
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (atomic writes, revisions, and history); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (canonical command dispatch and project access); `plugins/immune-brain/runtime/kernel/legacy.ts` (pure committed-snapshot inspector); `plugins/immune-brain/runtime/kernel/storage.ts` (non-authoritative journal); `tests/runtime-state.test.ts` (representative state commits); `tests/replan-recovery-runtime.test.ts` (replan commit recovery); `tests/review-decision-notes.test.ts` (review mutation fixtures)
- Verification: `bun test tests/kernel-shadow-observation.test.ts tests/runtime-state.test.ts tests/replan-recovery-runtime.test.ts && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; instrument one central successful commit boundary, not every command independently.
- failure_behavior: If no durable stable commit receipt or authoritative history denominator can cover sync/activate/work/review/finish/termination without making observation part of the transaction, stop and replan. Never fall back to manual-call counting or pre-commit projection.
- security_considerations: The observer consumes immutable committed bytes/revision, appends only non-authoritative telemetry, stores no session identity or secrets, and cannot invoke recovery writes.
- Test scenarios: Covers one observation per successful commit identity; Covers retry deduplication and conflicting receipt rejection; Covers rejected/CAS-conflicted mutation classification; Covers observer throw, journal failure, process interruption, lock contention, and rapid next commit; Covers post-state rather than live reread; Covers unchanged v3 exit/stdout/Ledger behavior.

### Step 2

- Step ID: U2
- Result: P2 readiness is a deterministic fail-closed projection.
- Scope: `plugins/immune-brain/runtime/kernel/readiness.ts`; `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-migrate.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/kernel/observation.ts` (U1 observation contract and commit identities); `plugins/immune-brain/runtime/commands/kernel.ts` (read-only status, journal, and migration shapes); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (manifest and project access); `docs/specs/assurance-kernel-v4.spec.md` (parent P2 promotion rule)
- Verification: `bun test tests/kernel-readiness.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts && plugins/immune-brain/bin/imm-kernel readiness --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json && git diff --check`
- Verification type: automated
- Depends on: 1
- Execution note: inject clock and observation data into a pure projector; the CLI remains a canonical read-only adapter.
- failure_behavior: Missing receipts, duplicate/conflicting observations, malformed records, version changes, gaps, ambiguity, divergence, insufficient calendar window, insufficient lifecycle coverage, or missing dry-run digest return `collecting` or `blocked`, never candidate and never partial success.
- security_considerations: Readiness is operational evidence, not tamper-proof audit. It exposes bounded counts/reason codes/digests only and writes no authority, approval, TaskRecord, workspace pointer, Intent, or Ledger state.
- Test scenarios: Covers five-hour/manual-only and 13-day collecting fixtures; Covers 14-day but idle/no-lifecycle fixture; Covers three complete lifecycles and required mutation families; Covers one gap/divergence/malformed/version change; Covers duplicate retries; Covers current live output remains non-candidate; Covers before/after authority-byte snapshots.

### Step 3

- Step ID: U3
- Result: Every acceptance criterion has one stable evidence identity.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/intent.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-intent.test.ts`; `tests/kernel-core.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/kernel/types.ts` (P1 TaskIntent and TaskRecord v1 schema); `plugins/immune-brain/runtime/kernel/validation.ts` (strict parsers and intent update rules); `plugins/immune-brain/runtime/kernel/completion.ts` (current any-evidence predicate); `plugins/immune-brain/runtime/progress_projection.ts` (secure path precedent); `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md` (D4 TaskIntent authority)
- Verification: `bun test tests/kernel-intent.test.ts tests/kernel-core.test.ts && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; introduce TaskIntent v1 sidecar plus TaskRecord v2 production contract without rewriting P1 v1 records.
- failure_behavior: Invalid path identity, symlink, traversal, oversized input, malformed/unknown JSON, duplicate acceptance ID, task mismatch, read drift, revision rollback, hash mismatch, or incomplete acceptance evidence fails closed without filesystem mutation. If v1 compatibility requires a permissive production fallback, stop and replan.
- security_considerations: Git ownership is not authentication. Bind canonical path, no-symlink identity, revision, normalized content hash, acceptance ID, intent hash, and diff hash; never trust dirty/clean status as user authority.
- Test scenarios: Covers exact valid sidecar; Covers all path/TOCTOU/size/schema failures; Covers compatible and breaking revisions; Covers v1 compatibility-read-only and v2 production eligibility; Covers evidence for some versus every acceptance ID; Covers stale revision/hash/diff; Covers no persisted derived stale flags; Covers byte-identical intent reads.

### Step 4

- Step ID: U4
- Result: Every production TaskRecord fact mutation is reducer-owned.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/reducer.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/authority.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-production-actions.test.ts`; `tests/kernel-core.test.ts`; `tests/kernel-migrate.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/kernel/reducer.ts` (P1 event fingerprint and authority descriptor); `plugins/immune-brain/runtime/kernel/storage.ts` (P1 working-only creation and CAS transaction); `plugins/immune-brain/runtime/kernel/intent.ts` (U3 TaskIntent v1 and TaskRecord v2 acceptance identity); `docs/specs/assurance-kernel-v4-p2-managed-cutover.spec.md` (D5-D6 production action and authority contracts); `plugins/immune-brain/.pi-extension/index.ts` (repo-local trusted-host adapter boundary deferred to P2B)
- Verification: `bun test tests/kernel-production-actions.test.ts tests/kernel-core.test.ts tests/kernel-migrate.test.ts && ! rg -n 'patch_record|hydrate|allowTerminal|user_confirmed|approved: true' plugins/immune-brain/runtime/kernel plugins/immune-brain/runtime/commands/kernel.ts && git diff --check`
- Verification type: automated
- Depends on: 3
- Execution note: implement one closed table of typed factual actions and one authority-consumption port; do not add a generic mutation command or host issuer.
- failure_behavior: Any factual mutation lacking a typed reducer action, exact intent/record binding, valid authority kind, event identity, or CAS success performs no write. If tests need a production issuer or CLI mutation to close, stop and replan because that belongs to P2B.
- security_considerations: Ordinary facts remain unprivileged; QA/review/user actions consume distinct opaque host capabilities; serialized audit descriptors never grant authority; no minting factory is exported from production surfaces; the contract does not claim protection from malicious same-user code.
- Test scenarios: Covers evidence, finding, ordinary resolve, QA/review approval, user approval, compatible revision, breaking revision, stop, and user-decision resolution; Covers phase/role/revision/hash/diff rejection; Covers identical replay and conflicting reuse; Covers all-acceptance auto-completion; Covers direct storage bypass rejection; Covers CAS/transaction restart; Covers no public issuer, privileged CLI, generic patch, import, or terminal creation.

## Plan Closure Verification

- Run every Step Verification against current signatures.
- Run `bun test` and require zero failures.
- Run `plugins/immune-brain/bin/imm-kernel status --json`, `readiness --json`, and migration dry-run against the real workspace; expect readiness `collecting` until the real gate matures.
- Snapshot `.imm/memory/current_iteration.json`, `.imm/tasks`, `.imm/workspace.json`, and TaskIntent files before/after all P2A CLI smoke checks.
- Confirm canonical command manifest still describes `imm-kernel` as shadow/read-only and exposes no mutation or authority issuer.
- Confirm v3 `imm-plan`, `imm-work`, `imm-review`, and `imm-finish` remain the only production mutation routes.
- Validate this Plan through `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-003-feat-assurance-kernel-p2a-readiness-plan.md --json`.
- Require strict per-Step QA, final `imm-code-review`, Design Conformance against the P2 Spec, and Compounder before `imm-finish`.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-003-feat-assurance-kernel-p2a-readiness-plan.md --json`
- Focused tests: the four Step Verification commands above
- Repository regression: `bun test`
- Real read-only smoke: `plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-kernel readiness --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json`
- Repository hygiene: `git diff --check`

## Roadmap Continuation

- Preserved P2B content: Pi-only exact-task enrollment; `ctx.ui.confirm` capability issuance; Kernel application service; TaskRecord/workspace enrollment transaction; v4-aware Planner/Work/Loop/QA/review routing; immutable backend pinning; drain-only rollback.
- Preserved P2C content: default Kernel enrollment for newly created managed tasks on separately qualified hosts; incident fallback for new tasks only; canary mechanism exit milestone.
- Preserved P3 content: v3 new-task retirement; read-only legacy projection; explicit value decision before any terminal import; provenance and rollback Plan only if import remains necessary.
- Open questions: P2B exact first cohort, Pi confirmation UX, host-validated QA/review receipt shape, P2C canary period, and non-Pi confirmation semantics. None block P2A.
- Promotion criteria: P2A completion is necessary but insufficient. P2B requires the machine and literal-user preconditions recorded in the Task and P2 Spec.
- Candidate next Plan: P2B Pi-only canary, created and validated only after a fresh readiness report is `candidate` and the user explicitly requests it.
- Explicit non-goals: production TaskRecord creation, privileged CLI/tool, Pi issuer implementation, v4 Skill routing, default route, OpenCode/RPC privilege, dual write, active-task fallback, terminal import, migration write, scheduler, queue, persisted next action, or new lifecycle phases.
