# Retire Legacy Progress Projection

**Task ID**: `2026-08-15-013-retire-legacy-progress-projection`
**Status**: Completed on 2026-08-15 (Kernel QA and Review passed)
**Roadmap phase**: R4 legacy deletion, slice 2

## Goal

Remove the legacy v3 `imm-work progress` command and its
`progress_projection/v1` implementation now that Task 012 removed the only Pi
progress UI consumer. Preserve the distinct `imm-work status` read projection,
explicit read-only `imm-kernel audit --legacy`, all Kernel lifecycle paths, and
all retired-command fail-closed walls.

## Proven Caller Boundary

The source audit establishes:

1. The Pi extension manifest loads only `imm-canary-enroll.ts`,
   `imm-canary-new.ts`, and `imm-canary-work.ts`.
2. The root package does not ship `immune_brain_runtime.ts`,
   `progress_projection.ts`, `imm_core.ts`, or `commands/work.ts`.
3. `buildProgressProjection` is called only by the legacy
   `immune_brain_runtime.ts` implementation of `imm-work progress`.
4. `progress_projection.ts` is otherwise referenced only by the `imm_core.ts`
   compatibility export, its dedicated test, historical solution documents,
   and one v3 retirement test asserting that the read path remained available.
5. Task 012 deleted the only host presentation consumer:
   `.pi-extension/{index,progress_client,progress_views}.ts`.
6. `imm-work status` uses the separate `buildWorkStatusProjection`; read-only
   legacy audit uses `runtime/kernel/legacy_audit.ts` and is independent of
   `progress_projection.ts`.

## Scope

- Delete `plugins/immune-brain/runtime/progress_projection.ts`.
- Remove the `progress_projection` export from
  `plugins/immune-brain/runtime/imm_core.ts`.
- Remove `progress` from the legacy `imm-work` manifest, examples, usage,
  access classification, dependency injection, and command handler.
- Make `imm-work progress` fail closed as an unknown/retired subcommand with
  zero State Ledger writes.
- Delete `tests/progress-projection-runtime.test.ts`.
- Replace the old v3-retirement assertion that progress remains readable with
  an assertion that it is unavailable while `imm-work status` and
  `imm-kernel audit --legacy` remain readable.
- Update focused source/package boundary tests for the retired path.

## Out Of Scope

- Deleting `immune_brain_runtime.ts`, `imm_core.ts`, `state_ledger.ts`,
  `plan_core.ts`, `commands/work.ts`, or the remaining v3 command handlers.
- Deleting or changing `imm-work status`.
- Deleting or changing `imm-kernel audit --legacy` or
  `runtime/kernel/legacy_audit.ts`.
- Deleting historical solution documents that cite
  `progress_projection/v1` as historical evidence.
- Removing public skill aliases or literal-user Review confirmation.
- Adding a compatibility alias, replacement projection, migration, or adapter.

## Invariants

1. `imm-work progress` cannot read or mutate State Ledger state after
   retirement.
2. `imm-work status --json` remains readable for a legacy v3 Ledger under the
   current routing policy.
3. `imm-kernel audit --legacy` remains bounded, read-only, redacted, and
   available.
4. Pi canary extension discovery and packed artifact loading remain unchanged.
5. No Kernel reducer, storage, authority, QA, Review, or completion module is
   modified.
6. Historical docs remain history and are not rewritten to erase old facts.

## Acceptance

1. **Projection implementation absent**
   - `progress_projection.ts` and `tests/progress-projection-runtime.test.ts`
     are absent.
   - `imm_core.ts` no longer exports `progress_projection`.
2. **Command retired fail closed**
   - The command manifest, examples, access classifier, usage, handler, and
     runtime context contain no `progress` subcommand or
     `buildWorkProgressProjection` dependency.
   - `imm-work progress --json` returns non-zero and leaves the project tree
     byte-identical.
3. **Status retained**
   - `imm-work status --json` remains successful and deterministic for the
     retained legacy read boundary.
4. **Legacy audit retained**
   - `tests/v4-storage-retirement-legacy-audit.test.ts` passes unchanged.
5. **Host/package boundaries retained**
   - Pi source discovery, packed loader, package-surface, and host-runtime
     focused suites pass.
6. **Full regression**
   - `bun test` passes with zero failures.

## Verification

```text
bun test tests/legacy-v3-projection.test.ts tests/v4-storage-retirement-legacy-audit.test.ts
bun test tests/pi-canary-discovery-regression.test.ts tests/pi-canary-packed-loader.test.ts tests/pi-only-package-surface.test.ts tests/host-runtime-cutover.test.ts
bun test
```

## Exit Plan

This task contains no transitional mechanism. Completion permanently removes
one obsolete command and projection. The remaining v3 dispatcher/runtime
closure is a later R4 task after its own caller and documentation audit.
