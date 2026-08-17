---
title: "Rejected: Perpetual Runtime Compatibility for Persisted Workflow State"
rejected: true
reason: "Long-lived compatibility branches make every core read and mutation path interpret historical state; supported legacy projects must migrate once before entering a single current-schema runtime."
reusability: high
next_reuse_scenarios:
  - "A persisted workflow or local database introduces a new schema version"
  - "Historical CLI or evidence formats remain accepted by normal business logic"
  - "A migration must preserve user files across crashes and concurrent writers"
key_files:
  - plugins/immune-brain/runtime/project_migration.ts
  - plugins/immune-brain/runtime/state_ledger.ts
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/runtime/plan_core.ts
  - tests/state-ledger-migration.test.ts
  - tests/project-migration-cli.test.ts
  - docs/specs/legacy-project-migration.spec.md
---

# Rejected: Perpetual Runtime Compatibility for Persisted Workflow State

## Rejected decision

Do not keep old State Ledger schemas, free-text execution evidence, retired CLI flags, or legacy Plan path rewriting as permanent branches in the normal runtime. This approach makes every current operation depend on historical representations, obscures which format is authoritative, and expands the concurrency and validation surface indefinitely.

## Adopted replacement

Use a project migration gateway in front of a strict current runtime:

1. Classify persisted state as `current`, `migration_required`, `invalid`, or `future` without normalizing it through current business code.
2. Keep historical parsing and conversion inside one migration module.
3. Back up every changed file, publish a prepared journal, replace atomically, verify the resulting current state, and either commit or roll back.
4. Let read-only commands report `migration_required` without writing; let stateful commands migrate before their first business mutation.
5. Make current runtime loaders accept exactly one schema and one structured evidence representation. Legacy fields may be named only to reject them with an explicit migration instruction.
6. Capture the migrated Ledger revision before releasing control to the business handler. Reject the original command if another writer changes the Ledger before that handler loads its target; use the ordinary CAS boundary for later read-to-commit races.

## Evidence

- `tests/state-ledger-migration.test.ts` covers missing-version/v2 conversion, structured evidence conversion, active Plan Spec path migration, content-addressed backup identity, manifest tamper resistance, symlink rejection, interruption recovery, rollback, mode preservation, manual-change protection, invalid/future rejection, and idempotence.
- `tests/project-migration-cli.test.ts` covers read-only diagnostics, explicit migration, stateful auto-migration, help independence, future-schema failure, and the migration-to-business-command concurrency window.
- The explicit root test inventory passed 394 tests across 47 files; plugin-local packaging and manifest tests passed 28 tests across 6 files.
- Independent security/data-integrity review and correctness/reliability review approved the implementation after the revision guard closed the only high-priority finding.

## Reusability critique notes

- **Falsifiability**: This pattern is unnecessary when persisted state is disposable, all readers and writers upgrade atomically under a database-managed transaction, or old versions must remain concurrently readable for a documented product requirement.
- **Evidence trail audit**: The claim is supported by migration fault-injection tests, strict-runtime negative tests, CLI/OpenCode parity tests, a deterministic concurrent-target replacement test, and two independent review lenses. It does not claim arbitrary schema migrations can be inferred safely.
- **Architecture entropy resistance**: One migration gateway replaces distributed compatibility branches. It does not introduce a generic migration framework, plugin registry, background migrator, or second state authority.

## Architecture map decision

Update `CONTEXT.md` because `project_migration.ts` and `imm-migrate` are now durable runtime navigation entrypoints, not implementation details.

---

*Captured: 2026-07-30 | Source: legacy project migration Plan U1-U3, independent QA, and exact-signature code review*
