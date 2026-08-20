# Iteration Plan

## Task

- Summary: Repair the P2A authority-commit observation boundary, then complete production-readiness, intent identity, and reducer authority contracts while v3 remains the sole production workflow authority.
- Origin: QA replan of `docs/plans/2026-08-11-003-feat-assurance-kernel-p2a-readiness-plan.md` Step U1. The predecessor assumed `commitStateMutation` covered every production Ledger commit, but canonical runtime preflight and explicit migration can commit `.imm/memory/current_iteration.json` through `project_migration.ts:migrateProject`.
- Origin review: QA decision `replan` for predecessor Step 1; focused observer implementation passed 20 tests and diff hygiene but did not cover committed project migrations.
- Spec: `docs/specs/archive/assurance-kernel-v4-p2a-readiness-r1.spec.md`
- Research: Runtime inspection proves two production authority commit classes plus one production-reachable projection-only writer. Existing business history and deterministic migration manifests cannot serve as durable commit receipts: archive append precedes Ledger rename, final-byte hashes can collapse distinct commits, migration manifest identity omits `after_sha256`, and rolled-back attempts can reuse a manifest directory. The previous observer code remains partial implementation only; no predecessor execution evidence carries forward.
- Decisions: D1 introduce one append-only fsynced authority commit receipt protocol with unique attempt IDs, prepared/terminal records, a hash chain, and next-start/write recovery. D2 instrument both normal state mutations and Ledger-changing committed project migrations. D3 classify `commitStateIfUnchanged` as projection-only only while tests prove it preserves authority facts, and classify `saveStateLedger` outside production only while its call-site inventory remains empty. D4 derive observation from immutable committed receipts rather than live reread. D5 keep observation failure non-authoritative while receipt preparation remains a precondition to starting an authority commit. D6 retain the original P2A readiness, TaskIntent, TaskRecord v2, reducer, and authority-port outcomes. D7 keep P2B/P2C/P3 deferred.
- Assumptions: The existing Ledger lock can serialize receipt recovery with all supported authority commits. A strict prepared receipt can bind exact before/after Ledger hashes before replacement. Project migration can bind the receipt attempt into its transaction metadata without changing successful rollback semantics. If any production Ledger writer bypasses the closed inventory, receipt recovery cannot classify an interrupted attempt, or migration cannot link one unique attempt without false commits, U1 must replan again.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Superseded predecessor: `docs/plans/2026-08-11-003-feat-assurance-kernel-p2a-readiness-plan.md`
- Plan boundary: One corrected P2A readiness/contracts slice with no production Kernel routing.
- Boundary rationale: The migration writer invalidates the predecessor observation boundary but does not change the remaining P2A outcomes or authorize P2B. A new Plan path preserves immutable execution history while reusing verified partial code as unclosed implementation.
- Scope pressure: Durable receipt protocol/recovery, observation/readiness reconciliation, intent identity, and reducer authority span several contracts. Retained as one Plan because U1 is the prerequisite for U2, U3/U4 are production-unreachable pure contracts, and the shared rollback leaves v3 routing authoritative.
- Roadmap source: `docs/specs/archive/assurance-kernel-v4-p2-managed-cutover.spec.md`
- Execution scope: P2A only.
- Deferred phases: P2B Pi canary, P2C supported-host default, P3 legacy retirement and any separately justified terminal import.
- Successor candidate: P2B, advisory only.
- Successor preconditions: P2A terminal/reviewed; one unchanged observer version for 14 consecutive days; at least three complete real v3 lifecycles; exact normal-plus-migration receipt reconciliation; zero divergence/ambiguity/gaps; current dry-run digest; rollback rehearsal; separate literal user approval.
- Current-slice warning: This Plan does not create production TaskRecords, mint authority, add privileged commands, change Skill routing, enroll a canary, switch a backend, support OpenCode/RPC privilege, or write terminal migration data.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, contract names, schema keys, enum values, API names, and runtime identifiers

## Brainstorm Trace

The current session and predecessor QA decision are the authoritative framing source; no standalone brainstorm artifact exists.

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | partially_covered | U1-U4 | P2A closes readiness/contracts; P2B/P2C retain actual production routing. |
| BR-REQ-002 | covered_by_step | U1, U2 | Promotion uses complete automatic authority-commit coverage. |
| BR-REQ-003 | partially_covered | U4, P2B | P2A defines authority consumption; Pi issuance remains P2B. |
| BR-REQ-004 | captured_as_decision | D6 | Terminal import remains outside P2. |
| BR-FIND-001 | covered_by_step | U1 | `migrateProject` is a production Ledger writer outside `commitStateMutation`. |
| BR-DEC-001 | captured_as_decision | D1-D4 | A dedicated durable receipt protocol forms the denominator; history, manifests, and observations remain separate evidence classes. |
| BR-OUT-001 | out_of_scope | Scope | No dual write or active-task backend switch. |
| BR-OUT-002 | out_of_scope | Scope | No generic workflow engine, scheduler, event platform, or policy DSL. |
| BR-OUT-003 | out_of_scope | Scope | No session-bound state or authority. |
| BR-DEFER-001 | deferred | P2B | Pi `ctx.ui.confirm` issuer and exact-task enrollment. |
| BR-DEFER-002 | deferred | P2C | Default Kernel route and additional host qualification. |
| BR-DEFER-003 | deferred | P3 | Legacy retirement and optional import value decision. |

## Planner Advisory Synthesis

- Agreement: the predecessor Plan cannot be edited in place and its QA decision must remain archived.
- Agreement: the passing normal-mutation observer is partial implementation, not closure evidence for the corrected denominator.
- Agreement: project migration must publish a unique prepared authority attempt before replacement; committed observation occurs only after committed-manifest publication and outside rollback semantics.
- Agreement: existing business history, deterministic manifest identity, and final-byte hash are insufficient commit identities.
- Agreement: a durable prepared/terminal receipt protocol is authority commit bookkeeping, while observation remains best-effort telemetry.
- Agreement: projection-only and raw writers require a closed, tested call-site classification.
- Decision criterion: if receipt recovery cannot distinguish committed from aborted attempts before a later authority write, U1 replans rather than weakening readiness.
- Deferred authority: superseding the predecessor and syncing this Plan require literal user authorization; Planner does not self-assert `--user-confirmed`.

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 is additive at the routing level but intentionally strengthens v3 commit bookkeeping. Removing it before P2B must restore the predecessor writer protocol through a tested migration/rollback path; already-written receipt journals remain readable.
- A failure before durable receipt preparation leaves authority bytes unchanged.
- A failure after preparation is terminally reconciled before any later authority write.
- A migration failure before manifest commit follows restoration logic and terminates the attempt as aborted.
- A terminal-receipt or observation failure after a successful authority commit cannot roll back or mark the v3 command failed.
- U2 is pure/read-only; U3 and U4 are production-unreachable contracts.
- No Step can strand a Kernel-owned production task because P2A has no enrollment route.

### 2. Verification Vanity

- U1 cannot close from normal command lifecycle tests alone. It must cover unique prepared/terminal receipts, A->B->A->B identity, explicit and automatic migration, repeated rolled-back attempts, parent-directory fsync, interrupted recovery, projection-only/raw writer inventory, observer failure, and exact receipt-to-observation reconciliation.
- U2 synthetic 14-day fixtures prove predicate logic but do not make the live workspace a candidate.
- U3 must prove secure path identity and evidence coverage for every acceptance ID, not merely schema parsing.
- U4 must prove storage bypass rejection and absence of production issuer/mutation CLI.
- Full `bun test` is closure evidence, not a substitute for receipt-specific fault tests.

### 3. Spec Dilution Detection

- Excluding `migrateProject`, `commitStateIfUnchanged`, or the raw writer call-site inventory would repeat the invalidated assumption.
- Treating business history, deterministic migration manifests, final-byte hashes, or observation entries as commit receipts violates the revised Spec.
- Allowing a later authority write before prepared-receipt recovery violates the crash-safety contract.
- Observing before committed-manifest publication or inside rollback semantics violates the revised Spec.
- Counting manual status/dry-run calls violates promotion evidence.
- Adding Pi commands, TaskRecord enrollment, backend routing, generic mutation/import, or terminal migration writes is scope drift.

## Planning Quality Gate

- contract surface: durable authority commit receipt journal, normal and migration commit adapters, recovery reconciler, non-authoritative observation journal, readiness report, TaskIntent/TaskRecord v2, reducer authority port.
- compatibility: v3 remains sole production workflow authority; receipt preparation/recovery strengthens commit bookkeeping while command behavior and migration rollback remain stable.
- interruption recovery: every prepared attempt is terminally reconciled before a later authority write; committed receipt observation replay is idempotent; aborted attempts are excluded from the readiness denominator.
- rollback path: P2A provides a tested protocol rollback/migration for receipt files while leaving v3 workflow routing unchanged.
- verification strength: process interruption, fsync/hash-chain checks, A->B->A->B identity, exact-byte checks, writer inventory, receipt reconciliation, command lifecycle tests, migration transaction tests, CAS/restart checks, full repository suite, strict QA, final review.
- design-depth classification: High risk due persisted authority, migration, concurrency, and future promotion decisions.
- Technical Design baseline: `docs/specs/archive/assurance-kernel-v4-p2a-readiness-r1.spec.md`.
- Mermaid intent: clarify two commit paths and post-commit observation ordering.
- Design Conformance: QA verifies P2A stays v3-only and exposes no issuer, routing, enrollment, or import.
- roadmap preservation: P2B/P2C/P3 gates and non-goals remain explicit.

## Steps

### Step 1

- Step ID: U1
- Result: Every successful v3 Ledger authority commit is represented by exactly one automatic shadow observation.
- Scope: `plugins/immune-brain/runtime/authority_commit_receipts.ts`; `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/project_migration.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/kernel/observation.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/types.ts`; `tests/authority-commit-receipts.test.ts`; `tests/kernel-shadow-observation.test.ts`; `tests/state-ledger-migration.test.ts`; `tests/project-migration-cli.test.ts`; focused v3 mutation/recovery fixtures.
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (normal commit ordering history compaction projection writer raw writer); `plugins/immune-brain/runtime/project_migration.ts` (manifest identity prepared committed rollback recovery); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (automatic and explicit migration plus projection-writer reachability); `plugins/immune-brain/runtime/kernel/observation.ts` (partial immutable snapshot observer); `plugins/immune-brain/runtime/kernel/storage.ts` (non-authoritative journal locking); `tests/kernel-shadow-observation.test.ts` (partial normal mutation observer evidence); `tests/state-ledger-migration.test.ts` (migration interruption rollback recovery idempotency); `tests/project-migration-cli.test.ts` (explicit and automatic migration command boundary)
- Verification: `bun test tests/authority-commit-receipts.test.ts tests/kernel-shadow-observation.test.ts tests/state-ledger-migration.test.ts tests/project-migration-cli.test.ts tests/runtime-state.test.ts tests/replan-recovery-runtime.test.ts && bun test && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; retain immutable snapshot projection and best-effort observation, replace byte-hash commit identity with the durable prepared/terminal receipt protocol, then instrument normal and migration authority paths.
- failure_behavior: If a production Ledger writer escapes the closed inventory, a prepared receipt cannot be terminally recovered before a later write, projection-only commits alter authority facts, or migration cannot bind one unique attempt without false commits, stop and replan. Never fall back to history-, manifest-, final-byte-, observation-, or manual-query-only counting.
- security_considerations: Receipt records bind canonical state-path identity, unique attempt ID, source kind, exact before/after hashes, revision, terminal status, and chain predecessor. Receipt metadata stores no session identity or secrets. Observation remains unable to invoke recovery writes.
- Test scenarios: Covers normal sync/activate/work/review/finish/termination; Covers A->B->A->B and byte-identical commit identity; Covers prepared/committed/aborted and recovered terminal receipts; Covers parent-directory fsync and receipt hash chain; Covers explicit/automatic/no-op/Plan-only/rolled-back/committed project migration; Covers repeated migration attempts and legacy manifest compatibility; Covers projection-only writer invariants and raw writer inventory; Covers failed CAS; Covers exact bytes versus live reread; Covers process interruption before/after Ledger rename and committed-manifest publication; Covers observer/journal/lock/terminal-receipt failure; Covers duplicate replay and conflicting identity; Covers unchanged v3 exit/stdout/Ledger authority behavior.

### Step 2

- Step ID: U2
- Result: P2 readiness is a deterministic fail-closed projection.
- Scope: `plugins/immune-brain/runtime/kernel/readiness.ts`; `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `tests/kernel-readiness.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-migrate.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/authority_commit_receipts.ts` (durable denominator and recovery protocol); `plugins/immune-brain/runtime/kernel/observation.ts` (receipt-bound observation contract); `plugins/immune-brain/runtime/project_migration.ts` (migration attempt binding); `plugins/immune-brain/runtime/commands/kernel.ts` (read-only adapters); `docs/specs/archive/assurance-kernel-v4-p2a-readiness-r1.spec.md` (promotion predicate)
- Verification: `bun test tests/kernel-readiness.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts && plugins/immune-brain/bin/imm-kernel readiness --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json && git diff --check`
- Verification type: automated
- Depends on: 1
- Execution note: inject clock, expected receipts, observations, and migration digest into one pure projector.
- failure_behavior: Missing expected receipts, conflicting duplicates, orphan observations, malformed sources, version changes, gaps, ambiguity, divergence, insufficient calendar/lifecycle coverage, or missing dry-run digest return `collecting` or `blocked`, never candidate.
- security_considerations: Readiness is bounded operational evidence, not tamper-proof audit; it writes no authority, TaskRecord, workspace pointer, Intent, or Ledger state.
- Test scenarios: Covers five-hour/manual-only and 13-day collecting; Covers 14-day idle/no-lifecycle; Covers three complete lifecycles and required mutation families; Covers normal/migration gaps and conflicts; Covers observer version reset; Covers current live output remains non-candidate; Covers authority-byte snapshots.

### Step 3

- Step ID: U3
- Result: Every acceptance criterion has one stable evidence identity.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/intent.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-intent.test.ts`; `tests/kernel-core.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/kernel/types.ts` (P1 schemas); `plugins/immune-brain/runtime/kernel/validation.ts` (strict parsing); `plugins/immune-brain/runtime/kernel/completion.ts` (current predicate); `plugins/immune-brain/runtime/progress_projection.ts` (secure path precedent); `docs/specs/archive/assurance-kernel-v4-p2a-readiness-r1.spec.md` (intent identity contract)
- Verification: `bun test tests/kernel-intent.test.ts tests/kernel-core.test.ts && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; add TaskIntent v1 plus TaskRecord v2 production contract without rewriting P1 v1 records.
- failure_behavior: Invalid path identity, symlink, traversal, oversized input, malformed/unknown JSON, duplicate acceptance ID, task mismatch, read drift, revision rollback, hash mismatch, or incomplete evidence fails closed without mutation.
- security_considerations: Git ownership is a convention, not authentication. Bind path, identity, revision, content hash, acceptance ID, and diff hash.
- Test scenarios: Covers valid sidecar; Covers path/TOCTOU/size/schema failures; Covers compatible and breaking revisions; Covers v1 compatibility-read-only and v2 production eligibility; Covers some versus every acceptance ID; Covers stale revision/hash/diff; Covers byte-identical reads.

### Step 4

- Step ID: U4
- Result: Every production TaskRecord fact mutation is reducer-owned.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/reducer.ts`; `plugins/immune-brain/runtime/kernel/completion.ts`; `plugins/immune-brain/runtime/kernel/authority.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-production-actions.test.ts`; `tests/kernel-core.test.ts`; `tests/kernel-migrate.test.ts`.
- Discovery cache: `plugins/immune-brain/runtime/kernel/reducer.ts` (event fingerprint and authority descriptor); `plugins/immune-brain/runtime/kernel/storage.ts` (CAS transaction and creation guard); `plugins/immune-brain/runtime/kernel/intent.ts` (TaskIntent and acceptance identity); `docs/specs/archive/assurance-kernel-v4-p2a-readiness-r1.spec.md` (closed actions and authority port); `plugins/immune-brain/.pi-extension/index.ts` (P2B host boundary only)
- Verification: `bun test tests/kernel-production-actions.test.ts tests/kernel-core.test.ts tests/kernel-migrate.test.ts && ! rg -n 'patch_record|hydrate|allowTerminal|user_confirmed|approved: true' plugins/immune-brain/runtime/kernel plugins/immune-brain/runtime/commands/kernel.ts && git diff --check`
- Verification type: automated
- Depends on: 3
- Execution note: freeze one closed factual action table and one authority-consumption port; do not add a host issuer or mutation command.
- failure_behavior: A factual mutation lacking typed action, exact intent/record binding, valid authority kind, event identity, or CAS success performs no write. If closure needs a production issuer or CLI mutation, stop and replan to P2B.
- security_considerations: Serialized descriptors never grant authority; no minting factory is exported; the contract does not claim protection from malicious same-user code.
- Test scenarios: Covers evidence, finding, ordinary resolve, approvals, intent revisions, stop, and user-decision resolution; Covers phase/role/revision/hash/diff rejection; Covers identical replay and conflicting reuse; Covers all-acceptance completion; Covers direct storage bypass; Covers CAS/restart; Covers no issuer, privileged CLI, generic patch, import, or terminal creation.

## Plan Closure Verification

- Run every Step Verification against current signatures.
- Run `bun test` and require zero failures.
- Run real `imm-kernel status --json`, `readiness --json`, and migration dry-run; expect live readiness `collecting` until the gate matures.
- Snapshot `.imm/memory/current_iteration.json`, committed migration manifests, `.imm/tasks`, `.imm/workspace.json`, and TaskIntent files before/after P2A CLI smoke.
- Confirm canonical command manifest still marks `imm-kernel` shadow/read-only and exposes no mutation or issuer.
- Confirm every canonical production Ledger writer appears in the receipt inventory.
- Validate this Plan with `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-004-fix-assurance-kernel-p2a-observation-boundary-plan.md --json`.
- Require strict per-Step QA, final `imm-code-review`, Design Conformance, and Compounder before `imm-finish`.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-004-fix-assurance-kernel-p2a-observation-boundary-plan.md --json`
- Focused tests: the four Step Verification commands above
- Repository regression: `bun test`
- Real read-only smoke: `plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-kernel readiness --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json`
- Repository hygiene: `git diff --check`

## Roadmap Continuation

- P2B: Pi-only exact-task enrollment, `ctx.ui.confirm` capability issuance, Kernel application service, TaskRecord/workspace creation, Kernel-aware lifecycle routing, immutable backend pinning, and drain-only rollback.
- P2C: default Kernel enrollment only for newly created tasks on separately qualified hosts.
- P3: v3 new-task retirement, read-only legacy projection, and a value decision before any terminal import.
- Open questions: first Pi cohort, confirmation UX, host-validated QA/review receipt, P2C canary duration, and non-Pi confirmation semantics.
- Promotion criteria: P2A completion is necessary but insufficient; P2B requires a fresh `candidate` report plus literal user approval.
- Explicit non-goals: production TaskRecord creation, privileged CLI/tool, Pi issuer, Kernel Skill routing, default route, OpenCode/RPC privilege, dual write, active-task fallback, terminal import, migration write, scheduler, queue, persisted next action, or additional lifecycle phases.
