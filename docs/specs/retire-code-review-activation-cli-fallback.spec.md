# Retire Code-Review Activation CLI Fallback

**Task ID**: `2026-08-15-017-retire-code-review-activation-cli-fallback`  
**Status**: Completed on 2026-08-15 (Kernel QA and Review passed)  
**Risk**: material

## Problem

v4 storage retirement already rejects `imm-activation-plan`:

- `plugins/immune-brain/bin/imm-activation-plan` routes through `v4_runtime.ts`
  and exits 2 with `Unknown Immune-Brain v4 command`;
- `v4_runtime.ts` does not list the command and does not place it on the
  retired-mutation wall;
- the Pi package still omits `runtime/immune_brain_runtime.ts`.

Shipped review contracts still instruct agents to call that missing planner:

- `plugins/immune-brain/skills/imm-code-review/SKILL.md`
- `plugins/immune-brain/dist/imm-code-review.md`
- `plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md`

`tests/code-review-activation-contract.test.ts` currently locks the broken
fallback order in place. Shared review-host dispatch already owns eligibility
and authorization; the leftover CLI ladder is a deterministic runtime failure,
not a compatibility path.

## Goal

Remove the retired `imm-activation-plan` CLI fallback from shipped
`imm-code-review` contracts while preserving catalog-driven lens selection,
shared dispatch/authorization, same-boundary `follow_up`, public Skill aliases,
and the separately bounded legacy dispatcher.

## Requirements

### R1. Code-review contracts stop advertising the retired CLI

Source and packaged `imm-code-review` contracts must:

- keep catalog-driven lenses `security`, `api_contract`, `data_integrity`, and
  `reliability`;
- keep shared `review-host-dispatch-protocol` / `subagent-dispatch-protocol`
  ownership of environment, authorization, and packet construction;
- keep same-boundary `follow_up` to `imm-work`;
- remove every `imm-activation-plan`, `immune_brain_runtime.ts`, and
  `activation_runtime_unavailable` CLI-ladder instruction.

### R2. Packaged activation spec matches the shipped runtime

`plugins/immune-brain/dist/docs/specs/automatic-subagent-activation.spec.md`
must stop naming the omitted dispatcher as the packaged planner entrypoint.
Catalog, policy, and dispatch-protocol references may remain. This packaged
spec is a manual adapted copy; do not invent a generator replacement in this
slice.

### R3. Focused contracts prove the retirement

Focused tests must prove:

- source and packaged `imm-code-review` contracts contain no retired CLI
  ladder;
- the packaged activation spec contains no `immune_brain_runtime.ts` or
  `imm-activation-plan` entrypoint;
- `tests/code-review-activation-contract.test.ts` no longer requires the
  retired fallback order;
- `bin/imm-activation-plan` still fails closed through v4.

### R4. Later deletion boundary remains intact

This slice must not modify or delete:

- `runtime/immune_brain_runtime.ts` or `runtime/commands/*`;
- public Skill aliases (`imm-page-design`, `imm-preplan-review`, `imm-party`,
  `debug-investigator`);
- `bin/imm-activation-plan` itself, except through existing v4 unknown-command
  behavior;
- Review confirmation / pending-verdict authority.

### R5. Existing package and repository behavior remains green

Pi source discovery, packed loader, package surface, host runtime, Skill
registry, packaging sync, and the full repository suite must pass.

## Non-Goals

- Deleting the legacy dispatcher or command modules.
- Deleting public Skill aliases.
- Restoring `imm-activation-plan` as a v4 command.
- Rewriting historical plans, Specs, solutions, HANDOFF, or user-manual
  history.
- Implementing automatic Review authority.

## Verification

1. `bun test tests/code-review-activation-contract.test.ts tests/pi-packaged-legacy-fallbacks.test.ts tests/activation-plan-runtime-surface.test.ts`
2. `bun test tests/dist-docs-sync-contract.test.ts tests/v4-runtime-launchers.test.ts`
3. `bun test tests/pi-canary-discovery-regression.test.ts tests/pi-canary-packed-loader.test.ts tests/pi-only-package-surface.test.ts tests/host-runtime-cutover.test.ts`
4. `bun test plugins/immune-brain/tests/skill-registry-consistency.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts`
5. `git diff --exit-code -- plugins/immune-brain/runtime/immune_brain_runtime.ts plugins/immune-brain/runtime/commands plugins/immune-brain/runtime/v4_runtime.ts`
6. `bun test`
