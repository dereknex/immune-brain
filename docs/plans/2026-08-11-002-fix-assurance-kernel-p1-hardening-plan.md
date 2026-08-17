# Iteration Plan

## Task

- Summary: Close the Assurance Kernel P1 authority, creation, legacy projection, canonical CLI, and package-fixture findings without enabling production v4 routing.
- Origin: Post-terminal `imm-code-review` of the Assurance Kernel Foundation and finished-shadow repair returned findings F1-F5 with executable reproductions and three change-introduced full-suite failures.
- Spec: `docs/specs/assurance-kernel-v4-p1-hardening.spec.md`
- Research: Direct runtime repros proved generic user-decision resolution, empty terminal creation, incomplete legacy aggregate handling, and wrapper bypass. A HEAD snapshot comparison attributed two wrapper failures and one Roadmap smoke failure to the current change surface. Planner ensemble fast/mid/strong candidates agreed on one bounded repair slice with four independently closeable outcomes; all rejected P2 cutover, tracked-Ledger test repair, and a general terminal import API.
- Decisions: D1 pass privileged authority separately from untrusted TaskAction payload and bind its audit descriptor to fingerprint/history. D2 restrict canonical creation to an empty `working` record and defer all import behavior. D3 project the complete Plan/Step/follow-up aggregate with fail-closed precedence. D4 register shadow-only `imm-kernel` through the canonical TypeScript runtime and command manifest. D5 isolate package progress fixtures for Roadmap-present and Roadmap-absent contracts.
- Assumptions: P1 has no production TaskRecord mutation command, so host authentication can remain deferred while reducer privilege separation is made explicit. The v3 pending follow-up state vocabulary remains `pending|executing|ready_for_review|rework_needed|replanning|closed`. The recorded HEAD baseline continues to distinguish the unrelated compatibility-document failure and missing local `@opencode-ai/plugin` dependency.
- Workflow profile: strict
- Compounder: required
- Scope Mode: New Slice
- Plan boundary: One shadow-foundation hardening slice that closes all five review findings under the same authority, compatibility, review, and rollback boundary.
- Boundary rationale: The findings are different bypasses of the same P1 claim: a conservative, reducer-owned, discoverable, read-only shadow foundation. Splitting them into separate Plans would leave the foundation knowingly contradictory between Steps; P2 authentication and migration writes remain separate future authorities.
- Scope pressure: Four runtime domains and five focused test surfaces; retained as one Plan because no production data migration, host API, or v3 behavior change is allowed.
- Execution scope: Assurance Kernel v4 shadow-only P1 hardening.
- Deferred phases: P2 production routing, host-authenticated user authority issuance, and migration writes.
- Successor candidate: none
- Successor preconditions: none

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, and code identifiers

## Planner Ensemble Synthesis

- Agreement: one Plan with independently reversible authority/storage, legacy, fixture, and CLI outcomes; no tracked Ledger edits; no terminal import API; no P2 cutover.
- Disagreement resolved: authority authenticity cannot originate in a pure reducer. P1 therefore accepts only a separate trusted context, records its descriptor, exposes no issuer or privileged CLI, and treats any need for a host API as a replan trigger.
- Disagreement resolved: the package smoke should not merely use optional chaining. It must independently test both a declared Roadmap and the valid no-Roadmap representation in temporary roots.
- Strong-model blocker converted to verification: event replay must bind the authority descriptor, and ordinary TaskAction fields that claim user identity must remain ineffective.

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 changes only the unpromoted Kernel API and focused tests; rollback restores the previous pure foundation without persisted migration. Do not add a compatibility overload that preserves unsafe creation.
- U2 changes only pure shadow projection/divergence logic; rollback has no source-Ledger cleanup.
- U3 is test-fixture isolation and can revert independently without runtime behavior.
- U4 must roll back wrapper, command registry, dispatch, and manifest expectations as one unit. A partial rollback that restores direct `commands/kernel.ts` execution is forbidden.

### 2. Verification Vanity

- A passing phase assertion is insufficient. U1 must prove negative authority paths, history provenance, and event replay conflicts; U2 must assert phase and divergence across the full aggregate; U4 must prove actual wrapper target plus argv/stdout/stderr/exit behavior.
- Full-suite output must be compared with the recorded HEAD baseline. Known environment/baseline failures are reported separately and cannot be relabeled as repair success.
- Real repository smoke is supplemental only; package tests must succeed from self-contained fixtures.

### 3. Spec Dilution Detection

- Adding `actor`, `role`, or `user_confirmed` inside TaskAction does not satisfy D1.
- Adding an internal `allowTerminal` creation flag or general import helper does not satisfy D2.
- Ignoring all follow-up replan divergence does not satisfy D3; legal equivalence and real conflict need separate fixtures.
- Exempting `imm-kernel` from canonical wrapper tests does not satisfy D4.
- Modifying `.imm/memory/current_iteration.json` or conditionalizing away Roadmap assertions does not satisfy D5.

## Steps

### Step 1

- Step ID: U1
- Result: TaskRecord mutation enforces one canonical reducer authority contract.
- Scope: `plugins/immune-brain/runtime/kernel/types.ts`; `plugins/immune-brain/runtime/kernel/validation.ts`; `plugins/immune-brain/runtime/kernel/reducer.ts`; `plugins/immune-brain/runtime/kernel/storage.ts`; `plugins/immune-brain/runtime/kernel/index.ts`; `tests/kernel-core.test.ts`; `tests/kernel-migrate.test.ts`
- Verification: `bun test tests/kernel-core.test.ts tests/kernel-migrate.test.ts && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first; replace broad creation/update APIs rather than adding a permissive overload.
- Discovery cache: `plugins/immune-brain/runtime/kernel/types.ts` (TaskAction/history schema); `plugins/immune-brain/runtime/kernel/reducer.ts` (event fingerprint and phase transitions); `plugins/immune-brain/runtime/kernel/storage.ts` (creation and reducer-owned commit); `docs/specs/assurance-kernel-v4-p1-hardening.spec.md` (D1-D2 authority baseline)
- failure_behavior: Missing, self-asserted, stale, or mismatched authority fails before history append or storage commit; non-canonical creation performs no TaskRecord/workspace write.
- security_considerations: Authority context is separate from action payload, its descriptor is event-bound, and no production issuer or import path is introduced.
- Test scenarios: Covers generic resolve rejection for `unresolved_user_decision`; Covers privileged resolve/stop context success and missing-context failure; Covers identical replay and authority-descriptor conflict; Covers history audit descriptor; Covers `review|done|stopped` and pre-populated lifecycle creation rejection; Covers canonical `working` creation and existing CAS/transaction recovery.

### Step 2

- Step ID: U2
- Result: Legacy shadow projection conservatively represents the complete v3 execution aggregate.
- Scope: `plugins/immune-brain/runtime/kernel/legacy.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `tests/kernel-core.test.ts`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-migrate.test.ts`
- Verification: `bun test tests/kernel-core.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts && plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: use a table-driven Plan/Step/follow-up truth matrix; do not suppress divergence globally.
- Discovery cache: `plugins/immune-brain/runtime/kernel/legacy.ts` (phase mapping); `plugins/immune-brain/runtime/commands/kernel.ts` (divergence); `plugins/immune-brain/runtime/state_ledger.ts` (pending follow-up vocabulary); `tests/progress-projection-runtime.test.ts` (conservative projection fixture patterns)
- failure_behavior: Missing Plan identity, malformed follow-up, simultaneous current owners, or mismatched replan facts map to explicit stopped/divergent output; source Ledger bytes remain unchanged.
- security_considerations: Treat every legacy object and path string as untrusted data; projection never opens a TaskRecord import path.
- Test scenarios: Covers all-closed without Plan identity; Covers `pending|executing|ready_for_review|rework_needed|replanning|closed` follow-ups; Covers legal follow-up replan equivalence; Covers Step/follow-up ownership conflicts; Covers valid and malformed finished evidence; Covers recursive read-only snapshots.

### Step 3

- Step ID: U3
- Result: Package progress verification is independent of repository workflow state.
- Scope: `tests/plugin-package-runtime.test.ts`
- Verification: `bun test tests/plugin-package-runtime.test.ts tests/progress-projection-runtime.test.ts && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: build self-contained temporary Plan/Ledger/Roadmap fixtures; do not mutate or branch on the repository Ledger.
- Discovery cache: `tests/plugin-package-runtime.test.ts` (`withIsolatedRoot` package harness); `tests/progress-projection-runtime.test.ts` (Roadmap-present/absent fixtures); `plugins/immune-brain/runtime/progress_projection.ts` (optional Roadmap contract)
- failure_behavior: A missing optional Roadmap returns the formal null/unavailable representation without throwing; a declared valid Roadmap remains available; both paths leave fixture files byte-identical.
- security_considerations: Temporary fixture paths stay inside the test root and continue exercising canonical path/symlink validation.
- Test scenarios: Covers Roadmap-present package wrapper projection; Covers valid no-Roadmap terminal projection; Covers repository Ledger independence; Covers before/after file snapshots.

### Step 4

- Step ID: U4
- Result: `imm-kernel` is discoverable exclusively through the canonical TypeScript CLI runtime.
- Scope: `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/commands/kernel.ts`; `plugins/immune-brain/bin/imm-kernel`; `tests/python-reference-boundary.test.ts`; `tests/host-runtime-cutover.test.ts`; `tests/plugin-package-runtime.test.ts`
- Verification: `bun test tests/kernel-core.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts tests/python-reference-boundary.test.ts tests/host-runtime-cutover.test.ts tests/plugin-package-runtime.test.ts tests/progress-projection-runtime.test.ts && plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-11-002-fix-assurance-kernel-p1-hardening-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: 3
- Execution note: register a read-only shadow command in the existing registry/manifest/dispatch; remove the direct command-module entrypoint from the production wrapper path.
- Discovery cache: `plugins/immune-brain/runtime/immune_brain_runtime.ts` (`IMM_COMMANDS`, `COMMAND_MANIFEST`, `projectAccess`, `runImmCommand`); `plugins/immune-brain/bin/imm-kernel` (wrapper); `docs/solutions/contracts.md#pattern-cli-only-runtime-contracts-with-command-manifest-discovery` (canonical CLI pattern); `tests/python-reference-boundary.test.ts` and `tests/host-runtime-cutover.test.ts` (wrapper boundaries)
- failure_behavior: Unknown subcommands and command failures preserve the current return code/stdout/stderr contract; registration never enables TaskRecord or v3 workflow mutation.
- security_considerations: `status` and dry-run remain read-only; `journal` cannot bypass State Ledger workflow authority; wrapper resolution stays plugin-local and canonical.
- Test scenarios: Covers wrapper target and no direct `commands/kernel.ts` startup; Covers manifest discovery and shadow-only description; Covers status/journal/migrate argv plus output/exit parity; Covers project-access classification; Covers all F1-F5 focused suites; Covers full-suite baseline-delta audit with unrelated baseline/environment failures reported separately.

## Plan Closure Verification

- Run the U4 verification command against the current file signatures.
- Run the repository-wide `bun test` diagnostically and compare failures to the recorded HEAD snapshot; no change-introduced failure is allowed.
- Confirm real `imm-kernel status --json` and migration dry-run do not change `.imm/memory/current_iteration.json`, `.imm/tasks`, or `.imm/workspace.json`.
- Require strict per-Step QA, final `imm-code-review`, Design Conformance against the hardening Spec, and Compounder before `imm-finish`.

## Explicit Non-Goals

- P2 production routing or user-authority authentication.
- TaskRecord import/migration writes.
- Compatibility-document cleanup or dependency installation.
- Any edit to tracked Ledger content solely to satisfy tests.
