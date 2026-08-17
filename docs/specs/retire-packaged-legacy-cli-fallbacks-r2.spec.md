# Retire Packaged Legacy CLI Fallbacks (Revision 2)

**Task ID**: `2026-08-15-016-retire-packaged-legacy-cli-fallbacks`  
**Status**: Completed on 2026-08-15 (Kernel QA and Review passed)  
**Risk**: material  
**Predecessor**: `2026-08-15-015-retire-packaged-legacy-cli-fallbacks`

## Problem

Task 015 implemented the correct shipped-contract edits, but its enrolled
`acc-activation-reference` assertion required source and packaged
`automatic-subagent-activation-policy.md` copies to be byte-identical. That
conflicts with the existing adapted `dist/docs` generator, which rewrites only
the Split Gate path for the packaged copy. Changing the assertion is a breaking
Intent revision; the current TUI authorize path cannot supply the next-intent
payload. The successor restates the same deletion goal with the packaging
contract that already exists.

## Goal

Remove the broken legacy CLI fallbacks from shipped agent contracts while
preserving current read-only Plan validation, Kernel TaskIntent handoff,
post-closure Compounder behavior, static catalog-reference integrity, the
adapted packaged activation-policy generator, and the separately bounded
repository legacy dispatcher closure.

## Requirements

### R1. Planner contract is v4/Kernel-only

`plugins/immune-brain/dist/imm-planner.md` must:

- keep read-only `imm-plan <plan-path> --json` validation;
- remove every `imm-plan --sync`, `imm_plan_validate(sync=true)`, and direct
  `runtime/immune_brain_runtime.ts` instruction;
- hand managed execution to Git-tracked TaskIntent author/validate plus Pi TUI
  enrollment, consistent with the source `imm-planner` Skill.

### R2. Compounder does not mutate workflow closure

`plugins/immune-brain/dist/imm-compounder.md` must:

- state that workflow closure and assurance are complete before Compounder;
- remove `imm-finish`, direct legacy runtime, and `imm-heal` instructions;
- keep learning capture, memory maintenance, and evidence critique behavior.

### R3. Activation references use static integrity validation

Both source and packaged copies of
`automatic-subagent-activation-policy.md` must remove the retired
`imm-activation-plan` wrapper/direct-runtime validation instruction and state
that catalog `policy_ref`/`spec_ref` integrity is enforced by build/package
contract tests. The packaged copy remains the generated adapted form of the
source; Split Gate path wording may differ. Do not force byte-identity that
conflicts with `scripts/dist-sync-manifest.ts`.

### R4. Packed bytes do not advertise absent commands

A focused test must run real `npm pack`, extract the tarball, and verify the
shipped planner, compounder, and activation reference contain no legacy runtime
path or retired command guidance. It must also prove the intended v4/Kernel and
static-integrity wording is present.

### R5. Later deletion boundary remains intact

This slice must not modify or delete:

- `runtime/immune_brain_runtime.ts`;
- `runtime/commands/*`, `imm_core.ts`, or legacy runtime modules;
- source Skill entry files;
- v3 retirement/runtime behavior tests.

The focused contract may update Task 014's preservation assertion from
"packaged fallback still references legacy" to "legacy dispatcher still exists
but packaged fallback no longer references it."

### R6. Existing package and repository behavior remains green

Pi source discovery, packed loader, package surface, host runtime, Skill
registry, packaging sync, and the full repository suite must pass.

## Non-Goals

- Deleting the legacy dispatcher or command modules.
- Deleting public Skill aliases.
- Rewriting historical plans, Specs, solutions, HANDOFF, benchmark fixtures, or
  `.imm` state.
- Reintroducing v3 mutation through v4.
- Implementing automatic Review authority.
- Completing the unfinished TUI breaking-revision payload path.

## Verification

1. `bun test tests/pi-packaged-legacy-fallbacks.test.ts`
2. `bun test tests/v4-runtime-launchers.test.ts tests/dist-docs-sync-contract.test.ts`
3. `bun test tests/pi-canary-discovery-regression.test.ts tests/pi-canary-packed-loader.test.ts tests/pi-only-package-surface.test.ts tests/host-runtime-cutover.test.ts`
4. `bun test plugins/immune-brain/tests/skill-registry-consistency.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts`
5. `git diff --exit-code -- plugins/immune-brain/runtime plugins/immune-brain/skills`
6. `bun test`
