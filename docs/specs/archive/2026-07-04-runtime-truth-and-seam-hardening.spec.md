---
title: "refactor: runtime truth and seam hardening"
type: refactor
status: planned
date: 2026-07-04
origin:
  - imm-arch-explorer candidate selection A,B,C,D
  - local readonly architecture evidence from CONTEXT.md, README.md, docs/specs, docs/solutions, plugin runtime, and tests
---

# Runtime Truth and Seam Hardening Spec

## 1. Goal

Bring the current Immune-Brain runtime architecture back to one checked truth and reduce the two highest-cost runtime seams without creating a new platform layer.

The selected scope covers four architecture opportunities:

1. Align active runtime truth after the Bun + TypeScript CLI-only cutover.
2. Add a focused stale-reference guard for active docs and packaged runtime docs.
3. Split `plugins/immune-brain/runtime/imm_core.ts` along real Plan and State Ledger seams while preserving compatibility.
4. Reduce OpenCode adapter drift against the CLI command contract.

## 2. Current Technical Evidence

### Runtime truth drift

`README.md` documents the current production route: host adapters and `plugins/immune-brain/bin/imm-*` wrappers call `plugins/immune-brain/runtime/immune_brain_runtime.ts`, and the runtime no longer falls back to Python `.imm` modules. The Python retirement inventory also records `.imm/imm_core/`, packaged Python runtime files, and Python tests as retired.

Active architecture docs still contain stale current-tense references: `CONTEXT.md` names `.imm/imm_core/` and `.imm/imm-plan.py` as active workflow runtime surfaces, and the packaged automatic activation spec names `dist/.imm/imm_core/activation_plan.py` as the activation planner.

### Stale reference detection gap

`scripts/detect-stale-refs.ts` currently catches stale `skills/*/SKILL.md`, `docs/specs|docs/plans`, and legacy `.imm/specs` links. It does not catch retired runtime paths such as `.imm/imm_core`, `immune_brain_runtime.py`, `.mcp.json`, or `list-tools` when those paths are presented as current architecture. Running it over all docs reports many historical plan findings, so the executable slice should protect active docs first instead of attempting a broad historical cleanup.

### `imm_core.ts` seam cost

`plugins/immune-brain/runtime/imm_core.ts` is the central runtime module for Plan parsing and validation, State Ledger transitions, review gates, heal helpers, wrapper retirement, and activation mode helpers. `plugins/immune-brain/runtime/immune_brain_runtime.ts` imports many unrelated capabilities from this single module, and tests across Plan validation, State Ledger behavior, review orchestration, and plugin runtime import it directly. The split should preserve the `imm_core.ts` export surface as a compatibility barrel while moving the largest real seams into named modules.

### OpenCode command drift

`plugins/immune-brain/runtime/immune_brain_runtime.ts` owns the CLI command manifest and dispatch table. `plugins/immune-brain/.opencode-plugin/runtime.ts` separately maps OpenCode tool names to CLI arguments. Some duplication is necessary because OpenCode tools have host-specific names and arguments, but supported CLI command names and wrapper coverage should not silently diverge.

## 3. Requirements

### R1. Active runtime truth alignment

- Update active architecture docs so the production runtime truth is Bun + TypeScript CLI through `plugins/immune-brain/runtime/immune_brain_runtime.ts` and `plugins/immune-brain/bin/imm-*` wrappers.
- Remove current-tense references to retired Python runtime surfaces from active docs and packaged runtime docs.
- Preserve historical context where useful, but mark it as historical or source-only rather than current architecture.
- Keep `CONTEXT.md` vocabulary aligned with current domain terms: `State Ledger`, `Plan`, `Spec`, `Skill`, `Activation Plan`, and `Domain Mapper`.

### R2. Focused stale-reference guard

- Add or extend a lightweight check that protects active docs and packaged docs from retired runtime-current references.
- Do not require all historical `docs/plans/` findings to be fixed in this slice.
- The guard must report actionable file and line evidence.
- The guard must be runnable from a normal Bun/Node environment without adding dependencies.

### R3. `imm_core.ts` seam split

- Extract Plan parsing/validation and State Ledger transition behavior into named runtime modules or an equivalent small seam.
- Preserve `plugins/immune-brain/runtime/imm_core.ts` as a compatibility barrel unless a separate breaking-change plan retires it.
- Preserve State Ledger schema v2, step state enum values, legal transitions, mutation semantics, and existing runtime JSON shapes.
- Avoid fanout: do not split every helper into a separate file.

### R4. OpenCode command contract hardening

- Keep OpenCode's host-specific tool-to-argument mapping where it adds real value.
- Share or verify the supported CLI command set against the runtime command contract so wrapper, manifest, and OpenCode coverage cannot drift silently.
- Keep `imm-pr-diag` explicitly outside the shared runtime command map unless it is intentionally ported later.
- Preserve installed-plugin and external target repo behavior, including `IMMUNE_BRAIN_PLUGIN_ROOT` resolution.

## 4. Non-goals

- Do not rewrite all historical plans or solutions.
- Do not remove plugin-local shell wrappers.
- Do not reintroduce MCP, Python runtime startup, a daemon, or a scheduler.
- Do not change State Ledger persisted schema or migrate `.imm/memory/current_iteration.json`.
- Do not replace OpenCode's host-specific tool schema with a generic tool platform.
- Do not add new dependencies.

## 5. Acceptance Criteria

- Active docs and packaged runtime docs no longer present retired Python/MCP runtime surfaces as current architecture.
- A focused guard fails on current-tense retired runtime references in active docs or packaged docs and reports file/line evidence.
- Plan and State Ledger runtime behavior remains covered after `imm_core.ts` becomes a compatibility barrel over smaller seams.
- CLI command discovery, plugin-local wrappers, and OpenCode command mapping are covered by tests that prevent supported command drift.
- `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-04-002-refactor-runtime-truth-and-seam-hardening-plan.md --json` validates the Plan.
