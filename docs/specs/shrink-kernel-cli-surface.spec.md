# Shrink Kernel CLI Surface

**Status**: Completed
**Task**: `2026-08-15-019-shrink-kernel-cli-surface`
**Roadmap**: `docs/specs/host-native-lightweight-workflow-roadmap.spec.md`, Phase 5 R4
**Output Language**: English prose; preserve CLI commands, paths, schema keys, contract names, and code identifiers literally.
**Design risk**: Material - removes retired CLI branches from a shipped command module and changes `status`/`audit` journal behavior across runtime and contract tests; no public schema, persistence, or authority change.
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded deletion plus a journal-skip guard; the affected surface and its consumers are enumerated in the Scope and Tests sections without flow relationships that a diagram would clarify.

## 1. Problem

`plugins/immune-brain/runtime/commands/kernel.ts` still implements three
retired CLI branches — `migrate --dry-run`, `readiness --json`, and
`journal --json` — plus their `runMigration`/`runReadiness`/`runJournal`
handlers and the migration-report helpers they depend on. The shipped v4
router (`v4_runtime.ts`) already rejects these subcommands with
`invalid_kernel_command` before dispatch, so the branches are unreachable
from every shipped entrypoint. They remain reachable only through the legacy
`immune_brain_runtime.ts` dispatcher (scheduled for removal in a later slice)
and through direct module imports in tests.

Separately, `imm-kernel status --json` and `imm-kernel audit --legacy` still
append friction-journal entries through `runKernelCommand`, even though both
are read-only projections. A read-only command must not write workflow
state; journal appends are a state write that a strict read-only command
cannot perform.

## 2. Goal

- Remove the `migrate`, `readiness`, and `journal` CLI branches and their
  handlers from `commands/kernel.ts`, so no invocation of `runKernelCommand`
  can reach them.
- Keep `buildMigrationDryRunReport` and `migrationDryRunDigest` as exported
  pure functions: `tests/pi-canary-enroll-extension.test.ts` builds
  readiness-evidence fixtures from them, and enrollment preparation must
  keep its independence from v3 migration reports (already asserted by
  `tests/v4-storage-retirement-enrollment.test.ts`).
- Make `status` and `audit` strictly read-only: they no longer append
  friction-journal entries.
- Keep the shipped v4 router behavior unchanged (`invalid_kernel_command`
  for retired subcommands) and keep the legacy dispatcher byte-identical.

## 3. Scope

### 3.1 In scope

- `plugins/immune-brain/runtime/commands/kernel.ts`:
  - delete `runMigration`, `runReadiness`, `runJournal` and their
    `executeKernelCommand` branches (`migrate`, `readiness`, `journal`);
  - delete imports used only by those branches
    (`readAuthorityCommitReceipts`, `readAutomaticObservationsV2`,
    `loadReadinessEvidence`, `projectReadiness`);
  - keep `buildMigrationDryRunReport` and `migrationDryRunDigest` exported;
  - extend the no-journal guard in `runKernelCommand` from `intent` to
    `intent`, `status`, `audit`, `migrate`, `readiness`, `journal` — retired
    subcommands fall through to the `invalid_command` rejection branch, which
    must also append no journal entry (zero writes on retired paths);
  - update `--help` and usage strings to list only
    `status --json | audit --legacy | intent author <path> --stdin --json | intent validate <path> --json`.
- Tests:
  - `tests/kernel-migrate.test.ts`: the `imm-kernel migration dry-run`
    describe block asserts retired rejection
    (`error.code === "invalid_command"`), preserving the
    `worktree-local kernel storage` describe block unchanged.
  - `tests/kernel-shadow-cli.test.ts`: replace `readiness`/`journal` CLI
    expectations with retired-rejection assertions; read the friction
    journal directly via `readFileSync(".imm/journal.jsonl")` where entry
    read-back is needed; replace the journal-failure-on-status test with a
    strict no-journal-write assertion.
  - `tests/kernel-r2a-boundary.test.ts`: change direct
    `runKernelCommand(["readiness", "--json"])` expectations to retired
    rejection; keep the legacy dispatcher manifest assertions (the legacy
    manifest is owned by `immune_brain_runtime.ts`, unchanged here).
  - New focused assertions in the affected files prove `status` and
    `audit` perform zero journal writes and retired subcommands are
    rejected through both `runKernelCommand` and the shipped `v4_runtime`
    path.
- Docs: `CONTEXT.md` Assurance Kernel bullet updated to state the kernel
  CLI surface (intent/status/audit) and strict read-only behavior.

### 3.2 Out of scope

- `plugins/immune-brain/runtime/immune_brain_runtime.ts` bytes (legacy
  dispatcher removal is a later slice).
- `plugins/immune-brain/runtime/kernel/*` deep modules (`readiness.ts`,
  `readiness_evidence.ts`, `automatic_observations.ts`,
  `authority_commit_receipts.ts`) — they remain for library consumers and
  are not removed here.
- `migrate`/`readiness`/`journal` behavior in the legacy dispatcher
  manifest (`list-commands`): the manifest is owned by
  `immune_brain_runtime.ts`, which stays byte-identical.
- State Ledger migration, Kernel authority, or enrollment semantics.

## 4. Retired rejection contract

Any `runKernelCommand` invocation with first arg `migrate`, `readiness`, or
`journal` returns:

```json
{
  "error": { "code": "invalid_command", "message": "..." }
}
```

with `returncode: 2`, and appends no journal entry: the no-journal guard in
`runKernelCommand` covers `intent`, `status`, `audit`, `migrate`,
`readiness`, and `journal`, so both the retained read-only commands and the
retired-rejection fallback write zero friction-journal entries. The shipped
`v4_runtime.ts` path continues to return the same `invalid_kernel_command`
shape it returns today (unchanged).

## 5. Tests

- `bun test tests/kernel-migrate.test.ts tests/kernel-shadow-cli.test.ts tests/kernel-r2a-boundary.test.ts`
  — retired rejection and strict read-only behavior.
- `bun test tests/pi-canary-enroll-extension.test.ts` — enrollment
  fixtures still build from the kept pure functions.
- `bun test` — full regression.

## 6. Verification descriptors (TaskIntent)

1. Retired subcommands rejected: `runKernelCommand(["migrate"|"readiness"|"journal", ...])` returns `invalid_command`/`invalid_kernel_command` with no journal write.
2. `status`/`audit` strict read-only: zero journal appends, zero `.imm` writes, byte-identical Ledger.
3. Kept pure helpers: `buildMigrationDryRunReport`/`migrationDryRunDigest` remain exported and enrollment fixture tests pass.
4. Legacy dispatcher bytes unchanged; shipped v4 router behavior unchanged.
5. Help/usage lists only the retained surface.
6. Full repository suite passes.
