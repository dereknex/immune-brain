# Retire Repository Legacy Runtime Launchers

**Task ID**: `2026-08-15-014-retire-repo-legacy-runtime-launchers`
**Status**: Completed on 2026-08-15 (Kernel QA and Review passed)
**Risk**: Material

## Goal

Remove repository-owned commands and current documentation that still launch or
name `runtime/immune_brain_runtime.ts` as the active runtime. Repository
operations must use the v4-only CLI runtime before the legacy dispatcher itself
can be considered unreachable.

## Proven Caller Boundary

The explicit Pi package manifest and every `plugins/immune-brain/bin/imm-*`
wrapper already load `runtime/v4_runtime.ts`. The remaining executable callers
of the legacy dispatcher are repository tasks in `mise.toml`:

- `heal` invokes a command that the shipped v4 runtime already rejects as
  retired;
- `list-runtime-tools` invokes the legacy command manifest;
- `check-plugin` validates package metadata and then invokes that same legacy
  manifest.

README and the current architecture map also name the legacy dispatcher as the
active runtime. Packaged Skill fallback text is a separate public contract and
is excluded from this slice.

## Required Changes

1. Remove the obsolete `heal` mise task instead of preserving a command that is
   retired by the shipped runtime.
2. Route `list-runtime-tools` and `check-plugin` through
   `plugins/immune-brain/runtime/v4_runtime.ts`.
3. Update current README and CONTEXT architecture text to identify
   `v4_runtime.ts` as the shipped CLI router and the Pi extension/Kernel as the
   authority path.
4. Add a focused launcher contract that proves the old runtime path is absent
   from repository tasks/current docs while the legacy dispatcher file itself
   remains present for the next deletion boundary.

## Preserved Boundaries

- Do not delete or modify `runtime/immune_brain_runtime.ts`, `runtime/imm_core.ts`,
  or the legacy command modules in this slice.
- Do not modify packaged Skill fallback contracts in `skills/` or `dist/`.
- Do not modify the three Pi canary factories, Kernel reducers/storage,
  `imm-work status`, or `imm-kernel audit --legacy`.
- Do not add a compatibility launcher, alias, or forwarding wrapper.

## Acceptance Criteria

1. `mise.toml` contains no `immune_brain_runtime.ts` launcher and contains no
   `heal` task; `list-runtime-tools` and `check-plugin` use `v4_runtime.ts`.
2. Real `mise run list-runtime-tools` and `mise run check-plugin` executions
   succeed and expose only the v4 command surface.
3. README and the current CONTEXT architecture map identify `v4_runtime.ts` as
   the active CLI runtime and do not identify the legacy dispatcher as active.
4. The legacy dispatcher and its modules remain present and unmodified for the
   next independently enrolled deletion boundary.
5. Source and packed Pi discovery still find exactly the three retained canary
   factories, and package-surface/host-runtime tests pass.
6. The full repository test suite passes.

## Verification

```bash
bun test tests/v4-runtime-launchers.test.ts
mise run list-runtime-tools
mise run check-plugin
bun test tests/pi-canary-discovery-regression.test.ts tests/pi-canary-packed-loader.test.ts tests/pi-only-package-surface.test.ts tests/host-runtime-cutover.test.ts
bun test tests/v4-storage-retirement-v3-writers.test.ts tests/wrapper-retirement.test.ts
bun test
```

## Exit Plan

This slice is permanent cleanup and introduces no compatibility layer. Its
completion removes repository-owned launcher authority from the legacy
dispatcher. A successor slice may remove packaged Skill fallback references and
then delete the dispatcher closure only after proving those public contracts no
longer advertise it.
