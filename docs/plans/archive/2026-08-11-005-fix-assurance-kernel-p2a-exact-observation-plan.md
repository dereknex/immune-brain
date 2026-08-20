# Iteration Plan

## Task

- Summary: Repair the P2A receipt-to-observation protocol so every receipt-v2 authority commit has one replayable exact automatic observation while v3 remains the sole production workflow authority.
- Origin: QA replan of `docs/plans/2026-08-11-004-fix-assurance-kernel-p2a-observation-boundary-plan.md` Step U2. R1 U1 closed durable receipts, but R1 U2 proved observation v1 could not persist or recover exact terminal receipt/source/bytes/revision binding.
- Origin review: Strict QA decision `replan`; R1 U2 focused readiness tests passed 37 tests, but producer/schema files required for exact binding were outside U2 Scope. Subsequent adversarial review required a receipt-side epoch marker and replay-sufficient terminal payload.
- Spec: `docs/specs/archive/assurance-kernel-v4-p2a-observation-r2.spec.md`
- Research: Receipt v1 covers normal mutation, Ledger-changing migration, and autowork authority CAS. Observation v1 persists attempt ID and revision in friction journal but lacks terminal record ID, source kind, and committed bytes hash. Terminal receipt success followed by observation failure cannot be reconstructed from a later live Ledger. R1 U2 readiness changes remain unclosed partial implementation and are removed in this slice.
- Decisions: D1 add additive receipt v2 generation plus terminal replay seed. D2 persist strict observation v2 in a dedicated automatic evidence journal. D3 keep receipt/observation v1 immutable, readable, and nonqualifying. D4 replay only from terminal receipt seed, never later live Ledger. D5 apply one protocol to normal mutation, project migration, and autowork authority CAS. D6 remove unclosed R1 readiness module/route/tests; readiness becomes R2B. D7 defer TaskIntent/reducer to R2C. D8 keep P2B/P2C/P3 deferred.
- Assumptions: Terminal receipt v2 can include bounded projection seed without becoming workflow authority. All authority adapters can capture one exact committed byte snapshot. Receipt hash-chain compatibility can parse v1 and v2 without rewrite. If a committed receipt cannot durably retain replay-sufficient material, a fourth production writer appears, or automatic observation must affect v3 success, this Plan must replan.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Superseded predecessor: `docs/plans/2026-08-11-004-fix-assurance-kernel-p2a-observation-boundary-plan.md`
- Plan boundary: R2A observation evidence producer only; no readiness policy or future Kernel data model.
- Boundary rationale: Observation durability and readiness policy have different failure/replan boundaries. TaskIntent/reducer has no receipt dependency. Splitting the slices prevents another evidence-protocol finding from invalidating unrelated P2A contracts.
- Scope pressure: High-risk persisted receipt and observation compatibility spans three authority writers. Retained as one Step because receipt generation, terminal seed, dedicated observation v2 persistence, replay, writer symmetry, and legacy classification form one indivisible exact-observation invariant.
- Roadmap source: `docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md`; `docs/specs/assurance-kernel-v4-p2a-readiness-r2.spec.md`.
- Execution scope: P2A R2A only.
- Deferred phases: R2B readiness projection; R2C TaskIntent/TaskRecord/reducer contracts; P2B Pi canary; P2C supported-host default; P3 retirement/import decision.
- Successor candidate: R2B readiness projection, advisory only.
- Successor preconditions: R2A terminal/reviewed; receipt-v2/observation-v2 contract stable; no unresolved gaps/conflicts in focused fixtures; literal user successor approval.
- Current-slice warning: This Plan does not calculate candidate readiness, create TaskRecords, mint authority, add privileged commands, change Skill routing, enroll a canary, switch a backend, support OpenCode/RPC privilege, or write legacy migration/import data.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, contract names, schema keys, enum values, API names, and runtime identifiers

## Brainstorm Trace

The current session, two QA replans, repository investigation, and late fast/mid/strong planner advisories are the authoritative framing source; no standalone brainstorm artifact exists.

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U1 | Exact replayable observation producer closes first. |
| BR-REQ-002 | deferred | R2B | Readiness consumes the stable producer in a separate Plan. |
| BR-REQ-003 | deferred | R2C | Intent/record/reducer contracts have a separate rollback boundary. |
| BR-FIND-001 | covered_by_step | U1 | Observation v1 lacks exact terminal receipt/source/bytes binding. |
| BR-FIND-002 | covered_by_step | U1 | Receipt-side epoch marker is required before the first v2 commit. |
| BR-FIND-003 | covered_by_step | U1 | Terminal receipt must retain replay material after later commits. |
| BR-DEC-001 | captured_as_decision | D1-D5 | Additive receipt/observation v2 and dedicated evidence journal. |
| BR-DEC-002 | captured_as_decision | D6-D7 | Split R2A/R2B/R2C rather than coupling all P2A domains. |
| BR-OUT-001 | out_of_scope | Scope | No readiness candidate calculation or rollout evidence bundle. |
| BR-OUT-002 | out_of_scope | Scope | No production TaskRecord route, issuer, or backend selection. |
| BR-OUT-003 | out_of_scope | Scope | No historical receipt/journal rewrite or terminal import. |

## Planner Advisory Synthesis

- Agreement: terminal receipt record ID, attempt ID, source kind, exact bytes hash, revision, generation, and observer version must be persisted and reconciled.
- Agreement: v1 remains diagnostic-only; a record claiming v2 with malformed binding must fail closed.
- Agreement: terminal receipt success plus observation failure requires durable replay material; later live Ledger reread is invalid.
- Agreement: a receipt-side generation marker defines the epoch before the first observation succeeds.
- Agreement: normal mutation, migration, and autowork authority CAS must use symmetric observation semantics.
- Agreement: query/friction journal records cannot be qualifying automatic evidence.
- Agreement: readiness policy and TaskIntent/reducer do not belong in this Plan.
- Decision: terminal receipt v2 carries a bounded observation seed rather than full Ledger bytes or a second workflow snapshot.
- Decision: v2 automatic observations use a dedicated `.imm/memory` journal; v1 friction journal remains untouched.
- Deferred authority: superseding R1 and syncing R2A require literal user authorization; Planner does not self-assert `--user-confirmed`.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Receipt/observation v2 is additive; v1 remains readable and is never rewritten.
- Failure before prepared v2 fsync leaves authority bytes unchanged.
- A terminal v2 seed error cannot change an already successful v3 commit; it remains explicit nonqualifying evidence.
- Automatic observation replay cannot write Ledger or route state.
- Removing R2A code before R2B preserves v3 authority and receipt-v1 compatibility.
- No Kernel-owned production task can be stranded because no production route exists.

### 2. Verification Vanity

- U1 cannot close from ordinary command lifecycle tests or full-suite green alone.
- Tests must prove receipt generation precedes replacement, seed fields share one byte snapshot, terminal record ID is the v2 primary key, and later live Ledger changes cannot alter replay.
- Process interruption must cover receipt prepare, authority replace, terminal seed/receipt, observation append, and replay after a later commit.
- Normal mutation, explicit/automatic migration, and autowork authority CAS require symmetric cases.
- V1 diagnostic readability and v2 malformed-claim blocking require independent fixtures.
- A source-level contract test must prove the unclosed readiness route is absent.

### 3. Spec Dilution Detection

- Observing from prepared receipt, attempt-only identity, final live Ledger reread, or friction journal violates R2A.
- Starting epoch at first successful observation hides the first gap and violates R2A.
- Treating legacy v1 as matching v2 violates R2A.
- Blocking future v3 commits solely because observation replay fails turns telemetry into authority and violates R2A.
- Retaining the unclosed R1 readiness route, calculating candidate status, or accepting migration/rehearsal evidence is R2B scope drift.
- Adding TaskIntent/reducer/application service is R2C scope drift.
- Adding Pi confirmation, enrollment, routing, import, or backend switch is P2B/P3 scope drift.

## Planning Quality Gate

- contract surface: additive receipt v2, terminal observation seed, dedicated automatic observation v2 journal, replay reconciler, three writer adapters, legacy classifier, R1 readiness cleanup.
- compatibility: receipt/observation v1 remains immutable/readable; v3 remains sole workflow authority; command success and migration rollback stay stable.
- interruption recovery: terminal seed survives observation failure and later commits; replay never uses historical live reread.
- rollback path: remove v2 producer/replay while retaining v1 receipt compatibility and Ledger authority; v2 records remain readable diagnostic bytes.
- verification strength: process SIGKILL/fault injection, exact-byte/hash/record binding, generation epoch, writer symmetry, legacy classification, duplicate/conflict tests, route absence test, full repository suite, strict QA, final review.
- design-depth classification: High risk due persisted commit receipts, replay protocol, writer symmetry, and future promotion evidence.
- Technical Design baseline: `docs/specs/archive/assurance-kernel-v4-p2a-observation-r2.spec.md`.
- Mermaid intent: show prepared generation, exact committed bytes, terminal seed, best-effort observation, and replay.
- Design Conformance: QA verifies no readiness policy, TaskRecord route, issuer, enrollment, import, or backend switch.
- roadmap preservation: R2B/R2C/P2B/P2C/P3 remain explicit successor candidates, not activated work.

## Steps

### Step 1

- Step ID: U1
- Result: Every receipt-v2 authority commit has one replayable exact observation identity.
- Scope: `plugins/immune-brain/runtime/authority_commit_receipts.ts`; `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/project_migration.ts`; `plugins/immune-brain/runtime/kernel/automatic_observations.ts`; `plugins/immune-brain/runtime/kernel/observation.ts`; `plugins/immune-brain/runtime/kernel/readiness.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `tests/authority-commit-receipts.test.ts`; `tests/kernel-shadow-observation.test.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-migrate.test.ts`; `tests/state-ledger-migration.test.ts`; `tests/project-migration-cli.test.ts`; `tests/kernel-r2a-boundary.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/authority_commit_receipts.ts` (receipt v1 chain and terminal recovery); `plugins/immune-brain/runtime/state_ledger.ts` (normal and autowork commit adapters); `plugins/immune-brain/runtime/project_migration.ts` (migration committed bytes and manifest boundary); `plugins/immune-brain/runtime/kernel/observation.ts` (observation v1 producer); `plugins/immune-brain/runtime/kernel/readiness.ts` (unclosed R1 partial implementation to remove); `plugins/immune-brain/runtime/commands/kernel.ts` (unclosed readiness route to remove); `tests/kernel-readiness.test.ts` (unclosed R1 tests to remove); `docs/specs/archive/assurance-kernel-v4-p2a-observation-r2.spec.md` (receipt/observation v2 authority)
- Verification: `test -f plugins/immune-brain/runtime/kernel/automatic_observations.ts && test -f tests/kernel-r2a-boundary.test.ts && test ! -e plugins/immune-brain/runtime/kernel/readiness.ts && test ! -e tests/kernel-readiness.test.ts && bun test tests/authority-commit-receipts.test.ts tests/kernel-shadow-observation.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts tests/state-ledger-migration.test.ts tests/project-migration-cli.test.ts tests/kernel-r2a-boundary.test.ts tests/runtime-state.test.ts tests/replan-recovery-runtime.test.ts && bun test && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; preserve closed receipt-v1 behavior, add receipt/observation v2 and replay, then remove only the unclosed R1 readiness module/route/tests and readiness-specific additions without reverting U1 receipts or unrelated user changes.
- failure_behavior: If terminal receipt v2 cannot durably retain replay-sufficient material, any production writer escapes generation/seed instrumentation, replay requires a later live Ledger reread, legacy records must be rewritten, or v2 telemetry must block/change v3 authority behavior, stop and replan. Never fall back to attempt-only, live-reread, friction-journal, or first-success epoch semantics.
- security_considerations: Seed contains bounded commit projection data, no secret/capability/session identity. Record IDs and observation IDs are domain-separated. Automatic journal paths use existing canonical root/symlink protections. R2A does not claim tamper resistance against the same OS user.
- Test scenarios: Covers receipt v1/v2 mixed chain parsing; Covers generation prepared before replace; Covers terminal seed exact bytes/hash/revision/source binding; Covers normal mutation, migration, autowork authority CAS; Covers prepared/committed/recovered-committed versus aborted/recovered-aborted; Covers SIGKILL before/after replace, terminal receipt, observation append, and later replay; Covers later Ledger mutation cannot change replay; Covers duplicate/conflicting receipt-record replay; Covers v1 readable/nonqualifying and invalid v2 claim; Covers A->B->A->B unique identities; Covers projection/raw writer inventory; Covers unchanged v3 exit/stdout/Ledger authority behavior; Covers readiness route/module/tests absent.

## Plan Closure Verification

- Run U1 Verification against current signatures.
- Run `bun test` and require zero failures.
- Inspect receipt-v1/v2 and observation-v2 fixtures for strict canonical parsing and hash-chain compatibility.
- Run normal command, explicit migration, automatic migration, autowork authority CAS, duplicate, conflict, and interruption smoke in temporary workspaces.
- Snapshot Ledger, receipt journal, TaskRecords, workspace pointer, migration manifests, and Intent paths around observation replay; only the dedicated automatic observation journal may gain evidence.
- Confirm canonical command manifest exposes no readiness route, mutation route, issuer, enrollment, import, or backend switch.
- Confirm every canonical production Ledger writer appears in the receipt-v2/observation-v2 inventory.
- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-005-fix-assurance-kernel-p2a-exact-observation-plan.md --json`.
- Require strict QA, final `imm-code-review`, Design Conformance, and Compounder before `imm-finish`.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-005-fix-assurance-kernel-p2a-exact-observation-plan.md --json`
- Focused tests: U1 Verification command above
- Repository regression: `bun test`
- Repository hygiene: `git diff --check`

## Roadmap Continuation

- R2B: validated receipt/observation reconciler; promotion epoch; lifecycle/family coverage; current migration digest; independently presented Git-owned rollout/rehearsal evidence; read-only readiness reporting.
- R2C: TaskIntent v1 secure reader; TaskRecord v2 compatibility boundary; all-acceptance completion; closed reducer vocabulary; authority consumption port; negative production-surface audit.
- P2B: Pi-only exact-task enrollment, `ctx.ui.confirm` capability issuance, Kernel application service, Kernel-aware lifecycle routing, immutable backend pinning, and drain-only rollback.
- P2C: default Kernel enrollment only for newly created tasks on separately qualified hosts.
- P3: v3 new-task retirement, read-only legacy projection, and a value decision before any terminal import.
- Successor rule: R2A completion does not activate R2B. A literal user must approve the successor after terminal closure.
- Explicit non-goals: readiness candidate calculation, rollout evidence writer, production TaskRecord creation, privileged CLI/tool, Pi issuer, Kernel Skill routing, default route, OpenCode/RPC privilege, dual write, active-task fallback, terminal import, migration write, scheduler, queue, persisted next action, or additional lifecycle phases.
