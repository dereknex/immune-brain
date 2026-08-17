# Iteration Plan

## Task

- Summary: Replace Immune-Brain runtime compatibility branches with detection and one-time migration of legacy projects to the current format.
- Spec: `docs/specs/legacy-project-migration.spec.md`
- Origin: The user explicitly rejected compatibility preservation and required legacy projects to be discovered and migrated to the latest version.
- Research: Current State Ledger schema is v3. `normalizeCurrentIteration` currently defaults missing versions to v2, `validateTransitionState` accepts v2/v3, `normalizeExecutionEvidence` synthesizes structured evidence from legacy free text, `normalizeSpecReference` silently maps old Spec paths, and `LedgerStateMachine` remains only as a compatibility wrapper. Existing lock, atomic-write, revision, and focused runtime tests provide the primitives for a migration gateway.
- Decisions: D1. Read-only commands detect and report without writing. D2. Stateful commands migrate before their first mutation. D3. Add explicit `imm-migrate` and `--check`. D4. Back up every changed project file and roll back failed replacement. D5. After migration, normal runtime accepts only schema v3 and structured evidence. D6. Unknown future versions fail closed. D7. Remove compatibility-only APIs and flags rather than retaining aliases.
- Assumptions: Existing v2 projects follow the validated v2 shape; the current v3 ledger and `structured-v1` evidence are the only latest formats; Bun and the existing atomic State Ledger write path are available.
- Scope Mode: New Slice
- Plan boundary: Legacy State Ledger, active Plan Spec reference, execution evidence, CLI migration entry, and compatibility removal inside `plugins/immune-brain`.
- Boundary rationale: Detection, migration, strict loading, and compatibility deletion form one independently verifiable runtime invariant: historical formats are handled only by the migration gateway.
- Scope pressure: One new runtime migration module, focused edits to three runtime modules, one CLI wrapper, OpenCode command exposure, generated documentation, and focused tests.

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, JSON keys, Skill names, `Plan`, `Step`, `Spec`, `Verification`, and `State Ledger`.

## Plan Boundary

This Plan owns migration of active Immune-Brain runtime inputs to the latest
format and removal of the compatibility paths that migration replaces. It does
not redesign workflow states, review gates, transition approval, advisory
activation, benchmark schemas, or historical documentation.

## Devil's Advocate Audit

1. **Rollback Resilience**: Migration must persist backups before replacement and restore all changed files after injected failures. A failed migration cannot leave a partially current project.
2. **Verification Vanity**: Unit conversion tests alone are insufficient. CLI tests must prove read-only commands do not write, write commands migrate first, repeated migration is byte-stable, and future versions fail closed.
3. **Spec Dilution Detection**: No normal loader, validator, command flag, or compatibility wrapper may continue interpreting legacy formats after this Plan closes. Historical knowledge belongs only in `project_migration.ts` and migration fixtures.

## Planning Quality Gate

- **contract surface**: `plugins/immune-brain/runtime/project_migration.ts`, `state_ledger.ts`, `plan_core.ts`, `immune_brain_runtime.ts`, `plugins/immune-brain/bin/imm-migrate`, OpenCode tool adapters, migration/runtime tests, README, USER_GUIDE, and packaged dist docs.
- **compatibility**: No runtime compatibility is preserved. Existing legacy projects are upgraded through the migration gateway; current v3 projects remain byte-stable.
- **interruption recovery**: Migration backups and a persisted manifest are created before replacement. A retry first restores an incomplete transaction, then reruns inspection and migration.
- **rollback path**: Revert the implementation and restore a test fixture from `.imm/migrations/` backups. Production migration failures restore changed files automatically.
- **verification strength**: Focused migration fault tests, strict evidence tests, CLI/package tests, transition/follow-up/finish regression tests, generated-doc sync, LSP diagnostics, and `git diff --check`.
- **replan condition**: Replan if legacy formats cannot be classified without guessing, if atomic rollback cannot cover every changed runtime input, or if strict v3 loading requires changing workflow semantics.

## Steps

### Step 1

- Step ID: U1
- Result: Supported legacy project inputs become one atomically migrated current-format project through a classified migration transaction.
- Verification: `bun test tests/state-ledger-migration.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-002-refactor-legacy-project-migration-plan.md --json && git diff --check`
- Verification type: automated
- Agent Hint: imm-executor
- Test scenarios: Covers absent state; current v3; v2; valid missing-version v2; legacy evidence in Steps and follow-ups; active Plan legacy Spec reference; missing target Spec; malformed JSON; invalid version; future version; repeated migration no-op; backup creation; injected replacement failure and restoration.
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (schema, evidence, lock and atomic write); plugins/immune-brain/runtime/plan_core.ts (legacy Spec mapping); plugins/immune-brain/runtime/imm_core.ts (heal); tests/runtime-state.test.ts (legacy fixtures); tests/roadmap-plan-transition-state.test.ts (v3 contract); docs/specs/legacy-project-migration.spec.md (migration authority)
- Depends on: none
- failure_behavior: Reject ambiguous legacy state and restore every replaced file on any migration failure. Never stamp an unsupported or partially converted project as current.
- security_considerations: Reject symlinked migration targets, keep backups under project-local `.imm/migrations`, use content hashes for identity, and never execute data read from legacy files.

### Step 2

- Step ID: U2
- Result: Every stateful CLI or host operation reaches strict current-format loading through the migration gateway.
- Verification: `bun test tests/state-ledger-migration.test.ts tests/plugin-package-runtime.test.ts tests/opencode-cli-adapter.test.ts plugins/immune-brain/tests/opencode-runtime.test.ts tests/execution-evidence-runtime.test.ts && git diff --check`
- Verification type: automated
- Agent Hint: imm-executor
- Test scenarios: Covers list/help with no state access; `imm-migrate --check`; explicit migration; status/heal zero-write diagnostics; automatic migration before plan/work/review/autowork/finish writes; JSON output; structured evidence JSON/stdin; rejection of legacy evidence flags.
- Discovery cache: plugins/immune-brain/runtime/immune_brain_runtime.ts (command dispatch and stateful handlers); plugins/immune-brain/.opencode-plugin/runtime.ts (tool argv); plugins/immune-brain/.opencode-plugin/index.ts (tool schema); plugins/immune-brain/bin/imm-work (wrapper pattern); tests/plugin-package-runtime.test.ts (packaged CLI); tests/opencode-cli-adapter.test.ts (adapter contract)
- Depends on: U1
- failure_behavior: If inspection reports invalid/future or migration fails, return a non-zero result before the requested command mutates workflow state.
- security_considerations: Keep migration local to the resolved project root; reject path traversal and symlink targets; do not expose backup contents through command output.

### Step 3

- Step ID: U3
- Result: The migration module becomes the sole interpreter of historical Immune-Brain project formats.
- Verification: `bun test tests/runtime-state.test.ts tests/state-ledger-migration.test.ts tests/execution-evidence-runtime.test.ts tests/roadmap-plan-transition-state.test.ts tests/roadmap-plan-transition-runtime.test.ts tests/imm-follow-up-runtime.test.ts tests/finish-dehydrate-runtime.test.ts tests/plugin-package-runtime.test.ts plugins/immune-brain/tests/ && bun scripts/sync-dist-docs.ts --check && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-002-refactor-legacy-project-migration-plan.md --json && git diff --check`
- Verification type: automated plus diagnostics
- Agent Hint: imm-executor
- Test scenarios: Covers absence of `LedgerStateMachine`; strict schema v3; strict `structured-v1`; future-version failure; current transition/follow-up/review/finish behavior; generated command and Skill documentation alignment.
- Discovery cache: plugins/immune-brain/runtime/state_ledger.ts (compatibility branches); plugins/immune-brain/runtime/plan_core.ts (legacy Spec mapping); plugins/immune-brain/runtime/imm_core.ts (barrel comment/exports); plugins/immune-brain/dist/imm-executor.md and test-fixer.md (legacy evidence prose); README.md and USER_GUIDE.md (CLI documentation); scripts/sync-dist-docs.ts (packaged docs)
- Depends on: U2
- failure_behavior: If a normal-runtime compatibility path remains or regression tests require legacy acceptance, stop and move that interpretation into the migration module rather than restoring compatibility.
- security_considerations: Strict loaders fail closed on malformed, older, or future formats and do not infer trusted workflow state from free text.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-002-refactor-legacy-project-migration-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-30-002-refactor-legacy-project-migration-plan.md --sync`
